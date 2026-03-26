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
oscillation_presets: [0, 45, 90, 180, 350]
# Optional: only if auto-discovery cannot find your oscillation select (rare)
oscillation_select_entity: select.dyson_zz7_ca_mja1790a_oscillation
# Optional: humidity target step (integer %) and write path if your integration needs it
# humidity_step: 10
# humidity_write: auto   # auto | humidifier | climate
```

`title` is optional. If omitted or blank, the title row is hidden (no fallback title is shown).

For **hass-dyson**, the card usually auto-links air quality sensors, oscillation `select`, and combo humidifier/climate entities. If something does not match your setup, see **[docs/integration-behavior.md](docs/integration-behavior.md)** (contributor-oriented detail) or **Troubleshooting** below.

### Dashboard sizing (Sections view)

In Home Assistant Sections view, you can adjust the card size (columns/rows) directly from the visual editor.
This card now includes a visual config editor, so Home Assistant should no longer show "Visual editor not supported" when editing it.

## What the controls do

| Control | What it does |
|--------|--------------|
| Air quality header | Shows the current air quality level (Good → Severe), dominant pollutant, and a color bar. Each piece can be turned on or off in the visual editor. Only appears if your integration provides air quality sensors. |
| On / Off | Powers the device on or off. |
| Cooling | Switches to fan/cooling mode — turns off heating or humidifying and just moves air. |
| Auto mode | Lets the device manage its own speed automatically based on air quality. Press again to go back to manual. |
| Auto purify *(humidifier models)* | Same as Auto mode, but specific to the purification side of combo devices. |
| Auto humidify *(humidifier models)* | The device automatically adjusts humidification to reach a target humidity level. |
| Airflow `+` / `−` | Raises or lowers fan speed. Displayed as levels **1–10** (matching the Dyson app), with **OFF** at zero and **AUTO** when the device is managing its own speed. |
| Heating `+` / `−` | Raises or lowers the target temperature. |
| Humidity `+` / `−` *(humidifier models)* | Raises or lowers the target humidity percentage. Shows **AUTO** when Auto humidify is on. Stepping down from **AUTO** switches back to the last manual percentage; stepping down from the minimum turns humidification off. |
| Oscillation `+` / `−` | Cycles through sweep angles. Press the angle readout to open a picker showing all available angles for your device. |
| Night mode | Switches to quieter, dimmer operation — the device runs at a lower speed and dims its display lights. |
| Sleep timer | Sets the device to turn off automatically after 30, 60, 90, or 120 minutes. A countdown appears on the card while the timer is running. |
| Airflow direction | Reverses the direction of airflow. |

## Troubleshooting

- README in HACS looks stale: confirm changes are pushed to your default branch, then run HACS "Reload data" and refresh browser.
- Card looks unchanged after an update: hard-refresh the dashboard (or clear the site cache). In the visual editor, the card description includes a **build** date string—if it did not advance, Home Assistant is still loading an older `hacs-dyson-remote.js` from disk or cache.
- Card missing after install: reload Lovelace and verify the resource path.
- Actions do not match your Dyson integration: map behavior with scripts/automations and call those from your dashboard workflow.

## License

MIT
