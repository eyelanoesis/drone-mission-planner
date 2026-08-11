# Phase 0 Test Log — Mission Planner Evaluation

Spec reference: §5 (Evaluation Protocol). One block per product, T1–T6 below.
**Decision gate (§5.4) at the bottom. Do not skip it.**

Read `docs/phase0-desk-research.md` first — it says what each app documents, so
field time goes on measuring rather than hunting through menus. It is vendor
claims only; nothing in it fills the measured rows here.

## Test setup (fill once)

| | |
|---|---|
| Test site (address / description) | |
| Site boundary file | `sites/________.geojson` |
| Site has boundary shared with neighbour? | yes / no |
| Site has internal obstacle? | yes / no — what: |
| **Site is concave** (L-shape, courtyard, notch)? | yes / no — see note below |
| Date range of trials | |
| Drone firmware version | |
| RC 2 firmware version | |

**Keep the same site and parameters across all products so results are comparable.**
Suggested baseline: altitude 50 m · frontlap 80 % · sidelap 70 % · nadir gimbal.

> **Use a concave test site if you possibly can.** A convex parcel hides the
> failure mode that matters: a straight connector between two in-boundary line
> ends cutting across a notch. On a rectangle, every planner looks fine.

### Before the first trial — fix the boundary once

```bash
python3 tools/boundary.py from-geojson <drawn.geojson> --name testsite
python3 tools/boundary.py to-kml sites/testsite.geojson
```

Draw the parcel on <https://geojson.io>, save the GeoJSON, run the above, and
import `sites/testsite.kml` into **every** app. Six hand-drawn approximations of
the same field are not a comparison.

Also worth trying (see desk research, "the shortcut"):

```bash
python3 tools/boundary.py to-kml sites/testsite.geojson --inset 3
```

Import the *inset* KML instead, and an app with no setback setting still keeps
its waypoints 3 m inside the property line. If this works, it may end Phase 0.

### After every trial

Export the KMZ and copy it into `reference/` — needed for §9.3 regardless of the
outcome. Name it `<product>-<date>.kmz`. Then:

```bash
python3 tools/kmz_inspect.py schema reference/<file>.kmz          # real WPML field names
python3 tools/overshoot.py sites/testsite.geojson reference/<file>.kmz \
    --setback 2.5 --geojson                                       # THE number
```

`overshoot.py` prints the measured-distance line to paste below. The `--geojson`
output goes onto geojson.io if you want to see it. **Do not eyeball the distance
— the tool computes it.**

---

## T1 — WaypointMap  (version: ______ , date: ______ )

**Boundary behaviour — the critical path**

- [ ] Any setting named inset / buffer / margin / offset / "inner turns" / "turns within area"?  → name & location: ______
- [ ] Flight-line extension / overshoot distance settable? To zero?  → ______
- [ ] Waypoint **turn mode** settable to stop-at-point (vs. curved)?  → ______
      (desk research: "Straightened Flight Paths" / "remove curves" — premium)
- [ ] **`overshoot.py` measured distance, outermost waypoint → polygon edge: ______ m**
- [ ] **`overshoot.py` worst segment excursion (path between waypoints): ______ m**
- [ ] Flight-line heading settable manually (not just E-W / N-S)?  → ______
- [ ] Inset-KML shortcut works (import `-inset3m.kml`, waypoints stay inside)?  → ______

**Exclusion zones**

- [ ] Hole / exclusion polygon inside the survey area possible?  → ______
- [ ] Does the path route around it?  → ______

**Capture control**

- [ ] Photo triggers embedded as waypoint actions (not just a timer)?  → ______
- [ ] Trigger mode: distance / time / per-waypoint?  → ______

**Terrain & altitude**

- [ ] Terrain following offered? Elevation source — DTM or DSM?  → ______
- [ ] Altitude reference: takeoff-relative / absolute?  → ______

**Scale & repeatability**

- [ ] Site saveable and re-flyable with identical parameters?  → ______
- [ ] Parameter templates?  → ______
- [ ] Batch generation / export?  → ______

**Export & verdict**

- [ ] KMZ exported and copied to `reference/`?  → filename: ______
- [ ] `kmz_inspect.py schema` run — turn-mode value actually written: ______
- [ ] Cost to get the needed features (free / premium / subscription): ______
- Overall workflow feel (1–5): ______   Deal-breakers: ______

---

## T2 — Waypoint OS  (version: ______ , date: 2026-08-11 — **partial**)

⚠️ Windows desktop only — arrange a Windows machine or VM before this trial.

**Status: file-only.** An export exists and has been read
(`reference/waypoint-os-2026-08-11.kmz`, 8 waypoints, 50 m, Copenhagen). The
trial itself was never run: no canonical site, so no `overshoot.py` number, and
none of the UI rows below were checked. Only rows derivable from the exported
file are filled — everything else stays blank on purpose.

*(copy the T1 block; filled rows only:)*

**Capture control**

- [x] Photo triggers embedded as waypoint actions (not just a timer)? → **yes**, 4 `actionGroup`s
- [x] Trigger mode: distance / time / per-waypoint? → **per-waypoint only** (`actionTriggerType=reachPoint`); no interval trigger present

**Terrain & altitude**

- [x] Altitude reference: takeoff-relative / absolute? → **takeoff-relative** (`executeHeightMode=relativeToStartPoint`)

**Export & verdict**

- [x] KMZ exported and copied to `reference/`? → `waypoint-os-2026-08-11.kmz`
- [x] `kmz_inspect.py schema` run — turn-mode value actually written: **`toPointAndStopWithDiscontinuityCurvature`** (damping 0, `useStraightLine=1`)
- Note: file carries **no gimbal pitch field at all** — see `docs/wpml-dialect.md` §3

**Not measured:** overshoot, segment excursion, inset shortcut, exclusions,
setback settings, repeatability, cost.

---

## T3 — Litchi Hub  (version: ______ , date: ______ )

⚠️ Confirm Mini 5 Pro is supported at all before spending a trial.
⚠️ Curved Turns disables waypoint actions — so curved + per-waypoint photo is
impossible. Test Straight Lines, and Curved Turns at curve size 0 %.

*(copy the T1 block)*

---

## T4 — MavenRoute + MavenBridge  (version: ______ , date: ______ )

Docs list only curved/orbit/spiral path types — check hard for a straight option.
MavenBridge is also the route for pulling existing missions off the RC 2 (§9.3).

*(copy the T1 block)*

---

## T5 — YMapper  (version: ______ , date: ______ )

Source reading says waypoints are strictly clipped inside the drawn polygon: no
extension, no inset. Expect overshoot ≈ 0 and clearance ≈ 0. **The two things to
actually test:** the inset-KML shortcut, and the segment excursion on a concave
site.

*(copy the T1 block)*

---

## T6 — Pixpro  (14-day trial — only if T1–T5 fail the critical path)

Capture is interval-based; waypoints are path-only, not photo positions.

*(copy the T1 block)*

---

## Decision gate (§5.4) — fill after all trials

| Finding | Applies? |
|---|---|
| A product enforces boundary containment with a settable parameter → **buy it, build nothing** | **no** — none of the six documents or offers one |
| Stop-at-point turn mode reduces overshoot to within the legal setback → **adopt + document as SOP; revisit only if exclusions/batch force it** | not measured — superseded, see below |
| The inset-KML shortcut holds on a real parcel → **adopt app + `boundary.py --inset` as SOP** | untested — remains the cheapest fallback if the build stalls |
| No product covers the required capability set → **build (Phase 1)** | **yes** |

**Decision: BUILD (Phase 1).**   **Date: 2026-08-11**

### What this decision rests on — read before trusting it

This gate closed on a **capability gap, not on a measured overshoot number.**
The measured rows above are still blank. That is a weaker basis than §5.4
intended, and it is recorded as such deliberately.

The gap is categorical rather than marginal. Rune trialled the field and found no
product that covers the job. The clearest single piece of evidence is DroneRoute
(the best-liked of those trialled): its grid survey is defined by
`corner1`/`corner2` — **a two-corner rectangle**. The strings `polygon`,
`surveyArea`, `boundary`, `inset`, `buffer` and `setback` do not appear anywhere
in its shared type package. An arbitrary parcel polygon is not a missing feature
there; it is absent from the data model. Obstacle handling across the field
(DroneRoute's `getObstacleWarnings`, and every other product) *warns* about a
crossing rather than routing around it.

So the question the measurement was meant to answer — "is the overshoot small
enough to live with?" — is moot where the app cannot accept the boundary at all.

**What is still true and still worth doing:**

- The **inset-KML shortcut is untested** and remains the one path that could make
  the build unnecessary for simple convex parcels. If Phase 1 stalls or a job
  needs flying before it lands, test it: `boundary.py to-kml --inset 3` into
  YMapper, then `overshoot.py` against the un-inset site file.
- `overshoot.py` does not retire with this decision. It becomes the acceptance
  test for our own output: every generated mission gets measured against the
  parcel before it is flown.
- Fill the measured rows opportunistically. A real overshoot figure from an
  existing app is still the honest benchmark to beat, and it is evidence if the
  decision is ever revisited (R9).

Remember what the measurement does *not* cover: `overshoot.py` measures the
**commanded** path. A real aircraft flying curved turns bulges further out than
the straight lines between waypoints, so every figure above is a lower bound.
Fly one mission and watch the line ends before trusting a marginal pass.

Still unresolved by any measurement here, and reasons to build even on a pass:
**exclusion zones** (no product documents them) and **batch/repeatability at
several hundred missions a year**.
