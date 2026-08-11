# Phase 0 Test Log — Mission Planner Evaluation

Spec reference: §5 (Evaluation Protocol). Fill one copy of the checklist per product.
**Decision gate (§5.4) at the bottom. Do not skip it.**

## Test setup (fill once)

| | |
|---|---|
| Test site (address / description) | |
| Site has boundary shared with neighbour? | yes / no |
| Site has internal obstacle? | yes / no — what: |
| Date range of trials | |
| Drone firmware version | |
| RC 2 firmware version | |

**Keep the same site and parameters across all products so results are comparable.**
Suggested baseline: altitude 50 m · frontlap 80 % · sidelap 70 % · nadir gimbal.

**After every trial: export the KMZ and copy it into `reference/` — needed for §9.3
regardless of the outcome. Name it `<product>-<date>.kmz`.**

Then immediately run:

```
python3 tools/kmz_inspect.py schema reference/<file>.kmz     # learn the vocabulary
python3 tools/kmz_inspect.py points reference/<file>.kmz     # waypoints -> GeoJSON
```

Drag the resulting `.geojson` onto geojson.io and *measure* the distance from the
outermost waypoint to your drawn boundary. That number goes in the checklist.

---

## Checklist template

Copy this block per product. Trials in order: **T1 WaypointMap (free) · T2 Waypoint OS
(owned) · T3 Litchi Hub (free) · T4 MavenRoute+MavenBridge (free) · T5 YMapper (free,
open source) · T6 Pixpro (14-day trial — only if T1–T5 fail the critical path).**

### T_: ____________________  (version: ______ , date: ______ )

**Boundary behaviour — the critical path**

- [ ] Any setting named inset / buffer / margin / offset / "inner turns" / "turns within area"?  → name & location: ______
- [ ] Flight-line extension / overshoot distance settable? To zero?  → ______
- [ ] Waypoint **turn mode** settable to stop-at-point (vs. curved)?  → ______
- [ ] With stop-at-point set: **measured distance, outermost waypoint → polygon edge: ______ m** (from geojson.io)
- [ ] Flight-line heading settable manually?  → ______

**Exclusion zones**

- [ ] Hole / exclusion polygon inside the survey area possible?  → ______
- [ ] Does the path route around it?  → ______

**Capture control**

- [ ] Photo triggers embedded as waypoint actions (not just a timer)?  → ______
- [ ] Trigger mode: distance / time / per-waypoint?  → ______

**Terrain & altitude**

- [ ] Terrain following offered? Elevation source?  → ______
- [ ] Altitude reference: takeoff-relative / absolute?  → ______

**Scale & repeatability**

- [ ] Site saveable and re-flyable with identical parameters?  → ______
- [ ] Parameter templates?  → ______
- [ ] Batch generation / export?  → ______

**Export & verdict**

- [ ] KMZ exported and copied to `reference/`?  → filename: ______
- [ ] `kmz_inspect.py schema` run — anything notable (esp. turn-mode values): ______
- Overall workflow feel (1–5): ______   Deal-breakers: ______

---

## Decision gate (§5.4) — fill after all trials

| Finding | Applies? |
|---|---|
| A product enforces boundary containment with a settable parameter → **buy it, build nothing** | |
| Stop-at-point turn mode reduces overshoot to within the legal setback → **adopt + document as SOP; revisit only if exclusions/batch force it** | |
| No product contains turnarounds; overshoot is material → **build (Phase 1)** | |

**Decision:** ______________________   **Date:** ______

**Measured best-case overshoot across all products: ______ m**
(This number is the build/no-build fact. If it's under your smallest legal setback, you may not need to build.)
