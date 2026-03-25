---
name: hacs-dyson-remote
description: >
  Deep context for contributors to the hacs-dyson-remote Lovelace card — a Home
  Assistant dashboard card that mimics the Dyson iOS app controls. Use this skill
  any time you are working on this repository: adding features, fixing bugs,
  updating integration behavior, writing or editing tests, touching the build
  system, or updating docs.
---

# hacs-dyson-remote contributor skill

## Step 1 — load project context

Read `CLAUDE.md` in the repo root before doing anything else. It is the authoritative reference for:

- Repository layout and build commands
- Entity resolution and auto-discovery rules
- hass-dyson / libdyson attribute reference (`fan.*`, `climate.*`, `humidifier.*`)
- Combo humidifier mode detection and behavior
- Humidity write path and service-call ordering
- Oscillation logic
- Night mode / sleep timer service resolution
- Air quality levels and sensor resolution
- Visual editor schema conventions
- Card layout grid
- Testing patterns and release checklist

## Step 2 — do the work

Proceed with the task using the context from `CLAUDE.md`.

## Step 3 — keep CLAUDE.md current

After making any change to the following, update the relevant section of `CLAUDE.md` before finishing:

- Entity resolution or auto-discovery logic (`src/dyson-logic.js`, main card)
- Service-call paths (humidity write plan, night mode, oscillation, auto mode)
- New or renamed config keys (also update the visual editor schema section)
- hass-dyson / libdyson attribute behavior (new attributes, changed semantics)
- Build system or test setup
- Project structure (new files, renamed files)

`CLAUDE.md` is what keeps future contributors — human and AI — from having to reverse-engineer the same integration quirks from scratch. Treat keeping it updated as part of the definition of done for any non-trivial change.
