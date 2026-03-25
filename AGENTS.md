# Agent / maintainer notes

Read `CLAUDE.md` before working on this project. It contains all integration context: entity resolution, hass-dyson attribute reference, combo humidifier detection, service-call paths, oscillation, air quality, build workflow, and testing patterns. **Keep it updated** when integration logic or project structure changes.

- **Build**: Rollup writes **`dist/hacs-dyson-remote.js`** and root **`hacs-dyson-remote.js`**; HACS **`hacs.json`** `filename` points at the root copy.
- **Workflow**: [CONTRIBUTING.md](CONTRIBUTING.md) (tests, harness, release).
