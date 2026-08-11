# reference/ — known-good mission files

**Never edit these files.** They are the oracle the WPML writer is diffed against
(spec §9.3). They are chmod'd read-only on purpose. Add files, never modify them.

Every file needs a row here saying where it came from and whether it has flown.
A file nobody has flown is evidence, not truth.

| File | Source | Aircraft | Flown? | Notes |
|---|---|---|---|---|
| `waypoint-os-2026-08-11.kmz` | Waypoint OS export (`wpml:author` = `Waypoint OS`), 2026-08-11 12:10 | intended Mini 5 Pro | **not yet** | 8 waypoints, 50 m, Copenhagen. `droneEnumValue` 68, consumer dialect, no `payloadInfo`. Turn mode `toPointAndStopWithDiscontinuityCurvature`, `useStraightLine=1`. No gimbal pitch field anywhere. |
| `droneroute-pr56-2026-08-11.kmz` | Generated from droneroute PR #56 (branch `pr56-mini5pro`) via its own `generateKmzBuffer`, 2026-08-11 | Mini 5 Pro profile | **not yet** | 2 waypoints, synthetic. Included as the *other* opinion on the consumer dialect — `www.uav.com` namespace, `waypointGimbalHeadingParam`, `useStraightLine=0`. Not a product export. |

## Still missing — the one that would outrank both

A mission authored by **DJI Fly itself** on the RC 2 with the Mini 5 Pro bound,
pulled off the controller from:

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
