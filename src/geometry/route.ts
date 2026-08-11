/**
 * Connector routing — keeping the path between capture lines inside F.
 *
 * lawnmower() connects flight-line ends with straight hops. Where an exclusion
 * splits a line, or the parcel is concave, that hop leaves F even though both
 * of its endpoints are inside it. This module routes around instead.
 *
 * DESIGN NOTE — why clearance and not containment.
 * The rest of the module asks "is this point inside F?". That question is
 * ill-posed at the boundary itself, and a router that navigates via F's own
 * vertices asks it there every time: a waypoint at zero clearance is legal or
 * illegal according to floating-point noise. So routing decisions are made on
 * DISTANCE instead — every emitted waypoint and segment is at least `eps`
 * metres from ∂F — which is a question the arithmetic can answer unambiguously.
 *
 * Two-level offset: candidate nodes sit at delta = 2·eps from the boundary,
 * while graph edges are only required to clear eps. delta > eps is a
 * CORRECTNESS REQUIREMENT, not a tuning knob. Turf discretises a buffered
 * circle into a 32-gon; the chord between two adjacent nodes offset by delta
 * passes at distance exactly delta from the arc. Validating that chord at the
 * same delta is a coin flip — measured, only 10 of 32 chords around the demo
 * site's 12 m mast were admitted, leaving the graph disconnected and every
 * connector "unreachable". At delta = 2·eps: 32 of 32.
 *
 * Nothing here is trusted on its own. Whatever this module produces must still
 * pass assertInvariant and checkRouteEdges — two independently written
 * predicates — before anything is exported.
 */
import {
  assertInvariant,
  bounds,
  checkRouteEdges,
  containsPoint,
  rotate,
  rotatePoly,
  scanline,
  type GridOptions,
  type PolyM,
  type RingM,
  type WaypointM,
} from "./index.js";

export type Pt = readonly [number, number];
export type EdgeList = ReadonlyArray<readonly [Pt, Pt]>;

/** Clearance guaranteed for every routed waypoint and segment, metres. */
export const EPS_ROUTE = 0.5;
/** Node offset as a multiple of eps. MUST be > 1 — see the design note. */
export const K_OFFSET = 2;
const MITRE_LIMIT = 4;
const NODE_MERGE = 0.01;
const DEGEN_EDGE = 1e-9;
const MIN_HOP = 0.1;
const MAX_VIA = 8;
const MAX_DETOUR = 4;

export interface RouteOptions {
  routeClearance?: number;
  /** The turnExtension C was built with. Checked against routeClearance. */
  turnExtension?: number;
  nodeOffsetFactor?: number;
  maxViaPerConnector?: number;
  maxDetourFactor?: number;
}

// ───────────────────────────────────────────── exact distance predicates

function pointSegDist2(p: Pt, a: Pt, b: Pt): number {
  const vx = b[0] - a[0], vy = b[1] - a[1];
  const wx = p[0] - a[0], wy = p[1] - a[1];
  const L2 = vx * vx + vy * vy;
  const t = L2 === 0 ? 0 : Math.max(0, Math.min(1, (wx * vx + wy * vy) / L2));
  const dx = wx - t * vx, dy = wy - t * vy;
  return dx * dx + dy * dy;
}

const cross = (ax: number, ay: number, bx: number, by: number) => ax * by - ay * bx;

function properIntersect(p: Pt, q: Pt, a: Pt, b: Pt): boolean {
  const d1 = cross(q[0] - p[0], q[1] - p[1], a[0] - p[0], a[1] - p[1]);
  const d2 = cross(q[0] - p[0], q[1] - p[1], b[0] - p[0], b[1] - p[1]);
  const d3 = cross(b[0] - a[0], b[1] - a[1], p[0] - a[0], p[1] - a[1]);
  const d4 = cross(b[0] - a[0], b[1] - a[1], q[0] - a[0], q[1] - a[1]);
  return d1 > 0 !== d2 > 0 && d3 > 0 !== d4 > 0;
}

/**
 * Squared distance between two segments. Collinear and endpoint-touching cases
 * deliberately fall through the sign test — their four endpoint distances are
 * ~0, so they are rejected by the clearance threshold anyway. The configurations
 * where the sign test is unreliable are exactly the ones already excluded.
 */
function segSegDist2(p: Pt, q: Pt, a: Pt, b: Pt): number {
  if (properIntersect(p, q, a, b)) return 0;
  return Math.min(
    pointSegDist2(p, a, b), pointSegDist2(q, a, b),
    pointSegDist2(a, p, q), pointSegDist2(b, p, q),
  );
}

export function ringEdges(poly: PolyM): EdgeList {
  const out: Array<readonly [Pt, Pt]> = [];
  for (const rings of poly)
    for (const ring of rings)
      for (let i = 0, n = ring.length; i < n; i++) {
        const a = ring[i]!;
        const b = ring[(i + 1) % n]!;
        if (Math.hypot(b[0] - a[0], b[1] - a[1]) > DEGEN_EDGE) out.push([a, b]);
      }
  return out;
}

export function pointClearance(edges: EdgeList, p: Pt): number {
  let best = Infinity;
  for (const [a, b] of edges) best = Math.min(best, pointSegDist2(p, a, b));
  return Math.sqrt(best);
}

export function segmentClearance(edges: EdgeList, p: Pt, q: Pt): number {
  let best = Infinity;
  for (const [a, b] of edges) best = Math.min(best, segSegDist2(p, q, a, b));
  return Math.sqrt(best);
}

export function clearPoint(poly: PolyM, edges: EdgeList, p: Pt, eps: number): boolean {
  if (pointClearance(edges, p) < eps) return false;
  return containsPoint(poly, p[0], p[1]);
}

/**
 * Is the segment p→q at least `eps` from every boundary edge AND inside F?
 *
 * Being >= eps from every edge means the segment cannot cross ∂F, so it lies
 * wholly inside or wholly outside; one midpoint test then decides which, and
 * that test is taken far from the boundary where it is unambiguous.
 */
export function clearSegment(
  poly: PolyM, edges: EdgeList, p: Pt, q: Pt, eps: number,
): boolean {
  if (p[0] === q[0] && p[1] === q[1]) return clearPoint(poly, edges, p, eps);
  if (segmentClearance(edges, p, q) < eps) return false;
  return containsPoint(poly, (p[0] + q[0]) / 2, (p[1] + q[1]) / 2);
}

// ───────────────────────────────────────────────── ring orientation

function signedArea(ring: RingM): number {
  let a = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const p = ring[i]!, q = ring[(i + 1) % n]!;
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

/**
 * Exteriors CCW, holes CW, so that traversing ANY ring in order puts the
 * interior of F on the left and `cross(uIn, uOut) < 0` means reflex uniformly.
 *
 * Turf happens to return this orientation today, but it is not contractual: a
 * CCW hole would classify every hole vertex as convex, generate zero nodes, and
 * report every connector unreachable. Silent total loss of function, so this
 * runs unconditionally.
 */
export function orientRings(poly: PolyM): PolyM {
  return poly.map((rings) =>
    rings.map((ring, i) => {
      const want = i === 0 ? 1 : -1;
      return Math.sign(signedArea(ring)) === want ? ring : ([...ring].reverse() as RingM);
    }),
  );
}

// ─────────────────────────────────────────────────────── the nav graph

const unit = (dx: number, dy: number): Pt => {
  const L = Math.hypot(dx, dy);
  return [dx / L, dy / L];
};
/** Left normal of a direction — points into F given the orientation above. */
const leftNormal = (u: Pt): Pt => [-u[1], u[0]];

/**
 * Candidate via-points: reflex vertices only, offset inward by `delta`.
 *
 * A taut shortest path bends only at reflex vertices, so convex ones are
 * skipped. Nodes are the analytic mitre offset — one node per corner, against
 * the 65 that re-buffering the polygon with Turf would produce for the same
 * clearance. F's own vertices are never used.
 */
export function routeNodes(
  poly: PolyM, edges: EdgeList, delta: number, eps: number,
): Pt[] {
  const out: Pt[] = [];
  for (const rings of orientRings(poly))
    for (const ring of rings) {
      const n = ring.length - 1 > 0 && ring[0]![0] === ring[ring.length - 1]![0] &&
        ring[0]![1] === ring[ring.length - 1]![1] ? ring.length - 1 : ring.length;
      for (let i = 0; i < n; i++) {
        const prev = ring[(i - 1 + n) % n]!, v = ring[i]!, next = ring[(i + 1) % n]!;
        if (Math.hypot(v[0] - prev[0], v[1] - prev[1]) < DEGEN_EDGE) continue;
        if (Math.hypot(next[0] - v[0], next[1] - v[1]) < DEGEN_EDGE) continue;
        const u1 = unit(v[0] - prev[0], v[1] - prev[1]);
        const u2 = unit(next[0] - v[0], next[1] - v[1]);
        if (cross(u1[0], u1[1], u2[0], u2[1]) >= 0) continue; // convex/straight
        const n1 = leftNormal(u1), n2 = leftNormal(u2);
        const den = 1 + (n1[0] * n2[0] + n1[1] * n2[1]);
        let placed = false;
        if (den > 1e-9) {
          const mi: Pt = [(n1[0] + n2[0]) / den, (n1[1] + n2[1]) / den];
          if (Math.hypot(mi[0], mi[1]) <= MITRE_LIMIT) {
            const p: Pt = [v[0] + delta * mi[0], v[1] + delta * mi[1]];
            if (clearPoint(poly, edges, p, eps)) { out.push(p); placed = true; }
          }
        }
        if (!placed) {
          // Needle vertex, or the mitre ran past the limit: fall back to two
          // per-edge nodes slid `delta` clear of the vertex itself. Dropping a
          // node can only cost a route — it can never create an unsafe one.
          for (const [nrm, along] of [[n1, [-u1[0], -u1[1]] as Pt], [n2, u2]] as const) {
            const p: Pt = [
              v[0] + delta * nrm[0] + delta * along[0],
              v[1] + delta * nrm[1] + delta * along[1],
            ];
            if (clearPoint(poly, edges, p, eps)) out.push(p);
          }
        }
      }
    }
  const kept: Pt[] = [];
  for (const p of out) {
    if (!kept.some((q) => Math.hypot(p[0] - q[0], p[1] - q[1]) < NODE_MERGE)) kept.push(p);
  }
  return kept;
}

export interface NavGraph {
  readonly poly: PolyM;
  readonly edges: EdgeList;
  readonly nodes: readonly Pt[];
  readonly adj: ReadonlyArray<ReadonlyArray<readonly [number, number]>>;
  readonly eps: number;
  readonly delta: number;
}

export function buildNavGraph(Fm: PolyM, opts: RouteOptions = {}): NavGraph {
  const poly = orientRings(Fm);
  const edges = ringEdges(poly);
  const eps = opts.routeClearance ?? EPS_ROUTE;
  const delta = eps * (opts.nodeOffsetFactor ?? K_OFFSET);
  if (!(delta > eps)) {
    throw new Error(
      `nodeOffsetFactor must exceed 1 (got ${opts.nodeOffsetFactor}); nodes ` +
      `placed at exactly the edge-clearance distance make graph connectivity a ` +
      `floating-point coin flip — see the design note in route.ts`,
    );
  }
  const nodes = routeNodes(poly, edges, delta, eps);
  const adj: Array<Array<readonly [number, number]>> = nodes.map(() => []);
  for (let i = 0; i < nodes.length; i++)
    for (let j = i + 1; j < nodes.length; j++)
      if (clearSegment(poly, edges, nodes[i]!, nodes[j]!, eps)) {
        const w = Math.hypot(nodes[i]![0] - nodes[j]![0], nodes[i]![1] - nodes[j]![1]);
        adj[i]!.push([j, w]);
        adj[j]!.push([i, w]);
      }
  return { poly, edges, nodes, adj, eps, delta };
}

// ────────────────────────────────────────────────────── one connector

export type ConnectorResult =
  | { ok: true; via: Pt[]; direct: boolean; length: number; minClearance: number;
      flags: ReadonlyArray<"via-budget" | "detour"> }
  | { ok: false; reason: "unreachable" | "passage-too-narrow"; from: Pt; to: Pt;
      hint: string };

function dijkstra(
  adj: ReadonlyArray<ReadonlyArray<readonly [number, number]>>,
  from: number, to: number,
): number[] | null {
  const n = adj.length;
  const dist = new Array<number>(n).fill(Infinity);
  const prev = new Array<number>(n).fill(-1);
  const done = new Array<boolean>(n).fill(false);
  dist[from] = 0;
  for (;;) {
    let u = -1, best = Infinity;
    for (let i = 0; i < n; i++) if (!done[i] && dist[i]! < best) { best = dist[i]!; u = i; }
    if (u === -1) break;
    if (u === to) break;
    done[u] = true;
    for (const [v, w] of adj[u]!) {
      const alt = dist[u]! + w;
      if (alt < dist[v]!) { dist[v] = alt; prev[v] = u; }
    }
  }
  if (dist[to] === Infinity) return null;
  const path: number[] = [];
  for (let at = to; at !== -1; at = prev[at]!) path.unshift(at);
  return path;
}

/** Shortcut the path, RE-VERIFYING every shortcut rather than inheriting it. */
function stringPull(g: NavGraph, P: Pt[]): Pt[] {
  const out: Pt[] = [];
  let i = 0;
  for (;;) {
    let j = P.length - 1;
    while (j > i + 1 && !clearSegment(g.poly, g.edges, P[i]!, P[j]!, g.eps)) j--;
    if (j === P.length - 1) break;
    out.push(P[j]!);
    i = j;
  }
  return out;
}

export function routeConnector(
  g: NavGraph, s: Pt, t: Pt, opts: RouteOptions = {},
): ConnectorResult {
  const straight = Math.hypot(t[0] - s[0], t[1] - s[1]);
  const none = { via: [] as Pt[], direct: true, length: straight, flags: [] as never[] };
  if (straight < MIN_HOP) {
    return { ok: true, ...none, minClearance: pointClearance(g.edges, s) };
  }
  if (clearSegment(g.poly, g.edges, s, t, g.eps)) {
    return { ok: true, ...none, minClearance: segmentClearance(g.edges, s, t) };
  }

  // Temporary S/T nodes. The static adjacency is copied, never mutated.
  const n = g.nodes.length;
  const adj: Array<Array<readonly [number, number]>> = g.adj.map((a) => [...a]);
  adj.push([], []);
  const S = n, T = n + 1;
  for (let i = 0; i < n; i++) {
    const p = g.nodes[i]!;
    if (clearSegment(g.poly, g.edges, s, p, g.eps)) {
      const w = Math.hypot(s[0] - p[0], s[1] - p[1]);
      adj[S]!.push([i, w]); adj[i]!.push([S, w]);
    }
    if (clearSegment(g.poly, g.edges, t, p, g.eps)) {
      const w = Math.hypot(t[0] - p[0], t[1] - p[1]);
      adj[T]!.push([i, w]); adj[i]!.push([T, w]);
    }
  }

  const path = dijkstra(adj, S, T);
  if (!path) {
    // Is there a corridor at all, just too narrow? The reduced-eps probe's
    // OUTPUT IS A STRING — never a path. This is the only place a smaller
    // epsilon appears, and it cannot produce something flyable.
    const narrow = probeNarrow(g, s, t);
    return {
      ok: false, from: s, to: t,
      reason: narrow ? "passage-too-narrow" : "unreachable",
      hint: narrow
        ? `a corridor exists but is narrower than 2x routeClearance ` +
          `(${g.eps} m); lower routeClearance knowingly, or accept the split`
        : `F is genuinely split between these points; this parcel needs ` +
          `more than one flight`,
    };
  }

  const full: Pt[] = [s, ...path.slice(1, -1).map((i) => g.nodes[i]!), t];
  const via = stringPull(g, full);
  const pts = [s, ...via, t];
  let length = 0, minClearance = Infinity;
  for (let i = 0; i + 1 < pts.length; i++) {
    length += Math.hypot(pts[i + 1]![0] - pts[i]![0], pts[i + 1]![1] - pts[i]![1]);
    minClearance = Math.min(minClearance, segmentClearance(g.edges, pts[i]!, pts[i + 1]!));
  }
  const flags: Array<"via-budget" | "detour"> = [];
  if (via.length > (opts.maxViaPerConnector ?? MAX_VIA)) flags.push("via-budget");
  if (length > (opts.maxDetourFactor ?? MAX_DETOUR) * straight) flags.push("detour");
  // A long detour is LEGAL. Breaking the leg would land the pilot and make them
  // relaunch, which is strictly worse than extra waypoints — so these are
  // report flags, and genuine unreachability is the only thing that breaks a leg.
  return { ok: true, via, direct: false, length, minClearance, flags };
}

function probeNarrow(g: NavGraph, s: Pt, t: Pt): boolean {
  const eps = g.eps / 4;
  const nodes = routeNodes(g.poly, g.edges, g.delta / 4, eps);
  const adj: Array<Array<readonly [number, number]>> = nodes.map(() => []);
  for (let i = 0; i < nodes.length; i++)
    for (let j = i + 1; j < nodes.length; j++)
      if (clearSegment(g.poly, g.edges, nodes[i]!, nodes[j]!, eps)) {
        const w = Math.hypot(nodes[i]![0] - nodes[j]![0], nodes[i]![1] - nodes[j]![1]);
        adj[i]!.push([j, w]); adj[j]!.push([i, w]);
      }
  const n = nodes.length;
  adj.push([], []);
  for (let i = 0; i < n; i++) {
    if (clearSegment(g.poly, g.edges, s, nodes[i]!, eps)) { adj[n]!.push([i, 1]); adj[i]!.push([n, 1]); }
    if (clearSegment(g.poly, g.edges, t, nodes[i]!, eps)) { adj[n + 1]!.push([i, 1]); adj[i]!.push([n + 1, 1]); }
  }
  return dijkstra(adj, n, n + 1) !== null;
}

// ────────────────────────────────────────────────────────── assembly

export interface RouteReport {
  legs: number;
  viaWaypoints: number;
  routedConnectors: number;
  directConnectors: number;
  breaks: Array<{ afterLeg: number; from: Pt; to: Pt;
                  reason: "unreachable" | "passage-too-narrow"; hint: string }>;
  detourMetres: number;
  minWaypointClearance: number;
  flags: string[];
}

export interface MissionPlan {
  legs: WaypointM[][];
  report: RouteReport;
}

export class RouteInvariantViolation extends Error {
  constructor(message: string, readonly leg: number,
              readonly offenders: Array<[number, number]>) {
    super(message);
    this.name = "RouteInvariantViolation";
  }
}

function componentIndex(poly: PolyM, x: number, y: number): number {
  for (let i = 0; i < poly.length; i++) if (containsPoint([poly[i]!], x, y)) return i;
  return -1;
}

/**
 * Serpentine capture lines clipped to C, with connectors routed inside F.
 *
 * Emits NO waypoint at a connector's own endpoints — the adjacent capture-end
 * and capture-start already occupy those coordinates. lawnmower() emits both,
 * which costs 32 duplicate waypoints on the demo mission (14% of a budget
 * capped near 99). That saving more than pays for the via points routing adds.
 */
export function lawnmowerRouted(
  Cm: PolyM, Fm: PolyM, grid: GridOptions, opts: RouteOptions = {},
): MissionPlan {
  const { lineSpacing, triggerSpacing, heading } = grid;
  const eps = opts.routeClearance ?? EPS_ROUTE;

  if (opts.turnExtension !== undefined && opts.turnExtension < eps) {
    throw new Error(
      `turnExtension ${opts.turnExtension} m is below routeClearance ${eps} m: ` +
      `capture-line ends sit on the boundary of C, so they would start with ` +
      `less clearance than the router guarantees for everything else. Raise ` +
      `turnExtension to at least ${eps} m, or lower routeClearance knowingly.`,
    );
  }

  const [bx0, by0, bx1, by1] = bounds(Cm);
  const ox = (bx0 + bx1) / 2, oy = (by0 + by1) / 2;
  const Cr = rotatePoly(Cm, -heading, ox, oy);
  // F is rotated into the sweep frame too. lawnmower() ignores F entirely; the
  // router cannot, or it would test containment in the wrong frame.
  const Fr = rotatePoly(Fm, -heading, ox, oy);
  const g = buildNavGraph(Fr, opts);

  const [, minY, , maxY] = bounds(Cr);
  const segs: Array<{ y: number; a: number; b: number; comp: number }> = [];
  for (let y = minY + lineSpacing / 2; y <= maxY; y += lineSpacing) {
    for (const [a, b] of scanline(Cr, y)) {
      if (b - a > 0.5) segs.push({ y, a, b, comp: componentIndex(Fr, (a + b) / 2, y) });
    }
  }
  if (!segs.length) throw new Error("no flight lines fit; check spacing vs. area size");

  const report: RouteReport = {
    legs: 0, viaWaypoints: 0, routedConnectors: 0, directConnectors: 0,
    breaks: [], detourMetres: 0, minWaypointClearance: Infinity, flags: [],
  };

  const legs: WaypointM[][] = [[]];
  let cur = legs[0]!;
  let prevEnd: Pt | null = null;

  // Finish one connected component of F before starting the next. Without this
  // a parcel cut in two produces a break per ROW rather than one per component.
  for (const comp of [...new Set(segs.map((s) => s.comp))].sort((p, q) => p - q)) {
    const mine = segs.filter((s) => s.comp === comp);
    let direction = 1;
    for (const y of [...new Set(mine.map((s) => s.y))].sort((p, q) => p - q)) {
      const row = mine.filter((s) => s.y === y)
        .sort((p, q) => (direction > 0 ? p.a - q.a : q.a - p.a));
      for (const s of row) {
        const start = direction > 0 ? s.a : s.b;
        const end = direction > 0 ? s.b : s.a;
        if (prevEnd) {
          const r = routeConnector(g, prevEnd, [start, y], opts);
          if (r.ok) {
            for (const p of r.via) cur.push({ x: p[0], y: p[1], kind: "turn" });
            report.viaWaypoints += r.via.length;
            if (r.direct) report.directConnectors++;
            else {
              report.routedConnectors++;
              report.detourMetres +=
                r.length - Math.hypot(start - prevEnd[0], y - prevEnd[1]);
            }
            for (const f of r.flags) if (!report.flags.includes(f)) report.flags.push(f);
          } else {
            report.breaks.push({ afterLeg: legs.length - 1, from: prevEnd,
                                 to: [start, y], reason: r.reason, hint: r.hint });
            cur = [];
            legs.push(cur);
          }
        }
        cur.push({ x: start, y, kind: "capture-start" });
        const length = Math.abs(s.b - s.a);
        const along = Math.sign(end - start) || 1;
        const nTrig = Math.max(0, Math.floor(length / triggerSpacing) - 1);
        for (let i = 1; i <= nTrig; i++) {
          cur.push({ x: start + along * i * triggerSpacing, y, kind: "trigger" });
        }
        cur.push({ x: end, y, kind: "capture-end" });
        prevEnd = [end, y];
      }
      direction *= -1;
    }
  }

  const out = legs
    .filter((l) => l.length)
    .map((leg) => leg.map(({ x, y, kind }) => {
      const [rx, ry] = rotate(x, y, heading, ox, oy);
      return { x: rx, y: ry, kind };
    }));

  for (const leg of out)
    for (const w of leg) {
      report.minWaypointClearance = Math.min(
        report.minWaypointClearance, pointClearance(ringEdges(Fm), [w.x, w.y]));
    }
  report.legs = out.length;

  const plan = { legs: out, report };
  assertPlan(plan, Fm);
  return plan;
}

/**
 * The gate. Both predicates, per leg — the clearance-based router and the
 * independently written containment checks must agree before anything ships.
 */
export function assertPlan(plan: MissionPlan, Fm: PolyM, tol = 0.05): true {
  plan.legs.forEach((leg, k) => {
    assertInvariant(leg, Fm, tol);
    const bad = checkRouteEdges(leg, Fm, tol);
    if (bad.length) {
      throw new RouteInvariantViolation(
        `ROUTE INVARIANT VIOLATED: leg ${k} has ${bad.length} segment(s) ` +
        `leaving the flyable region F. Export must not proceed.`,
        k, bad,
      );
    }
  });
  return true;
}
