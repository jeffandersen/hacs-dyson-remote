# Agent / maintainer notes

Read `CLAUDE.md` before working on this project. It contains all integration context: entity resolution, hass-dyson attribute reference, combo humidifier detection, service-call paths, oscillation, air quality, build workflow, and testing patterns. **Keep it updated** when integration logic or project structure changes.

- **Build**: Rollup writes **`dist/hacs-dyson-remote.js`** and root **`hacs-dyson-remote.js`**; HACS **`hacs.json`** `filename` points at the root copy.
- **Workflow**: [CONTRIBUTING.md](CONTRIBUTING.md) (tests, harness, release).

---

## Card layout — implementation notes

Three-column grid. Top row: **On/Off** | **Cooling / Auto purify** | **Auto mode / Auto humidify**. On plain fans the stepper row is **Oscillation** | **Heating** | **Airflow**; on humidifier combo cards it shifts to **Oscillation** | **Airflow** | **Humidity** so airflow sits under Auto purify and humidity under Auto humidify (see `CLAUDE.md → Card layout`).

The bottom row uses a `display: none` invisible spacer in column 1 so that Night mode lands in the center column via normal grid auto-flow rather than an explicit `grid-column`. This avoids a layout break in the narrow `@container` two-column branch that was resetting `grid-column`. At roughly 346px card width, the row is fixed to three steppers so columns cannot drift onto extra rows.

## Thermal stepper (heating / humidity)

One stepper handles both use-cases. Auto-detection of combo humidifier mode is documented in `CLAUDE.md → Combo humidifier mode`. Service call priority: `humidifier.set_humidity` → `climate.set_humidity` → `number.set_value`; controlled by the optional `humidity_write` config key (`auto` | `humidifier` | `climate`). Humidity bounds prefer the paired `humidifier.*` entity's `min_humidity` / `max_humidity` over the climate entity's (which may be narrower for display purposes). Step is inferred at 10% for the standard Dyson 30–70 range, or explicit via `humidity_step`. Stepping down from AUTO exits to the last manual %; stepping down from the floor turns humidification off.

## Oscillation

Prefers `select.*_oscillation` over `fan.oscillate` / `dyson.set_angle`. When a select entity is used, `fan.turn_on` is skipped on humidifier combo models to avoid a race that reverts the oscillation mode. See `CLAUDE.md → Oscillation` for the full fallback chain and pointing-angle drag logic.
