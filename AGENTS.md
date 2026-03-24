# Agent / maintainer notes

- **Integration logic** (entity discovery, hass-dyson / libdyson signals, combo humidifier behavior): keep **[docs/integration-behavior.md](docs/integration-behavior.md)** aligned with code changes in `src/hacs-dyson-remote.js`.
- **Build**: Rollup writes **`dist/hacs-dyson-remote.js`** and root **`hacs-dyson-remote.js`**; HACS **`hacs.json`** `filename` points at the root copy.
- **Workflow**: [CONTRIBUTING.md](CONTRIBUTING.md) (tests, harness, release).
