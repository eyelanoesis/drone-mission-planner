/**
 * Spec §7 geometry — the product guarantee lives here.
 *
 *   P = property boundary polygon
 *   F = inset(P, setback) − union(buffer(obstacle_i, clearance_i))    flyable
 *   C = inset(F, turnExtension)                                       capture
 *
 *   INVARIANT: every waypoint ∈ F. Asserted before export; fails loudly.
 *
 * Ported from tools/geometry_prototype.py, which stays the oracle (see
 * index.test.ts). Buffer/difference come from Turf on lon/lat; everything else
 * runs in a local metres frame so the grid maths is plain planar arithmetic
 * rather than spherical trigonometry at property scale.
 */
import * as turf from "@turf/turf";
import type { Feature, MultiPolygon, Polygon } from "geojson";

export type AnyPoly = Feature<Polygon | MultiPolygon> | Polygon | MultiPolygon;
export type WaypointKind = "capture-start" | "trigger" | "capture-end" | "turn";

export interface WaypointM {
  x: number;
  y: number;
  kind: WaypointKind;
}

export interface Obstacle {
  geometry: AnyPoly | Feature<GeoJSON.Point> | GeoJSON.Point;
  /** clearance buffer around the obstacle, metres */
  clearance: number;
}

// ─────────────────────────────────────────────────────────── projection

export interface Proj {
  fwd(lon: number, lat: number): [number, number];
  inv(x: number, y: number): [number, number];
}

/**
 * Local equirectangular metres frame about an origin. Accurate at property
 * scale (<~2 km); identical formulation to make_proj() in the Python oracle.
 */
export function makeProj(originLon: number, originLat: number): Proj {
  const M_PER_DEG_LAT = 111_320;
  const mPerDegLon = 111_320 * Math.cos((originLat * Math.PI) / 180);
  return {
    fwd: (lon, lat) => [
      (lon - originLon) * mPerDegLon,
      (lat - originLat) * M_PER_DEG_LAT,
    ],
    inv: (x, y) => [
      originLon + x / mPerDegLon,
      originLat + y / M_PER_DEG_LAT,
    ],
  };
}

// ──────────────────────────────────────────── planar polygons in metres

/** A ring of [x, y] metre coordinates. */
export type RingM = Array<[number, number]>;
/** Polygons in metres: each entry is [exteriorRing, ...holeRings]. */
export type PolyM = RingM[][];

function asGeometry(p: AnyPoly): Polygon | MultiPolygon {
  return "type" in p && p.type === "Feature" ? p.geometry : (p as Polygon | MultiPolygon);
}

export function toMetres(p: AnyPoly, proj: Proj): PolyM {
  const g = asGeometry(p);
  const polys = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
  return polys.map((rings) =>
    rings.map((ring) => ring.map(([lon, lat]) => proj.fwd(lon!, lat!)) as RingM),
  );
}

export function toLonLat(poly: PolyM, proj: Proj): MultiPolygon {
  return {
    type: "MultiPolygon",
    coordinates: poly.map((rings) =>
      rings.map((ring) => ring.map(([x, y]) => proj.inv(x, y))),
    ),
  };
}

function ringContains(ring: RingM, px: number, py: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!;
    const b = ring[j]!;
    if (
      a[1] > py !== b[1] > py &&
      px < ((b[0] - a[0]) * (py - a[1])) / (b[1] - a[1]) + a[0]
    ) {
      inside = !inside;
    }
  }
  return inside;
}

/** Point-in-polygon honouring holes: inside an exterior and outside its holes. */
export function containsPoint(poly: PolyM, px: number, py: number): boolean {
  for (const rings of poly) {
    const [outer, ...holes] = rings;
    if (!outer || !ringContains(outer, px, py)) continue;
    if (holes.some((h) => ringContains(h, px, py))) continue;
    return true;
  }
  return false;
}

export function bounds(poly: PolyM): [number, number, number, number] {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const rings of poly)
    for (const [x, y] of rings[0] ?? []) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  return [minX, minY, maxX, maxY];
}

export function area(poly: PolyM): number {
  const ringArea = (r: RingM) => {
    let a = 0;
    for (let i = 0; i < r.length - 1; i++) {
      a += r[i]![0] * r[i + 1]![1] - r[i + 1]![0] * r[i]![1];
    }
    return a / 2;
  };
  return poly.reduce(
    (sum, rings) =>
      sum +
      Math.abs(ringArea(rings[0] ?? [])) -
      rings.slice(1).reduce((h, r) => h + Math.abs(ringArea(r)), 0),
    0,
  );
}

/**
 * Horizontal scanline ∩ polygon, as [xStart, xEnd] intervals.
 * Even-odd over every ring (exteriors and holes together) yields the inside
 * intervals directly, so exclusion holes split a flight line for free.
 */
export function scanline(poly: PolyM, y: number): Array<[number, number]> {
  const xs: number[] = [];
  for (const rings of poly)
    for (const ring of rings)
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const a = ring[i]!;
        const b = ring[j]!;
        if (a[1] > y !== b[1] > y) {
          xs.push(((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]);
        }
      }
  xs.sort((p, q) => p - q);
  const segs: Array<[number, number]> = [];
  for (let i = 0; i + 1 < xs.length; i += 2) segs.push([xs[i]!, xs[i + 1]!]);
  return segs;
}

// ───────────────────────────────────────────────────────── the regions

function toFeature(p: AnyPoly): Feature<Polygon | MultiPolygon> {
  return "type" in p && p.type === "Feature"
    ? p
    : turf.feature(p as Polygon | MultiPolygon);
}

/** F = P inset by `setback`, minus every buffered obstacle. Metres. */
export function flyableRegion(
  P: AnyPoly,
  setback: number,
  obstacles: Obstacle[] = [],
): Feature<Polygon | MultiPolygon> {
  const inset = turf.buffer(toFeature(P), -setback, { units: "meters" });
  if (!inset || turf.area(inset) === 0) {
    throw new Error(`setback ${setback} m swallows the whole polygon`);
  }
  let F = inset as Feature<Polygon | MultiPolygon>;
  for (const o of obstacles) {
    const buffered = turf.buffer(o.geometry as never, o.clearance, {
      units: "meters",
    });
    if (!buffered) continue;
    const cut = turf.difference(
      turf.featureCollection([F, buffered as Feature<Polygon | MultiPolygon>]),
    );
    if (!cut) throw new Error("obstacles consume the entire flyable region");
    F = cut as Feature<Polygon | MultiPolygon>;
  }
  return F;
}

/** C = F inset by the turn allowance — where capture lines may start and end. */
export function captureRegion(
  F: Feature<Polygon | MultiPolygon>,
  turnExtension: number,
): Feature<Polygon | MultiPolygon> {
  if (turnExtension === 0) return F;
  const C = turf.buffer(F, -turnExtension, { units: "meters" });
  if (!C || turf.area(C) === 0) {
    throw new Error(
      "turnExtension leaves no capture area; reduce it or the setback",
    );
  }
  return C as Feature<Polygon | MultiPolygon>;
}

// ──────────────────────────────────────────────────────────── the grid

function rotate(
  x: number,
  y: number,
  deg: number,
  ox: number,
  oy: number,
): [number, number] {
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r), s = Math.sin(r);
  const dx = x - ox, dy = y - oy;
  return [ox + dx * c - dy * s, oy + dx * s + dy * c];
}

function rotatePoly(poly: PolyM, deg: number, ox: number, oy: number): PolyM {
  return poly.map((rings) =>
    rings.map((ring) => ring.map(([x, y]) => rotate(x, y, deg, ox, oy)) as RingM),
  );
}

export interface GridOptions {
  lineSpacing: number;
  triggerSpacing: number;
  /** flight-line bearing, degrees */
  heading: number;
}

/**
 * Serpentine capture lines clipped to C, connected by turnarounds inside F.
 *
 * Turn strategy is stop-at-point (spec §7.4): the connector between line ends
 * is a straight hop, the aircraft stops, translates, reverses. Line ends are
 * held inside C so the deceleration allowance stays within F.
 */
export function lawnmower(
  Cm: PolyM,
  _Fm: PolyM,
  { lineSpacing, triggerSpacing, heading }: GridOptions,
): WaypointM[] {
  const [bx0, by0, bx1, by1] = bounds(Cm);
  const ox = (bx0 + bx1) / 2, oy = (by0 + by1) / 2;
  const Cr = rotatePoly(Cm, -heading, ox, oy);
  const [, minY, , maxY] = bounds(Cr);

  const rows: Array<{ y: number; segs: Array<[number, number]> }> = [];
  for (let y = minY + lineSpacing / 2; y <= maxY; y += lineSpacing) {
    const segs = scanline(Cr, y).filter(([a, b]) => b - a > 0.5);
    if (segs.length) rows.push({ y, segs });
  }
  if (!rows.length) {
    throw new Error("no flight lines fit; check spacing vs. area size");
  }

  const wps: WaypointM[] = [];
  let direction = 1;
  let prevEnd: [number, number] | null = null;

  for (const { y, segs } of rows) {
    const ordered = [...segs].sort((p, q) =>
      direction > 0 ? p[0] - q[0] : q[0] - p[0],
    );
    for (const [a, b] of ordered) {
      const start = direction > 0 ? a : b;
      const end = direction > 0 ? b : a;
      if (prevEnd) {
        wps.push({ x: prevEnd[0], y: prevEnd[1], kind: "turn" });
        wps.push({ x: start, y, kind: "turn" });
      }
      wps.push({ x: start, y, kind: "capture-start" });
      const length = Math.abs(b - a);
      const along = Math.sign(end - start) || 1;
      const nTrig = Math.max(0, Math.floor(length / triggerSpacing) - 1);
      for (let i = 1; i <= nTrig; i++) {
        wps.push({ x: start + along * i * triggerSpacing, y, kind: "trigger" });
      }
      wps.push({ x: end, y, kind: "capture-end" });
      prevEnd = [end, y];
    }
    direction *= -1;
  }

  return wps.map(({ x, y, kind }) => {
    const [rx, ry] = rotate(x, y, heading, ox, oy);
    return { x: rx, y: ry, kind };
  });
}

// ───────────────────────────────────────────────────────── the guarantee

export class InvariantViolation extends Error {
  constructor(
    message: string,
    readonly offenders: Array<{ index: number; wp: WaypointM }>,
  ) {
    super(message);
    this.name = "InvariantViolation";
  }
}

/**
 * THE product guarantee (spec §7.2). Export must not proceed if this throws.
 * `tol` is numerical slack only — never widen it to make a mission pass.
 */
export function assertInvariant(
  waypoints: WaypointM[],
  Fm: PolyM,
  tol = 0.05,
): true {
  const offenders = waypoints
    .map((wp, index) => ({ index, wp }))
    .filter(({ wp }) => !containsPointTol(Fm, wp.x, wp.y, tol));
  if (offenders.length) {
    const detail = offenders
      .slice(0, 10)
      .map(
        ({ index, wp }) =>
          `  wp[${index}] (${wp.kind}) at local (${wp.x.toFixed(2)}, ${wp.y.toFixed(2)}) m`,
      )
      .join("\n");
    throw new InvariantViolation(
      `INVARIANT VIOLATED: ${offenders.length} waypoint(s) outside the flyable ` +
        `region F.\n${detail}\nExport must not proceed.`,
      offenders,
    );
  }
  return true;
}

function containsPointTol(poly: PolyM, x: number, y: number, tol: number) {
  if (containsPoint(poly, x, y)) return true;
  if (tol <= 0) return false;
  // Cheap dilation: accept a point within `tol` of being inside.
  for (const [dx, dy] of [[tol, 0], [-tol, 0], [0, tol], [0, -tol]] as const) {
    if (containsPoint(poly, x + dx, y + dy)) return true;
  }
  return false;
}

/**
 * Secondary check: the straight segments BETWEEN waypoints must also stay in F.
 * A serpentine connector can cut across an exclusion hole or a concave corner
 * even when both of its endpoints are inside. Returns the offending index pairs.
 */
export function checkRouteEdges(
  waypoints: WaypointM[],
  Fm: PolyM,
  step = 0.5,
): Array<[number, number]> {
  const bad: Array<[number, number]> = [];
  for (let i = 0; i < waypoints.length - 1; i++) {
    const a = waypoints[i]!;
    const b = waypoints[i + 1]!;
    const dist = Math.hypot(b.x - a.x, b.y - a.y);
    const n = Math.max(2, Math.min(Math.ceil(dist / step), 4000));
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      if (!containsPointTol(Fm, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, 0.05)) {
        bad.push([i, i + 1]);
        break;
      }
    }
  }
  return bad;
}
