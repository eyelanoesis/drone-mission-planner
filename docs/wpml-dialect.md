# WPML dialects — what the Mini 5 Pro actually needs

Harvested 2026-08-11 from two independent sources. This is the working reference
for the eventual `/src/wpml` writer (spec §9). **Nothing here has been flown yet.**

Every claim below is tagged with how it is known:

- **[obs]** — observed directly in a file in `reference/`, by running `tools/kmz_inspect.py`
- **[src]** — read from source code of a third-party tool
- **[unver]** — asserted by someone else, not yet confirmed against this airframe

---

## 1. There are two WPML dialects, not one

This is the single most important thing harvested, and it is not in DJI's public
documentation. **[src]** (droneroute PR #56, by Myrko Federico)

| | Enterprise dialect | Consumer dialect |
|---|---|---|
| Loaded by | DJI Pilot 2 / FlightHub / Cloud API | **DJI Fly** |
| Aircraft | M300, M350, M30, Mavic 3E/T/M/D | **Mini series — incl. Mini 5 Pro** |
| `xmlns:wpml` | `http://www.dji.com/wpmz/1.0.2` | `http://www.uav.com/wpmz/1.0.2` |
| `missionConfig/payloadInfo` | present | **absent** |
| `template.kml` | full Folder with template params | mission config only |
| Height mode | `aboveGroundLevel` / `EGM96` / relative | `relativeToStartPoint` (no AGL equivalent) |

A writer that emits the enterprise dialect for a Mini will produce a file DJI Fly
refuses. This is the likeliest single cause of "my KMZ won't import."

>**RESOLVED 2026-08-12 — the namespace is `www.uav.com`. [obs]**
> Two files written by DJI Fly itself (`wpml:author` = `fly`) are now in
> `reference/`: `djifly-mcobosb-2025-08-24.kmz` and
> `djifly-ptarmigan-2026-03-06.kmz`. Both use `http://www.uav.com/wpmz/1.0.2`,
> both omit `payloadInfo`, both carry `droneEnumValue` 68 / sub 0. Independently
> corroborated by FlyPath's `wpml/consumer.py`, whose header states it was
> "verified against a DJI Mini 4 Pro + DJI RC2 native mission dump".
>
> The Waypoint OS export is therefore the **outlier**, not the rule, on this
> field. It may still import — DJI may tolerate both — but a writer that copies
> DJI's own output is taking the safer side of an unknown.

## 2. Mini 5 Pro identity

```
droneEnumValue     68        [obs] in the Waypoint OS export; [src] in droneroute PR #56
droneSubEnumValue  0         [obs] [src]
payloadInfo        omitted   [obs] [src]
```

**Enum 68 is ambiguous.** It is also "DJI M30 (Dock)". **[src]** Two different
aircraft, one enum — which is why the dialect has to be carried explicitly per
model and can never be inferred from the enum value. Any drone-profile table this
project builds needs `(enum, sub, dialect)` as the key, not `(enum, sub)`.

Note droneroute lists the **Mini 4 Pro** as enum 100. Community sources say 68 for
Mini 4 Pro too. **[unver]** — irrelevant for us, flagged only because it suggests
the 100 entry may be wrong upstream.

## 3. Field-by-field, from the two reference files

`reference/waypoint-os-2026-08-11.kmz` — real export, DJI-bound, 8 waypoints **[obs]**
`reference/droneroute-pr56-2026-08-11.kmz` — generated from droneroute PR #56 **[obs]**

Agreed by both (treat as the consumer skeleton):

```
missionConfig: flyToWaylineMode=safely · finishAction=goHome
               exitOnRCLost=goContinue · executeRCLostAction=goBack
               globalTransitionalSpeed · droneInfo{68,0} · NO payloadInfo
Folder:        templateId=0 · waylineId=0 · distance=0 · duration=0
               autoFlightSpeed · executeHeightMode=relativeToStartPoint
Placemark:     Point/coordinates (lon,lat) · index · executeHeight · waypointSpeed
               waypointHeadingParam{waypointHeadingMode, waypointHeadingAngle}
               waypointTurnParam{waypointTurnMode, waypointTurnDampingDist}
               useStraightLine
actionGroup:   actionGroupId · actionGroupStartIndex · actionGroupEndIndex
               actionGroupMode=sequence · actionTrigger/actionTriggerType=reachPoint
               action{actionId, actionActuatorFunc=takePhoto,
                      actionActuatorFuncParam/payloadPositionIndex}
```

### The turn-mode enum — spec §7.4 / R3

Both files write a **stop-at-point** turn mode, and they write *different ones*:

| Source | Value | `waypointTurnDampingDist` |
|---|---|---|
| Waypoint OS **[obs]** | `toPointAndStopWithDiscontinuityCurvature` | 0 |
| droneroute grid **[src]** | `toPointAndStopWithContinuityCurvature` | 0 |

Both exist in DJI's enum. The difference is whether the aircraft holds heading
continuity through the stop. For our purpose — stop dead at the line end, no
overshoot — `...DiscontinuityCurvature` is the more literal reading, and it is
the one an app that has flown on this airframe chose. **Start there.**

That a real tool ships stop-at-point on a Mini is supporting evidence for the R3
hypothesis, but it is **not** the measurement. The measurement is
`tools/overshoot.py` against a flown mission.

### Gimbal pitch — an open problem for us specifically

The two sources express gimbal completely differently:

| Source | How |
|---|---|
| Waypoint OS **[obs]** | per-Placemark `gimbalHeadingYawBase=aircraft` + `gimbalRotateMode=absoluteAngle` — **and no pitch angle anywhere in the file** |
| droneroute PR #56 **[src]** | per-Placemark `waypointGimbalHeadingParam/waypointGimbalPitchAngle` |
| **DJI Fly ×2 [obs]** | **`<wpml:gimbalPitchRotateAngle>` per waypoint** (0 and −18.5 in the two files) with `gimbalRotateMode=absoluteAngle`, plus `gimbalRotate` / `gimbalEvenlyRotate` actions in the action group |

**RESOLVED 2026-08-12 for the mechanism.** DJI Fly writes
`gimbalPitchRotateAngle` on the waypoint. Waypoint OS's silence is the outlier
again — meaning that mission flew at whatever pitch the gimbal happened to hold,
which for orthomosaic work is a silent failure. Emit an explicit −90 and never
rely on a default. Still **[unver]** on this airframe: that −90 actually produces
nadir frames on a Mini 5 Pro.

**This matters more to us than to either of them.** Orthomosaic capture requires
nadir (−90°). The one file we have that is known to load carries no pitch value at
all, which means that mission flew at whatever pitch the gimbal happened to hold.
Neither mechanism is confirmed on the Mini 5 Pro.

Third possibility not present in either file: a `gimbalRotate` **action** inside
the actionGroup, which is how the enterprise dialect does it. Test all three.

### No interval trigger anywhere

Both files trigger photos only via `actionTriggerType=reachPoint` — a photo at a
waypoint. **[obs]** Neither carries a distance-interval or time-interval trigger.

For a survey line this forces the choice made in the spec: **a waypoint at every
shot position**, which is what makes the ≈99-waypoint-per-mission limit (CLAUDE.md,
unconfirmed for RC 2) the binding constraint on mission size, and what makes
battery-aware mission splitting a real requirement rather than a nicety.

## 4. Unresolved — only the aircraft can settle these

Each of these differs between the two reference files. Ranked by what breaks.

| # | Field | Waypoint OS | droneroute #56 | DJI Fly ×2 | Status |
|---|---|---|---|---|---|
| 1 | `xmlns:wpml` | `www.dji.com` | `www.uav.com` | **`www.uav.com`** | **SETTLED** — use `uav.com` |
| 2 | gimbal pitch | absent | `waypointGimbalHeadingParam` | **`gimbalPitchRotateAngle`** | **SETTLED** (mechanism) |
| 3 | `takeOffSecurityHeight` | `1.2` | omitted | **absent** | **SETTLED** — optional |
| 4 | `useStraightLine` | `1` | `0` | `0`, `0` | **OPEN** — user setting, not format |
| 5 | turn mode enum | `...Discontinuity...` | `...Continuity...` | `...StopWithContinuity...`, `...PassWithContinuity...` | **OPEN** — user setting |

#4 and #5 are the containment-critical pair and they remain **open**. The two DJI
Fly files do not settle them and cannot: those fields record what a pilot chose
in the app, not what the format requires. Both of those pilots wanted smooth
cinematic paths, so both files carry `useStraightLine=0` with a curved turn mode.

Note what that pairing means for us: `useStraightLine=0` plus
`toPointAndPassWithContinuityCurvature` is a flown path that **bulges outside the
straight line between waypoints** — cutting inside our routed corners, exactly
where clearance is tightest. The geometry module guarantees the commanded path;
only these two fields make the flown path match it. Getting them wrong voids the
whole containment guarantee silently.

**How to settle them cheaply:** make a waypoint mission in DJI Fly on the RC 2
itself, then pull it off the controller and read it. A DJI-authored file for this
exact airframe outranks every source above and turns all five rows from **[unver]**
into **[obs]**. Path on the controller:

```
Android/data/dji.go.v5/files/waypoint/<uuid>/<uuid>.KMZ
```

Reachable over `adb pull`, or with OpenMTP (already installed). The reverse
direction — pushing a generated KMZ back — is what `npx droneroute <file>.kmz`
does; that CLI is worth keeping regardless of anything else.

## 5. What this means for `/src/wpml`

1. Dialect is a **first-class parameter**, not a constant. Key drone profiles on
   `(droneEnumValue, droneSubEnumValue, dialect)`.
2. Write the consumer dialect for the Mini 5 Pro. Do not carry `payloadInfo`.
3. Emit `executeHeightMode=relativeToStartPoint`; there is no AGL mode here, so
   terrain following (Phase 2) must be baked into per-waypoint `executeHeight`
   arithmetic, exactly as spec §7 already assumes.
4. One waypoint per photo. Enforce the count limit at the validation gate.
5. Keep both files in `reference/` as the diff target for the writer's tests, and
   add the DJI-authored file as soon as it exists — it becomes the primary oracle.

## Sources

- `reference/waypoint-os-2026-08-11.kmz` — Waypoint OS export, 2026-08-11 12:10
- droneroute PR #56 — <https://github.com/fcsonline/droneroute/pull/56>
- Local droneroute checkout at `/Users/raa/CURRENT/DRONE/droneroute`, branch `pr56-mini5pro`
