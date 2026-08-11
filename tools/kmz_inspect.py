#!/usr/bin/env python3
"""kmz_inspect.py — inspect, extract, and diff DJI WPML waypoint KMZ files.

Deliberately schema-agnostic: it does not assume WPML field names. It unzips,
pretty-prints, pulls out anything that looks like a coordinate, and surfaces
every element/attribute name so the *actual* schema can be learned from a
known-good reference file (spec §9.3) instead of guessed.

Usage:
  python3 tools/kmz_inspect.py list     mission.kmz          # archive contents
  python3 tools/kmz_inspect.py dump     mission.kmz          # pretty-print all XML
  python3 tools/kmz_inspect.py schema   mission.kmz          # every tag/attr name + counts
  python3 tools/kmz_inspect.py points   mission.kmz          # waypoints -> table + GeoJSON
  python3 tools/kmz_inspect.py diff     a.kmz b.kmz          # structural diff of two missions

`points` writes <mission>.waypoints.geojson next to the KMZ — drop it onto
geojson.io or QGIS to see the flight path over a map.

No dependencies beyond the standard library.
"""
import io
import json
import re
import sys
import zipfile
import xml.dom.minidom as minidom
import xml.etree.ElementTree as ET
from collections import Counter
from pathlib import Path


def _xml_members(kmz_path):
    """Yield (name, bytes) for every XML-ish member of the archive."""
    with zipfile.ZipFile(kmz_path) as z:
        for name in z.namelist():
            if name.lower().endswith((".kml", ".xml", ".wpml")):
                yield name, z.read(name)


def _strip_ns(tag):
    return tag.split("}", 1)[-1] if "}" in tag else tag


def cmd_list(kmz_path):
    with zipfile.ZipFile(kmz_path) as z:
        for info in z.infolist():
            print(f"{info.file_size:>10}  {info.filename}")


def cmd_dump(kmz_path):
    for name, data in _xml_members(kmz_path):
        print(f"\n{'=' * 70}\n{name}\n{'=' * 70}")
        try:
            print(minidom.parseString(data).toprettyxml(indent="  "))
        except Exception as e:
            print(f"(could not parse as XML: {e})")
            print(data[:2000].decode("utf-8", "replace"))


def cmd_schema(kmz_path):
    """Every element and attribute name, with occurrence counts and sample values
    for leaf elements. This is how you learn the real WPML vocabulary."""
    for name, data in _xml_members(kmz_path):
        print(f"\n### {name}")
        try:
            root = ET.fromstring(data)
        except ET.ParseError as e:
            print(f"  parse error: {e}")
            continue
        tags = Counter()
        samples = {}
        attrs = Counter()
        for el in root.iter():
            t = _strip_ns(el.tag)
            tags[t] += 1
            for a in el.attrib:
                attrs[f"{t}@{_strip_ns(a)}"] += 1
            text = (el.text or "").strip()
            if text and len(list(el)) == 0 and t not in samples:
                samples[t] = text[:60]
        width = max((len(t) for t in tags), default=10)
        for t, n in sorted(tags.items()):
            sample = f'   e.g. "{samples[t]}"' if t in samples else ""
            print(f"  {t:<{width}}  x{n}{sample}")
        if attrs:
            print("  -- attributes --")
            for a, n in sorted(attrs.items()):
                print(f"  {a}  x{n}")


_COORD_RE = re.compile(
    r"(-?\d{1,3}\.\d{3,})\s*[, ]\s*(-?\d{1,3}\.\d{3,})"
)


def _extract_points(kmz_path):
    """Best-effort waypoint extraction without schema assumptions.

    Strategy: any element whose stripped tag contains 'coordinate' (KML
    <coordinates>, WPML coordinate elements) is scanned for lon,lat pairs.
    Elements near each point whose tag mentions height/altitude/speed/turn/
    action are attached as properties for inspection.
    """
    points = []
    for name, data in _xml_members(kmz_path):
        try:
            root = ET.fromstring(data)
        except ET.ParseError:
            continue
        parent = {c: p for p in root.iter() for c in p}
        # Walk Placemark-like containers so per-point siblings can be captured.
        for container in root.iter():
            children = list(container)
            coord_els = [c for c in children if "coordinate" in _strip_ns(c.tag).lower()]
            if not coord_els:
                continue
            # Collect interesting props from this container and up to two
            # ancestors (coordinates usually sit in Point inside Placemark).
            scopes, node = [container], container
            for _ in range(2):
                node = parent.get(node)
                if node is None:
                    break
                # Stop ascending once the scope spans multiple points, else
                # properties from sibling waypoints would leak across.
                n_coords = sum(1 for c in node.iter()
                               if "coordinate" in _strip_ns(c.tag).lower())
                if n_coords > 1:
                    break
                scopes.append(node)
            props = {}
            for scope in reversed(scopes):  # nearest scope wins
                for c in scope.iter():
                    t = _strip_ns(c.tag).lower()
                    txt = (c.text or "").strip()
                    if txt and any(k in t for k in
                                   ("height", "altitude", "speed", "turn", "action",
                                    "index", "heading", "gimbal", "trigger")):
                        props[_strip_ns(c.tag)] = txt[:80]
            for c in coord_els:
                for m in _COORD_RE.finditer(c.text or ""):
                    lon, lat = float(m.group(1)), float(m.group(2))
                    if -180 <= lon <= 180 and -90 <= lat <= 90:
                        points.append({"file": name, "lon": lon, "lat": lat,
                                       "props": dict(props)})
    return points


def cmd_points(kmz_path):
    pts = _extract_points(kmz_path)
    if not pts:
        print("No coordinate-bearing elements found. Run `schema` and look for "
              "the coordinate vocabulary this file uses.")
        return
    print(f"{'#':>3}  {'lon':>12}  {'lat':>12}  props")
    for i, p in enumerate(pts):
        prop_str = ", ".join(f"{k}={v}" for k, v in list(p["props"].items())[:4])
        print(f"{i:>3}  {p['lon']:>12.7f}  {p['lat']:>12.7f}  {prop_str}")
    gj = {
        "type": "FeatureCollection",
        "features": [
            {"type": "Feature",
             "geometry": {"type": "Point", "coordinates": [p["lon"], p["lat"]]},
             "properties": {"index": i, **p["props"]}}
            for i, p in enumerate(pts)
        ] + [
            {"type": "Feature",
             "geometry": {"type": "LineString",
                          "coordinates": [[p["lon"], p["lat"]] for p in pts]},
             "properties": {"name": "flight path (file order)"}}
        ],
    }
    out = Path(kmz_path).with_suffix(".waypoints.geojson")
    out.write_text(json.dumps(gj, indent=2))
    print(f"\n{len(pts)} points -> {out}")
    print("View: drag the .geojson onto https://geojson.io or open in QGIS.")


def _flatten(kmz_path):
    """(path, text) lines for structural diffing."""
    lines = []
    for name, data in _xml_members(kmz_path):
        try:
            root = ET.fromstring(data)
        except ET.ParseError:
            continue

        def walk(el, path):
            t = _strip_ns(el.tag)
            p = f"{path}/{t}"
            txt = (el.text or "").strip()
            if txt and len(list(el)) == 0:
                lines.append(f"{name}:{p} = {txt}")
            for a, v in el.attrib.items():
                lines.append(f"{name}:{p}@{_strip_ns(a)} = {v}")
            for ch in el:
                walk(ch, p)

        walk(root, "")
    return lines


def cmd_diff(a, b):
    import difflib
    la, lb = _flatten(a), _flatten(b)
    n = 0
    for line in difflib.unified_diff(la, lb, fromfile=a, tofile=b, lineterm=""):
        print(line)
        n += 1
    if n == 0:
        print("Structurally identical.")


def main():
    args = sys.argv[1:]
    cmds = {"list": (cmd_list, 1), "dump": (cmd_dump, 1),
            "schema": (cmd_schema, 1), "points": (cmd_points, 1),
            "diff": (cmd_diff, 2)}
    if not args or args[0] not in cmds or len(args) - 1 != cmds[args[0]][1]:
        print(__doc__)
        sys.exit(1)
    fn, _ = cmds[args[0]]
    fn(*args[1:])


if __name__ == "__main__":
    main()
