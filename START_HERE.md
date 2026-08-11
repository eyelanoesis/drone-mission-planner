# START HERE (plain language)

## What this folder is

Everything for the drone mission planner project, in one place:

- **The plan** (`spec/` folder) — the long technical document. You don't need to read it; Claude Code will.
- **A checklist** (`docs/phase0-test-log.md`) — for testing the existing apps. This is the actual next task.
- **Three small helper programs** (`tools/` folder) — already built and tested. You never have to run them yourself; Claude Code runs them when you ask.
- **An empty folder called `reference/`** — this is where you save mission files exported from the apps you test.

## The one big question everything hinges on

**Does any existing app keep the drone inside the property boundary?**

- If YES → use that app. Done. We build nothing.
- If NO → we build our own tool, and this folder already contains everything needed to start.

You answer that question by testing apps, not by coding.

## What to do, in order

1. **Test the apps.** Start with the free ones (WaypointMap, Litchi Hub, MavenRoute, YMapper), plus Waypoint OS which you own. For each: plan a mission over the same test property, and fill in one page of the checklist. Print `phase0-test-log.pdf` and take it with you.

2. **Save every exported mission file** (the .kmz file each app produces) into the `reference/` folder. These files matter no matter what you decide.

3. **Take one photo with the drone** at a known height (say 50 m) over flat ground, and keep it. It's used to calibrate the camera math — the only step only you can do.

4. **When you want help, open Claude Code in this folder:**
   - Open Terminal
   - Type `cd ` (with a space), drag this folder onto the window, press Enter
   - Type `claude` and press Enter

5. **Then just talk to it in plain language.** For example:
   - *"Look at the mission file I saved in the reference folder and tell me how far outside my property the waypoints go."*
   - *"Here's a photo from my drone — set up the camera profile."*
   - *"I finished testing the apps, here's what I found — help me decide whether to build."*

That's it. No coding, no commands to memorize. The checklist and the .kmz files are the whole job right now.
