#!/usr/bin/env python3
"""boundary.py — manage the ONE canonical test-site polygon (Phase 0).

Comparing six mission planners is only meaningful if all six survey the *same*
shape. This tool holds that shape in one place, reports its dimensions, and
emits a KML the trial apps can import — so T1-T6 are not six hand-drawn
approximations of "roughly the same field".

It is also what tools/overshoot.py measures against.

Usage:
  python3 tools/boundary.py from-geojson drawn.geojson --name testsite
      Validate a polygon drawn on geojson.io (or exported from QGIS), normalise
      it, report area/perimeter, write sites/testsite.geojson

  python3 tools/boundary.py from-kmz reference/waypointmap-2026-08-10.kmz --name testsite
      Pull the survey-area polygon out of an app's own export, where the app
      writes one alongside the waylines.

  python3 tools/boundary.py to-kml sites/testsite.geojson
      Write sites/testsite.kml — import this into each app so every trial uses
      an identical boundary.

  python3 tools/boundary.py to-kml sites/testsite.geojson --inset 3
      Write sites/testsite-inset3m.kml — the property line pulled in 3 m. Apps
      that clip waypoints to the drawn area (see docs/phase0-desk-research.md)
      then respect a setback they have no setting for.

  python3 tools/boundary.py info sites/testsite.geojson
      Dimensions only.

Requires shapely (see requirements.txt); KMZ reading reuses tools/kmz_inspect.py.
"""
import argparse
import json
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

try:
    from shapely.geometry import Polygon, mapping, shape
    from shapely.validation import explain_validity
except ImportError:
    sys.exit("pip install shapely   (then re-run)")

from geometry_prototype import make_proj, project_geom
from kmz_inspect import strip_ns, xml_members

SITES_DIR = Path(__file__).resolve().parent.parent / "sites"


# ------------------------------------------------------------------ reporting

def metric(P_ll):
    """Area (m2), perimeter (m) via the local-metres projection."""
    c = P_ll.centroid
    fwd, _ = make_proj(c.x, c.y)
    P_m = project_geom(P_ll, fwd)
    return P_m.area, P_m.length


def describe(P_ll, label=""):
    area, perim = metric(P_ll)
    n = len(P_ll.exterior.coords) - 1
    print(f"{label}vertices   : {n}")
    print(f"{label}area       : {area:,.0f} m2  ({area / 10_000:.3f} ha)")
    print(f"{label}perimeter  : {perim:,.1f} m")
    print(f"{label}centroid   : {P_ll.centroid.x:.6f}, {P_ll.centroid.y:.6f}  (lon, lat)")
    if P_ll.interiors:
        print(f"{label}note       : {len(P_ll.interiors)} interior ring(s) — kept as holes")


def write_site(P_ll, name):
    SITES_DIR.mkdir(exist_ok=True)
    out = SITES_DIR / f"{name}.geojson"
    if out.exists():
        print(f"\nREFUSING to overwrite {out}\n"
              f"A site boundary must stay fixed across all trials, or the "
              f"comparison is meaningless.\nDelete it deliberately if you really "
              f"mean to change the test site.")
        sys.exit(1)
    fc = {"type": "FeatureCollection",
          "features": [{"type": "Feature",
                        "geometry": mapping(P_ll),
                        "properties": {"layer": "property_boundary", "name": name}}]}
    out.write_text(json.dumps(fc, indent=1))
    print(f"\nwrote      : {out}")
    return out


def repair(P_ll):
    """Hand-drawn polygons self-intersect often enough that a raw GEOS crash is
    the wrong failure mode. Repair — but never silently: this polygon defines a
    legal boundary, so any change to it has to be visible and checkable."""
    if P_ll.is_valid:
        return P_ll
    before = metric(P_ll)[0]
    fixed = P_ll.buffer(0)
    if fixed.geom_type == "MultiPolygon":
        fixed = max(fixed.geoms, key=lambda p: p.area)
    if fixed.is_empty or not fixed.is_valid:
        sys.exit(f"Polygon is invalid and could not be repaired: "
                 f"{explain_validity(P_ll)}\nRedraw it on https://geojson.io.")
    after = metric(fixed)[0]
    print("\n!! WARNING — the polygon was INVALID and has been repaired.")
    print(f"   problem : {explain_validity(P_ll)}")
    print(f"   area    : {before:,.0f} m2 -> {after:,.0f} m2 "
          f"({after - before:+,.0f} m2)")
    print("   This is your legal boundary. Open it on https://geojson.io and\n"
          "   confirm the repaired shape is the parcel you meant.\n")
    return fixed


def load_site(path):
    gj = json.loads(Path(path).read_text())
    feats = gj["features"] if gj.get("type") == "FeatureCollection" else [gj]
    polys = [shape(f["geometry"]) for f in feats
             if f.get("geometry", {}).get("type") in ("Polygon", "MultiPolygon")]
    if not polys:
        sys.exit(f"no Polygon feature in {path}")
    if len(polys) > 1:
        print(f"note: {len(polys)} polygons found — using the largest")
        polys.sort(key=lambda p: p.area, reverse=True)
    P = polys[0]
    if P.geom_type == "MultiPolygon":
        P = max(P.geoms, key=lambda p: p.area)
    return repair(P)


# ------------------------------------------------------------------ importers

def cmd_from_geojson(path, name):
    P = load_site(path)
    print(f"source     : {path}")
    describe(P)
    write_site(P, name)


_KML_COORDS = re.compile(r"[-\d.]+,[-\d.]+(?:,[-\d.]+)?")


def _rings_from_kmz(kmz_path):
    """Every closed ring of >=4 points found in any <coordinates>-ish element."""
    rings = []
    for member, data in xml_members(kmz_path):
        try:
            root = ET.fromstring(data)
        except ET.ParseError:
            continue
        for el in root.iter():
            if "coordinate" not in strip_ns(el.tag).lower():
                continue
            pts = []
            for tok in _KML_COORDS.findall(el.text or ""):
                parts = tok.split(",")
                pts.append((float(parts[0]), float(parts[1])))
            if len(pts) < 4:
                continue
            if pts[0] != pts[-1]:
                pts.append(pts[0])
            if len(pts) < 4:
                continue
            try:
                poly = Polygon(pts)
            except Exception:
                continue
            if poly.is_valid and poly.area > 0:
                rings.append((member, poly))
    return rings


def cmd_from_kmz(kmz_path, name):
    rings = _rings_from_kmz(kmz_path)
    if not rings:
        sys.exit(
            f"No closed polygon found in {kmz_path}.\n"
            f"Most WPML exports contain only the waylines, not the area you drew.\n"
            f"Draw the boundary on https://geojson.io instead, save the GeoJSON, "
            f"then:\n  python3 tools/boundary.py from-geojson <file> --name {name}")
    member, P = max(rings, key=lambda r: r[1].area)
    print(f"source     : {kmz_path}  ({member})")
    if len(rings) > 1:
        print(f"note       : {len(rings)} rings found — using the largest")
    describe(P)
    print("\nCHECK THIS SHAPE before trusting it — an app may store a bounding "
          "box or\na buffered area rather than the boundary you drew. Compare it "
          "on geojson.io\nagainst what you actually drew in the app.")
    write_site(P, name)


# ------------------------------------------------------------------- exporter

def cmd_to_kml(site_path, inset=0.0):
    P = load_site(site_path)
    name = Path(site_path).stem
    suffix = ""
    if inset > 0:
        # Several planners clip waypoints to the drawn polygon and never extend
        # beyond it (docs/phase0-desk-research.md). Feeding them an already-inset
        # polygon buys the setback without the app knowing what a setback is.
        c = P.centroid
        fwd, inv = make_proj(c.x, c.y)
        P_in = project_geom(P, fwd).buffer(-inset, join_style="mitre")
        if P_in.is_empty:
            sys.exit(f"an inset of {inset} m swallows the whole polygon")
        if P_in.geom_type == "MultiPolygon":
            print(f"note       : inset split the parcel into {len(P_in.geoms)} "
                  f"pieces — using the largest; the rest is unreachable at this "
                  f"setback")
            P_in = max(P_in.geoms, key=lambda p: p.area)
        print(f"inset      : {inset:.2f} m applied — this KML is the FLYABLE "
              f"area, not the property line")
        P = project_geom(P_in, inv)
        name = f"{name}-inset{inset:g}m"
        suffix = f"-inset{inset:g}m"
    coords = " ".join(f"{x:.8f},{y:.8f},0" for x, y in P.exterior.coords)
    holes = "".join(
        "<innerBoundaryIs><LinearRing><coordinates>"
        + " ".join(f"{x:.8f},{y:.8f},0" for x, y in r.coords)
        + "</coordinates></LinearRing></innerBoundaryIs>"
        for r in P.interiors)
    kml = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<kml xmlns="http://www.opengis.net/kml/2.2">\n'
        f'  <Document>\n    <name>{name}</name>\n'
        f'    <Placemark>\n      <name>{name} boundary</name>\n'
        '      <Polygon>\n        <outerBoundaryIs><LinearRing><coordinates>\n'
        f'          {coords}\n'
        '        </coordinates></LinearRing></outerBoundaryIs>\n'
        f'        {holes}\n'
        '      </Polygon>\n    </Placemark>\n  </Document>\n</kml>\n')
    out = Path(site_path).with_suffix("").with_name(Path(site_path).stem + suffix + ".kml")
    out.write_text(kml)
    describe(P)
    print(f"\nwrote      : {out}")
    print("Import this into each trial app so every trial surveys the same shape.")
    if inset > 0:
        print(f"Waypoints planned inside it sit >= {inset:g} m inside the real "
              f"property line —\nstill verify with tools/overshoot.py against the "
              f"UN-inset site file.")


def cmd_info(site_path):
    P = load_site(site_path)
    print(f"site       : {site_path}")
    describe(P)


def main():
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("from-geojson", help="validate + store a drawn polygon")
    p.add_argument("path")
    p.add_argument("--name", required=True, help="site name -> sites/<name>.geojson")

    p = sub.add_parser("from-kmz", help="pull a survey-area polygon out of an export")
    p.add_argument("path")
    p.add_argument("--name", required=True)

    p = sub.add_parser("to-kml", help="emit a KML the trial apps can import")
    p.add_argument("path", help="sites/<name>.geojson")
    p.add_argument("--inset", type=float, default=0.0,
                   help="shrink by N metres first — import THIS to get the "
                        "setback out of an app that has no setback setting")

    p = sub.add_parser("info", help="dimensions of a stored site")
    p.add_argument("path")

    a = ap.parse_args()
    {"from-geojson": lambda: cmd_from_geojson(a.path, a.name),
     "from-kmz": lambda: cmd_from_kmz(a.path, a.name),
     "to-kml": lambda: cmd_to_kml(a.path, a.inset),
     "info": lambda: cmd_info(a.path)}[a.cmd]()


if __name__ == "__main__":
    main()
