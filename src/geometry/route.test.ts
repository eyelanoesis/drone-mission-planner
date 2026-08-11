/**
 * Connector-routing tests.
 *
 * The contract is narrow and absolute: either a connector is verified inside F,
 * or the leg breaks and the operator is told. There is no path through this
 * module that emits an unverified straight hop.
 *
 * Every numeric expectation below was measured, not assumed.
 */
import { describe, expect, it } from "vitest";
import * as turf from "@turf/turf";
import type { Feature, Polygon } from "geojson";
import {
  captureRegion, checkRouteEdges, flyableRegion, lawnmower, makeProj, toMetres,
  type PolyM,
} from "./index.js";
import {
  buildNavGraph, clearPoint, clearSegment, lawnmowerRouted, orientRings,
  pointClearance, ringEdges, routeConnector, routeNodes,
  type Pt,
} from "./route.js";

const DEMO_SITE: Feature<Polygon> = turf.polygon([[
  [12.3400, 55.9700], [12.3428, 55.9701], [12.3430, 55.9691],
  [12.3415, 55.9688], [12.3401, 55.9690], [12.3400, 55.9700],
]]);
const DEMO_MAST = turf.point([12.3416, 55.9695]);
const GRID = { lineSpacing: 12, triggerSpacing: 8, heading: 90 };
const proj = (() => {
  const c = turf.centroid(DEMO_SITE).geometry.coordinates;
  return makeProj(c[0]!, c[1]!);
})();

function regions(obstacles: Array<{ geometry: never; clearance: number }> = [], turnExt = 2) {
  const F = flyableRegion(DEMO_SITE, 5, obstacles);
  const C = captureRegion(F, turnExt);
  return { Fm: toMetres(F, proj), Cm: toMetres(C, proj), F };
}
const MAST = [{ geometry: DEMO_MAST as never, clearance: 12 }];

describe("the headline: the two bad connectors are gone", () => {
  it("routes the demo site clean, at tolerance ZERO", () => {
    const { Fm, Cm } = regions(MAST);
    expect(checkRouteEdges(lawnmower(Cm, Fm, GRID), Fm, 0)).toHaveLength(2);

    const plan = lawnmowerRouted(Cm, Fm, GRID);
    const all = plan.legs.flat();
    expect(plan.legs).toHaveLength(1);
    expect(plan.report.breaks).toEqual([]);
    expect(plan.report.viaWaypoints).toBe(6);
    // 226 unrouted -> 200: +6 via, -32 coincident duplicates
    expect(all).toHaveLength(200);
    // tol 0, not the 0.05 slack — the router does not need the tolerance
    for (const leg of plan.legs) expect(checkRouteEdges(leg, Fm, 0)).toEqual([]);
  });

  it("costs no photo coverage — the trigger set is unchanged", () => {
    const { Fm, Cm } = regions(MAST);
    const un = lawnmower(Cm, Fm, GRID).filter((w) => w.kind === "trigger");
    const rt = lawnmowerRouted(Cm, Fm, GRID).legs.flat().filter((w) => w.kind === "trigger");
    expect(rt).toHaveLength(un.length);
    expect(rt.map((w) => [+w.x.toFixed(6), +w.y.toFixed(6)]))
      .toEqual(un.map((w) => [+w.x.toFixed(6), +w.y.toFixed(6)]));
  });

  it("emits no coincident waypoints (lawnmower emits 32)", () => {
    const { Fm, Cm } = regions(MAST);
    const coincident = (w: Array<{ x: number; y: number }>) =>
      w.filter((_, i) => i + 1 < w.length &&
        Math.hypot(w[i + 1]!.x - w[i]!.x, w[i + 1]!.y - w[i]!.y) < 1e-3).length;
    expect(coincident(lawnmower(Cm, Fm, GRID))).toBe(32);
    expect(coincident(lawnmowerRouted(Cm, Fm, GRID).legs.flat())).toBe(0);
  });
});

describe("clearance is real, not asserted", () => {
  it("every waypoint clears 1 m — 20x the assertion tolerance", () => {
    const { Fm, Cm } = regions(MAST);
    const E = ringEdges(Fm);
    const all = lawnmowerRouted(Cm, Fm, GRID).legs.flat();
    const min = Math.min(...all.map((w) => pointClearance(E, [w.x, w.y])));
    // predicted delta/cos(pi/32) = 1.00482 for the mitre offset on a 32-gon arc
    expect(min).toBeGreaterThan(1.0);
    expect(min).toBeCloseTo(1.0048, 3);
  });

  it("never emits one of F's own vertices", () => {
    const { Fm, Cm } = regions(MAST);
    const verts: Pt[] = [];
    for (const rings of Fm) for (const r of rings) for (const v of r) verts.push(v);
    for (const w of lawnmowerRouted(Cm, Fm, GRID).legs.flat()) {
      const hit = verts.some((v) => Math.hypot(v[0] - w.x, v[1] - w.y) < 1e-9);
      expect(hit).toBe(false);
    }
  });
});

describe("node offset must exceed edge clearance — the correctness requirement", () => {
  it("rejects nodeOffsetFactor <= 1 rather than silently disconnecting", () => {
    const { Fm } = regions(MAST);
    expect(() => buildNavGraph(Fm, { nodeOffsetFactor: 1 })).toThrow(/must exceed 1/);
    expect(() => buildNavGraph(Fm, { nodeOffsetFactor: 0.5 })).toThrow(/must exceed 1/);
  });

  it("at factor 1 the chords around a buffered circle are a coin flip", () => {
    // Placing nodes at exactly the edge-clearance distance puts the chord
    // between adjacent nodes at distance EXACTLY eps from the arc it spans.
    const { Fm } = regions(MAST);
    const E = ringEdges(Fm);
    const eps = 0.5;
    const admitted = (factor: number) => {
      const nodes = routeNodes(orientRings(Fm), E, eps * factor, eps);
      let ok = 0, total = 0;
      for (let i = 0; i + 1 < nodes.length; i++) {
        total++;
        if (clearSegment(Fm, E, nodes[i]!, nodes[i + 1]!, eps)) ok++;
      }
      return { ok, total };
    };
    const one = admitted(1);
    const two = admitted(2);
    expect(one.ok).toBeLessThan(one.total);          // partial — the coin flip
    expect(two.ok / two.total).toBeGreaterThan(one.ok / one.total);
  });
});

describe("heading independence — F is rotated into the sweep frame too", () => {
  // lawnmower() ignores F entirely; the router cannot, or it tests containment
  // in the wrong frame. A non-axis-aligned heading is what catches that.
  it.each([0, 37, 90, 143, 180, 270, -270])("heading %s", (heading) => {
    const { Fm, Cm } = regions(MAST);
    const plan = lawnmowerRouted(Cm, Fm, { ...GRID, heading });
    expect(plan.report.breaks).toEqual([]);
    for (const leg of plan.legs) expect(checkRouteEdges(leg, Fm, 0)).toEqual([]);
    // routing is a net saving at every heading
    expect(plan.legs.flat().length)
      .toBeLessThan(lawnmower(Cm, Fm, { ...GRID, heading }).length);
  });
});

describe("refusal, never a silent straight hop", () => {
  it("splits into legs when an obstacle cuts the parcel in two", () => {
    const wall = turf.lineString([[12.3400, 55.96945], [12.3430, 55.96945]]);
    const { Fm, Cm } = regions([{ geometry: wall as never, clearance: 14 }]);
    expect(Fm.length).toBe(2); // genuinely disconnected

    const plan = lawnmowerRouted(Cm, Fm, GRID);
    expect(plan.legs.length).toBeGreaterThan(1);
    expect(plan.report.breaks.length).toBeGreaterThan(0);
    expect(plan.report.breaks[0]!.reason).toBe("unreachable");
    expect(plan.report.breaks[0]!.hint).toMatch(/more than one flight/);
    // and every leg is still clean
    for (const leg of plan.legs) expect(checkRouteEdges(leg, Fm, 0)).toEqual([]);
  });

  it("component grouping keeps the break count to one per component", () => {
    const wall = turf.lineString([[12.3400, 55.96945], [12.3430, 55.96945]]);
    const { Fm, Cm } = regions([{ geometry: wall as never, clearance: 14 }]);
    // ungrouped assembly would break once per ROW; grouped, once per boundary
    expect(lawnmowerRouted(Cm, Fm, GRID).report.breaks).toHaveLength(Fm.length - 1);
  });

  /** Two 100x40 chambers joined by a corridor `w` metres wide. */
  const dumbbell = (w: number): PolyM => [[[
    [0, 0], [100, 0], [100, 40], [50 + w / 2, 40], [50 + w / 2, 60],
    [100, 60], [100, 100], [0, 100], [0, 60], [50 - w / 2, 60],
    [50 - w / 2, 40], [0, 40], [0, 0],
  ]]];

  it("refuses a corridor narrower than the clearance, and says why", () => {
    // 0.8 m wide: the centreline clears only 0.4 m, under the 0.5 m contract
    const g = buildNavGraph(dumbbell(0.8));
    const r = routeConnector(g, [50, 20], [50, 80]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      // a corridor DOES exist — it is just too tight. That is a different fact
      // from the parcel being split, and the operator can act on it.
      expect(r.reason).toBe("passage-too-narrow");
      expect(r.hint).toMatch(/routeClearance/);
    }
  });

  it("routes through a corridor that is wide enough", () => {
    const g = buildNavGraph(dumbbell(3));
    const r = routeConnector(g, [50, 20], [50, 80]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.minClearance).toBeGreaterThanOrEqual(0.5);
  });
});

describe("degenerate geometry", () => {
  it("refuses a segment collinear with a boundary edge", () => {
    const holeBelow: PolyM = [[
      [[0, 0], [100, 0], [100, 100], [0, 100], [0, 0]],
      [[20, 20], [80, 20], [80, 50], [20, 50], [20, 20]],
    ]];
    const E = ringEdges(holeBelow);
    // runs exactly along the hole's top edge: zero clearance, both directions
    expect(clearSegment(holeBelow, E, [10, 50], [90, 50], 0.5)).toBe(false);
    expect(clearSegment(holeBelow, E, [90, 50], [10, 50], 0.5)).toBe(false);
  });

  it("refuses a point at a zero-width pinch that containment would admit", () => {
    // diamond hole touching both sides: the pinch point is 'inside' by the
    // containment test but has zero clearance
    const pinch: PolyM = [[
      [[0, 0], [100, 0], [100, 100], [0, 100], [0, 0]],
      [[0, 50], [50, 20], [100, 50], [50, 80], [0, 50]],
    ]];
    const E = ringEdges(pinch);
    expect(clearPoint(pinch, E, [0, 50], 0.5)).toBe(false);
    expect(clearPoint(pinch, E, [100, 50], 0.5)).toBe(false);
  });

  it("normalises ring orientation whichever way the input winds", () => {
    const { Fm } = regions(MAST);
    const E = ringEdges(Fm);
    const base = routeNodes(Fm, E, 1, 0.5).length;
    expect(base).toBeGreaterThan(0);
    const variants: PolyM[] = [
      Fm.map((rings) => rings.map((r, i) => (i === 0 ? [...r].reverse() : r))) as PolyM,
      Fm.map((rings) => rings.map((r, i) => (i === 0 ? r : [...r].reverse()))) as PolyM,
      Fm.map((rings) => rings.map((r) => [...r].reverse())) as PolyM,
    ];
    for (const v of variants) expect(routeNodes(v, ringEdges(v), 1, 0.5)).toHaveLength(base);
  });

  it("still generates nodes when the obstacle bites the boundary (no hole at all)", () => {
    const near = turf.point([12.3415, 55.97005]);
    const { Fm, Cm } = regions([{ geometry: near as never, clearance: 20 }]);
    expect(Fm[0]!).toHaveLength(1); // folded into the exterior, no hole
    expect(routeNodes(Fm, ringEdges(Fm), 1, 0.5).length).toBeGreaterThan(0);
    const plan = lawnmowerRouted(Cm, Fm, GRID);
    for (const leg of plan.legs) expect(checkRouteEdges(leg, Fm, 0)).toEqual([]);
  });
});

describe("configuration guards", () => {
  it("refuses a turnExtension below routeClearance, naming both values", () => {
    const { Fm, Cm } = regions(MAST, 0.25);
    expect(() => lawnmowerRouted(Cm, Fm, GRID, { turnExtension: 0.25 }))
      .toThrow(/turnExtension 0.25 m is below routeClearance 0.5 m/);
  });
});

describe("load — not circle-shaped, not small", () => {
  it("handles a rectangular exclusion", () => {
    const rect = turf.polygon([[
      [12.3412, 55.96935], [12.3420, 55.96935],
      [12.3420, 55.96965], [12.3412, 55.96965], [12.3412, 55.96935],
    ]]);
    const { Fm, Cm } = regions([{ geometry: rect as never, clearance: 3 }]);
    const plan = lawnmowerRouted(Cm, Fm, GRID);
    for (const leg of plan.legs) expect(checkRouteEdges(leg, Fm, 0)).toEqual([]);
  });

  it("handles five obstacles inside 200 ms", () => {
    const obs = [
      [12.3408, 55.96955], [12.3414, 55.96975], [12.3420, 55.96945],
      [12.3424, 55.96985], [12.3410, 55.96925],
    ].map((c) => ({ geometry: turf.point(c as [number, number]) as never, clearance: 8 }));
    const { Fm, Cm } = regions(obs);
    const t0 = performance.now();
    const plan = lawnmowerRouted(Cm, Fm, GRID);
    expect(performance.now() - t0).toBeLessThan(200);
    for (const leg of plan.legs) expect(checkRouteEdges(leg, Fm, 0)).toEqual([]);
    expect(plan.legs.flat().length)
      .toBeLessThan(lawnmower(Cm, Fm, GRID).length);
  });

  it("is deterministic", () => {
    const { Fm, Cm } = regions(MAST);
    const a = JSON.stringify(lawnmowerRouted(Cm, Fm, GRID).legs);
    const b = JSON.stringify(lawnmowerRouted(Cm, Fm, GRID).legs);
    expect(a).toBe(b);
  });
});

describe("property test: 120 random parcels never emit a bad edge", () => {
  // Deterministic PRNG so a failure is reproducible.
  function mulberry(seed: number) {
    return () => {
      seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  it("either routes clean or breaks the leg — never a bad edge", () => {
    const rnd = mulberry(20260812);
    let planned = 0, breaks = 0, routed = 0;
    for (let iter = 0; iter < 120; iter++) {
      // star-shaped parcel around the demo centroid
      const n = 5 + Math.floor(rnd() * 5);
      const ring: Array<[number, number]> = [];
      for (let i = 0; i < n; i++) {
        const a = (2 * Math.PI * i) / n;
        const r = 0.0009 + rnd() * 0.0009;
        ring.push([12.3415 + r * Math.cos(a) * 1.8, 55.9695 + r * Math.sin(a)]);
      }
      ring.push(ring[0]!);
      const obstacles = Array.from({ length: Math.floor(rnd() * 4) }, () => ({
        geometry: turf.point([
          12.3415 + (rnd() - 0.5) * 0.0012,
          55.9695 + (rnd() - 0.5) * 0.0007,
        ]) as never,
        clearance: 5 + rnd() * 10,
      }));
      let Fm: PolyM, Cm: PolyM;
      try {
        const F = flyableRegion(turf.polygon([ring]), 4, obstacles);
        const C = captureRegion(F, 2);
        Fm = toMetres(F, proj); Cm = toMetres(C, proj);
      } catch { continue; } // setback/turn swallowed it — a legitimate refusal
      let plan;
      try {
        plan = lawnmowerRouted(Cm, Fm, { ...GRID, heading: rnd() * 360 });
      } catch (e) {
        // the only acceptable throw is "no flight lines fit"
        expect(String(e)).toMatch(/no flight lines fit/);
        continue;
      }
      planned++;
      breaks += plan.report.breaks.length;
      routed += plan.report.routedConnectors;
      for (const leg of plan.legs) {
        expect(checkRouteEdges(leg, Fm, 0)).toEqual([]);
        for (const w of leg) {
          expect(Number.isFinite(w.x) && Number.isFinite(w.y)).toBe(true);
        }
      }
    }
    expect(planned).toBeGreaterThan(60);   // the corpus actually exercised it
    expect(routed).toBeGreaterThan(0);     // and actually routed round things
    console.log(`  ${planned} parcels planned, ${routed} connectors routed, ${breaks} legs broken`);
  });
});
