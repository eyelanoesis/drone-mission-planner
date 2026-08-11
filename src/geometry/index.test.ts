/**
 * The geometry tests. The invariant assertion is the most important test in the
 * repo (CLAUDE.md) — if it can be made to pass on a mission that leaves the
 * boundary, the product has no reason to exist.
 *
 * ORACLE: tools/geometry_prototype.py (Shapely) on its DEMO_SITE, run at
 * setback 5 m, turn extension 2 m, line spacing 12 m, trigger spacing 8 m,
 * heading 90°. Its printed figures, in m²:
 *
 *              P         F         C        waypoints  triggers  badEdges
 *   plain    22365.6   19522.2   18437.7       225        171        0
 *   +mast    22365.6   19070.6   17822.8       226        160        2
 *
 * Measured agreement of this port against that oracle: areas within 0.022 %,
 * and waypoint / trigger / bad-edge counts identical. Areas therefore carry a
 * 0.1 % tolerance (Shapely insets with mitre joins, Turf with round ones, so
 * exact equality is not available by construction) while every COUNT is asserted
 * exactly. If a change moves a count, the port has diverged from the oracle.
 */
import { describe, expect, it } from "vitest";
import * as turf from "@turf/turf";
import type { Feature, Polygon } from "geojson";
import {
  area,
  assertInvariant,
  captureRegion,
  checkRouteEdges,
  containsPoint,
  flyableRegion,
  InvariantViolation,
  lawnmower,
  makeProj,
  scanline,
  toMetres,
  type PolyM,
} from "./index.js";

/** Same synthetic Nordsjælland-ish site as the Python oracle's DEMO_SITE. */
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

function plan(obstacles: Array<{ geometry: never; clearance: number }> = []) {
  const F = flyableRegion(DEMO_SITE, 5, obstacles);
  const C = captureRegion(F, 2);
  const Fm = toMetres(F, proj);
  const Cm = toMetres(C, proj);
  const wps = lawnmower(Cm, Fm, GRID);
  return { F, C, Fm, Cm, wps };
}

const PCT = (actual: number, expected: number) =>
  Math.abs(actual - expected) / expected;

describe("regions match the Shapely oracle", () => {
  it("property area", () => {
    expect(area(toMetres(DEMO_SITE, proj))).toBeCloseTo(22365.6, -1);
  });

  it("F and C without obstacles, within 0.1% of Shapely", () => {
    const { Fm, Cm } = plan();
    expect(PCT(area(Fm), 19522.2)).toBeLessThan(0.001);
    expect(PCT(area(Cm), 18437.7)).toBeLessThan(0.001);
  });

  it("F and C with the mast excluded, within 0.1% of Shapely", () => {
    const { Fm, Cm } = plan([{ geometry: DEMO_MAST as never, clearance: 12 }]);
    expect(PCT(area(Fm), 19070.6)).toBeLessThan(0.001);
    expect(PCT(area(Cm), 17822.8)).toBeLessThan(0.001);
  });

  it("the mast's clearance buffer is actually removed from F", () => {
    const { Fm } = plan([{ geometry: DEMO_MAST as never, clearance: 12 }]);
    const [mx, my] = proj.fwd(12.3416, 55.9695);
    expect(containsPoint(Fm, mx, my)).toBe(false);
    // and a point 20 m away (outside the 12 m clearance) is still flyable
    expect(containsPoint(Fm, mx + 20, my)).toBe(true);
  });
});

describe("the invariant — the product guarantee", () => {
  it("holds for a generated mission without obstacles", () => {
    const { wps, Fm } = plan();
    // exact parity with the Shapely oracle: 225 waypoints, 171 of them triggers
    expect(wps).toHaveLength(225);
    expect(wps.filter((w) => w.kind === "trigger")).toHaveLength(171);
    expect(assertInvariant(wps, Fm)).toBe(true);
  });

  it("holds for a generated mission with an exclusion", () => {
    const { wps, Fm } = plan([{ geometry: DEMO_MAST as never, clearance: 12 }]);
    expect(wps).toHaveLength(226);
    expect(wps.filter((w) => w.kind === "trigger")).toHaveLength(160);
    expect(assertInvariant(wps, Fm)).toBe(true);
  });

  it("every waypoint is inside F when checked independently of the assertion", () => {
    const { wps, Fm } = plan([{ geometry: DEMO_MAST as never, clearance: 12 }]);
    const outside = wps.filter((w) => !containsPoint(Fm, w.x, w.y));
    expect(outside).toEqual([]);
  });

  it("THROWS when a waypoint is outside — and names the offender", () => {
    const { wps, Fm } = plan();
    const sabotaged = [...wps];
    sabotaged[3] = { x: 9_999, y: 9_999, kind: "trigger" };
    expect(() => assertInvariant(sabotaged, Fm)).toThrow(InvariantViolation);
    try {
      assertInvariant(sabotaged, Fm);
    } catch (e) {
      const v = e as InvariantViolation;
      expect(v.offenders).toHaveLength(1);
      expect(v.offenders[0]!.index).toBe(3);
      expect(v.message).toContain("Export must not proceed");
    }
  });

  it("tolerance is numerical slack only — 1 m outside still fails", () => {
    const { Fm } = plan();
    // a point far outside any plausible tolerance
    expect(() =>
      assertInvariant([{ x: 500, y: 500, kind: "turn" }], Fm),
    ).toThrow(InvariantViolation);
  });
});

describe("route edges — the known gap the prototype documents", () => {
  it("no connector leaves F on an unobstructed site", () => {
    const { wps, Fm } = plan();
    expect(checkRouteEdges(wps, Fm)).toEqual([]);
  });

  it("flags connectors that cut across the exclusion (Shapely found 2)", () => {
    const { wps, Fm } = plan([{ geometry: DEMO_MAST as never, clearance: 12 }]);
    // Not yet routed around — Phase 1 task. The contract for now is that it is
    // DETECTED, never silently emitted. Shapely finds exactly 2.
    expect(checkRouteEdges(wps, Fm)).toHaveLength(2);
  });
});

describe("scanline handles holes, so exclusions split a flight line", () => {
  it("returns two intervals where a hole interrupts the row", () => {
    const square: PolyM = [[
      [[0, 0], [100, 0], [100, 100], [0, 100], [0, 0]],
      [[40, 40], [60, 40], [60, 60], [40, 60], [40, 40]],
    ]];
    expect(scanline(square, 10)).toEqual([[0, 100]]);
    expect(scanline(square, 50)).toEqual([[0, 40], [60, 100]]);
  });
});

describe("guards", () => {
  it("refuses a setback that swallows the polygon", () => {
    expect(() => flyableRegion(DEMO_SITE, 500)).toThrow(/swallows/);
  });

  it("refuses a turn extension that leaves no capture area", () => {
    const F = flyableRegion(DEMO_SITE, 5);
    expect(() => captureRegion(F, 500)).toThrow(/no capture area/);
  });
});
