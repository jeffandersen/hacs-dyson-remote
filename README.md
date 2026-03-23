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
| Heating/Humidity `+/-` | Uses one thermal stepper: adjusts target temperature on heat-capable devices, or target humidity on humidifier-capable devices (auto-detected by entity capabilities) |
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
