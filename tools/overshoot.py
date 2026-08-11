#!/usr/bin/env python3
"""overshoot.py — measure how far a planner's waypoints stray past the boundary.

This produces THE Phase 0 number (spec §5.4): how far outside the property does
an existing app put the aircraft? If that number is smaller than the smallest
legal Danish setback, there may be nothing to build.

It replaces "drag the GeoJSON onto geojson.io and read a ruler" with an actual
computation, so the build/no-build decision does not rest on an eyeballed
measurement.

Usage:
  python3 tools/overshoot.py sites/testsite.geojson reference/waypointmap-2026-08-10.kmz \\
      --setback 2.5 --geojson

  --setback M   required inward clearance from the property line, metres (default 2.5)
  --geojson     also write <mission>.overshoot.geojson for visual confirmation
  --label TEXT  name for the report header (defaults to the KMZ filename)

Sign convention, stated once:
  clearance > 0  waypoint is INSIDE the boundary, that many metres from the line
  clearance < 0  waypoint is OUTSIDE — this is overshoot, the thing we are hunting

Requires shapely; waypoint extraction reuses tools/kmz_inspect.py.
"""
import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

try:
    from shapely.geometry import LineString, Point, mapping
except ImportError:
    sys.exit("pip install shapely   (then re-run)")

from boundary import load_site
from geometry_prototype import make_proj, project_geom
from kmz_inspect import extract_points

SAMPLE_STEP_M = 0.10   # resolution for scanning a segment's excursion beyond P


def clearance(pt, P_m):
    """Metres from the boundary; positive inside, negative outside."""
    d = pt.distance(P_m.boundary)
    return d if P_m.contains(pt) else -d


def segment_excursion(a, b, P_m):
    """Max distance the straight segment a->b reaches beyond P. 0 if contained.

    The extreme point can lie in the middle of the segment (a concave boundary),
    so the outside portion is sampled rather than checked only at its ends.
    """
    seg = LineString([a, b])
    outside = seg.difference(P_m)
    if outside.is_empty:
        return 0.0
    parts = [outside] if outside.geom_type == "LineString" else list(
        getattr(outside, "geoms", []))
    worst = 0.0
    for part in parts:
        if part.geom_type != "LineString" or part.length == 0:
            continue
        n = min(int(part.length / SAMPLE_STEP_M) + 1, 2000)
        for i in range(n + 1):
            p = part.interpolate(part.length * i / n)
            worst = max(worst, p.distance(P_m.boundary))
    return worst


def report(site_path, kmz_path, setback, label, write_geojson):
    P_ll = load_site(site_path)
    pts_ll = extract_points(kmz_path)
    if not pts_ll:
        sys.exit(f"No waypoints found in {kmz_path}.\n"
                 f"Run:  python3 tools/kmz_inspect.py schema {kmz_path}\n"
                 f"to see what coordinate vocabulary this file uses.")

    c = P_ll.centroid
    fwd, inv = make_proj(c.x, c.y)
    P_m = project_geom(P_ll, fwd)
    wps_m = [Point(*fwd(p["lon"], p["lat"])) for p in pts_ll]

    clears = [clearance(p, P_m) for p in wps_m]
    outside = [i for i, cl in enumerate(clears) if cl < 0]
    breach = [i for i, cl in enumerate(clears) if cl < setback]
    worst_i = min(range(len(clears)), key=lambda i: clears[i])
    worst = clears[worst_i]

    excursions = [segment_excursion(wps_m[i], wps_m[i + 1], P_m)
                  for i in range(len(wps_m) - 1)]
    seg_worst = max(excursions, default=0.0)
    seg_i = excursions.index(seg_worst) if excursions and seg_worst > 0 else None

    inset = P_m.buffer(-setback, join_style="mitre")

    print(f"\n{'=' * 68}\nOVERSHOOT REPORT — {label}\n{'=' * 68}")
    print(f"site        : {site_path}")
    print(f"mission     : {kmz_path}")
    print(f"waypoints   : {len(wps_m)}")
    print(f"setback     : {setback:.2f} m required clearance from the property line")
    print(f"\n-- waypoints vs. property line --")
    print(f"outside the boundary        : {len(outside)} of {len(wps_m)}"
          + (f"   indices {outside[:12]}{' …' if len(outside) > 12 else ''}"
             if outside else ""))
    print(f"inside boundary, inside setback : {len(breach) - len(outside)}")
    print(f"worst waypoint              : #{worst_i} at "
          f"{pts_ll[worst_i]['lon']:.7f}, {pts_ll[worst_i]['lat']:.7f}")
    if worst < 0:
        print(f"  -> {-worst:.2f} m OUTSIDE the boundary")
    else:
        print(f"  -> {worst:.2f} m inside the boundary (closest approach)")

    print(f"\n-- flight path between waypoints --")
    if seg_worst > 0:
        print(f"worst segment excursion     : {seg_worst:.2f} m beyond the boundary "
              f"(waypoints {seg_i}->{seg_i + 1})")
        print("  the aircraft leaves the parcel between waypoints even where the "
              "waypoints\n  themselves may be inside — turnarounds are the usual cause")
    else:
        print("worst segment excursion     : 0.00 m — every straight segment stays inside")

    max_out = max(-worst, seg_worst, 0.0)
    print(f"\n{'-' * 68}")
    if max_out > 0:
        print(f"VERDICT: BREACH — path reaches {max_out:.2f} m outside the property line.")
    elif breach:
        print(f"VERDICT: BREACH — inside the parcel, but {len(breach)} waypoint(s) sit "
              f"closer than the {setback:.2f} m setback\n         (closest {worst:.2f} m).")
    else:
        print(f"VERDICT: PASS — every waypoint and segment stays at least "
              f"{setback:.2f} m inside the property line\n         "
              f"(closest approach {worst:.2f} m).")
    print(f"\nFor docs/phase0-test-log.md, 'measured distance, outermost waypoint "
          f"-> polygon edge':\n  {-worst:+.2f} m   (positive = outside the boundary)")
    print(f"{'-' * 68}")
    print("CAVEAT: this measures the COMMANDED path — waypoints and the straight")
    print("lines between them. A real aircraft flying curved/coordinated turns bulges")
    print("further out than the straight segments. Treat this figure as a LOWER BOUND")
    print("on the overshoot you would actually fly.")

    if write_geojson:
        feats = [{"type": "Feature", "geometry": mapping(P_ll),
                  "properties": {"layer": "property_boundary"}}]
        if not inset.is_empty:
            feats.append({"type": "Feature",
                          "geometry": mapping(project_geom(inset, inv)),
                          "properties": {"layer": f"setback_inset_{setback}m"}})
        for i, (p, cl) in enumerate(zip(pts_ll, clears)):
            feats.append({
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [p["lon"], p["lat"]]},
                "properties": {"layer": "waypoint", "index": i,
                               "clearance_m": round(cl, 3),
                               "status": ("OUTSIDE" if cl < 0 else
                                          "inside-setback" if cl < setback else "ok"),
                               "worst": i == worst_i, **p["props"]}})
        feats.append({"type": "Feature",
                      "geometry": {"type": "LineString",
                                   "coordinates": [[p["lon"], p["lat"]] for p in pts_ll]},
                      "properties": {"layer": "flight_path"}})
        out = Path(kmz_path).with_suffix(".overshoot.geojson")
        out.write_text(json.dumps({"type": "FeatureCollection", "features": feats},
                                  indent=1))
        print(f"\nwrote: {out}   (drag onto https://geojson.io to see it)")


def main():
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("site", help="sites/<name>.geojson — the property boundary")
    ap.add_argument("kmz", help="reference/<product>-<date>.kmz — an app's export")
    ap.add_argument("--setback", type=float, default=2.5,
                    help="required clearance from the property line, m (default 2.5)")
    ap.add_argument("--label", default=None)
    ap.add_argument("--geojson", action="store_true",
                    help="also write <mission>.overshoot.geojson")
    a = ap.parse_args()
    report(a.site, a.kmz, a.setback, a.label or Path(a.kmz).name, a.geojson)


if __name__ == "__main__":
    main()
