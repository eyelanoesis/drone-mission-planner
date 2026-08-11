#!/usr/bin/env python3
"""geometry_prototype.py — reference implementation of spec §7 in Shapely.

This is NOT the product (the product is browser/Turf.js per spec §10). It is a
readable, tested statement of the algorithm, so the eventual JS port has a
known-correct oracle to compare against — and so the core thesis can be
demonstrated on real parcel geometry today.

Pipeline (spec §7.2):
  P  = property polygon                         (input, lon/lat WGS84)
  F  = inset(P, setback) - union(buffer(obstacle_i, clearance_i))   # flyable
  C  = inset(F, turn_extension)                                     # capture
  lawnmower lines clipped to C, connected with turnarounds inside F
  INVARIANT: every waypoint in F  (asserted; export must fail loudly if not)

Run the self-test / demo:
  pip install shapely            (once)
  python3 tools/geometry_prototype.py            # runs demo, writes demo GeoJSON
  python3 tools/geometry_prototype.py --help     # use with your own GeoJSON

With your own data:
  python3 tools/geometry_prototype.py --polygon site.geojson --setback 5 \
      --line-spacing 12 --trigger-spacing 8 --heading 90 --out mission.geojson
(site.geojson: a single Polygon feature; obstacles: optional extra features
 with property {"clearance": metres}.)
"""
import argparse
import json
import math
import sys
from pathlib import Path

try:
    from shapely.geometry import (LineString, MultiLineString, MultiPolygon,
                                  Point, Polygon, mapping, shape)
    from shapely.ops import unary_union
    from shapely import affinity
except ImportError:
    sys.exit("pip install shapely   (then re-run)")


# ---------------------------------------------------------------- projection
# Simple local equirectangular metres projection around the polygon centroid.
# Fine at property scale (<~2 km); the JS port should use the same approach or
# turf's planar ops which behave equivalently at this scale.

def make_proj(origin_lon, origin_lat):
    m_per_deg_lat = 111_320.0
    m_per_deg_lon = 111_320.0 * math.cos(math.radians(origin_lat))

    def fwd(lon, lat):
        return ((lon - origin_lon) * m_per_deg_lon,
                (lat - origin_lat) * m_per_deg_lat)

    def inv(x, y):
        return (origin_lon + x / m_per_deg_lon,
                origin_lat + y / m_per_deg_lat)

    return fwd, inv


def project_geom(geom, fn):
    def tx(coords):
        return [fn(x, y) for x, y in coords]
    if geom.geom_type == "Polygon":
        return Polygon(tx(geom.exterior.coords),
                       [tx(r.coords) for r in geom.interiors])
    if geom.geom_type == "LineString":
        return LineString(tx(geom.coords))
    if geom.geom_type == "Point":
        return Point(*fn(geom.x, geom.y))
    if geom.geom_type.startswith("Multi"):
        return type(geom)([project_geom(g, fn) for g in geom.geoms])
    raise ValueError(geom.geom_type)


# ------------------------------------------------------------------ core alg

def flyable_region(P_m, setback, obstacles_m=()):
    """F = inset(P) minus buffered obstacles. All in metres."""
    F = P_m.buffer(-setback, join_style="mitre")
    if F.is_empty:
        raise ValueError(f"setback {setback} m swallows the whole polygon")
    if obstacles_m:
        F = F.difference(unary_union([g.buffer(c, join_style="round")
                                      for g, c in obstacles_m]))
    return F


def capture_region(F_m, turn_extension):
    C = F_m.buffer(-turn_extension, join_style="mitre")
    if C.is_empty:
        raise ValueError("turn_extension leaves no capture area; "
                         "reduce it or the setback")
    return C


def lawnmower(C_m, F_m, line_spacing, trigger_spacing, heading_deg):
    """Grid lines clipped to C, serpentine order, turnaround connectors kept
    inside F. Returns (waypoints[(x, y, kind)], lines_for_display).

    kind: 'capture-start' | 'trigger' | 'capture-end' | 'turn'
    Turn strategy = stop-at-point (spec §7.4): the connector between line ends
    is a straight hop inside F; the aircraft stops, translates, reverses.
    """
    # Rotate frame so lines are horizontal, sweep in y.
    centre = C_m.centroid
    C_r = affinity.rotate(C_m, -heading_deg, origin=centre)
    F_r = affinity.rotate(F_m, -heading_deg, origin=centre)
    minx, miny, maxx, maxy = C_r.bounds

    rows = []
    y = miny + line_spacing / 2.0
    while y <= maxy:
        scan = LineString([(minx - 1, y), (maxx + 1, y)]).intersection(C_r)
        segs = ([scan] if isinstance(scan, LineString)
                else list(scan.geoms) if isinstance(scan, MultiLineString)
                else [])
        for s in segs:
            if s.length > 0.5:
                rows.append(s)
        y += line_spacing
    if not rows:
        raise ValueError("no flight lines fit; check spacing vs. area size")

    # Serpentine ordering: sort by y, alternate direction; greedy nearest
    # segment within a row group keeps split rows (around exclusions) sane.
    rows.sort(key=lambda s: (round(s.coords[0][1], 3), s.coords[0][0]))
    wps = []
    direction = 1
    prev_end = None
    grouped = {}
    for s in rows:
        grouped.setdefault(round(s.coords[0][1], 3), []).append(s)

    for y_key in sorted(grouped):
        segs = sorted(grouped[y_key], key=lambda s: s.coords[0][0],
                      reverse=(direction < 0))
        for s in segs:
            a, b = s.coords[0], s.coords[-1]
            start, end = (a, b) if direction > 0 else (b, a)
            if prev_end is not None:
                wps.append((*prev_end, "turn"))
                wps.append((*start, "turn"))
            wps.append((*start, "capture-start"))
            n_trig = max(0, int(s.length // trigger_spacing) - 1)
            for i in range(1, n_trig + 1):
                p = s.interpolate(i * trigger_spacing)
                # keep photo positions in flight order
                px, py = (p.x, p.y)
                if direction < 0:
                    p2 = s.interpolate(s.length - i * trigger_spacing)
                    px, py = p2.x, p2.y
                wps.append((px, py, "trigger"))
            wps.append((*end, "capture-end"))
            prev_end = end
        direction *= -1

    # Rotate back.
    out = []
    for x, y, kind in wps:
        p = affinity.rotate(Point(x, y), heading_deg, origin=centre)
        out.append((p.x, p.y, kind))
    lines_disp = [affinity.rotate(s, heading_deg, origin=centre) for s in rows]
    return out, lines_disp


def check_route_edges(waypoints_m, F_m, tol=0.05):
    """Secondary check: the straight segments BETWEEN waypoints must also stay
    inside F. The prototype's serpentine connector can cut across an exclusion
    hole or a concave boundary; this reports it. Routing connectors around
    obstacles is a Phase 1 task (see CLAUDE.md) — the prototype flags, it does
    not yet fix.
    Returns list of (i, i+1) index pairs whose connector leaves F."""
    F_ok = F_m.buffer(tol)
    bad = []
    for i in range(len(waypoints_m) - 1):
        a, b = waypoints_m[i], waypoints_m[i + 1]
        if not F_ok.contains(LineString([(a[0], a[1]), (b[0], b[1])])):
            bad.append((i, i + 1))
    return bad


def assert_invariant(waypoints_m, F_m, tol=0.05):
    """THE product guarantee (spec §7.2). Raises with full detail on failure."""
    F_ok = F_m.buffer(tol)  # numerical tolerance only
    bad = [(i, x, y, k) for i, (x, y, k) in enumerate(waypoints_m)
           if not F_ok.contains(Point(x, y))]
    if bad:
        detail = "\n".join(f"  wp[{i}] ({k}) at local ({x:.2f}, {y:.2f}) m"
                           for i, x, y, k in bad[:10])
        raise AssertionError(
            f"INVARIANT VIOLATED: {len(bad)} waypoint(s) outside flyable "
            f"region F.\n{detail}\nExport must not proceed.")
    return True


# -------------------------------------------------------------------- driver

def run(P_ll, setback, line_spacing, trigger_spacing, heading,
        turn_extension, obstacles_ll, out_path):
    c = P_ll.centroid
    fwd, inv = make_proj(c.x, c.y)
    P_m = project_geom(P_ll, fwd)
    obs_m = [(project_geom(g, fwd), cl) for g, cl in obstacles_ll]

    F_m = flyable_region(P_m, setback, obs_m)
    C_m = capture_region(F_m, turn_extension)
    wps_m, lines_m = lawnmower(C_m, F_m, line_spacing, trigger_spacing, heading)
    assert_invariant(wps_m, F_m)
    bad_edges = check_route_edges(wps_m, F_m)

    uncovered = P_m.area - C_m.area
    print(f"waypoints            : {len(wps_m)} "
          f"({sum(1 for w in wps_m if w[2] == 'trigger')} photo triggers)")
    print(f"property area        : {P_m.area:,.0f} m2")
    print(f"capture region       : {C_m.area:,.0f} m2 "
          f"({100 * C_m.area / P_m.area:.1f} % of property)")
    print(f"not nadir-imaged     : {uncovered:,.0f} m2  "
          f"(setback band + turn allowance; report per spec F-D5)")
    print("invariant            : PASS — every waypoint inside F")
    if bad_edges:
        print(f"route-edge check     : WARNING — {len(bad_edges)} connector(s) "
              f"between waypoints leave F (e.g. cross an exclusion). "
              f"Known prototype limitation; Phase 1 must route around. "
              f"Pairs: {bad_edges[:6]}")
    else:
        print("route-edge check     : PASS — all connectors inside F")

    feats = []

    def add(geom_m, props):
        feats.append({"type": "Feature",
                      "geometry": mapping(project_geom(geom_m, inv)),
                      "properties": props})

    add(P_m, {"layer": "property"})
    add(F_m if isinstance(F_m, (Polygon, MultiPolygon)) else F_m,
        {"layer": "flyable_F"})
    add(C_m, {"layer": "capture_C"})
    for ln in lines_m:
        add(ln, {"layer": "flight_line"})
    path = LineString([(x, y) for x, y, _ in wps_m])
    add(path, {"layer": "waypoint_path"})
    for i, (x, y, kind) in enumerate(wps_m):
        add(Point(x, y), {"layer": "waypoint", "index": i, "kind": kind})

    Path(out_path).write_text(json.dumps(
        {"type": "FeatureCollection", "features": feats}, indent=1))
    print(f"wrote                : {out_path}  (view on geojson.io / QGIS)")


DEMO_SITE = Polygon([  # ~180 x 120 m irregular commercial site, Nordsjælland-ish
    (12.3400, 55.9700), (12.3428, 55.9701), (12.3430, 55.9691),
    (12.3415, 55.9688), (12.3401, 55.9690), (12.3400, 55.9700)])
DEMO_OBSTACLE = (Point(12.3416, 55.9695), 12.0)  # mast, 12 m clearance


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--polygon", help="GeoJSON file (Polygon feature[s])")
    ap.add_argument("--setback", type=float, default=5.0)
    ap.add_argument("--line-spacing", type=float, default=12.0)
    ap.add_argument("--trigger-spacing", type=float, default=8.0)
    ap.add_argument("--heading", type=float, default=90.0,
                    help="flight-line bearing, degrees")
    ap.add_argument("--turn-extension", type=float, default=2.0,
                    help="deceleration allowance for stop-at-point turns, m")
    ap.add_argument("--out", default="mission_preview.geojson")
    a = ap.parse_args()

    if a.polygon:
        gj = json.loads(Path(a.polygon).read_text())
        feats = gj["features"] if gj.get("type") == "FeatureCollection" else [gj]
        polys = [shape(f["geometry"]) for f in feats
                 if f["geometry"]["type"] == "Polygon"]
        obstacles = [(shape(f["geometry"]),
                      float(f.get("properties", {}).get("clearance", 10)))
                     for f in feats if f["geometry"]["type"] != "Polygon"]
        if not polys:
            sys.exit("no Polygon feature found")
        P = polys[0]
    else:
        print("(demo mode — synthetic site with one exclusion mast; "
              "use --polygon for real data)\n")
        P, obstacles = DEMO_SITE, [DEMO_OBSTACLE]

    run(P, a.setback, a.line_spacing, a.trigger_spacing, a.heading,
        a.turn_extension, obstacles, a.out)


if __name__ == "__main__":
    main()
