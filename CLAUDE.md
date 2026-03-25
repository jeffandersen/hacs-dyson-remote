# hacs-dyson-remote — project context

> **Keep this file updated.** When you change integration logic, entity resolution, service-call paths, or project structure in `src/`, update the relevant section here before closing the PR.

---

## Agent instructions — Tests are specifications

**Tests encode correct behavior. They are not obstacles to work around.**

When a test fails after a code change:
- **Fix the implementation** so it satisfies the test. Do not change the test's expected value to match the new (broken) behavior.
- If you genuinely believe the test expectation is wrong — i.e., it contradicts the spec in this file — **stop and ask the user** before changing anything. Cite the specific CLAUDE.md section and explain the conflict.
- If you cannot make the implementation satisfy the test without understanding why the test expects that specific value, **ask the user** rather than guessing.

When tests pass but you changed their assertions to make them pass:
- That is a regression, not a fix. The test now documents what the code does, not what it should do.
- Any change to an `.equal()`, `.deepEqual()`, `.toBe()`, `.toEqual()`, or similar assertion argument **requires a comment** explaining which CLAUDE.md section or explicit user instruction justifies the new expected value.

**`test/regression.test.mjs` is append-only.** Tests in that file were written to catch specific bugs that were previously shipped. Never delete or weaken an assertion in that file. If one fails, the implementation regressed — fix it.

---

## Agent instructions — Home Assistant context gathering

**Before making any decisions about entity state handling, service calls, attribute names, or action parameters, agents MUST ask the user for relevant information from the Home Assistant developer tools.**

The developer tools provide ground truth about what HA actually exposes at runtime. Do not assume attribute names, service parameters, or state values match what's documented here — Dyson integration versions vary and entity shapes differ across installs.

Ask the user to provide any of the following that are relevant to the task at hand:

- **Entity state + attributes** — from *Developer Tools → States*, filter by the entity id (e.g. `fan.dyson_xxx`). Paste the full state object including all attributes.
- **Available services / actions** — from *Developer Tools → Services* (or *Actions* in newer HA), look up services like `fan.turn_on`, `fan.set_preset_mode`, `climate.set_humidity`, `humidifier.set_humidity`, `humidifier.set_mode`, `select.select_option`, `switch.turn_on`, etc. Include the service schema / fields shown in the UI.
- **Device info** — the `device_id` of the Dyson device (visible in Settings → Devices, or from the entity's device page). Required for `hass_dyson.set_night_mode`, `hass_dyson.set_sleep_timer`, etc.
- **All related entities** — from the device page, the full list of entities belonging to the Dyson device (fan, climate, humidifier, select, number, switch, sensor entities). This is critical for entity resolution logic.
- **Template output** — if there's ambiguity about a computed value, ask the user to run a template in *Developer Tools → Template* and share the result.

**When to ask:** Any time a task involves writing or changing logic that reads entity state, calls a service, resolves a paired entity, or handles a specific attribute value. If the task is purely cosmetic (CSS, layout, labels) and doesn't touch HA data, this step can be skipped.

Phrase the request concretely — tell the user exactly which entity ids to look up and which fields are needed, rather than asking generically.

## What this project is

A single-file **Lovelace custom card** (`custom:dyson-remote-card`) for Home Assistant that replicates the iOS Dyson app control strip. It targets `fan.*` entities (and optionally `climate.*` / `humidifier.*`) created by a Dyson integration — primarily **hass-dyson** (cmgrayb/hass-dyson, installed via HACS). The card is UI-only; it does not talk to Dyson devices directly.

```yaml
type: custom:dyson-remote-card
entity: fan.your_dyson_entity
```

---

## Repository layout

```
src/
  hacs-dyson-remote.js      # Main card class (LitElement / vanilla custom element)
  dyson-logic.js            # Pure helpers: fan attrs, humidity, oscillation, temperature
  air-quality-logic.js      # Air quality level resolution and display helpers
  humidity-write-plan.js    # Ordered service-call plan for setting target humidity
  dyson-editor-schema.js    # ha-form schema for the visual config editor

dist/hacs-dyson-remote.js   # Rollup build output (committed for HACS users)
hacs-dyson-remote.js        # Root copy (what HACS points at — same as dist/)

integration/
  card.integration.vitest.mjs   # Integration tests (Vitest + Happy DOM)
  setup.mjs                     # Test environment setup

docs/
  integration-behavior.md   # Redirect stub — see this file for authoritative context
```

**Build:** Rollup writes `dist/hacs-dyson-remote.js` and `hacs-dyson-remote.js`. Both are committed so HACS users get the built artifact without running a build.

```bash
npm run build          # build only
npm run build:deploy   # build + copy to HA_HACS_DIR (set in .env)
npm test               # all tests
npm run test:integration
npm run dev:harness    # local preview at http://localhost:4173/dev/harness.html
```

---

## Entity resolution

The card is configured with a single `entity` (usually `fan.*`, occasionally `climate.*`). It auto-discovers paired entities using the **object id** — the part after the dot, e.g. `dyson_zz7_ca_mja1790a`.

| Paired entity | Discovery rule |
|---|---|
| `climate.*` | `climate.<same object id>` |
| `humidifier.*` | `humidifier.<climate object id>` first, then `humidifier.<fan object id>` |
| `select.*_oscillation` | `select.<fan object id>_oscillation`, then any `select.*` containing device id + `oscillation` whose options look like angle presets |
| `select.*_humidity_auto` / `switch.*_humidity_auto` | `select.<climate oid>_humidity_auto`, `switch.<climate oid>_humidity_auto`, or any `select.*` on same device id containing both "humidity" and "auto" |
| `number.*` humidity target | `number.<oid>_target_humidity`, `number.<oid>_humidifier_target`, or any `number.*` with device id + "humidity" + "target"/"setpoint" |
| `switch.*_night_mode` | `switch.<fan_or_climate_oid>_night_mode`, then any `switch.*` on same `device_id` whose id contains `night_mode` |

**Optional overrides** (YAML / visual editor):

| Key | Purpose |
|---|---|
| `oscillation_select_entity` | Force oscillation select entity id |
| `climate_entity` | Force climate entity id when renamed |
| `humidifier_entity` | Force humidifier entity id |
| `humidity_auto_entity` | Force `select.*` or `switch.*` for auto-humidity toggle |
| `humidity_target_entity` | Force `number.*` for humidity setpoint |
| `night_mode_entity` | Force `switch.*` for night mode |
| `humidity_step` | Override inferred step (Dyson devices use 10% grids) |
| `humidity_write` | `auto` (default) \| `humidifier` \| `climate` |

---

## hass-dyson / libdyson entity signals

### `fan.*` attributes

| Attribute | Type / values | Meaning |
|---|---|---|
| `is_on` | bool | Device powered |
| `preset_mode` | `"Auto"` / `"Manual"` / `"Heat"` | Current preset |
| `preset_modes` | list (or comma-string) | Available presets |
| `auto_mode` | bool | True when fan is in auto speed |
| `fan_speed_setting` | `"AUTO"` / `"0003"` etc. | Dyson-style speed string |
| `percentage` / `fan_speed` | number 0–100 | Current speed % |
| `heating_mode` / `heating_enabled` | `"ON"`/`"OFF"` / bool | Heat active |
| `oscillation_enabled` | bool / `"false"` string | Sweep on/off |
| `oscillation_span` | number | Sweep angle |
| `oscillation_angle_low/high` | number | Absolute angle bounds |
| `night_mode` | bool / `"ON"`/`"OFF"` | Night mode state |
| `current_temperature` | number | Ambient temp |
| `target_temperature` | number | Heat setpoint |

**Fan auto mode** is detected by any of: `auto_mode === true`, `preset_mode === "Auto"`, or `fan_speed_setting` matching `/^\s*auto\s*$/i`.

**Speed mapping:** Percentages map to display levels 0–10 (10% per level when `max = 100`). The card does not use `percentage_step` directly.

### `climate.*` attributes (hass-dyson humidifier models)

| Attribute | Meaning |
|---|---|
| `hvac_mode` | `fan_only` / `humidify` / `heat` / `off` |
| `hvac_modes` | Presence of `"humidify"` triggers combo mode |
| `humidity_enabled` | `"HUMD"` / `"ON"` / `"HUMIDIFY"` = humidify on; `"OFF"` = off |
| `humidity_auto` | `"ON"` = auto target humidity engaged |
| `target_humidity` | Numeric setpoint — **keeps last value even when humidity is off** |
| `target_humidity_formatted` | Dyson-style string e.g. `"0070"` (= 70%) |
| `current_temperature` | Ambient |
| `temperature` | Climate setpoint |

**Key quirk:** `target_humidity` / `target_humidity_formatted` persist the last setpoint even when `humidity_enabled` is `OFF`. The card reads off-state from `humidity_enabled`, not from the target being 0.

### `humidifier.*` attributes

| Attribute | Meaning |
|---|---|
| `mode` | `"auto"` / `"normal"` (hass-dyson) |
| `available_modes` | e.g. `["auto", "normal"]` |
| `min_humidity` / `max_humidity` | Stepper range (30–70 on Dyson) |
| `target_humidity_step` | Step; may be absent — card infers 10 from range |

### `select.*_oscillation` attributes

| Attribute | Meaning |
|---|---|
| `options` | Available span presets, e.g. `["45°", "90°", "180°", "350°", "Breeze", "Custom"]` — fan omits Breeze |
| `oscillation_mode` | Currently active option string (mirrors `state`) |
| `oscillation_enabled` | Whether oscillation is active |
| `oscillation_angle_low` / `oscillation_angle_high` | Absolute angle bounds for the current sweep |
| `oscillation_center` | Center angle of the current sweep |
| `oscillation_span` | Span in degrees (may be 0 even when oscillating on humidifiers) |

**Fan vs humidifier options:** Humidifier select includes `Breeze` (random sweep); fan select does not. Both include `Custom` (set via `hass_dyson.set_oscillation_angles`). `Custom` is filtered out of chip chips — it is set implicitly by the pointing-angle drag, not user-selectable as a named preset.

---

## Combo humidifier mode

`humidifierComboMode()` (`dyson-logic.js`) triggers combo mode (humidity stepper + Auto purify / Auto humidify UI) when **any** of:

1. Configured entity starts with `humidifier.`
2. A `humidifier.*` entity with the same object id exists in `hass.states`
3. Paired `climate.*` lists `"humidify"` in `hvac_modes`
4. Paired `climate.*` has `humidity_enabled: "HUMD"` / `"HUMIDIFY"`, or has a `humidity_auto` attribute (presence alone is sufficient)

Plain fans that only report humidity readings (no paired humidifier, no `humidify` mode) stay on the normal Cooling / Auto mode / Heating UI.

In combo mode:
- **Auto purify** tracks `climate.hvac_mode` (`fan_only` = on) plus fan auto state. Pressing it sets climate to `fan_only` + fan to Auto preset. `humidity_auto` being on does **not** turn this off — that flag means auto *target humidity*, not purify mode.
- **Auto humidify** tracks `humidifier.mode === "auto"` OR `climate.humidity_auto === "ON"` OR `climate.hvac_mode === "humidify"`.
- When auto humidify is on, the middle readout shows `AUTO` instead of `%`.

---

## Humidity write path (`humidity-write-plan.js`)

Order for `humidity_write: "auto"` (default):
1. `humidifier.set_humidity` on paired humidifier
2. `climate.set_humidity` on paired climate
3. `number.set_value` on resolved number entity

Only one path fires per press to avoid race conditions. `humidity_write: "humidifier"` skips climate; `humidity_write: "climate"` skips humidifier.

**Auto humidify toggle fallback chain** (when `climate.set_humidity` has no `humidity_auto` field):
1. `select.<climate_oid>_humidity_auto` → `select.select_option`
2. `switch.<climate_oid>_humidity_auto` → `switch.turn_on/off`
3. `humidifier.set_mode` with `auto` / `normal` (from `available_modes`)

**Step and bounds:** `humidityStepperBounds()` prefers the humidifier entity's `min_humidity` / `max_humidity` (the writable range) over the climate's, which may be narrower for display purposes. Step is inferred: if range divides cleanly by 10 with ≤10 positions, use 10 (Dyson's physical step). Override with `humidity_step`.

**Optimistic state:** After a step the card shows the new value until `target_humidity` or `target_humidity_formatted` updates to match. Raw `humidity` (ambient reading) is intentionally ignored during reconcile to prevent bounce when ambient % briefly equals the new setpoint.

---

## Oscillation

The card prefers `select.*_oscillation` over `fan.oscillate` / `dyson.set_angle`.

**Enabled check** (`oscillationIsEnabled()`): checks `oscillation_span` first — returns **false** when `oscillation_span` is explicitly 0 (ground truth that sweep is off, wins over all other attrs), returns `true` when `oscillation_span > 0`. Falls back to `oscillating`, then `oscillation_enabled` (bool/number/string), then `|angle_high - angle_low| > 1`.

**Humidifier caveat** (`oscillationMergeForEnabled()`): hass-dyson humidifiers always report `oscillation_span: 0` on both the fan and select entities, even when actively sweeping. When the select entity has an explicit `oscillation_enabled` attribute, `oscillationMergeForEnabled` omits `oscillation_span` from the merged result entirely so that `oscillationIsEnabled` uses `oscillation_enabled` (the authoritative signal) instead of the always-zero span.

**Presets:** Default `[0, 45, 90, 180, 350]`. Configurable via `oscillation_presets`. `0` always means Off.

**Pointing-angle drag** — `_setPointingAngle(hass, entityId, angle, deviceId, spanDeg)` tries in order:
1. `hass_dyson.set_oscillation_angles` (`device_id`, `lower_angle`, `upper_angle`) — current hass-dyson (cmgrayb)
2. `dyson.set_angle` (`entity_id`, `angle_low`, `angle_high`) — legacy dyson integration
3. `hass_dyson.set_angle` (`device_id`, `angle_low`, `angle_high`) — older hass_dyson builds

`spanDeg` preserves the current sweep width when repointing: the caller determines the active span from the select entity's current option label (e.g. `"45°"` → 45) or falls back to `|angle_high − angle_low|`. The function computes `lower = center − span/2`, `upper = center + span/2` (clamped to 5–355). When `spanDeg === 0` (no active sweep), `lower = upper = pointing angle`, entering `Custom` single-point mode.

**Oscillation preset chip handler** — when a `select.*_oscillation` entity is available and the chip has a direct option value, the handler calls `fan.turn_on` then `select.select_option`. `fan.turn_on` is **skipped only in humidifier combo mode** because calling it before `select.select_option` on hass-dyson humidifiers races and reverts the oscillation mode. For plain fans, `fan.turn_on` is always called (with or without a select entity) to activate oscillation. When there is no select entity path the fallback goes through `_applyOscillationPreset` (uses `fan.oscillate`).

---

## Night mode and sleep timer

**hass-dyson** implements night mode as a `switch.*_night_mode` entity (`DysonNightModeSwitch`), not via `fan.turn_on`. Resolution order:
1. `switch.<fan_or_climate_oid>_night_mode` (or `night_mode_entity` override)
2. `hass_dyson.set_night_mode` with `device_id` (if registered)
3. `dyson.set_night_mode` with `entity_id` (older setups)
4. `fan.turn_on` with `night_mode` only when that field exists on the service schema

**Sleep timer:** `hass_dyson.set_sleep_timer` / `cancel_sleep_timer` take `device_id` (from `hass.entities[entity_id].device_id`). `fan.night_mode` may be bool or `"ON"`/`"OFF"` strings; the card normalizes both.

---

## Air quality (`air-quality-logic.js`)

Five-level scale matching the Dyson app — colors: `#22C55E → #EAB308 → #F97316 → #EF4444 → #A855F7`

Resolution order:
1. `sensor.<device_oid>_air_quality_index` — uses `category` attribute (`Good` / `Fair` / `Poor` / `Very poor` / `Severe`), not the raw numeric state
2. Fallback: PM2.5 / PM10 / VOC / NO₂ / HCHO sensors on same device id
3. Fallback: fan entity attributes (`particulate_matter_2_5`, `voc_index`, etc.)

Dominant pollutant: `dominant_pollutants` / `dominant_pollutant` attribute on the AQI sensor, or `sensor.<device_oid>_dominant_pollutant` state.

---

## Visual editor (`dyson-editor-schema.js`)

Uses `ha-form` schema. Key config fields: `entity`, advanced entity overrides (expandable), `show_temperature_header`, `show_air_quality_header`. When air quality header is on, sub-fields appear: `show_air_quality_category`, `show_air_quality_pollutant`, `show_air_quality_bar`.

**hide_* vs show_*:** Saved YAML uses `hide_air_quality_*: true` when a section is off. Both `hide_*` and `show_*` are accepted in YAML.

---

## Card layout

Three-column grid:

| Column 1 | Column 2 | Column 3 |
|---|---|---|
| On/Off | Cooling / Auto purify | Auto mode / Auto humidify |
| Oscillation `+/−` | Heating or Humidity `+/−` | Airflow `+/−` |
| (spacer) | Night mode | Airflow direction |

On combo models (humidifier), row 2 shifts so airflow sits under Auto purify and humidity under Auto humidify. Narrow layout (below ~346px): collapses to two columns.

---

## Testing

Integration tests in `integration/card.integration.vitest.mjs` use Vitest + Happy DOM. They mount `dyson-remote-card` as a real custom element with a simulated `hass` object and assert on DOM + `callService` calls.

`createMockHass()` is the base fixture — extend via the `overrides` argument. Pattern: set card config → update `hass` → `await nextTick()` → assert on DOM or `hass.__calls`.

```bash
npm test
npm run test:integration
```

---

## Release checklist

1. Update this file if integration logic changed.
2. `npm test`
3. `npm run build` — commit both `dist/hacs-dyson-remote.js` and root copy.
4. Tag / release.
