# CLAUDE.md — Drone Mission Planner

> Claude Code reads this file automatically. It is the working context; the spec
> at `spec/drone-mission-planner-spec-v0.2.md` is the authoritative requirements
> document — when they disagree, the spec wins.

## What this project is

A local-first, browser-based mission planner that generates **DJI WPML KMZ waypoint files**
for photogrammetric survey flights on a **DJI Mini 5 Pro** (flown via the RC 2 controller's
native waypoint mode). Its reason to exist is one guarantee no commercial planner documents:

**Every waypoint — including line-end turnarounds — stays inside a legally defined boundary,
inset from the property line by a settable setback distance.**

Operator: Rune, Hovedstaden/Nordsjælland, Denmark. Use case: orthomosaic site inspections
for facility-management clients, up to several hundred missions/year. Danish setback rules
(2.5–5 m to neighbouring property/roads) are the origin of the core requirement.

## Current status

- Specification v0.2 complete (see spec file). **No code exists yet.**
- **Phase 0 (evaluation of existing tools) is not done and gates everything.**
  Do not start building until Phase 0 says build. Trials: WaypointMap, Waypoint OS,
  Litchi Hub, MavenRoute+MavenBridge, YMapper (all free/owned), then Pixpro (paid trial).
  Checklist in spec §5.3. Decision gate in §5.4.
- Key open hypothesis (spec §7.4): setting waypoint **turn mode to stop-at-point**
  (vs. curved/coordinated) may collapse line-end overshoot to near zero on a multirotor.
  If any existing app exposes this and it works, the build may be unnecessary. Test first.

## Architecture decisions (settled — don't relitigate without cause)

| Decision | Choice | Why |
|---|---|---|
| Platform | Browser web app, local-first, no accounts/cloud | Map-centric problem; cross-platform (Mac now, Windows/tablet later); client site data stays local |
| Map | MapLibre GL JS | Open source, vector tiles, custom overlays |
| Geometry | Turf.js in-browser | buffer/difference/intersect/point-in-polygon covers spec §7 |
| KMZ writing | JSZip | KMZ = ZIP of WPML XML |
| Optional backend | Python FastAPI + Shapely + rasterio | Only if raster elevation sampling proves impractical in-browser |
| Persistence | GeoJSON/JSON files + IndexedDB | Site library, templates |
| NOT building | Flight control, live telemetry, photogrammetry processing, hard geofencing | §6.4 — the tool is a file generator; DJI SDK is closed for Mini series |

## The core geometry (spec §7)

```
P  = property boundary polygon (drawn, or later from Danish cadastral lookup)
F  = negativeBuffer(P, setback) − union(buffer(obstacle_i, clearance_i))   # flyable
C  = negativeBuffer(F, turn_extension)                                      # capture

INVARIANT (the product):  every waypoint ∈ F.  Assert before export; fail loudly.
```

- Per-edge setbacks (different value per boundary edge) are a Should (F-D2).
- Turn strategy: stop-at-point at line ends → tiny extension, sharper images
  (stationary capture; matters in Danish winter light). Curved turns need large extension.
- Trade-off to surface in UI, never hide: a band ~turn_extension wide at line ends
  is not nadir-imaged. Report un-imaged area (F-D5). Mitigations: run lines parallel
  to the most constrained edge; optional perimeter pass with outward gimbal.

GSD/spacing math (all automatic from a drone profile dropdown — never manual entry):

```
GSD_cm_px  = sensor_w_mm * alt_m * 100 / (focal_mm * img_w_px)
line_gap   = GSD * img_w_px * (1 - sidelap)
trig_gap   = GSD * img_h_px * (1 - frontlap)
v_max      = trig_gap / min_shot_interval_s     # warn if user speed exceeds
alt_wp     = (DTM(wp) - DTM(takeoff)) + AGL     # same DTM both terms; never mix sources
```

Ship a built-in profile library (Mini 4 Pro, Mini 5 Pro, Air 3/3S, Mavic 3/4, enterprise).
Profiles verified once against real-image EXIF (FocalLength, ExifImageWidth/Height) —
published specs are sometimes wrong and a wrong focal length silently corrupts everything.

## WPML KMZ output (spec §9) — critical method

**Do NOT write the WPML generator from documentation or memory.** Reverse-engineer:

1. Export a working Mini 5 Pro mission from WaypointMap or Waypoint OS
   (MavenBridge can also pull existing missions off the RC 2 controller).
2. Unzip → `wpmz/` contains template + waylines KML in DJI's WPML dialect.
3. That file is the reference implementation — it is known to fly on this airframe.
4. Generate files differing only in intended geometry/parameters. Diff against reference.
5. Fields that must be verified from the reference, not assumed: turn-mode enum values
   (the critical one), altitude reference mode, action-group syntax for photo trigger
   and gimbal pitch, speed fields, finish/RTH action.

Pre-export validation gate (block export with clear message on failure):
all waypoints ∈ F · none in exclusion buffers · speed ≤ v_max · vertical gradient sane ·
waypoint count ≤ aircraft limit (community reports ≈99/mission in DJI Fly — confirm for
Mini 5 Pro/RC 2; split missions if exceeded) · flight time within battery reserve ·
altitude ≤ 120 m.

## Danish data sources (spec §8) — all free

| Data | Source | Notes |
|---|---|---|
| No-fly zones | Trafikstyrelsen Dronezoner (droneregler.dk/dronezoner) — data download + API; Naviair open-sourced frontends at github.com/Naviair | Overlay is advisory ONLY. UI must carry disclaimer: not exhaustive, NOTAMs hourly via Naviair, pilot responsible |
| Elevation | Danmarks Højdemodel, SDFI via Datafordeleren (registration required) | Use **DTM** (bare earth), never DSM (includes buildings — would fly at roof height). Verify licence/access method |
| Cadastral parcels | Matriklen, SDFI + national address API | Address → parcel polygon → auto survey area. Highest-leverage feature at volume (F-N3); spike early |
| Base imagery | Commercial tiles or Danish orthophotos | **Check commercial-use licence — likeliest licensing trap in the stack** |

## Build order (only after Phase 0 says build)

**Phase 1 — MVP.** Polygon draw on satellite map → drone dropdown/GSD → uniform inset →
grid with stop-at-point contained turns → WPML KMZ with photo actions → validation gate.
*Done = one real mission flown from a self-generated file, every waypoint verified in-boundary.*

**Phase 2.** Exclusion zones w/ clearance buffers · per-edge setbacks · DTM terrain following ·
un-imaged-area report · site library + templates (save once, re-fly quarterly).

**Phase 3.** Dronezoner overlay · cadastral address→parcel import (spike early; if it works,
consider promoting to Phase 2) · batch generation · pre-flight PDF report ·
oblique/double-grid for 3D · battery-aware mission splitting.

## Repo layout (scaffolded — tools below already exist and are tested)

```
CLAUDE.md                      this file
README.md
spec/…spec-v0.2.md             authoritative spec
docs/phase0-test-log.md        fillable evaluation log, T1–T6 — THE CURRENT TASK
docs/phase0-desk-research.md   what each product documents (vendor claims, unverified)
reference/                     known-good KMZ exports (added during Phase 0; never edit)
sites/                         the ONE canonical test-site polygon, per site
profiles/drones.json           camera profiles — nulls until EXIF-verified
tools/kmz_inspect.py           list/dump/schema/points/diff for mission KMZs (stdlib only)
tools/exif_profile.py          real-photo EXIF -> verified profile JSON snippet
tools/boundary.py              canonical site polygon: from-geojson/from-kmz/to-kml/info.
                               `to-kml --inset N` emits a pre-shrunk boundary — the way to
                               get a setback out of an app that has no setback setting.
tools/overshoot.py             THE Phase 0 number: signed waypoint-to-boundary distance +
                               between-waypoint segment excursion, in metres, vs. a setback.
                               Replaces eyeballing a ruler on geojson.io.
tools/geometry_prototype.py    spec §7 pipeline in Shapely: inset -> exclusions ->
                               contained-turn grid -> invariant + route-edge checks.
                               The oracle the eventual Turf.js port is tested against.
/src (does not exist yet — create only after the Phase 0 gate says build)
  /map /geometry /profiles /wpml /validate /store   per spec §10
```

Geometry and WPML modules are pure and unit-tested; the invariant check is the most
important test in the repo. Keep the UI thin.

**Known prototype limitation (first Phase 1 geometry task):** connectors between
flight-line segments split by an exclusion are straight hops — the prototype's
`check_route_edges` flags when they cross the excluded area but does not yet route
around it. The demo intentionally reproduces this (2 flagged connectors).

## Immediate next actions

Python tooling needs a venv: `python3 -m venv .venv && .venv/bin/pip install -r requirements.txt`.

1. Fix the test site once: draw it on geojson.io, then
   `tools/boundary.py from-geojson <drawn> --name <site>` and `to-kml` it into every app.
   **Prefer a concave parcel** — a rectangle hides the connector-cuts-the-corner failure.
2. **Test the inset shortcut early** (`to-kml --inset 3`). Desk research shows YMapper
   provably clips waypoints inside the drawn polygon, and WaypointMap/Waypoint OS both
   advertise straight lines. If handing an app a pre-inset boundary holds up on a real
   parcel, §5.4 may close with "adopt + SOP" and nothing gets built.
3. Run Phase 0 trials per `docs/phase0-test-log.md` (T1–T6, free first), same site
   throughout. **Copy every exported KMZ into `reference/`.**
4. Per reference file: `tools/kmz_inspect.py schema` (real WPML field names, esp. the
   turn-mode value actually written) then `tools/overshoot.py <site> <kmz> --setback N`.
   Its two numbers — waypoint overshoot and segment excursion — are the build/no-build
   fact. Both are lower bounds: they measure the commanded path, not the flown one.
5. Fill the Mini 5 Pro profile: fly, take one photo at known altitude, run
   `python3 tools/exif_profile.py <photo> --altitude <m>`, paste into profiles/drones.json.
6. Apply the §5.4 decision gate. Note two things no product documents at all and no
   measurement above covers: **exclusion zones** and **batch repeatability** — either can
   justify building even on a containment pass. If build: port geometry_prototype.py to
   /src/geometry in Turf.js test-first, using the Python version as the oracle; fix the
   exclusion route-around; then the WPML writer diffed against reference files; UI last.

## Risks to keep in view (spec §11)

R3 stop-at-point turn hypothesis unproven (test in Phase 0 — core thesis) ·
R1 WPML schema drift (reference-file method) · R2 per-waypoint altitude support on this
airframe unverified (fallback: constant altitude + relief warning) · R9 building something
a €5/month product solves (Phase 0 exists to kill this) · R8 DJI firmware changes
(keep reference files, re-validate after updates).

## Conventions

- Units: metres, WGS84 lon/lat, altitudes AGL unless stated. GSD in cm/px.
- Danish regulatory framing stays advisory — the tool never claims airspace clearance.
- Requirement IDs from the spec (F-C*, F-D*, F-N*) are used in commit messages/issues.
