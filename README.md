# Drone Mission Planner

Boundary-safe mission planning for photogrammetric survey flights — DJI Mini 5 Pro,
Danish operations. The one guarantee no commercial planner documents: **every
waypoint, including turnarounds, stays inside a legally defined boundary.**

- `CLAUDE.md` — working context for Claude Code (read first; loaded automatically)
- `spec/drone-mission-planner-spec-v0.2.md` — the authoritative specification
- `docs/phase0-test-log.md` — **the current task**: fillable evaluation log for
  existing apps. Phase 0 gates all building.
- `reference/` — known-good KMZ exports from existing apps go here (ground truth
  for the WPML file format, spec §9.3)
- `tools/` — working Python utilities, tested:
  - `kmz_inspect.py` — `list` / `dump` / `schema` / `points` / `diff` a mission KMZ.
    `schema` learns the real WPML vocabulary from a reference file; `points`
    writes a GeoJSON of the flight path (view on geojson.io) — this is how you
    *measure* each app's boundary overshoot during Phase 0.
  - `exif_profile.py` — builds a verified camera profile from a real photo
    (fills `profiles/drones.json`)
  - `geometry_prototype.py` — reference implementation of the spec §7 pipeline
    (inset → exclusions → contained-turn grid → invariant check) in Shapely.
    Not the product; the oracle the eventual Turf.js port is tested against.
    Run it bare for a demo, or `--polygon site.geojson` for real parcels.
- `profiles/drones.json` — drone camera profiles (empty until EXIF-verified)

## Setup

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python3 tools/geometry_prototype.py        # smoke test: should print PASS twice*
```

*The demo intentionally includes an exclusion that triggers the route-edge
WARNING — connectors between split flight lines are not yet routed around
obstacles. That is the first known Phase 1 geometry task.

## Status

Phase 0 (tool evaluation) **not started**. See `docs/phase0-test-log.md`.
No product code exists; nothing should be built until the §5.4 decision gate says so.
