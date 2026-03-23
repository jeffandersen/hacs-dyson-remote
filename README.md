# Dyson Remote (HACS)

A Lovelace card built to mimic the Dyson iOS control experience in Home Assistant for Dyson fan and humidifier devices.

- Top row: Power, Cooling, Auto
- Middle row: Airflow `+/-`, Heating or Humidity `+/-` (auto-detected), Oscillation stepper
- Bottom row: Night mode

The card is designed for Dyson fan entities (including fan-based Dyson purifier/humidifier models) while using standard Home Assistant services whenever possible.

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
mushroom_shell: true
oscillation_presets: [0, 45, 90, 180, 350]
```

`title` is optional. If omitted or blank, the title row is hidden (no fallback title is shown).

### Dashboard sizing (Sections view)

In Home Assistant Sections view, you can adjust the card size (columns/rows) directly from the visual editor.
This card now includes a visual config editor, so Home Assistant should no longer show "Visual editor not supported" when editing it.

## What the controls do

| Control | Behavior |
|--------|----------|
| On/Off | Turns device on or off |
| Cooling | Forces cooling/fan-only behavior where supported (integration-dependent) |
| Auto mode | Toggles Auto/Manual when those presets exist |
| Airflow `+/-` | Shows app-style speed levels (**OFF, 1..10**) and maps them to fan percentage internally |
| Heating/Humidity `+/-` | Uses one thermal stepper: adjusts target temperature on heat-capable devices, or target humidity on humidifier-capable devices (auto-detected by entity capabilities) |
| Oscillation `+/-` | Cycles configured oscillation angles |
| Night mode | Toggles night mode when supported |

Note: Dyson integrations differ. If your setup uses different services or entity types, use scripts/automations as adapters.

## Mushroom-style look

By default, the card uses a Mushroom-style outer shell via Home Assistant theme variables.  
Set `mushroom_shell: false` for a full-bleed black panel.

## Troubleshooting

- README in HACS looks stale: confirm changes are pushed to your default branch, then run HACS "Reload data" and refresh browser.
- Card missing after install: reload Lovelace and verify the resource path.
- Actions do not match your Dyson integration: map behavior with scripts/automations and call those from your dashboard workflow.

## License

MIT
