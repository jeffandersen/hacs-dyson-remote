/**
 * Pure helpers for Dyson-style fan entities (attributes vary by integration).
 */

function normalizePresetModes(presetModes) {
  if (Array.isArray(presetModes)) {
    return presetModes.filter((m) => typeof m === "string" && m.trim().length);
  }
  if (typeof presetModes === "string" && presetModes.trim()) {
    return presetModes
      .split(",")
      .map((m) => m.trim())
      .filter(Boolean);
  }
  return [];
}

function findHeatPresetName(presetModes) {
  const modes = normalizePresetModes(presetModes);
  const exact = modes.find((m) => m.toLowerCase() === "heat");
  if (exact) return exact;
  return modes.find((m) => /\bheat\b/i.test(m)) || null;
}

function isAutoModeActive(attrs) {
  if (!attrs) return false;
  if (attrs.auto_mode === true) return true;
  const pm = attrs.preset_mode;
  return typeof pm === "string" && pm.toLowerCase() === "auto";
}

function isHeatActive(attrs) {
  if (!attrs) return false;
  const hm = attrs.heating_mode;
  if (typeof hm === "string" && hm.toUpperCase() === "ON") return true;
  if (attrs.heating_enabled === true) return true;
  const heatName = findHeatPresetName(attrs.preset_modes);
  if (heatName && attrs.preset_mode === heatName) return true;
  return false;
}

function coolingDotActive(attrs) {
  return !isHeatActive(attrs);
}

function airflowCenterLabel(attrs) {
  if (!attrs) return "—";
  if (isAutoModeActive(attrs)) {
    const fss = attrs.fan_speed_setting;
    if (typeof fss === "string" && fss.trim()) return fss.toUpperCase();
    return "AUTO";
  }
  const p =
    typeof attrs.percentage === "number" && Number.isFinite(attrs.percentage)
      ? attrs.percentage
      : typeof attrs.fan_speed === "number" && Number.isFinite(attrs.fan_speed)
        ? attrs.fan_speed
        : null;
  if (p != null) {
    const level = fanLevelFromPercentage(p);
    return level === 0 ? "OFF" : String(level);
  }
  return "—";
}

const DEFAULT_OSCILLATION_PRESETS = [0, 45, 90, 180, 350];

function normalizeOscillationPresets(list) {
  if (!Array.isArray(list) || !list.length) {
    return [...DEFAULT_OSCILLATION_PRESETS];
  }
  const nums = list.map((n) => Number(n)).filter((n) => Number.isFinite(n) && n >= 0);
  const uniq = [...new Set(nums)].sort((a, b) => a - b);
  if (!uniq.includes(0)) {
    uniq.unshift(0);
  }
  return uniq;
}

function oscillationPresetLabel(degrees) {
  if (!degrees) return "OFF";
  return `${degrees}°`;
}

function inferOscillationPresetIndex(attrs, presets) {
  if (!presets || !presets.length) return 0;
  if (!attrs?.oscillation_enabled) return 0;
  const spanCandidates = [
    attrs.oscillation_span,
    attrs.oscillation_angle,
    attrs.angle_span,
  ];
  if (typeof attrs.angle_high === "number" && typeof attrs.angle_low === "number") {
    spanCandidates.push(Math.abs(attrs.angle_high - attrs.angle_low));
  }
  let bestI = 1;
  let bestD = Infinity;
  for (const raw of spanCandidates) {
    if (typeof raw !== "number" || !Number.isFinite(raw)) continue;
    for (let i = 1; i < presets.length; i++) {
      const d = Math.abs(presets[i] - raw);
      if (d < bestD) {
        bestD = d;
        bestI = i;
      }
    }
  }
  if (bestD <= 45) return bestI;
  return 1;
}

function nextOscillationIndex(currentIndex, direction, len) {
  const n = Math.max(1, len);
  let i = currentIndex + (direction < 0 ? -1 : 1);
  if (i < 0) i = n - 1;
  if (i >= n) i = 0;
  return i;
}

function formatTargetTemperature(attrs, temperatureUnit) {
  if (!attrs || typeof attrs.target_temperature !== "number" || !Number.isFinite(attrs.target_temperature)) {
    return null;
  }
  if (attrs.target_temperature <= -200) return null;
  const u = typeof temperatureUnit === "string" && temperatureUnit.trim() ? temperatureUnit.trim() : "°C";
  return `${Math.round(attrs.target_temperature)}${u === "°C" || u === "°F" ? u : ` ${u}`}`;
}

function ambientTemperature(attrs) {
  const t = attrs?.current_temperature;
  if (typeof t !== "number" || !Number.isFinite(t) || t <= -200) return null;
  return t;
}

function temperatureStepAndBounds(attrs) {
  const a = attrs || {};
  const stepRaw =
    typeof a.target_temp_step === "number" && a.target_temp_step > 0
      ? a.target_temp_step
      : typeof a.temperature_step === "number" && a.temperature_step > 0
        ? a.temperature_step
        : 1;
  const minRaw =
    typeof a.min_temp === "number"
      ? a.min_temp
      : typeof a.min === "number"
        ? a.min
        : 0;
  const maxRaw =
    typeof a.max_temp === "number"
      ? a.max_temp
      : typeof a.max === "number"
        ? a.max
        : 40;
  const lo = Math.min(minRaw, maxRaw);
  const hi = Math.max(minRaw, maxRaw);
  return { step: stepRaw, min: lo, max: hi };
}

function snapTemperatureToStep(value, min, max, step) {
  const s = step > 0 ? step : 1;
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  const clamped = Math.min(hi, Math.max(lo, value));
  const k = Math.round((clamped - lo) / s);
  const snapped = lo + k * s;
  const rounded = Math.round(snapped * 1000) / 1000;
  return Math.min(hi, Math.max(lo, rounded));
}

function adjustTargetTemperature(current, direction, attrs) {
  const { step, min, max } = temperatureStepAndBounds(attrs);
  let base;
  if (typeof current === "number" && Number.isFinite(current) && current > -200) {
    base = current;
  } else {
    const amb = ambientTemperature(attrs);
    base = amb != null ? amb : (min + max) / 2;
  }
  const delta = direction < 0 ? -step : step;
  return snapTemperatureToStep(base + delta, min, max, step);
}

function heatingTargetReadout(attrs) {
  if (!attrs || typeof attrs.target_temperature !== "number" || !Number.isFinite(attrs.target_temperature)) {
    return "—";
  }
  if (attrs.target_temperature <= -200) return "—";
  const { step } = temperatureStepAndBounds(attrs);
  const u = typeof attrs.temperature_unit === "string" && attrs.temperature_unit.trim() ? attrs.temperature_unit.trim() : "°C";
  const decimals = step % 1 !== 0 ? 1 : 0;
  const v = decimals ? Math.round(attrs.target_temperature * 10) / 10 : Math.round(attrs.target_temperature);
  const suffix = u === "°C" || u === "°F" ? u : ` ${u}`;
  return `${v}${suffix}`;
}

function adjustFanPercentage(current, direction, attrs, max = 100) {
  const cap = typeof max === "number" && max > 0 ? max : 100;
  const base = typeof current === "number" && Number.isFinite(current) ? current : 0;
  const curLevel = fanLevelFromPercentage(base, cap);
  const nextLevel = Math.min(10, Math.max(0, curLevel + (direction < 0 ? -1 : 1)));
  return percentageFromFanLevel(nextLevel, cap);
}

function fanLevelFromPercentage(percentage, max = 100) {
  const cap = typeof max === "number" && max > 0 ? max : 100;
  if (typeof percentage !== "number" || !Number.isFinite(percentage)) return 0;
  const clamped = Math.min(cap, Math.max(0, percentage));
  if (clamped <= 0) return 0;
  return Math.min(10, Math.max(1, Math.round((clamped / cap) * 10)));
}

function percentageFromFanLevel(level, max = 100) {
  const cap = typeof max === "number" && max > 0 ? max : 100;
  const lv = Math.min(10, Math.max(0, Number(level) || 0));
  if (lv <= 0) return 0;
  return Math.round((lv / 10) * cap);
}

function entityIsPowered(st, attrs) {
  if (attrs && typeof attrs.is_on === "boolean") return attrs.is_on;
  const s = st?.state;
  if (typeof s !== "string" || !s.trim()) return false;
  return s !== "off" && s !== "unavailable";
}

function isNightModeActive(attrs) {
  return attrs?.night_mode === true;
}

function isAirflowControlEngaged(st, attrs) {
  if (!entityIsPowered(st, attrs)) return false;
  if (isAutoModeActive(attrs)) return true;
  const pct = attrs.percentage;
  if (typeof pct === "number" && pct > 0) return true;
  const fs = attrs.fan_state;
  if (typeof fs === "string" && fs.toUpperCase() === "ON") return true;
  return false;
}

function entityState(hass, entityId) {
  return hass?.states?.[entityId] || null;
}

function relatedClimateEntityId(hass, fanEntityId) {
  if (!fanEntityId || typeof fanEntityId !== "string") return null;
  const idx = fanEntityId.indexOf(".");
  if (idx < 0) return null;
  const objectId = fanEntityId.slice(idx + 1);
  const candidate = `climate.${objectId}`;
  if (hass?.states?.[candidate]) return candidate;
  return null;
}

function relatedFanEntityId(hass, climateEntityId) {
  if (!climateEntityId || typeof climateEntityId !== "string") return null;
  const idx = climateEntityId.indexOf(".");
  if (idx < 0) return null;
  const objectId = climateEntityId.slice(idx + 1);
  const candidate = `fan.${objectId}`;
  if (hass?.states?.[candidate]) return candidate;
  return null;
}

function resolveEntityPair(hass, configuredEntityId) {
  if (!configuredEntityId || typeof configuredEntityId !== "string") {
    return { fanEntityId: null, climateEntityId: null };
  }
  if (configuredEntityId.startsWith("fan.")) {
    return {
      fanEntityId: configuredEntityId,
      climateEntityId: relatedClimateEntityId(hass, configuredEntityId),
    };
  }
  if (configuredEntityId.startsWith("climate.")) {
    return {
      fanEntityId: relatedFanEntityId(hass, configuredEntityId),
      climateEntityId: configuredEntityId,
    };
  }
  return {
    fanEntityId: configuredEntityId,
    climateEntityId: relatedClimateEntityId(hass, configuredEntityId),
  };
}

function mergedThermalAttrs(fanAttrs, climateAttrs) {
  const fa = fanAttrs || {};
  const ca = climateAttrs || {};
  return {
    ...fa,
    ...ca,
    target_temperature:
      typeof fa.target_temperature === "number" && Number.isFinite(fa.target_temperature) && fa.target_temperature > -200
        ? fa.target_temperature
        : ca.target_temperature,
    current_temperature:
      typeof fa.current_temperature === "number" && Number.isFinite(fa.current_temperature) && fa.current_temperature > -200
        ? fa.current_temperature
        : ca.current_temperature,
    min_temp:
      typeof fa.min_temp === "number" && Number.isFinite(fa.min_temp)
        ? fa.min_temp
        : ca.min_temp,
    max_temp:
      typeof fa.max_temp === "number" && Number.isFinite(fa.max_temp)
        ? fa.max_temp
        : ca.max_temp,
    target_temp_step:
      typeof fa.target_temp_step === "number" && Number.isFinite(fa.target_temp_step)
        ? fa.target_temp_step
        : ca.target_temp_step,
    temperature_step:
      typeof fa.temperature_step === "number" && Number.isFinite(fa.temperature_step)
        ? fa.temperature_step
        : ca.temperature_step,
    temperature_unit:
      typeof fa.temperature_unit === "string" && fa.temperature_unit.trim()
        ? fa.temperature_unit
        : ca.temperature_unit,
  };
}

function mountHaIcon(slot, icon, sizePx) {
  if (!slot) return;
  slot.textContent = "";
  const hi = document.createElement("ha-icon");
  hi.icon = icon;
  hi.style.width = `${sizePx}px`;
  hi.style.height = `${sizePx}px`;
  slot.appendChild(hi);
}

class DysonRemoteCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._config = {};
    this._hass = null;
    this._rootEl = null;
    this._pendingActions = new Set();
    this._optimisticAttrs = null;
    this._optimisticClearTimer = null;
  }

  set hass(hass) {
    this._hass = hass;
    this._updateDynamic();
  }

  setConfig(config) {
    if (!config || !config.entity) {
      throw new Error("Specify an entity");
    }
    this._config = {
      ...config,
      show_temperature_header: config.show_temperature_header !== false,
      mushroom_shell: config.mushroom_shell !== false,
      oscillation_presets: normalizeOscillationPresets(config.oscillation_presets),
    };
    this._renderStatic();
    this._updateDynamic();
  }

  getCardSize() {
    return 12;
  }

  static getStubConfig() {
    return { entity: "fan.dyson", mushroom_shell: true };
  }

  static getConfigElement() {
    return document.createElement("dyson-remote-card-editor");
  }

  /**
   * Enable size controls in the HA Sections visual editor.
   * Defaults are tuned for the 3-column control layout, but users can resize.
   */
  static getGridOptions() {
    return {
      columns: 6,
      rows: 8,
      min_columns: 3,
      max_columns: 12,
      min_rows: 6,
      max_rows: 12,
    };
  }

  async _setTargetTemperature(hass, domain, entityId, temperature) {
    const climateEntityId = relatedClimateEntityId(hass, entityId);
    if (climateEntityId && hass?.services?.climate?.set_temperature) {
      await hass.callService("climate", "set_temperature", {
        entity_id: climateEntityId,
        temperature,
      });
      return true;
    }
    const services = hass?.services?.[domain] || {};
    if (services.set_temperature) {
      await hass.callService(domain, "set_temperature", { entity_id: entityId, temperature });
      return true;
    }
    return false;
  }

  async _setCoolingMode(hass, domain, entityId, attrs) {
    const climateEntityId = relatedClimateEntityId(hass, entityId);
    if (climateEntityId && hass?.services?.climate?.set_hvac_mode) {
      await hass.callService("climate", "set_hvac_mode", {
        entity_id: climateEntityId,
        hvac_mode: "fan_only",
      });
      return true;
    }

    const modes = normalizePresetModes(attrs?.preset_modes);
    const heatName = findHeatPresetName(modes);
    const manual = modes.find((m) => m.toLowerCase() === "manual");
    const auto = modes.find((m) => m.toLowerCase() === "auto");
    const fallbackPreset = manual || auto || modes.find((m) => m !== heatName);

    if (heatName && fallbackPreset && attrs?.preset_mode === heatName) {
      if (hass?.services?.[domain]?.set_preset_mode) {
        await hass.callService(domain, "set_preset_mode", { entity_id: entityId, preset_mode: fallbackPreset });
        return true;
      }
    }
    return false;
  }

  async _applyOscillationPreset(hass, domain, entityId, degrees) {
    if (degrees === 0) {
      await hass.callService(domain, "oscillate", { entity_id: entityId, oscillating: false });
      return;
    }
    if (hass.services?.dyson?.set_angle) {
      const half = Math.min(175, Math.round(degrees / 2));
      try {
        await hass.callService("dyson", "set_angle", {
          entity_id: entityId,
          angle_low: Math.max(0, 180 - half),
          angle_high: Math.min(350, 180 + half),
        });
      } catch (err) {
        console.warn("Dyson Remote: dyson.set_angle failed", err);
      }
    }
    await hass.callService(domain, "turn_on", { entity_id: entityId });
    await hass.callService(domain, "oscillate", { entity_id: entityId, oscillating: true });
  }

  async _setNightMode(hass, fanDomain, fanEntityId, enabled) {
    if (hass?.services?.dyson?.set_night_mode) {
      await hass.callService("dyson", "set_night_mode", {
        entity_id: fanEntityId,
        night_mode: enabled,
      });
      return true;
    }
    const fields = hass?.services?.[fanDomain]?.turn_on?.fields || {};
    if (Object.hasOwn(fields, "night_mode")) {
      await hass.callService(fanDomain, "turn_on", { entity_id: fanEntityId, night_mode: enabled });
      return true;
    }
    return false;
  }

  _renderStatic() {
    const shellFlat = !this._config.mushroom_shell;

    const style = document.createElement("style");
    style.textContent = `
      :host {
        display: block;
        container-type: inline-size;
        --drc-bg: #000000;
        --drc-surface-idle: #1a1a1c;
        --drc-surface-on: #5c5c60;
        --drc-label: #a8a8ad;
        --drc-text: #ffffff;
        --drc-muted: #8e8e93;
        --drc-blue: #5ac8fa;
        --drc-red: #ff3b30;
        --drc-gap-x: 10px;
        --drc-gap-y: 14px;
        --drc-circle: 76px;
        --drc-pill-w: 76px;
        --drc-pill-h: 124px;
        --drc-pill-r: 38px;
        --drc-label-size: 11px;
        --drc-temp-size: 17px;
        font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", sans-serif;
        -webkit-tap-highlight-color: transparent;
      }
      .shell {
        background: var(--ha-card-background, var(--card-background-color, #1c1c1c));
        border-radius: var(--ha-card-border-radius, 12px);
        border: var(--ha-card-border-width, 1px) solid
          var(--ha-card-border-color, var(--divider-color, rgba(255, 255, 255, 0.12)));
        box-shadow: var(--ha-card-box-shadow, none);
        overflow: hidden;
        padding: 0;
        box-sizing: border-box;
      }
      .shell.shell--flat {
        background: transparent;
        padding: 0;
        border-radius: 0;
        border: none;
        box-shadow: none;
        overflow: visible;
      }
      .inner-remote {
        background: var(--drc-bg);
        border-radius: inherit;
        color: var(--drc-text);
        padding: 12px 14px 16px;
        box-sizing: border-box;
      }
      .header {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        min-height: 28px;
        margin-bottom: 10px;
        font-size: var(--drc-temp-size);
        font-weight: 600;
        letter-spacing: 0.2px;
      }
      .header[hidden] { display: none !important; }
      .header .temp-muted {
        opacity: 0.85;
        font-weight: 500;
      }
      .grid {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        column-gap: var(--drc-gap-x);
        row-gap: var(--drc-gap-y);
        max-width: 100%;
        margin: 0 auto;
      }
      .cell {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 8px;
      }
      .cell--span-center {
        grid-column: 2;
      }
      .label {
        font-size: var(--drc-label-size);
        line-height: 1.2;
        color: var(--drc-label);
        text-align: center;
        max-width: 110px;
      }
      button {
        border: none;
        padding: 0;
        margin: 0;
        background: transparent;
        cursor: pointer;
        color: inherit;
        font: inherit;
      }
      button:focus-visible {
        outline: 2px solid rgba(255,255,255,0.35);
        outline-offset: 2px;
      }
      .icon-slot {
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--drc-text);
      }
      .icon-slot ha-icon {
        display: block;
      }
      .btn-circle {
        width: var(--drc-circle);
        height: var(--drc-circle);
        border-radius: 50%;
        background: var(--drc-surface-idle);
        display: flex;
        align-items: center;
        justify-content: center;
        transition: background 0.18s ease, transform 0.08s ease;
      }
      .btn-circle:active { transform: scale(0.97); }
      .btn-pill {
        width: var(--drc-pill-w);
        height: var(--drc-pill-h);
        border-radius: var(--drc-pill-r);
        background: var(--drc-surface-idle);
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: flex-start;
        padding-top: 16px;
        gap: 10px;
        box-sizing: border-box;
        transition: background 0.18s ease, transform 0.08s ease;
      }
      .btn-pill:active { transform: scale(0.98); }
      .stepper-pill {
        width: var(--drc-pill-w);
        min-height: var(--drc-pill-h);
        border-radius: var(--drc-pill-r);
        background: var(--drc-surface-idle);
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: flex-start;
        padding: 10px 2px 12px;
        gap: 6px;
        box-sizing: border-box;
        transition: background 0.18s ease;
      }
      .stepper-col {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: space-between;
        flex: 1 1 auto;
        width: 100%;
        min-height: 0;
        gap: 6px;
        padding: 2px 0 4px;
      }
      .stepper-pill:not(.is-engaged) .stepper-btn {
        background: rgba(255, 255, 255, 0.1);
        color: rgba(255, 255, 255, 0.72);
      }
      .stepper-pill.is-engaged .stepper-btn {
        background: rgba(0, 0, 0, 0.22);
        color: #ffffff;
      }
      .stepper-btn {
        flex: 0 0 24px;
        width: 24px;
        height: 24px;
        border-radius: 50%;
        font-size: 16px;
        line-height: 1;
        font-weight: 600;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: background 0.12s ease, color 0.12s ease, transform 0.08s ease;
      }
      .stepper-btn:active {
        transform: scale(0.92);
      }
      .stepper-pill:not(.is-engaged) .stepper-readout:not(.muted) {
        color: rgba(255, 255, 255, 0.55);
      }
      .stepper-pill.is-engaged .stepper-readout:not(.muted) {
        color: #ffffff;
      }
      .stepper-readout {
        flex: 0 1 auto;
        font-size: 11px;
        font-weight: 700;
        line-height: 1.15;
        min-width: 0;
        padding: 2px 1px;
        text-align: center;
        font-variant-numeric: tabular-nums;
        word-break: break-all;
      }
      .stepper-readout.muted {
        color: var(--drc-muted) !important;
      }
      .is-busy {
        cursor: progress !important;
        pointer-events: none;
        opacity: 0.82;
      }
      button.is-busy,
      .stepper-pill.is-busy {
        filter: saturate(0.9);
      }
      .btn-circle.is-engaged,
      .btn-pill.is-engaged,
      .stepper-pill.is-engaged {
        background: var(--drc-surface-on);
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.22);
      }
      button[data-action="power"]:not(.is-engaged) .icon-slot {
        color: rgba(255, 255, 255, 0.38);
      }
      button[data-action="power"].is-engaged .icon-slot {
        color: #ffffff;
      }
      button[data-action="cooling"]:not(.is-engaged) .icon-slot {
        color: rgba(255, 255, 255, 0.32);
      }
      button[data-action="cooling"].is-engaged .icon-slot {
        color: var(--drc-blue);
        filter: drop-shadow(0 0 10px rgba(90, 200, 250, 0.45));
      }
      [data-stepper="heating"]:not(.is-engaged) .icon-slot {
        color: rgba(255, 255, 255, 0.45);
      }
      [data-stepper="heating"].is-engaged .icon-slot {
        color: var(--drc-red);
        filter: drop-shadow(0 0 8px rgba(255, 59, 48, 0.35));
      }
      [data-stepper="oscillation"]:not(.is-engaged) .icon-slot {
        color: rgba(255, 255, 255, 0.45);
      }
      [data-stepper="oscillation"].is-engaged .icon-slot {
        color: #ffffff;
      }
      .pill-mid {
        font-size: 14px;
        font-weight: 600;
        letter-spacing: 0.4px;
        color: var(--drc-text);
      }
      .pill-mid.muted {
        color: var(--drc-muted);
        font-weight: 600;
      }
      .auto-word {
        font-size: 15px;
        font-weight: 700;
        letter-spacing: 0.5px;
        color: rgba(255, 255, 255, 0.38);
        transition: color 0.15s ease;
      }
      .auto-word.on {
        color: #ffffff;
      }
      button[data-action="night"]:not(.is-engaged) .icon-slot {
        color: rgba(255, 255, 255, 0.38);
      }
      button[data-action="night"].is-engaged .icon-slot {
        color: #ffd60a;
        filter: drop-shadow(0 0 8px rgba(255, 214, 10, 0.35));
      }

      @container (max-width: 430px) {
        :host {
          --drc-gap-x: 8px;
          --drc-gap-y: 12px;
          --drc-circle: 68px;
          --drc-pill-w: 68px;
          --drc-pill-h: 114px;
          --drc-pill-r: 34px;
          --drc-label-size: 10px;
          --drc-temp-size: 15px;
        }
        .inner-remote {
          padding: 10px 10px 14px;
        }
        .label {
          max-width: 96px;
        }
      }

      @container (max-width: 345px) {
        :host {
          --drc-gap-x: 10px;
          --drc-gap-y: 12px;
          --drc-circle: 64px;
          --drc-pill-w: 72px;
          --drc-pill-h: 112px;
          --drc-pill-r: 32px;
        }
        .grid {
          grid-template-columns: repeat(2, 1fr);
        }
        .cell--span-center {
          grid-column: 1 / -1;
        }
      }
    `;

    const shell = document.createElement("ha-card");
    shell.className = "shell" + (shellFlat ? " shell--flat" : "");
    shell.dataset.part = "shell";

    const inner = document.createElement("div");
    inner.className = "inner-remote";
    inner.innerHTML = `
      <div class="header" part="header">
        <span class="temp-muted" data-part="temp"></span>
      </div>
      <div class="grid">
        <div class="cell">
          <button type="button" class="btn-circle" data-action="power" aria-label="On/Off">
            <span class="icon-slot" data-ha-icon="mdi:power" data-ha-size="28"></span>
          </button>
          <div class="label">On/Off</div>
        </div>
        <div class="cell">
          <button type="button" class="btn-circle" data-action="cooling" aria-label="Cooling">
            <span class="icon-slot" data-ha-icon="mdi:circle" data-ha-size="30"></span>
          </button>
          <div class="label">Cooling</div>
        </div>
        <div class="cell">
          <button type="button" class="btn-circle" data-action="auto_mode" aria-label="Auto mode">
            <span class="auto-word" data-part="auto-word">AUTO</span>
          </button>
          <div class="label">Auto mode</div>
        </div>

        <div class="cell">
          <div class="stepper-pill" data-stepper="airflow" aria-label="Airflow speed">
            <span class="icon-slot" data-ha-icon="mdi:fan" data-ha-size="26"></span>
            <div class="stepper-col">
              <button type="button" class="stepper-btn" data-action="airflow_plus" aria-label="Increase airflow">+</button>
              <span class="stepper-readout" data-part="airflow-mid">AUTO</span>
              <button type="button" class="stepper-btn" data-action="airflow_minus" aria-label="Decrease airflow">−</button>
            </div>
          </div>
          <div class="label">Airflow speed</div>
        </div>
        <div class="cell">
          <div class="stepper-pill" data-stepper="heating" aria-label="Heating target temperature">
            <span class="icon-slot" data-ha-icon="mdi:radiator" data-ha-size="26"></span>
            <div class="stepper-col">
              <button type="button" class="stepper-btn" data-action="heat_plus" aria-label="Raise target temperature">+</button>
              <span class="stepper-readout muted" data-part="heat-target">—</span>
              <button type="button" class="stepper-btn" data-action="heat_minus" aria-label="Lower target temperature">−</button>
            </div>
          </div>
          <div class="label">Heating</div>
        </div>
        <div class="cell">
          <div class="stepper-pill" data-stepper="oscillation" aria-label="Oscillation angle">
            <span class="icon-slot" data-ha-icon="mdi:arrow-left-right" data-ha-size="26"></span>
            <div class="stepper-col">
              <button type="button" class="stepper-btn" data-action="osc_plus" aria-label="Next oscillation">+</button>
              <span class="stepper-readout muted" data-part="osc-mid">OFF</span>
              <button type="button" class="stepper-btn" data-action="osc_minus" aria-label="Previous oscillation">−</button>
            </div>
          </div>
          <div class="label">Oscillation</div>
        </div>

        <div class="cell cell--span-center">
          <button type="button" class="btn-circle" data-action="night" aria-label="Night mode">
            <span class="icon-slot" data-ha-icon="mdi:moon-waning-crescent" data-ha-size="28"></span>
          </button>
          <div class="label">Night mode</div>
        </div>
      </div>
    `;

    shell.appendChild(inner);

    this.shadowRoot.innerHTML = "";
    this.shadowRoot.appendChild(style);
    this.shadowRoot.appendChild(shell);
    this._rootEl = inner;

    inner.querySelectorAll("[data-ha-icon]").forEach((slot) => {
      const icon = slot.getAttribute("data-ha-icon");
      const size = Number(slot.getAttribute("data-ha-size") || 28);
      mountHaIcon(slot, icon, size);
    });

    inner.addEventListener("click", (ev) => {
      const btn = ev.target.closest("button[data-action]");
      if (!btn) return;
      this._onAction(btn.getAttribute("data-action"));
    });

    const header = inner.querySelector(".header");
    if (!this._config.show_temperature_header) {
      header.hidden = true;
    }
  }

  _toggleEngaged(selector, on) {
    const el = this._rootEl?.querySelector(selector);
    if (el) el.classList.toggle("is-engaged", Boolean(on));
  }

  _actionBusyTargets(action) {
    const byAction = {
      power: ['button[data-action="power"]'],
      cooling: ['button[data-action="cooling"]'],
      auto_mode: ['button[data-action="auto_mode"]'],
      airflow_plus: ['[data-stepper="airflow"]'],
      airflow_minus: ['[data-stepper="airflow"]'],
      heat_plus: ['[data-stepper="heating"]'],
      heat_minus: ['[data-stepper="heating"]'],
      osc_plus: ['[data-stepper="oscillation"]'],
      osc_minus: ['[data-stepper="oscillation"]'],
      night: ['button[data-action="night"]'],
    };
    return byAction[action] || [];
  }

  _setBusy(action, busy) {
    const targets = this._actionBusyTargets(action);
    targets.forEach((selector) => {
      const el = this._rootEl?.querySelector(selector);
      if (el) el.classList.toggle("is-busy", Boolean(busy));
    });
  }

  _applyOptimisticPatch(patch) {
    this._optimisticAttrs = { ...(this._optimisticAttrs || {}), ...(patch || {}) };
    if (this._optimisticClearTimer) {
      clearTimeout(this._optimisticClearTimer);
    }
    this._optimisticClearTimer = setTimeout(() => {
      this._optimisticAttrs = null;
      this._optimisticClearTimer = null;
      this._updateDynamic();
    }, 1500);
    this._updateDynamic();
  }

  _updateDynamic() {
    if (!this._rootEl || !this._hass) return;
    const { fanEntityId, climateEntityId } = resolveEntityPair(this._hass, this._config.entity);
    const st = fanEntityId ? entityState(this._hass, fanEntityId) : entityState(this._hass, this._config.entity);
    const attrs = { ...(st?.attributes || {}), ...(this._optimisticAttrs || {}) };
    const climateAttrs = climateEntityId ? this._hass?.states?.[climateEntityId]?.attributes || {} : {};
    const thermalAttrs = mergedThermalAttrs(attrs, climateAttrs);

    const tempEl = this._rootEl.querySelector('[data-part="temp"]');
    if (tempEl && this._config.show_temperature_header) {
      const txt = formatTargetTemperature(thermalAttrs, thermalAttrs.temperature_unit);
      tempEl.textContent = txt || "";
      tempEl.parentElement.hidden = !txt;
    }

    const autoWord = this._rootEl.querySelector('[data-part="auto-word"]');
    if (autoWord) {
      autoWord.classList.toggle("on", isAutoModeActive(attrs));
    }

    const airflowMid = this._rootEl.querySelector('[data-part="airflow-mid"]');
    if (airflowMid) {
      const powered = entityIsPowered(st, attrs);
      const label = powered ? airflowCenterLabel(attrs) : "OFF";
      airflowMid.textContent = label;
      airflowMid.classList.toggle("muted", label === "—");
    }

    const heatTarget = this._rootEl.querySelector('[data-part="heat-target"]');
    if (heatTarget) {
      const readout = isHeatActive(attrs) ? heatingTargetReadout(thermalAttrs) : "OFF";
      heatTarget.textContent = readout;
      heatTarget.classList.toggle("muted", readout === "—" || readout === "OFF");
    }

    const presets = this._config.oscillation_presets || normalizeOscillationPresets(null);
    const oscMid = this._rootEl.querySelector('[data-part="osc-mid"]');
    if (oscMid) {
      const oi = inferOscillationPresetIndex(attrs, presets);
      const deg = presets[oi] ?? 0;
      oscMid.textContent = oscillationPresetLabel(deg);
      oscMid.classList.toggle("muted", deg === 0);
    }

    this._toggleEngaged('button[data-action="power"]', entityIsPowered(st, attrs));
    this._toggleEngaged('button[data-action="cooling"]', coolingDotActive(attrs));
    this._toggleEngaged('button[data-action="auto_mode"]', isAutoModeActive(attrs));
    this._toggleEngaged('[data-stepper="airflow"]', isAirflowControlEngaged(st, attrs));
    this._toggleEngaged('[data-stepper="heating"]', isHeatActive(attrs));
    this._toggleEngaged('[data-stepper="oscillation"]', attrs.oscillation_enabled === true);
    this._toggleEngaged('button[data-action="night"]', isNightModeActive(attrs));
  }

  async _onAction(action) {
    const hass = this._hass;
    const configuredEntityId = this._config.entity;
    if (!hass || !configuredEntityId) return;
    const { fanEntityId, climateEntityId } = resolveEntityPair(hass, configuredEntityId);
    const entityId = fanEntityId || configuredEntityId;
    if (!entityId) return;

    const st = entityState(hass, entityId);
    const attrs = st?.attributes || {};
    const climateAttrs = climateEntityId ? hass?.states?.[climateEntityId]?.attributes || {} : {};
    const thermalAttrs = mergedThermalAttrs(attrs, climateAttrs);
    const domain = entityId.split(".")[0] || "fan";

    if (this._pendingActions.has(action)) return;
    this._pendingActions.add(action);
    this._setBusy(action, true);

    try {
      switch (action) {
        case "power": {
          const on =
            typeof attrs.is_on === "boolean"
              ? attrs.is_on
              : st?.state !== "off" && st?.state !== "unavailable";
          await hass.callService(domain, on ? "turn_off" : "turn_on", { entity_id: entityId });
          break;
        }
        case "cooling": {
          await hass.callService(domain, "turn_on", { entity_id: entityId });
          try {
            await this._setCoolingMode(hass, domain, entityId, attrs);
          } catch (err) {
            console.warn("Dyson Remote: cooling mode switch failed", err);
          }
          const amb = ambientTemperature(thermalAttrs);
          if (amb != null) {
            const { min, max, step } = temperatureStepAndBounds(thermalAttrs);
            const t = snapTemperatureToStep(amb, min, max, step);
            try {
              await this._setTargetTemperature(hass, domain, entityId, t);
            } catch (err) {
              console.warn("Dyson Remote: Cooling temperature sync failed", err);
            }
          }
          break;
        }
        case "auto_mode": {
          await hass.callService(domain, "turn_on", { entity_id: entityId });
          const modes = normalizePresetModes(attrs.preset_modes);
          const auto = modes.find((m) => m.toLowerCase() === "auto");
          const manual = modes.find((m) => m.toLowerCase() === "manual");
          if (isAutoModeActive(attrs) && manual) {
            await hass.callService(domain, "set_preset_mode", { entity_id: entityId, preset_mode: manual });
          } else if (auto) {
            await hass.callService(domain, "set_preset_mode", { entity_id: entityId, preset_mode: auto });
          }
          break;
        }
        case "airflow_minus":
        case "airflow_plus": {
          const dir = action === "airflow_minus" ? -1 : 1;
          const base =
            typeof attrs.percentage === "number" && Number.isFinite(attrs.percentage)
              ? attrs.percentage
              : 40;
          this._applyOptimisticPatch({
            percentage: adjustFanPercentage(base, dir, attrs, 100),
            auto_mode: false,
          });
          await hass.callService(domain, "turn_on", { entity_id: entityId });
          if (isAutoModeActive(attrs)) {
            const manual = normalizePresetModes(attrs.preset_modes).find((m) => m.toLowerCase() === "manual");
            if (manual) {
              await hass.callService(domain, "set_preset_mode", { entity_id: entityId, preset_mode: manual });
            }
            const next = adjustFanPercentage(base, dir, attrs, 100);
            await hass.callService(domain, "set_percentage", { entity_id: entityId, percentage: next });
          } else {
            const next = adjustFanPercentage(base, dir, attrs, 100);
            await hass.callService(domain, "set_percentage", { entity_id: entityId, percentage: next });
          }
          break;
        }
        case "heat_minus":
        case "heat_plus": {
          const dir = action === "heat_minus" ? -1 : 1;
          const next = adjustTargetTemperature(thermalAttrs.target_temperature, dir, thermalAttrs);
          this._applyOptimisticPatch({ target_temperature: next });
          await hass.callService(domain, "turn_on", { entity_id: entityId });
          const ok = await this._setTargetTemperature(hass, domain, entityId, next);
          if (!ok) {
            console.warn(
              "Dyson Remote: No set_temperature target available for",
              entityId,
              "(tried fan.set_temperature and related climate entity)",
            );
          }
          break;
        }
        case "osc_minus":
        case "osc_plus": {
          const dir = action === "osc_minus" ? -1 : 1;
          const presets = this._config.oscillation_presets || normalizeOscillationPresets(null);
          const idx = inferOscillationPresetIndex(attrs, presets);
          const nextIdx = nextOscillationIndex(idx, dir, presets.length);
          const nextDeg = presets[nextIdx];
          this._applyOptimisticPatch({
            oscillation_enabled: nextDeg > 0,
            oscillation_span: nextDeg,
          });
          await hass.callService(domain, "turn_on", { entity_id: entityId });
          await this._applyOscillationPreset(hass, domain, entityId, nextDeg);
          break;
        }
        case "night": {
          const next = attrs.night_mode !== true;
          const ok = await this._setNightMode(hass, domain, entityId, next);
          if (!ok) {
            console.warn(
              "Dyson Remote: night mode service not available for",
              entityId,
              "(tried dyson.set_night_mode and fan.turn_on night_mode field)",
            );
          }
          break;
        }
        default:
          break;
      }
    } catch (err) {
      console.warn("Dyson Remote card action failed:", action, err);
    } finally {
      setTimeout(() => {
        this._pendingActions.delete(action);
        this._setBusy(action, false);
      }, 450);
    }
  }
}

if (!customElements.get("dyson-remote-card")) {
  customElements.define("dyson-remote-card", DysonRemoteCard);
}

window.customCards = window.customCards || [];
window.customCards.push({
  type: "dyson-remote-card",
  name: "Dyson Remote",
  description: "Control strip styled like the Dyson mobile app",
});

class DysonRemoteCardEditor extends HTMLElement {
  setConfig(config) {
    this._config = {
      entity: "",
      show_temperature_header: true,
      mushroom_shell: true,
      oscillation_presets: [0, 45, 90, 180, 350],
      ...config,
    };
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    this._render();
  }

  _emitConfig(config) {
    this.dispatchEvent(
      new CustomEvent("config-changed", {
        detail: { config },
        bubbles: true,
        composed: true,
      }),
    );
  }

  _render() {
    if (!this._config) return;
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });

    const c = this._config;
    const osc = Array.isArray(c.oscillation_presets) ? c.oscillation_presets.join(", ") : "0, 45, 90, 180, 350";

    this.shadowRoot.innerHTML = `
      <style>
        :host { display:block; padding: 8px 0; }
        .wrap { display:grid; gap: 12px; }
        .row { display:grid; gap: 6px; }
        label { font-size: 13px; color: var(--secondary-text-color); }
        input[type="text"] {
          width: 100%;
          box-sizing: border-box;
          padding: 8px 10px;
          border-radius: 8px;
          border: 1px solid var(--divider-color);
          background: var(--card-background-color);
          color: var(--primary-text-color);
        }
        .toggle { display:flex; align-items:center; gap: 10px; }
        .toggle input[type="checkbox"] {
          width: 16px;
          height: 16px;
          margin: 0;
        }
      </style>
      <div class="wrap">
        <div class="row">
          <label>Entity (fan.* or climate.*)</label>
          <input id="entity" type="text" value="${c.entity || ""}" placeholder="fan.dyson_... or climate.dyson_..." />
        </div>
        <div class="toggle">
          <input id="showTemp" type="checkbox" />
          <label for="showTemp">Show temperature header</label>
        </div>
        <div class="toggle">
          <input id="mushroom" type="checkbox" />
          <label for="mushroom">Use mushroom-style shell</label>
        </div>
        <div class="row">
          <label>Oscillation presets (comma-separated degrees)</label>
          <input id="osc" type="text" value="${osc}" />
        </div>
      </div>
    `;

    const entityInput = this.shadowRoot.getElementById("entity");
    entityInput.value = c.entity || "";
    entityInput.addEventListener("change", () => {
      this._emitConfig({ ...this._config, entity: entityInput.value.trim() });
    });

    const showTemp = this.shadowRoot.getElementById("showTemp");
    showTemp.checked = c.show_temperature_header !== false;
    showTemp.addEventListener("input", () => {
      this._emitConfig({ ...this._config, show_temperature_header: showTemp.checked });
    });

    const mushroom = this.shadowRoot.getElementById("mushroom");
    mushroom.checked = c.mushroom_shell !== false;
    mushroom.addEventListener("input", () => {
      this._emitConfig({ ...this._config, mushroom_shell: mushroom.checked });
    });

    const oscInput = this.shadowRoot.getElementById("osc");
    oscInput.addEventListener("change", () => {
      const values = String(oscInput.value || "")
        .split(",")
        .map((v) => Number(v.trim()))
        .filter((v) => Number.isFinite(v) && v >= 0);
      this._emitConfig({
        ...this._config,
        oscillation_presets: values.length ? values : [0, 45, 90, 180, 350],
      });
    });
  }
}

if (!customElements.get("dyson-remote-card-editor")) {
  customElements.define("dyson-remote-card-editor", DysonRemoteCardEditor);
}
