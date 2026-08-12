# reference/ — known-good mission files

**Never edit these files.** They are the oracle the WPML writer is diffed against
(spec §9.3). They are chmod'd read-only on purpose. Add files, never modify them.

Every file needs a row here saying where it came from and whether it has flown.
A file nobody has flown is evidence, not truth.

| File | Source | Aircraft | Flown? | Notes |
|---|---|---|---|---|
| `waypoint-os-2026-08-11.kmz` | Waypoint OS export (`wpml:author` = `Waypoint OS`), 2026-08-11 12:10 | intended Mini 5 Pro | **not yet** | 8 waypoints, 50 m, Copenhagen. `droneEnumValue` 68, consumer dialect, no `payloadInfo`. Turn mode `toPointAndStopWithDiscontinuityCurvature`, `useStraightLine=1`. No gimbal pitch field anywhere. |
| `droneroute-pr56-2026-08-11.kmz` | Generated from droneroute PR #56 (branch `pr56-mini5pro`) via its own `generateKmzBuffer`, 2026-08-11 | Mini 5 Pro profile | **not yet** | 2 waypoints, synthetic. Included as the *other* opinion on the consumer dialect — `www.uav.com` namespace, `waypointGimbalHeadingParam`, `useStraightLine=0`. Not a product export. |
| `djifly-mcobosb-2025-08-24.kmz` | **Authored by DJI Fly** (`wpml:author` = `fly`, createTime 2025-08-24). Found committed unzipped in [mcobosb/environmentaltools](https://github.com/mcobosb/environmentaltools) (GPL-3.0), path `src/environmentaltools/data/drone/template_207BCB3D-…kmz/wpmz/`. Repacked here as a KMZ; contents byte-identical to source. | unknown, `droneEnumValue` 68 | unknown — **not by us** | 3 waypoints. `www.uav.com` namespace, no `payloadInfo`, `gimbalPitchRotateAngle` 0, `useStraightLine=0`, turn modes `toPointAndStopWithContinuityCurvature` / `toPointAndPassWithContinuityCurvature`, no `takeOffSecurityHeight`. |
| `djifly-ptarmigan-2026-03-06.kmz` | **Authored by DJI Fly** (`wpml:author` = `fly`, createTime 2026-03-06). Found committed unzipped in [ccheng-design/Ptarmigan](https://github.com/ccheng-design/Ptarmigan) (MIT), path `02_GH/Drone Section/CA7A9F62-…/wpmz/`. Repacked here as a KMZ; contents byte-identical to source. | unknown, `droneEnumValue` 68 | unknown — **not by us** | 11 waypoints. Same dialect as above. `gimbalPitchRotateAngle` −18.5, `waypointHeadingMode=smoothTransition`, `finishAction=gotoFirstWaypoint`. |

### How much the two DJI Fly files are worth

They are the only files here that DJI's own software wrote, so on **format**
questions they outrank everything else: namespace, which elements exist, what is
optional. Two independent files from different years agree on all of it.

They are worth much less on **flight-behaviour** questions. `useStraightLine`,
`waypointTurnMode`, gimbal angle and speed are whatever those two pilots chose in
the app. Both happen to have chosen curved fly-through paths, which tells us
nothing about whether a Mini 5 Pro honours stop-at-point.

And their provenance is weaker than it looks: unknown airframe (enum 68 is
ambiguous — see `docs/wpml-dialect.md` §2), unknown DJI Fly version, and no way
to confirm nobody edited them before committing. Evidence, not truth.

## Still missing — the one that would outrank everything

A mission authored by **DJI Fly itself** on **Rune's own RC 2** with the **Mini 5
Pro** bound, pulled off the controller from:

```
Android/data/dji.go.v5/files/waypoint/<uuid>/<uuid>.KMZ
```

Until that file exists, every field in `docs/wpml-dialect.md` marked unresolved
stays unresolved. See that document, §4.

## Reading a file here

```bash
.venv/bin/python tools/kmz_inspect.py schema  reference/<file>.kmz
.venv/bin/python tools/kmz_inspect.py points  reference/<file>.kmz
.venv/bin/python tools/kmz_inspect.py diff    reference/<a>.kmz reference/<b>.kmz
```
