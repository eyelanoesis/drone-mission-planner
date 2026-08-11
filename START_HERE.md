# START HERE (plain language)

## What this folder is

Everything for the drone mission planner project, in one place:

- **The plan** (`spec/` folder) — the long technical document. You don't need to read it; Claude Code will.
- **A checklist** (`docs/phase0-test-log.md`) — for testing the existing apps. This is the actual next task.
- **Notes on the apps** (`docs/phase0-desk-research.md`) — what each app claims it can do, looked up in advance so you don't have to hunt through menus. Worth five minutes before you start testing.
- **Five small helper programs** (`tools/` folder) — already built and tested. You never have to run them yourself; Claude Code runs them when you ask.
- **A folder called `reference/`** — this is where you save mission files exported from the apps you test.
- **A folder called `sites/`** — holds the outline of your test property, drawn once and used by every app.

## The one big question everything hinges on

**Does any existing app keep the drone inside the property boundary?**

- If YES → use that app. Done. We build nothing.
- If NO → we build our own tool, and this folder already contains everything needed to start.

You answer that question by testing apps, not by coding.

## What to do, in order

1. **Draw your test property once.** Go to <https://geojson.io>, draw the outline of the test site, and save the file. Hand it to Claude Code — it turns that into one boundary every app can import, so all the tests are of the same shape. Pick a property that is *not* a plain rectangle if you can: an L-shape or one with a courtyard is where the apps actually get caught out.

2. **Test the apps.** Start with the free ones (WaypointMap, Litchi Hub, MavenRoute, YMapper), plus Waypoint OS which you own. For each: plan a mission over that same property, and fill in one page of the checklist. (Waypoint OS is Windows-only — you'll need a Windows machine for that one.)

3. **Save every exported mission file** (the .kmz file each app produces) into the `reference/` folder. These files matter no matter what you decide.

4. **Take one photo with the drone** at a known height (say 50 m) over flat ground, and keep it. It's used to calibrate the camera math — the only step only you can do.

5. **When you want help, open Claude Code in this folder:**
   - Open Terminal
   - Type `cd ` (with a space), drag this folder onto the window, press Enter
   - Type `claude` and press Enter

6. **Then just talk to it in plain language.** For example:
   - *"Here's the property outline I drew — set it up as the test site."*
   - *"Look at the mission file I saved in the reference folder and tell me how far outside my property the waypoints go."*
   - *"Give me a version of the boundary pulled in 3 metres that I can import into the app."*
   - *"Here's a photo from my drone — set up the camera profile."*
   - *"I finished testing the apps, here's what I found — help me decide whether to build."*

That's it. No coding, no commands to memorize. The checklist and the .kmz files are the whole job right now.

## One thing worth knowing

There may be a shortcut. Several of these apps keep every waypoint inside the shape
you draw — they just don't offer a "stay 3 metres back from the edge" setting. So
you draw the real property line, we shrink it by 3 metres, and you hand the app the
shrunk version. The app then respects a rule it doesn't know exists.

If that works on a real site, the whole build might be unnecessary. Test it early —
it's the second thing to try, right after the first app.
