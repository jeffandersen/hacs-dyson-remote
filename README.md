# Dyson Remote (HACS)

**Lovelace** card for **Home Assistant** with the same control-strip layout as the **Dyson iOS** app.

## Preview

![Dyson Remote card in Home Assistant](screenshot.png)

## Features

- Optional **air quality** strip: status (Good → Severe), pollutant line, five-color bar with thumb, and a soft accent tint—each piece can be toggled in the visual editor.
- **Top row:** Power, Cooling, Auto
- **Middle row:** Airflow `+/-`, Heating or Humidity `+/-` (auto-detected), Oscillation
- **Bottom row:** Night mode

It targets **Dyson `fan.*` entities** (including purifiers and humidifiers that expose a fan). Where possible it uses built-in Home Assistant services.

## Prerequisites

This card is **UI only**—it does not connect to Dyson devices by itself. You need a Dyson integration in Home Assistant that creates the underlying entities.

**Recommended:** **[hass-dyson](https://github.com/cmgrayb/hass-dyson)** — unofficial Dyson integration (install via HACS as category **Integration**). This card is developed and tested against the `fan`, `climate`, `select`, and air-quality **`sensor`** entities and attributes **hass-dyson** exposes.

Other Dyson integrations may still work if they offer compatible entities and standard services; see **Troubleshooting** if actions or sensors do not line up.

## Install (HACS)

1. Open **HACS** -> **Dashboard** (or **Frontend** in older versions).
2. Open menu (three dots) -> **Custom repositories**.
3. Add this repository URL, category **Dashboard**.
4. Search for **Dyson Remote** in HACS and install it.
5. Reload Lovelace (or restart Home Assistant) when prompted.

After install, HACS adds the card as a dashboard resource for you in most setups.
Builds emit both `hacs-dyson-remote.js` (repo root, matching `hacs.json`) and `dist/hacs-dyson-remote.js`.

### If the resource is not auto-added

```yaml
lovelace:
  mode: yaml
  resources:
    - url: /hacsfiles/hacs-dyson-remote/hacs-dyson-remote.js
      type: module
```

## Quick Start

```yaml
type: custom:dyson-remote-card
entity: fan.your_dyson_entity
```

Optional settings:

```yaml
type: custom:dyson-remote-card
entity: fan.your_dyson_entity
title: Living Room
show_temperature_header: false
show_air_quality_header: true
# Subsections default on. Use hide_* when a section should stay off — Lovelace often drops plain `false` booleans from YAML.
# hide_air_quality_category: true
# hide_air_quality_pollutant: true
# hide_air_quality_bar: true
mushroom_shell: true
oscillation_presets: [0, 45, 90, 180, 350]
# Optional: only if auto-discovery cannot find your oscillation select (rare)
oscillation_select_entity: select.dyson_zz7_ca_mja1790a_oscillation
```

`title` is optional. If omitted or blank, the title row is hidden (no fallback title is shown).

**Air quality header:** When **`show_air_quality_header`** is true, the card **prefers** **`sensor.<device>_air_quality_index`** (libdyson) and uses its **`category`** attribute (**Good**, **Fair**, **Poor**, **Very poor**, **Severe**) for the level — not the numeric `state`, which can disagree with the app. The pollutant line uses **`dominant_pollutants`** on that sensor, or **`sensor.<device>_dominant_pollutant`** if needed. If no air-quality-index entity exists, it falls back to **PM2.5** / **PM10** / **VOC** / **NO₂** sensors on the same device id. The five bar colors follow Dyson’s scale: **green → yellow → orange → red → purple**.

With the header enabled, the visual editor shows **Show category**, **Show pollutant**, and **Show air quality bar**. Saved YAML uses **`hide_air_quality_*: true`** when a section is off so Home Assistant does not drop the setting. When a section is on, the editor may write **`hide_air_quality_*: false`** so the live preview can clear a previous hide after you turn a section back on; those **`false`** entries are often omitted again when YAML is saved. You can still use **`show_air_quality_*: false`** in YAML; both styles are accepted. If all three subsections are off, the header block stays hidden.

**Oscillation:** Many Dyson integrations (e.g. libdyson) control sweep angle via a **`select.*_oscillation`** entity (`45°`, `90°`, etc.), not only `fan.oscillate`. The card auto-picks **`select.<fan_object_id>_oscillation`**, then any **`select.*`** whose id contains the same device id and `oscillation` and whose options look like angle presets. It calls `select.select_option` on that entity when possible. You do **not** need **`oscillation_select_entity`** unless discovery fails for your setup.

The **readout and highlighted stepper** treat oscillation as **off** when **`oscillation_enabled`** is false (including string `"false"`), **`oscillating`** is false on the fan, or **`oscillation_span`** is 0—even if **`oscillation_mode`** / the select **state** still shows a remembered angle like `45°`. That matches libdyson: the angle preset can remain while sweep is disabled.

**Humidifier / combo purifiers:** The card only switches to **Auto purify**, **Auto humidify**, and the humidity stepper when it detects a real combo: **`humidifier.<same device id>`** exists in HA, the paired **`climate.*`** lists **`humidify`** in **`hvac_modes`**, the climate uses libdyson-style **`humidity_auto`** or **`humidity_enabled: HUMD` / `HUMIDIFY`**, or the configured entity is **`humidifier.*`**. Fans that only **report** humidity (no linked humidifier entity and no **`humidify`** mode) stay on the normal **Cooling** / **Auto mode** / **Heating** UI—including the radiator icon in the middle column (it sits under **Auto mode** in the grid, which is easy to mistake for part of that button). In combo mode, the top-row glyphs match the Dyson app layout: **Auto purify** shows **AUTO** (instead of the blue circle), and **Auto humidify** shows a **water** icon (instead of the **AUTO** text); plain fans keep the circle and **AUTO** text. When combo mode is on, those controls use the paired **`climate.*` entity’s `hvac_mode`** (e.g. **hass-dyson**: `humidify` vs `fan_only` / `fan` / `dry`). Some **libdyson** climates also expose **`humidity_auto`** (e.g. `ON`) for auto humidify and **`humidity_enabled: HUMD`** instead of `ON`; the card treats those as humidify-on / auto-humidify engaged and as humidity active for the stepper. If **`humidify`** is not in **`hvac_modes`**, **Auto humidify** first uses **`climate.set_humidity`** with **`humidity_auto`** when that field exists on the service. If Home Assistant does not expose **`humidity_auto`** on **`climate.set_humidity`**, the card looks for a sibling **`select.<climate_object_id>_humidity_auto`** (or any **`select.*`** on the same device id whose name contains both **humidity** and **auto**) or **`switch.<climate_object_id>_humidity_auto`**, and toggles that. If those are not available, it tries **`humidifier.set_mode`** with **`auto`** vs **`normal`** when the paired humidifier’s **`available_modes`** includes them (e.g. hass-dyson). You can set optional **`humidity_auto_entity`** in the card to a specific **`select.*` or `switch.*`** if discovery misses yours. Until the climate entity updates, the card may show the new **Auto humidify** state optimistically. If neither the service field nor a toggle entity is available, **Auto humidify** only re-sends the current target **%** (no toggle) and logs a console warning. The card reads **`target_humidity`** or Dyson **`target_humidity_formatted`** (e.g. `0070`) for the humidity readout. If the **fan** and **humidifier climate** use different entity ids, set optional **`climate_entity`** in the card to that **`climate.*`**. The card resolves **`humidifier.*`** using the **climate** entity’s object id first, then the fan’s (so a renamed **`fan.*`** can still pair with a **`humidifier.*`** that shares the same suffix as **`climate.*`**). Optional **`humidifier_entity`** forces the humidifier id if discovery fails. The **humidity %** stepper clamps to the **tightest** **`min_humidity` / `max_humidity`** across fan, climate, and humidifier (so a humidifier reporting **70%** max does not let **`+`** send **51%** when the climate only accepts up to **50%**). The readout merges attributes so **optimistic** steps are not overwritten by the same **`climate.*`** state when the climate entity is the card. With **`climate.*`** as the card entity (no fan in HA), it calls **`climate.turn_on`** before stepping humidity. When **auto humidify** is on (**`humidity_auto`** or humidifier **`mode: auto`**), the middle readout shows **AUTO** instead of a **%**. It calls **`climate.set_humidity`** when the climate looks Dyson-style, **also** calls **`humidifier.set_humidity`** when a paired humidifier exists, then falls back to **`number.set_value`** on a discovered or configured **`humidity_target_entity`**. **Auto purify** does not call **`climate.set_temperature`** on those models. While the climate is in fan-only / purify mode, **Auto purify** tracks **fan** auto airflow (same signals as the airflow column: **`preset_mode` / `auto_mode`**, and Dyson-style **`fan_speed_setting`** text **Auto**). The **Auto purify** highlight is **not** turned off merely because **`humidity_auto`** is on—that flag is auto target humidity, not purify mode. Pressing **Auto purify** sets the paired climate to purify/fan-only **and** selects the fan’s **Auto** preset when the integration exposes one. Airflow **AUTO** vs numbered speeds still come from the **fan** entity.

**hass-dyson (e.g. J9P) `climate.*` cues:** **`humidity_enabled: HUMD`** (or **`ON` / `HUMIDIFY`**) means humidification is allowed; **`OFF`** means it is off. **`humidity_auto: ON`** is auto target humidity (middle readout **AUTO**). **`target_humidity`** / **`target_humidity_formatted`** often **keep the last setpoint** (e.g. **70** / **`0070`**) even when **`humidity_enabled` is `OFF`**—the card shows **OFF**, not **70%**, until humidify is on again. If **`hvac_mode` is `fan_only`** for both auto-purify on and off, that difference lives on **`fan.*`** (**`preset_mode` Auto**, **`auto_mode`**, **`fan_speed_setting: AUTO`**, etc.); **Auto purify** on the card tracks that fan state, not extra climate fields in those snapshots.

**Matching `fan.*` (same J9P device):** **Auto purify on** shows as **`preset_mode: Auto`**, **`auto_mode: true`**, **`fan_speed_setting: AUTO`**, and a higher **`percentage` / `fan_speed`** (e.g. **40**) than typical **Manual** (**~30**). **Auto purify off**, **auto humidify on/off**, **humidity target 70%**, and **humidify off** can all look **identical on the fan** (`Manual`, **`fan_speed_setting: 0003`**, **`auto_mode: false`**, same speed)—those modes are driven by **`climate.*`** / **`humidifier.*`**, not by extra fan fields in those scenarios.

### Dashboard sizing (Sections view)

In Home Assistant Sections view, you can adjust the card size (columns/rows) directly from the visual editor.
This card now includes a visual config editor, so Home Assistant should no longer show "Visual editor not supported" when editing it.

## What the controls do

| Control | Behavior |
|--------|----------|
| Air quality header (optional) | When enabled, can show category row, pollutant line, and/or color bar (each toggled in the editor) using linked `sensor.*` / fan attributes |
| On/Off | Turns device on or off |
| Cooling | Forces cooling/fan-only behavior where supported (integration-dependent) |
| Auto mode | Toggles Auto/Manual when those presets exist |
| Airflow `+/-` | Shows app-style speed levels (**OFF, 1..10**) and maps them to fan percentage internally |
| Heating/Humidity `+/-` | One thermal stepper: target temperature for normal fans, or target humidity when combo mode is detected (linked **`humidifier.*`**, **`humidify`** in climate **`hvac_modes`**, or **`humidifier.*`** entity) |
| Oscillation `+/-` | Cycles configured angles; prefers `select.*_oscillation` when present, else `dyson.set_angle` / `fan.oscillate` |
| Night mode | Toggles night mode when supported |

Note: Dyson integrations differ. If your setup uses different services or entity types, use scripts/automations as adapters.

## Mushroom-style look

By default, the card uses a Mushroom-style outer shell via Home Assistant theme variables.  
Set `mushroom_shell: false` for a full-bleed black panel.

## Troubleshooting

- README in HACS looks stale: confirm changes are pushed to your default branch, then run HACS "Reload data" and refresh browser.
- Card looks unchanged after an update: hard-refresh the dashboard (or clear the site cache). In the visual editor, the card description includes a **build** date string—if it did not advance, Home Assistant is still loading an older `hacs-dyson-remote.js` from disk or cache.
- Card missing after install: reload Lovelace and verify the resource path.
- Actions do not match your Dyson integration: map behavior with scripts/automations and call those from your dashboard workflow.

## License

MIT
