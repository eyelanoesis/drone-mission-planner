# Phase 0 desk research — what the six products *document*

Compiled 2026-08-11. Supports the trials in `docs/phase0-test-log.md` (spec §5.3).

> **These are vendor claims and code readings, not measurements.**
> Nothing in this file may be copied into the measured rows of the test log. Its
> only job is to tell you what to *look for* in each app so field time is spent
> measuring rather than hunting through menus. The measured overshoot row comes
> from `tools/overshoot.py` and nothing else.

---

## The headline: nobody documents a setback

Across all six products, **not one documents an inset / buffer / margin / setback
from the drawn area.** That is the gap this project was specified around (spec
§1), and desk research does not close it.

What several products *do* document is the adjacent problem — **turn geometry**,
the spec §7.4 hypothesis. Two of them advertise straight/linear flight lines as a
feature. That is the thing to measure.

## The DJI turn-mode vocabulary (spec §9, R1)

Confirmed from DJI's own WPML documentation, as transcribed in YMapper's
open-source WPML engine
([enums.dart](https://github.com/YLabs-FPV/YMapper/blob/main/packages/dji_waypoint_engine/lib/src/enums.dart)):

| `wpml:waypointTurnMode` value | Behaviour |
|---|---|
| `coordinateTurn` | Coordinated turn, no dip, **turns early** — cuts the corner |
| `toPointAndStopWithDiscontinuityCurvature` | **Straight line, stops at the point** ← the §7.4 candidate |
| `toPointAndStopWithContinuityCurvature` | Curved approach, stops at the point |
| `toPointAndPassWithContinuityCurvature` | Curved, does not stop |

Source: [DJI WPML common elements](https://developer.dji.com/doc/cloud-api-tutorial/en/api-reference/dji-wpml/common-element.html#wpml-waypointturnparam).

Also confirmed from the same engine: `ActionTriggerType` supports `reachPoint`,
`betweenAdjacentPoints`, `multipleTiming` and `multipleDistance` — so
**distance-triggered capture is a native WPML feature**, not something that has
to be faked with a timer.

**Still unverified:** that a Mini 5 Pro on RC 2 firmware honours
`toPointAndStopWithDiscontinuityCurvature`. Documented enums and flown behaviour
are different claims. This stays R1/R3 until a reference KMZ from a real flight
is in `reference/` and `kmz_inspect.py schema` confirms the value.

---

## T1 — WaypointMap (free tier + premium)

- **Turn mode: yes, documented.** "Straightened Flight Paths — Benefit from 360°
  obstacle detection while maintaining linear tracks", and on the marketing page
  "Remove curves for perfectly linear tracks". This is the §7.4 hypothesis sold
  as a feature. **Premium.**
- **Waypoint actions: yes.** "Add custom triggers—photos, pauses, or camera angle
  shifts—at every waypoint" (premium). "Generate All Points" outputs a waypoint
  at every grid intersection (premium).
- **Terrain: "Dynamic Altitude Adjustment"** — auto-adjusts height to terrain
  (premium). Elevation source not documented; ask what DTM/DSM it uses (spec §8
  warns DSM would fly at roof height).
- **Free tier covers:** altitude, speed, gimbal angle, distance between paths.
- **Line orientation:** East-West / North-South only, per the docs — check in the
  app whether an arbitrary heading is possible, since spec §7 recommends running
  lines parallel to the most constrained edge.
- **Inset/setback: not documented. Overshoot/line-extension: not documented.**
- Can import and edit existing DJI Fly KMZ files — useful for §9.3 reverse
  engineering.

Sources: [Mini 5 Pro page](https://www.waypointmap.com/drone/dji-mini-5-pro-automated-mission-flight-planning),
[waypointmap.com](https://www.waypointmap.com/)

## T2 — Waypoint OS (owned)

- **Turn mode: yes, and it is the product's pitch.** "Flight lines use straight
  segments, not DJI Fly's default curved splines that ruin mapping coverage,
  keeping your grid as a grid."
- **Capture:** "The KMZ embeds the right spacing so DJI Fly fires the shutter on
  schedule" — sounds like distance-triggered capture (`multipleDistance`);
  confirm with `kmz_inspect.py schema` on an export.
- **Free, local-first, no accounts** — same posture as this project.
- **⚠️ Windows desktop only.** Not a web app. Rune is on Mac; this trial needs a
  Windows machine or VM. Plan for it or it will silently block T2.
- **Inset/setback: not documented.**

Source: [pilotbyte.com/waypoint-os](https://www.pilotbyte.com/waypoint-os),
[review](https://drone.vet/finally-free-drone-mapping-software-that-actually-works-meet-waypoint-os/)

## T3 — Litchi (Mission Hub)

Litchi is the best-documented turn behaviour of the six, and it comes with a
trap:

- **Path Mode: "Straight Lines"** — the aircraft flies into the waypoint, stops
  for a few seconds, and can perform actions there.
- **Path Mode: "Curved Turns"** with a **Curve Size 0–100 %** (batch-editable per
  waypoint).
- **The trap:** with Curved Turns selected, **waypoint actions are ignored** —
  the aircraft curves around the waypoints and never flies over them, so there is
  no per-waypoint photo trigger. Curved turns and per-waypoint capture are
  mutually exclusive in Litchi.
- Setting Curved Turns with curve size 0 % is the community workaround for "don't
  stop at every waypoint" — worth measuring, since 0 % curve may or may not mean
  zero overshoot.
- **Inset/setback: not documented.**
- Note Litchi's DJI support is largely older airframes; confirm Mini 5 Pro is
  actually supported before spending a trial on it.

Sources: [flylitchi.com/help](https://flylitchi.com/help),
[Mission Hub guide](https://dronephotographyservices.co.uk/litchi-mission-hub/),
[curved-turn actions thread](https://forum.flylitchi.com/t/curved-turn-waypoint-missions-perform-actions-at-0-ft-waypoints/5272)

## T4 — MavenRoute + MavenBridge

- Browser-based planner; single **and double-grid**; front/side overlap;
  **altitude *or* GSD targeting** (the only one documented to accept a target GSD
  directly); speed; 2D/3D/FPV preview; time, photo count and coverage estimates.
- **Path types documented as "curved, orbit, spiral"** — no straight/stop-at-point
  option is documented. This is a concern for the core hypothesis; verify in-app.
- Imports/exports KML, KMZ, GeoJSON, CSV — so `boundary.py to-kml` output should
  load straight in.
- **MavenBridge** transfers KMZ from computer to the controller — this is the
  route to getting missions onto RC 2, and (per CLAUDE.md §9) potentially to
  pulling existing missions *off* it for reference.
- **Inset/setback, exclusion zones, terrain source: not documented.**

Source: [mavenpilot.com](https://www.mavenpilot.com/)

## T5 — YMapper (free, open source) — **read the source, not the README**

YMapper's mapping engine is open source, so its behaviour is knowable exactly
rather than inferred:
[`lib/core/drone_mapping_engine.dart`](https://github.com/YLabs-FPV/YMapper/blob/main/lib/core/drone_mapping_engine.dart).

**Every candidate waypoint is tested with `_isPointInPolygon` and discarded if it
is not inside the drawn polygon.** There is no line extension, no turnaround
allowance, and no inset. Concretely:

```dart
Point p = Point(x, y);
if (_isPointInPolygon(p, rotatedPolygon)) { line.add(p); }
```

Consequences, and they matter for the decision gate:

1. **Commanded overshoot is zero by construction.** No waypoint can be outside
   the drawn polygon.
2. **Clearance is also zero.** Waypoints sit arbitrarily close to the edge — there
   is no setback. But that is fixable from the *input* side: draw an
   already-inset polygon. See "the shortcut" below.
3. **Concave parcels are not safe.** The serpentine connector between line ends is
   a straight hop between two in-polygon points. Across a concave notch (an
   L-shaped parcel, a courtyard) that straight segment can leave the polygon even
   though both waypoints are inside it. This is exactly what the
   *segment excursion* figure in `tools/overshoot.py` measures — do not skip it
   on a concave test site.
4. Arbitrary grid **angle** is supported (`angle` rotates the polygon before
   scanning), which satisfies "run lines parallel to the most constrained edge".
5. Grid spacing is derived from sensor/focal/overlap with the same GSD formula as
   CLAUDE.md, and there is a `groundOffset` term.

It also ships a full WPML writer (`packages/dji_waypoint_engine/`) with the turn
mode, action-trigger and finish-action enums — a second reference implementation
alongside the reference KMZ files, useful for §9.3.

⚠️ Its README warns: "Do not modify or save the mission from inside DJI Fly,
because it doesn't support straight curves, and will break the mission."

Source: [github.com/YLabs-FPV/YMapper](https://github.com/YLabs-FPV/YMapper)

## T6 — Pixpro Waypoints (paid, 14-day trial)

Documentation is thin on exactly the questions that matter. The step-by-step
guide covers photo interval, flight height, and overlap (recommended 80 %), and
notes that "Waypoints do not represent photo locations in any manner. Waypoints
are for the flight path only" — i.e. capture is interval-based, not a
per-waypoint action, which is a meaningful difference from WaypointMap.

**Turn behaviour, line extension, boundary buffer and exclusion zones: not
documented anywhere public.** Supports KML import, so the canonical boundary can
be loaded. Per spec §5.3 this is the last trial and only if T1–T5 fail.

Sources: [pix-pro.com/pixpro-waypoints](https://www.pix-pro.com/pixpro-waypoints),
[how-to guide](https://www.pix-pro.com/blog/pixpro-waypoints-how-to)

---

## The shortcut this research suggests

If a planner clips waypoints to the drawn polygon and never extends beyond it
(YMapper provably does this; WaypointMap and Waypoint OS both advertise straight
lines), then **containment can be achieved from the input side**: draw the
boundary already inset by the setback, and import *that* polygon into the app.

```bash
python3 tools/boundary.py to-kml sites/<site>.geojson --inset 3
```

This writes `sites/<site>-inset3m.kml` — import it into the trial app, fly the
grid inside it, and every waypoint is ≥3 m inside the real property line.

**Test this early.** If it holds on a real parcel, the §5.4 gate may close with
"adopt an existing app + this inset workflow as SOP" and no product gets built.
Two things would reopen it: concave parcels (point 3 above), and exclusion zones,
which no product documents at all.

## Products outside the spec's T1–T6 worth a look

Surfaced while researching; not in spec §5.3, so treat as optional:

- **FlyPath** — open-source **QGIS plugin** exporting native DJI WPML KMZ,
  explicitly for DJI Fly on RC 2. QGIS brings real geometry operations (buffer,
  difference) to the problem, which is precisely the missing capability. If
  boundary insets and exclusion holes work there, it is a serious alternative to
  building. <https://github.com/dronnix-io/FlyPath>
- **DroneRoute** — free, open-source, browser-based; grid/orbit/facade patterns,
  KMZ export. <https://droneroute.io/>
- **map-creator** (hdrpano) — grid/polygon/helix/circle generator, KMZ export.
  <https://github.com/hdrpano/map-creator>
