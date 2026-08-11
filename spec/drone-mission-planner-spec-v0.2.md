# Drone Mission Planning Tool

## Technical Specification — Automated KMZ Waypoint Generation for DJI Mini 5 Pro, Danish Operations

**Document version:** 0.2 (Revised draft)
**Date:** 11 August 2026
**Revision 0.2:** business context reframed around the orthomosaic as primary product; regulatory section condensed to an operational checklist; market survey expanded to all known Mini 5 Pro-compatible planners; airframe upgrade analysis added; drone profile selection made automatic (§7.1)
**Prepared for:** Rune — Hovedstaden / Nordsjælland, Denmark
**Status:** Pre-implementation. Section 5 (Evaluation Protocol) is to be completed before any code is written.

---

## 1. Purpose and Scope

### 1.1 Purpose

This document specifies a mission-planning tool that generates DJI-compatible KMZ waypoint files for photogrammetric survey flights, with **parametric boundary control** as its defining capability.

The tool exists to solve one problem that no surveyed commercial product solves: guaranteeing that **every waypoint in a generated mission falls inside a legally-defined boundary**, including the turnaround geometry at the ends of flight lines.

### 1.2 Scope

**In scope:**

- Polygon-based survey area definition on a satellite base map
- Parametric inward offset (setback) from the property boundary
- Flight-line generation with turnaround geometry constrained inside the boundary
- Internal exclusion zones with clearance buffers
- Camera/overlap/GSD calculation
- Terrain-following altitude profiles derived from Danish elevation data
- Export to DJI WPML KMZ for execution by the aircraft's native waypoint mode
- Mission templates and a site library for repeat inspections

**Explicitly out of scope** — see §6.4 for rationale:

- Direct flight control of the aircraft
- Live telemetry, video downlink, or in-flight modification
- Photogrammetric processing (handled downstream — see §10.5)
- Survey-grade or legally-binding measurement output
- Authoritative airspace clearance

### 1.3 Intended Reader

The operator (also the developer). This document doubles as (a) an evaluation checklist for trialling existing products and (b) a build specification if those trials fail to meet requirements.

---

## 2. Operating Context

### 2.1 Hardware and Software Baseline

| Component | Specification | Notes |
|---|---|---|
| Aircraft | DJI Mini 5 Pro | Sub-250 g class |
| Controller | DJI RC 2 (integrated screen) | Executes native waypoint missions |
| Planning workstation | MacBook Pro (macOS) | Primary planning environment |
| Field device | RC 2 screen; tablet desirable | See §10.4 on cross-platform rationale |
| Camera profile | Auto-loaded from built-in drone library | Verified once against EXIF — see §7.1 |

> **Note on camera parameters.** The camera profile (sensor dimensions, focal length, image resolution, minimum shot interval) is selected automatically when the aircraft is chosen from the drone dropdown. A one-time EXIF verification per airframe (§7.1) guards against wrong published specifications — a wrong focal length silently corrupts every GSD and line-spacing calculation downstream.

### 2.2 Operator Credentials

- A1 / A2 / A3 competency (Open category)
- Registered operator with Trafikstyrelsen; operator number displayed on airframe
- Operator registration renews on a three-year cycle (per rules effective July 2025)
- Commercial liability insurance in force

### 2.3 Business Context

The business supplies drone-based site documentation into facility-management consulting workflows, where many properties are currently assessed and calculated **without any physical inspection**. A simple, repeatable aerial inspection product fills that gap.

**Primary product — general orthographic site inspection.** An orthomosaic-based overview of the entire site as seen from above: grounds, grass and planted areas, pavements, parking, access routes, and the roof plan. This is the core deliverable, designed to be produced the same way at every site and expanded over time.

> **What is an orthomosaic?** A high-resolution, georeferenced map made by stitching together many overlapping aerial or drone photographs. Through a correction process called orthorectification, lens distortion, camera angles, and surface relief are removed. This gives every pixel a uniform scale and real-world coordinates. Unlike a single oblique photo or video frame, an orthomosaic can be measured, compared between visits, and overlaid on cadastral or CAD data.

**Add-on products**, offered per site on top of the primary inspection: condition documentation of facades, rooftops, gutters and solar arrays; construction and maintenance progress documentation; 3D site models; and video overview footage where a client prefers moving images.

**Potential service lines:**

1. Orthomosaic / general orthographic site inspection **(primary)**
2. Roof condition documentation *(add-on)*
3. Facade and gutter inspection *(add-on)*
4. Solar array condition checks *(add-on)*
5. Construction/maintenance progress documentation *(add-on)*
6. 3D site models *(add-on)*
7. Video overview footage *(optional supplement)*

Commercial model centres on **recurring inspection packages** (e.g. quarterly) rather than one-off jobs.

### 2.4 Volume Driver — the Central Design Constraint

Projected throughput is **up to several hundred missions per year**.

This single figure dictates most of the architecture. It means:

- Any workflow step requiring manual geometry adjustment per mission is disqualified
- Boundary compliance must be a **parameter**, not a hand-drawn approximation
- Site definitions must be stored and re-flown, not recreated
- Batch operations and templating are core requirements, not conveniences

### 2.5 Regulatory Checklist — Professional Mission on a Property (Denmark)

Summarised for design purposes. **Not legal advice; not an authoritative statement of the rules.** What must be in place to fly a professional mapping mission on a typical commercial property:

**Operator level (in place once, maintained):**

- Registered drone operator with Trafikstyrelsen; operator number affixed to the aircraft. Registration renews on a three-year cycle.
- Valid pilot competency: A1/A3 and A2, plus the Danish drone certificate (dronebevis) where operations in built-up areas require it.
- Commercial liability insurance in force.

**Per mission:**

- Check the site in Dronezoner and the latest NOTAMs (via Naviair) for restriction zones.
- Confirm the flight fits Open category limits: visual line of sight, maximum 120 m AGL, and the distance-to-people rules applicable to the sub-250 g class.
- Built-up areas: flight is restricted to professional purposes — which this is. Where advance notification or authorisation applies, give notice in good time (commonly 24 hours).
- Respect setback distances to neighbouring property, roads and third parties. **This obligation is the direct origin of the boundary-inset requirement in §6.2.**
- If the mission cannot stay within Open category limits (e.g. systematic flight over people), it falls into the Specific category (SORA/PDRA) and is out of scope for standard operations.

**Design consequence:** the tool must make the boundary constraint *explicit, parametric and auditable*, so that each mission carries a record of the setback applied.

---

## 3. Problem Statement

### 3.1 The SDK Constraint

DJI does not publish Mobile SDK access for the Mini series. Third-party applications therefore **cannot fly the aircraft directly**. The established workaround, used by every tool that supports this airframe:

```
Plan on desktop  →  export KMZ waypoint file  →  transfer to RC 2
                 →  aircraft executes via DJI native waypoint mode
```

This is not a limitation to be worked around — **it is the architecture**. It means:

- No SDK dependency, no risk of DJI revoking API access
- The tool is a *file generator*, not a flight application
- Photo capture must be encoded as waypoint **actions** inside the file, not driven by an external app at runtime

### 3.2 The Overshoot Problem

Grid ("lawnmower") mission planners extend flight lines **beyond** the survey polygon at each end. The extension gives the aircraft room to decelerate, turn, and stabilise on the next line before resuming capture.

Observed in trial (Waypoint OS): line-end waypoints were placed **outside the drawn polygon, over neighbouring property**. This is standard, expected behaviour for grid planners — and unacceptable under Danish setback obligations.

```
    ┌───────────────────────────────┐  ← property boundary
    │                               │
 ●──┼───────────────────────────────┼──●   ← waypoints outside boundary
    │                               │
 ●──┼───────────────────────────────┼──●
    │                               │
    └───────────────────────────────┘
 ↑                                     ↑
 overshoot on neighbour's land         overshoot
```

### 3.3 Why the Manual Inset Workaround Fails

The obvious workaround — draw the polygon smaller than the true boundary so overshoot lands in the margin — was rejected during requirements discussion, correctly:

1. It requires per-mission judgement, at up to several hundred missions per year
2. It is not auditable — the applied setback is invisible and unrecorded
3. It is error-prone precisely where errors are most costly (neighbour complaints, regulatory exposure)
4. It cannot express *different* setbacks on different edges (5 m to a road, 2.5 m to a neighbour, 0 m to a canal)

**The requirement is a settable minimum-distance-to-boundary parameter, enforced by the geometry engine.**

### 3.4 Gap Summary

No surveyed product offers a documented boundary-inset parameter with contained turnarounds. This is the gap the tool fills. Everything else in this specification is table stakes.

---

## 4. Market Survey

### 4.1 Products Relevant to the DJI Mini 5 Pro

All known planners that can produce missions flyable on this airframe. Every one of them ultimately reaches the aircraft the same way: a WPML KMZ executed by the native waypoint engine (§3.1).

| Product | Cost model | Path to aircraft | Notes |
|---|---|---|---|
| **Waypoint OS** (Pilotbyte) | One-time purchase | KMZ → RC 2 | Desktop, fully local, no account. Drone library, live GSD/photo-count readout. Currently trialled. |
| **WaypointMap** | Free | KMZ → RC 2 | Web-based; explicit Mini 5 Pro support. Zero-cost baseline. |
| **Litchi Hub** | Free (web planning) | KMZ → DJI Fly / RC 2 | Litchi's web planner exports waypoint missions for the Mini 5 Pro. (The Litchi Pilot app itself targets earlier Mini models.) |
| **MavenRoute + MavenBridge** | Free (web planner + transfer tool) | KMZ → controller | Browser planner; MavenBridge moves KMZ files onto the controller and can also pull existing missions off it — useful for §9.3. Part of the wider Maven ecosystem. |
| **YMapper** | Free, open source | KMZ → DJI Fly | Cross-platform survey-grid generator on GitHub. Readable source — a reference implementation for grid generation and WPML output if the build proceeds. |
| **Pixpro Waypoints** | ~EUR 5/month (annual); 14-day trial | Replaces an existing DJI waypoint file | Photogrammetry-focused; the file-replacement workflow is awkward — verify it is tolerable. |
| **DJI Fly native** (RC 2) | Included | On-controller | The baseline everything else builds on. Manual waypoint placement only; no area-based mapping automation. |
| **UgCS** | Professional licence | KML → Litchi Hub → KMZ | Full photogrammetry planner, but the export chain adds friction and pricing targets enterprise. |
| **Drone Harmony** | Subscription | Verify | Mapping planner; current Mini 5 Pro support status unclear — confirm in Phase 0 before considering. |

Excluded: **DroneDeploy** and **Dronelink** — SDK-dependent, without Mini-series support.

### 4.2 Gap Analysis

Key: **Y** yes · **N** no · **?** not documented (verify in Phase 0).

| Product | Area grid + KMZ w/ triggers | Boundary inset param. | Turns contained | Exclusion zones | Terrain follow | Site library / batch |
|---|---|---|---|---|---|---|
| Waypoint OS | Y | ? | N | ? | Partial | ? |
| WaypointMap | Y | ? | N | ? | ? | N |
| Litchi Hub | Y | ? | N | ? | ? | ? |
| MavenRoute | Y | ? | N | ? | ? | ? |
| YMapper | Y | N | N | N | N | N |
| Pixpro Waypoints | Partial | ? | N | ? | ? | ? |
| DJI Fly native | N | N | N | N | N | N |
| **Required** | **Y** | **Critical** | **Critical** | **High** | **High** | **High** |

No surveyed product documents a boundary-inset parameter with contained turnarounds. "?" means the capability was not found in available documentation — **confirm empirically during Phase 0 before concluding it is absent.**

### 4.3 Airframe Upgrade — Gains and Losses

Brief assessment of upgrading from the Mini 5 Pro to a dedicated mapping platform (e.g. an enterprise-class DJI with RTK and mechanical shutter).

| | Gain from upgrading | Loss / cost of upgrading |
|---|---|---|
| **Accuracy** | RTK positioning: centimetre-level geotags; deliverables approach survey grade | — |
| **Image quality** | Mechanical shutter removes rolling-shutter distortion; larger sensor helps in Danish winter light | — |
| **Operations** | Higher wind resistance, longer flight time, fewer aborted missions; built-in terrain follow and higher waypoint capacity; DJI Pilot 2 opens the professional app ecosystem (DroneDeploy etc.) | — |
| **Regulatory** | — | Sub-250 g A1 privileges are lost: stricter distance-to-people rules, more sites pushed toward A2 conditions or the Specific category; heavier aircraft raises the risk profile |
| **Financial** | — | Enterprise mapping platforms cost thousands of euros against the Mini's hundreds; higher insurance; C-class marking constraints |
| **Practical** | — | Bulkier kit; slower deployment per site |

**Position:** stay sub-250 g until either order volume or a client's accuracy requirement justifies enterprise RTK. Nothing in this specification is throwaway on upgrade — WPML KMZ is shared across DJI platforms, and an enterprise airframe would import the same missions through DJI Pilot 2 with looser turnaround constraints.

---

## 5. Phase 0 — Evaluation Protocol

**Complete this before writing any code.** Three outcomes are possible: an existing product is adequate; an existing product is adequate with a documented workaround; or the build proceeds. All three are acceptable results. The cheapest good outcome is not building anything.

### 5.1 Trials to Run

Free options first.

| # | Product | Cost | Objective |
|---|---|---|---|
| T1 | WaypointMap | Free | Baseline. Does the free option already solve it? |
| T2 | Waypoint OS (re-test) | Already owned | Exhaust its settings before dismissing it |
| T3 | Litchi Hub | Free | Second free web planner; different grid engine |
| T4 | MavenRoute + MavenBridge | Free | Planner trial **and** the KMZ pull-off-controller workflow needed for §9.3 |
| T5 | YMapper | Free (open source) | Trial as a tool; read as a reference implementation |
| T6 | Pixpro Waypoints | 14-day trial | Only if T1–T5 all fail on the critical path |

### 5.2 Test Case

Use a single consistent test site for all three products so results are comparable. Recommended: a rectangular commercial site with (a) at least one boundary shared with a neighbouring property and (b) an internal obstacle if available.

### 5.3 Checklist — Record Per Product

**Boundary behaviour (critical path)**

- [ ] Is there any setting named *inset*, *buffer*, *margin*, *offset*, *inner turns*, *turns within area*, or similar?
- [ ] Can flight-line **extension / overshoot distance** be set to zero or a fixed value?
- [ ] Can waypoint **turn mode** be set to stop-at-point rather than curved/coordinated? *(See §7.4 — this single setting may collapse the overshoot to near zero and resolve the entire problem.)*
- [ ] With turn mode set to stop-at-point, measure the actual distance from the outermost waypoint to the drawn polygon edge. **Record the number in metres.**
- [ ] Can flight-line **heading/orientation** be set manually? (Orientation control is a partial mitigation — see §7.5.)

**Exclusion zones**

- [ ] Can a hole or exclusion polygon be defined inside the survey area?
- [ ] Does the generated path route around it?

**Capture control**

- [ ] Are photo triggers embedded as waypoint actions, or is it interval/timer-based?
- [ ] Is trigger mode distance-based, time-based, or per-waypoint?

**Terrain and altitude**

- [ ] Is terrain following offered? From what elevation source?
- [ ] Is altitude referenced to takeoff point or to a geoid/ellipsoid?

**Scale and repeatability**

- [ ] Can a site be saved and re-flown later with identical parameters?
- [ ] Can parameters be saved as a reusable template?
- [ ] Can multiple missions be generated or exported in batch?

**Export**

- [ ] Export the KMZ. **Retain this file.** It is required for §9.3 regardless of outcome.

### 5.4 Decision Gate

| Finding | Action |
|---|---|
| A product enforces boundary containment with a settable parameter | **Buy it. Stop here.** Build nothing. |
| Stop-at-point turn mode reduces overshoot to within acceptable margin | Adopt product + document the setting as standard operating procedure. Revisit build only if exclusion zones or batch volume later force it. |
| No product contains turnarounds; overshoot is material | Proceed to build. Use the retained KMZ files per §9.3. |

---

## 6. Functional Requirements

Identifiers: **F-Cn** core/parity, **F-Dn** differentiator, **F-Nn** nice-to-have.

### 6.1 Core Requirements (Parity Floor)

These match capabilities already present in Waypoint OS and are treated as the minimum viable feature set.

| ID | Requirement | Priority |
|---|---|---|
| F-C1 | Draw and edit a survey polygon over satellite imagery | Must |
| F-C2 | Built-in drone profile library with dropdown selection (sensor, focal length, resolution, min shot interval); GSD and all spacing computed automatically | Must |
| F-C3 | Set flight altitude above ground level | Must |
| F-C4 | Set flight speed | Must |
| F-C5 | Set frontal overlap and side overlap independently | Must |
| F-C6 | Set gimbal pitch angle (nadir default; oblique for 3D) | Must |
| F-C7 | Terrain following — maintain constant height above ground on sloped sites | Must |
| F-C8 | Return-to-home behaviour and RTH altitude | Must |
| F-C9 | Live readout: area, GSD, estimated photo count, estimated flight time, estimated battery count | Must |
| F-C10 | Export DJI WPML KMZ with photo capture encoded as waypoint actions | Must |
| F-C11 | Set flight-line orientation (auto-optimise and manual override) | Should |

### 6.2 Differentiating Requirements

The reason this tool would exist.

| ID | Requirement | Priority |
|---|---|---|
| **F-D1** | **Parametric boundary inset.** A setback distance, in metres, applied inward from the property boundary. No waypoint may be generated outside the resulting region. | Must |
| **F-D2** | **Per-edge setback values.** Different setbacks on different boundary edges (e.g. 5 m to road, 2.5 m to neighbour, 0 m to own land). | Should |
| **F-D3** | **Turnaround containment.** All turn, deceleration and acceleration geometry lies inside the inset region. | Must |
| **F-D4** | **Internal exclusion zones.** Point, line or polygon obstacles (masts, power lines, plant) with a settable clearance buffer, subtracted from the flyable region; flight lines route around them. | Must |
| **F-D5** | **Coverage reporting.** Explicitly report the area that will *not* be imaged as a result of F-D1/F-D3/F-D4, so the client deliverable is understood before flying. | Should |
| **F-D6** | **Compliance record.** Each exported mission carries a record of the setbacks and exclusions applied. | Should |

### 6.3 Nice-to-Have Requirements

| ID | Requirement | Priority |
|---|---|---|
| F-N1 | Dronezoner airspace overlay from official Danish data (§8.1) | Should |
| F-N2 | Danish elevation model integration for takeoff reference elevation and terrain following (§8.2) | Should |
| F-N3 | Address search → automatic cadastral parcel boundary import (§8.3). *Potentially the single highest-leverage feature at target volume — it removes manual polygon drawing entirely.* | Should |
| F-N4 | Site library — save, recall and re-fly a site with identical parameters | Should |
| F-N5 | Mission templates per client or site type | Should |
| F-N6 | Batch generation and export of multiple missions | Could |
| F-N7 | Per-mission pre-flight report export (PDF) for client and compliance records | Could |
| F-N8 | Oblique / double-grid patterns for 3D building models | Could |
| F-N9 | Battery-count-aware mission splitting with resumable segments | Could |

### 6.4 Non-Goals

Stated explicitly to prevent scope creep.

| Not building | Why |
|---|---|
| Flight control / live telemetry | No SDK access; the aircraft flies the file natively (§3.1) |
| Photogrammetric processing | Mature tooling exists (§10.5); no value in reimplementing |
| Survey-grade output | No RTK on this airframe. Positioning as *supporting documentation* is deliberate (§2.3) |
| Authoritative airspace clearance | Official sources carry explicit disclaimers (§8.1). The tool is an aid, never the authority |
| Hard geofencing | A KMZ describes where to fly, not where the aircraft is forbidden to go (§7.6) |

---

## 7. Geometry Specification

The technical core. Everything here is deterministic 2D computational geometry — no machine learning, no heuristics.

### 7.1 Drone Profiles and Ground Sample Distance

**Calibration and calculation are automatic.** The user selects the aircraft from a dropdown; everything below is computed from the stored profile with no manual input. The tool ships with a built-in profile library covering the most common DJI airframes (Mini 4 Pro, Mini 5 Pro, Air 3/3S, Mavic 3/4 series, and enterprise variants), each profile holding sensor dimensions, focal length, image resolution, and minimum shot interval.

```
GSD [cm/px]  =  (S_w [mm] x H [m] x 100) / (f [mm] x I_w [px])
```

Where *S_w* = sensor width, *H* = altitude above ground, *f* = focal length, *I_w* = image width in pixels.

**Profile verification (once per airframe; required for any drone not in the library):**

1. Take a photo at a known altitude over flat ground
2. Read `FocalLength`, `ExifImageWidth`, `ExifImageHeight` and, where present, `FocalPlaneXResolution` from the EXIF
3. Cross-check the stored profile against these values — marketing specifications are occasionally wrong, and a wrong focal length silently corrupts every GSD and spacing calculation downstream
4. Verify computed GSD against a measured ground feature

Ground footprint per frame:

```
W_ground = GSD x I_w          H_ground = GSD x I_h
```

Line spacing and trigger spacing follow directly:

```
d_line    = W_ground x (1 - sidelap)
d_trigger = H_ground x (1 - frontlap)
```

Maximum permissible ground speed, given minimum camera shot interval *t_min*:

```
v_max = d_trigger / t_min
```

> Exceeding *v_max* causes silently dropped frames and overlap gaps that only appear at processing time. The tool must warn when the configured speed exceeds this limit.

### 7.2 Region Derivation

Let:

- **P** — property boundary polygon
- **s** — required setback (per-edge under F-D2)
- **e** — turn extension distance required by the aircraft
- **X_i** — obstacle geometries with clearance **c_i**

Then:

| Region | Definition | Meaning |
|---|---|---|
| **F** (flyable) | `negativeBuffer(P, s)` minus ∪ `buffer(X_i, c_i)` | Every waypoint must lie inside F. Hard constraint. |
| **C** (capture) | `negativeBuffer(F, e)` | Flight-line imaging endpoints. Reliable coverage region. |

The generated waypoint set must satisfy the invariant:

```
∀ waypoint w ∈ mission : w ∈ F
```

This invariant is the product. It should be asserted programmatically before export, and export should fail loudly if violated.

### 7.3 The Unavoidable Trade-off — State This to Clients

**You cannot simultaneously keep all waypoints inside the boundary and capture imagery right up to that boundary.** A band of width approximately *e* at each line end will be imaged only obliquely or not at all.

This is geometry, not a software limitation. Mitigations follow in §7.4 and §7.5, and F-D5 requires it be reported rather than discovered after the flight.

### 7.4 Turn Containment — the Key Insight

Flight-line extension exists in grid planners because they assume **coordinated (curved) turns**, inherited from fixed-wing survey practice. A fixed wing must fly a radius; a multirotor need not.

A multirotor can **stop at the line end, translate laterally, and reverse**. With stop-at-point turn behaviour, *e* collapses from tens of metres to a short deceleration allowance.

In DJI WPML, waypoint turn behaviour is expected to be controlled by a per-waypoint or global turn-mode field, with values distinguishing stop-at-point from pass-through-with-curvature behaviour. **Exact field names and enumerated values must be verified against the DJI WPML specification and against a known-good exported file (§9.3) — do not rely on recalled values.**

| Turn strategy | Extension *e* | Flight time | Image sharpness |
|---|---|---|---|
| Coordinated / curved turn | Large (tens of m) | Shortest | Motion blur risk |
| Stop-at-point, then reverse | Small (deceleration only) | Longer | **Best — capture while stationary** |

**Secondary benefit worth noting:** stationary capture eliminates motion blur. On a small-sensor airframe operating in Danish light — low winter sun, frequent overcast — longer exposures are common, and this materially improves image quality for photogrammetric tie-point matching. The slower mission is often the better mission.

### 7.5 Additional Mitigations

1. **Orientation optimisation (F-C11).** Run flight lines *parallel* to the most constrained edge. This minimises the number of line ends touching that boundary. Auto-selection should minimise total unimaged area, not merely minimise flight time.
2. **Perimeter pass.** Add a single pass along the inside edge of F, with the gimbal angled outward, to recover coverage of the end bands.
3. **Altitude increase.** Raising altitude widens the footprint, reducing line count and therefore the number of turns — at the cost of GSD.

### 7.6 Exclusion Zones — Safety Framing

For each obstacle, buffer by clearance *c_i* and subtract from F. Flight lines clip against the result and may split into multiple segments, each with its own ends and turns.

> **Safety statement — reproduce in operator documentation.**
>
> A KMZ waypoint file describes a *route*. It is not a geofence. The aircraft will not refuse to enter an excluded area; the file simply does not direct it there. Route planning is not a safety barrier.
>
> Lateral avoidance at mission altitude is insufficient for tall structures — a mast or crane may extend above the flight plane. For vertical obstacles, either raise mission altitude above the obstacle or exclude a generously sized radius.
>
> **Power lines and thin cables are poorly detected by vision-based obstacle sensing.** Do not rely on the aircraft's sensors near conductors. Treat cable corridors as hard exclusions with substantial buffers, and maintain visual line of sight.

### 7.7 Terrain Following

Per-waypoint altitude is computed as:

```
h_waypoint = ( E(lat, lon) - E(takeoff) ) + h_AGL
```

Where *E* samples the digital terrain model (§8.2).

**Datum consistency is critical.** Sampling both the waypoint elevation and the takeoff elevation from the *same* model and differencing them makes the result self-consistent and independent of the absolute vertical datum (DVR90 vs. ellipsoidal vs. barometric). Do not mix elevation sources.

Additional constraints:

- Clamp the vertical rate between consecutive waypoints to a safe climb/descent gradient
- Confirm which altitude reference mode the WPML file uses (relative-to-takeoff vs. absolute) and that the Mini 5 Pro honours per-waypoint altitude in native waypoint mode — **verify in Phase 0/1**
- Where terrain following is unsupported or unreliable, fall back to constant altitude and warn when terrain relief across the site exceeds a configured GSD-variance threshold

---

## 8. Danish Data Sources

A significant advantage of operating in Denmark: the required geospatial data is public.

### 8.1 Airspace — Dronezoner (F-N1)

- Operated by **Trafikstyrelsen** at `droneregler.dk/dronezoner`, having replaced the former `droneluftrum.dk`
- Zone data published for download, with API access documented on the same site
- **Naviair open-sourced the original frontend applications on GitHub** (`github.com/Naviair`), explicitly so that other actors could reuse and extend them — including a documented path to re-point the frontend at Trafikstyrelsen's APIs

**Mandatory disclaimer to surface in the UI.** The official service states that it does not necessarily show all areas where drone flight is prohibited, that NOTAMs are updated hourly, and that the pilot remains responsible for checking the latest NOTAM via Naviair. The overlay is a planning aid. It is never the clearance.

### 8.2 Elevation — Danmarks Højdemodel (F-N2)

- Published by **Styrelsen for Dataforsyning og Infrastruktur (SDFI)**
- High-resolution national digital terrain and surface models
- Distributed via Datafordeleren; free of charge, registration required
- **Verify current licence terms, access method (WCS/WMS/tile download) and registration requirements before implementation**

Use the **terrain** model (DTM) for terrain following, not the surface model (DSM) — the DSM includes buildings and vegetation and would drive the aircraft to fly over roof height as though it were ground.

### 8.3 Cadastral Boundaries — Matriklen (F-N3)

Candidate high-leverage feature. Danish cadastral parcel geometry is open data from SDFI, and address geocoding is available through the national address API.

Proposed flow:

```
address string → geocode to coordinate → cadastral parcel lookup
              → parcel polygon → apply setback → survey polygon
```

If this works, **manual polygon drawing disappears from the workflow entirely** — the single largest per-mission time cost at target volume. Endpoints, licence terms and coverage must be verified; treat as Phase 3 with a spike to validate feasibility early.

### 8.4 Base Imagery

Satellite/aerial tiles for polygon drawing. Options include commercial tile providers and Danish orthophoto services. **Check licence terms for commercial use** — this is the most likely source of a licensing problem in the stack, and the least obvious.

---

## 9. Output Format — DJI WPML KMZ

### 9.1 Structure

A DJI waypoint KMZ is a ZIP archive containing a `wpmz` directory with a template file and a waylines file, in DJI's WPML dialect of KML. The waylines file carries the executable mission: ordered waypoints with coordinates, altitudes, speeds, heading and turn behaviour, and per-waypoint action groups.

### 9.2 Required Encodings

| Element | Purpose |
|---|---|
| Waypoint coordinates | WGS84 longitude/latitude |
| Waypoint altitude + altitude reference mode | Terrain following (§7.7) |
| Global and per-waypoint speed | Constrained by *v_max* (§7.1) |
| Turn mode | Turn containment (§7.4) — **the critical field** |
| Gimbal pitch action | Nadir or oblique (F-C6) |
| Photo capture action | Per-waypoint or distance-interval triggering (F-C10) |
| Finish action / RTH | F-C8 |

### 9.3 Schema Verification Strategy

**Do not implement the WPML writer from recalled or documented structure alone.** The reliable method:

1. Export a working mission from WaypointMap or Waypoint OS for the Mini 5 Pro (retained from §5.3)
2. Unzip and inspect the XML
3. Treat that file as the reference implementation — it is known to fly on this airframe
4. Generate files that differ from it only in the geometry and parameters intentionally changed
5. Diff generated output against the reference before every field test

This reduces the highest-risk unknown in the project from a research problem to an inspection task.

### 9.4 Validation Before Export

Export must be blocked, with a clear message, if any of the following fail:

- [ ] All waypoints inside **F** (§7.2 invariant)
- [ ] No waypoint inside any exclusion buffer
- [ ] Speed ≤ *v_max* for the configured overlap
- [ ] Vertical gradient between consecutive waypoints within limits
- [ ] Waypoint count within the aircraft's supported maximum *(limit to be confirmed)*
- [ ] Estimated flight time within battery reserve margin
- [ ] Altitude within the applicable legal maximum

---

## 10. Architecture

### 10.1 Decision: Browser-Based Web Application

**Selected: web application. Rejected: SwiftUI/macOS native.**

| Factor | Web | SwiftUI native |
|---|---|---|
| Mapping libraries | Mature, rich ecosystem | Would require building from scratch |
| Danish open data | Published for web consumption | Requires additional integration work |
| Cross-platform | macOS, Windows, tablet, unchanged | macOS only |
| Distribution | Files; no packaging, no store | Signing, notarisation, packaging |
| Deep OS integration needed | Not required by any requirement | Its main advantage — unused here |

The application is fundamentally a map interface plus computational geometry. Both are web-native strengths. There is no requirement in §6 that benefits from native macOS APIs.

### 10.2 Stack

| Layer | Choice | Rationale |
|---|---|---|
| Map rendering | **MapLibre GL JS** | Open source, vector tiles, no vendor lock-in, custom overlay support |
| Geometry | **Turf.js** | Buffer, difference, intersect, line-splitting, point-in-polygon — the complete §7 toolkit |
| Archive writing | **JSZip** | KMZ construction in-browser |
| UI | Plain modern JS or a light framework | Deliberately unopinionated; not the interesting part |
| Optional backend | **Python — FastAPI + Shapely + rasterio** | Only if raster elevation sampling or heavy geometry proves impractical in-browser |
| Persistence | Local files (GeoJSON/JSON) + IndexedDB | Site library and templates (F-N4/F-N5) |

### 10.3 Local-First

No account, no cloud dependency, no telemetry. Serve as static files or run a local dev server. Mission data — client sites and boundaries — is commercially sensitive and stays on the machine.

### 10.4 Cross-Platform Value

Beyond macOS/Windows portability, a browser application runs on a tablet in the field. Given that missions may need adjustment on site — different takeoff point, unexpected obstruction, changed client instruction — this has direct operational value.

### 10.5 Downstream Processing

Out of scope for this tool. The output of a flight is a folder of geotagged images, consumed by existing photogrammetry software to produce orthomosaics and 3D models. Evaluate separately; note that OpenDroneMap is a capable open-source option, and that its handling of boundary and cropping parameters may interact usefully with the coverage regions defined in §7.2.

### 10.6 Data Flow

```
  address / drawn polygon
          │
          ├── cadastral lookup (F-N3) ──► property polygon P
          │
          ▼
  setbacks s (per-edge) ──► negative buffer
          │
  obstacles X, clearance c ──► subtract buffers
          │
          ▼
     flyable region F ──────────────► capture region C
          │                                  │
          │                          camera profile
          │                          overlap, altitude
          │                                  │
          │                                  ▼
          │                          line spacing, trigger spacing
          │                                  │
          ▼                                  ▼
    elevation sample (F-N2) ──►  waypoint generation
                                             │
                                             ▼
                                   validation (§9.4)
                                             │
                                             ▼
                                    WPML KMZ  ──►  RC 2  ──►  flight
```

---

## 11. Risks and Open Questions

| ID | Risk / question | Impact | Mitigation |
|---|---|---|---|
| R1 | WPML schema details differ from expectation | High — nothing flies | Reverse-engineer from known-good export (§9.3) |
| R2 | Mini 5 Pro native waypoints may not honour per-waypoint altitude, limiting terrain following | Medium | Verify in Phase 0; fall back to constant altitude with a relief warning |
| R3 | Turn-mode field may not eliminate overshoot as theorised | High — this is the core thesis | **Test empirically in Phase 0 before building anything** |
| R4 | Aircraft waypoint count limit may force mission splitting — community reports put a practical ceiling around 99 waypoints per DJI Fly mission | Medium | Confirm limit for the Mini 5 Pro / RC 2; implement F-N9 |
| R5 | Base imagery licensing for commercial use | Medium | Verify terms before client work |
| R6 | Dronezoner data format or API changes | Low | Treat overlay as advisory; never a hard dependency |
| R7 | Elevation data access/licence terms differ from expectation | Low | Verify; graceful degradation to constant altitude |
| R8 | DJI firmware change alters KMZ handling | Medium | Retain known-good reference files; re-validate after firmware updates |
| R9 | Time spent building a tool that a EUR 5/month product already solves | **High** | **Phase 0 exists precisely to eliminate this risk** |

---

## 12. Roadmap

### Phase 0 — Evaluate (do this first)

Run T1–T3 per §5. Record the checklist. Retain exported KMZ files. **Decide whether to build at all.**

### Phase 1 — Minimum Viable Tool

Only if Phase 0 justifies it.

- Polygon drawing on satellite base map (F-C1)
- Camera profile and GSD calculation (F-C2)
- Uniform boundary inset (F-D1)
- Grid generation with stop-at-point turn containment (F-D3, F-C5, F-C11)
- WPML KMZ export with photo actions (F-C10)
- Pre-export validation (§9.4)

**Definition of done: one real mission flown from a self-generated file, with every waypoint verified inside the boundary.**

### Phase 2 — Operational

- Internal exclusion zones with clearance (F-D4)
- Per-edge setbacks (F-D2)
- Elevation integration and terrain following (F-C7, F-N2)
- Coverage reporting (F-D5)
- Site library and templates (F-N4, F-N5)

### Phase 3 — Scale

- Dronezoner overlay (F-N1)
- Cadastral parcel import (F-N3) — *validate feasibility with an early spike; if it works, consider promoting to Phase 2*
- Batch generation (F-N6)
- Pre-flight report export (F-N7)
- Oblique/double-grid for 3D (F-N8)
- Battery-aware splitting (F-N9)

---

## Appendix A — Glossary

| Term | Definition |
|---|---|
| **AGL** | Above ground level |
| **DSM** | Digital surface model — includes buildings and vegetation |
| **DTM** | Digital terrain model — bare earth; the correct source for terrain following |
| **GSD** | Ground sample distance — ground distance represented by one pixel |
| **Frontal overlap** | Overlap between consecutive images along a flight line |
| **Side overlap (sidelap)** | Overlap between images on adjacent flight lines |
| **KMZ** | Zipped KML archive; DJI's waypoint mission container |
| **Nadir** | Camera pointing straight down (gimbal pitch −90°) |
| **Orthomosaic** | Geometrically corrected, stitched aerial image with uniform scale |
| **Overshoot / line extension** | Flight-line continuation beyond the survey area to permit turning |
| **RTK** | Real-time kinematic positioning — centimetre accuracy. **Not present on this airframe** |
| **SORA / PDRA** | Operational risk assessment frameworks for the Specific category |
| **WPML** | DJI's waypoint mission markup dialect of KML |

## Appendix B — Formula Reference

```
GSD (cm/px)        = (sensor_width_mm × altitude_m × 100) / (focal_mm × image_width_px)
Footprint width    = GSD × image_width_px
Footprint height   = GSD × image_height_px
Line spacing       = footprint_width × (1 − sidelap)
Trigger spacing    = footprint_height × (1 − frontlap)
Max ground speed   = trigger_spacing / min_shot_interval_s
Flyable region F   = negBuffer(P, setback) − ∪ buffer(obstacle_i, clearance_i)
Capture region C   = negBuffer(F, turn_extension)
Waypoint altitude  = (DTM(waypoint) − DTM(takeoff)) + target_AGL
```

## Appendix C — Sources Consulted

| Source | Relevance |
|---|---|
| `droneregler.dk/dronezoner` — Trafikstyrelsen | Danish drone zones; data download and API |
| `naviair.dk` / `github.com/Naviair` | Open-sourced droneluftrum frontend applications |
| `pilotbyte.com/waypoint-os` | Waypoint OS capabilities and licensing model |
| `waypointmap.com` | Free Mini 5 Pro mapping tool |
| Pixpro Waypoints product documentation | Subscription mapping tool, trial terms |
| `flylitchi.com` — Litchi Hub | Free web waypoint planning with KMZ export |
| `mavenpilot.com` — MavenRoute / MavenBridge | Free web planner and KMZ transfer tooling |
| `github.com/YLabs-FPV/YMapper` | Open-source survey-grid KMZ generator |
| `sphengineering.com` — UgCS | Enterprise planner; export chain via Litchi |
| `docs.opendronemap.org` | Downstream processing; boundary parameters |
| SDFI / Datafordeleren | Danmarks Højdemodel, cadastral data |

---

*End of document. Version 0.2 — revised draft. Section 5 gates all subsequent work.*
