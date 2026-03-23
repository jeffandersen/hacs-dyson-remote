import {
  adjustFanPercentage,
  adjustTargetTemperature,
  airflowCenterLabel,
  ambientTemperature,
  coolingDotActive,
  entityIsPowered,
  findHeatPresetName,
  formatTargetTemperature,
  heatingTargetReadout,
  inferOscillationPresetIndex,
  isAirflowControlEngaged,
  isAutoModeActive,
  isHeatActive,
  isNightModeActive,
  nextOscillationIndex,
  normalizeOscillationPresets,
  normalizePresetModes,
  oscillationPresetLabel,
  snapTemperatureToStep,
  temperatureStepAndBounds,
} from "./dyson-logic.js";

const DYSON_REMOTE_BUILD = "2026.03.23.11";

function entityState(hass, entityId) {
  return hass?.states?.[entityId] || null;
}

function normalizeDirection(direction) {
  const d = typeof direction === "string" ? direction.toLowerCase() : "";
  if (d === "reverse" || d === "backward" || d === "backwards" || d === "back") return "reverse";
  if (d === "forward" || d === "front" || d === "fwd") return "forward";
  return "forward";
}

function toggledDirection(direction) {
  return normalizeDirection(direction) === "forward" ? "reverse" : "forward";
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

function relatedHumidifierEntityId(hass, baseEntityId) {
  if (!baseEntityId || typeof baseEntityId !== "string") return null;
  const idx = baseEntityId.indexOf(".");
  if (idx < 0) return null;
  const objectId = baseEntityId.slice(idx + 1);
  const candidate = `humidifier.${objectId}`;
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

function humidityRange(attrs) {
  const a = attrs || {};
  const minRaw = typeof a.min_humidity === "number" ? a.min_humidity : 30;
  const maxRaw = typeof a.max_humidity === "number" ? a.max_humidity : 70;
  const lo = Math.min(minRaw, maxRaw);
  const hi = Math.max(minRaw, maxRaw);
  return { min: lo, max: hi, step: 1 };
}

function inferTargetHumidity(attrs) {
  const a = attrs || {};
  const candidates = [a.target_humidity, a.humidity];
  for (const value of candidates) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }
  return null;
}

function isHumidityEnabled(attrs) {
  const a = attrs || {};
  if (typeof a.humidity_enabled === "string") return a.humidity_enabled.toUpperCase() === "ON";
  if (typeof a.humidity_enabled === "boolean") return a.humidity_enabled;
  if (typeof a.is_on === "boolean") return a.is_on;
  return false;
}

function humidityCapability(fanAttrs, climateAttrs, humidifierAttrs) {
  const combined = { ...(fanAttrs || {}), ...(climateAttrs || {}), ...(humidifierAttrs || {}) };
  const hasHumidityBounds =
    (typeof combined.min_humidity === "number" && Number.isFinite(combined.min_humidity)) ||
    (typeof combined.max_humidity === "number" && Number.isFinite(combined.max_humidity));
  const hasHumidityValue =
    (typeof combined.target_humidity === "number" && Number.isFinite(combined.target_humidity)) ||
    (typeof combined.humidity === "number" && Number.isFinite(combined.humidity)) ||
    typeof combined.humidity_enabled !== "undefined";
  return hasHumidityBounds || hasHumidityValue;
}

function resolveEntityPair(hass, configuredEntityId) {
  if (!configuredEntityId || typeof configuredEntityId !== "string") {
    return { fanEntityId: null, climateEntityId: null, humidifierEntityId: null };
  }
  if (configuredEntityId.startsWith("fan.")) {
    return {
      fanEntityId: configuredEntityId,
      climateEntityId: relatedClimateEntityId(hass, configuredEntityId),
      humidifierEntityId: relatedHumidifierEntityId(hass, configuredEntityId),
    };
  }
  if (configuredEntityId.startsWith("climate.")) {
    return {
      fanEntityId: relatedFanEntityId(hass, configuredEntityId),
      climateEntityId: configuredEntityId,
      humidifierEntityId: relatedHumidifierEntityId(hass, configuredEntityId),
    };
  }
  if (configuredEntityId.startsWith("humidifier.")) {
    const climateId = configuredEntityId.replace(/^humidifier\./, "climate.");
    return {
      fanEntityId: relatedFanEntityId(hass, climateId),
      climateEntityId: hass?.states?.[climateId] ? climateId : null,
      humidifierEntityId: configuredEntityId,
    };
  }
  return {
    fanEntityId: configuredEntityId,
    climateEntityId: relatedClimateEntityId(hass, configuredEntityId),
    humidifierEntityId: relatedHumidifierEntityId(hass, configuredEntityId),
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
    this._optimisticExpected = null;
    this._optimisticOscPresetIndex = null;
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
      title: typeof config.title === "string" ? config.title : "",
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
        padding: 14px 14px 16px;
        box-sizing: border-box;
      }
      .title {
        display: block;
        font-size: 1.25rem;
        line-height: 1.3;
        letter-spacing: 0;
        font-weight: 500;
        color: var(--primary-text-color, var(--drc-text));
        margin: 0 0 6px;
      }
      .title[hidden] { display: none !important; }
      .header {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        min-height: 28px;
        margin-bottom: 12px;
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
      .cell--span-right {
        grid-column: 3;
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
        display: grid;
        place-items: center;
        line-height: 0;
        color: var(--drc-text);
      }
      .icon-slot ha-icon {
        display: block;
        line-height: 0;
      }
      .btn-circle {
        width: var(--drc-circle);
        height: var(--drc-circle);
        border-radius: 50%;
        background: var(--drc-surface-idle);
        display: grid;
        place-items: center;
        line-height: 0;
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
        line-height: 0;
        font-weight: 600;
        display: grid;
        place-items: center;
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
      [data-stepper="thermal"]:not(.is-engaged) .icon-slot {
        color: rgba(255, 255, 255, 0.45);
      }
      [data-stepper="thermal"].is-engaged .icon-slot {
        color: var(--drc-red);
        filter: drop-shadow(0 0 8px rgba(255, 59, 48, 0.35));
      }
      [data-stepper="thermal"][data-thermal-mode="humidity"].is-engaged .icon-slot {
        color: var(--drc-blue);
        filter: drop-shadow(0 0 8px rgba(90, 200, 250, 0.35));
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
        color: #ffffff;
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
        .title {
          font-size: 1.125rem;
          margin: 0 0 5px;
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
        .cell--span-right {
          grid-column: auto;
        }
      }
    `;

    const shell = document.createElement("ha-card");
    shell.className = "shell" + (shellFlat ? " shell--flat" : "");
    shell.dataset.part = "shell";

    const inner = document.createElement("div");
    inner.className = "inner-remote";
    inner.innerHTML = `
      <div class="title" data-part="title"></div>
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
          <div class="label" data-part="cooling-label">Cooling</div>
        </div>
        <div class="cell">
          <button type="button" class="btn-circle" data-action="auto_mode" aria-label="Auto mode">
            <span class="auto-word" data-part="auto-word">AUTO</span>
          </button>
          <div class="label" data-part="auto-label">Auto mode</div>
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
          <div class="stepper-pill" data-stepper="thermal" data-thermal-mode="temperature" aria-label="Heating target temperature">
            <span class="icon-slot" data-part="thermal-icon" data-ha-icon="mdi:radiator" data-ha-size="26"></span>
            <div class="stepper-col">
              <button type="button" class="stepper-btn" data-action="heat_plus" aria-label="Raise target temperature">+</button>
              <span class="stepper-readout muted" data-part="thermal-target">—</span>
              <button type="button" class="stepper-btn" data-action="heat_minus" aria-label="Lower target temperature">−</button>
            </div>
          </div>
          <div class="label" data-part="thermal-label">Heating</div>
        </div>
        <div class="cell">
          <div class="stepper-pill" data-stepper="oscillation" aria-label="Oscillation angle">
            <span class="icon-slot" data-ha-icon="mdi:rotate-360" data-ha-size="26"></span>
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
            <span class="icon-slot" data-ha-icon="mdi:weather-night" data-ha-size="28"></span>
          </button>
          <div class="label">Night mode</div>
        </div>
        <div class="cell cell--span-right">
          <button type="button" class="btn-circle" data-action="direction" aria-label="Airflow direction">
            <span class="icon-slot" data-part="direction-icon" data-ha-icon="mdi:tray-arrow-up" data-ha-size="28"></span>
          </button>
          <div class="label">Airflow direction</div>
        </div>
      </div>
    `;

    shell.appendChild(inner);

    this.shadowRoot.innerHTML = "";
    this.shadowRoot.appendChild(style);
    this.shadowRoot.appendChild(shell);
    this._rootEl = inner;

    const titleEl = this._rootEl.querySelector('[data-part="title"]');
    if (titleEl) {
      const initialTitle = typeof this._config.title === "string" ? this._config.title.trim() : "";
      titleEl.textContent = initialTitle;
      titleEl.hidden = !initialTitle;
    }

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
      heat_plus: ['[data-stepper="thermal"]'],
      heat_minus: ['[data-stepper="thermal"]'],
      osc_plus: ['[data-stepper="oscillation"]'],
      osc_minus: ['[data-stepper="oscillation"]'],
      night: ['button[data-action="night"]'],
      direction: ['button[data-action="direction"]'],
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

  _clearOptimisticState() {
    if (this._optimisticClearTimer) {
      clearTimeout(this._optimisticClearTimer);
      this._optimisticClearTimer = null;
    }
    this._optimisticAttrs = null;
    this._optimisticExpected = null;
    this._optimisticOscPresetIndex = null;
  }

  /**
   * Drop optimistic overlays only when real entity state matches what we asked for,
   * so the UI does not snap back to stale values before HA catches up.
   */
  _reconcileOptimisticState(st, climateEntityId, humidifierEntityId) {
    if (!this._optimisticAttrs || !this._optimisticExpected) return;

    const realFan = st?.attributes || {};
    const climateAttrs = climateEntityId ? this._hass?.states?.[climateEntityId]?.attributes || {} : {};
    const humidifierAttrs = humidifierEntityId ? this._hass?.states?.[humidifierEntityId]?.attributes || {} : {};
    const thermalReal = mergedThermalAttrs(realFan, climateAttrs);
    const humidityCombined = { ...realFan, ...climateAttrs, ...humidifierAttrs };

    const nextPatch = { ...this._optimisticAttrs };
    const nextExpected = { ...this._optimisticExpected };
    const presets = this._config.oscillation_presets || normalizeOscillationPresets(null);

    const del = (key) => {
      delete nextPatch[key];
      delete nextExpected[key];
    };

    if (this._optimisticOscPresetIndex != null && presets.length) {
      const idx = inferOscillationPresetIndex(realFan, presets);
      if (idx === this._optimisticOscPresetIndex) {
        del("oscillation_enabled");
        del("oscillation_span");
        this._optimisticOscPresetIndex = null;
      }
    }

    if (nextPatch.direction !== undefined && nextExpected.direction !== undefined) {
      if (normalizeDirection(realFan.direction) === normalizeDirection(nextExpected.direction)) {
        del("direction");
      }
    }

    if (nextPatch.percentage !== undefined && nextExpected.percentage !== undefined) {
      const r = realFan.percentage;
      if (typeof r === "number" && Number.isFinite(r) && Math.abs(r - nextExpected.percentage) <= 1.5) {
        del("percentage");
      }
    }

    if (nextPatch.auto_mode !== undefined && nextExpected.auto_mode !== undefined) {
      if (Boolean(realFan.auto_mode) === Boolean(nextExpected.auto_mode)) {
        del("auto_mode");
      }
    }

    if (nextPatch.target_temperature !== undefined && nextExpected.target_temperature !== undefined) {
      const r = thermalReal.target_temperature;
      if (typeof r === "number" && Number.isFinite(r) && Math.abs(r - nextExpected.target_temperature) <= 0.55) {
        del("target_temperature");
      }
    }

    const humExp = nextExpected.target_humidity ?? nextExpected.humidity;
    const hasHumidPatch =
      nextPatch.target_humidity !== undefined ||
      nextPatch.humidity !== undefined ||
      nextPatch.humidity_enabled !== undefined;
    if (hasHumidPatch) {
      let ok = true;
      if (humExp != null && typeof humExp === "number" && Number.isFinite(humExp)) {
        const r = inferTargetHumidity(humidityCombined);
        ok = r != null && Math.round(r) === Math.round(humExp);
      }
      if (nextPatch.humidity_enabled !== undefined) {
        const wantOn =
          (typeof nextExpected.humidity_enabled === "string" && nextExpected.humidity_enabled.toUpperCase() === "ON") ||
          nextExpected.humidity_enabled === true;
        ok = ok && isHumidityEnabled(humidityCombined) === wantOn;
      }
      if (ok) {
        del("target_humidity");
        del("humidity");
        del("humidity_enabled");
      }
    }

    if (Object.keys(nextPatch).length === 0) {
      this._clearOptimisticState();
    } else {
      this._optimisticAttrs = nextPatch;
      this._optimisticExpected = nextExpected;
    }
  }

  _applyOptimisticPatch(patch, meta = {}) {
    if (!patch || typeof patch !== "object") return;
    this._optimisticAttrs = { ...(this._optimisticAttrs || {}), ...patch };
    this._optimisticExpected = { ...(this._optimisticExpected || {}), ...patch };
    if (meta.oscPresetIndex != null) {
      this._optimisticOscPresetIndex = meta.oscPresetIndex;
    }
    if (this._optimisticClearTimer) {
      clearTimeout(this._optimisticClearTimer);
    }
    this._optimisticClearTimer = setTimeout(() => {
      this._clearOptimisticState();
      this._updateDynamic();
    }, 12000);
    this._updateDynamic();
  }

  _updateDynamic() {
    if (!this._rootEl || !this._hass) return;
    const { fanEntityId, climateEntityId, humidifierEntityId } = resolveEntityPair(this._hass, this._config.entity);
    const st = fanEntityId ? entityState(this._hass, fanEntityId) : entityState(this._hass, this._config.entity);
    this._reconcileOptimisticState(st, climateEntityId, humidifierEntityId);
    const attrs = { ...(st?.attributes || {}), ...(this._optimisticAttrs || {}) };
    const climateAttrs = climateEntityId ? this._hass?.states?.[climateEntityId]?.attributes || {} : {};
    const humidifierAttrs = humidifierEntityId ? this._hass?.states?.[humidifierEntityId]?.attributes || {} : {};
    const thermalAttrs = mergedThermalAttrs(attrs, climateAttrs);
    const humidifierMode = humidityCapability(attrs, climateAttrs, humidifierAttrs);

    const tempEl = this._rootEl.querySelector('[data-part="temp"]');
    if (tempEl && this._config.show_temperature_header) {
      const txt = formatTargetTemperature(thermalAttrs, thermalAttrs.temperature_unit);
      tempEl.textContent = txt || "";
      tempEl.parentElement.hidden = !txt;
    }

    const titleEl = this._rootEl.querySelector('[data-part="title"]');
    if (titleEl) {
      const title = typeof this._config.title === "string" ? this._config.title.trim() : "";
      titleEl.textContent = title;
      titleEl.hidden = !title;
    }

    const autoWord = this._rootEl.querySelector('[data-part="auto-word"]');
    if (autoWord) {
      autoWord.classList.toggle("on", isAutoModeActive(attrs));
    }

    const coolingLabel = this._rootEl.querySelector('[data-part="cooling-label"]');
    if (coolingLabel) {
      coolingLabel.textContent = humidifierMode ? "Auto purify" : "Cooling";
    }

    const autoLabel = this._rootEl.querySelector('[data-part="auto-label"]');
    if (autoLabel) {
      autoLabel.textContent = humidifierMode ? "Auto humidify" : "Auto mode";
    }

    const directionValue = normalizeDirection(attrs.direction);
    const directionIconSlot = this._rootEl.querySelector('[data-part="direction-icon"]');
    if (directionIconSlot) {
      mountHaIcon(
        directionIconSlot,
        directionValue === "forward" ? "mdi:tray-arrow-up" : "mdi:tray-arrow-down",
        28,
      );
    }

    const airflowMid = this._rootEl.querySelector('[data-part="airflow-mid"]');
    if (airflowMid) {
      const powered = entityIsPowered(st, attrs);
      const label = powered ? airflowCenterLabel(attrs) : "OFF";
      airflowMid.textContent = label;
      airflowMid.classList.toggle("muted", label === "—");
    }

    const thermalTarget = this._rootEl.querySelector('[data-part="thermal-target"]');
    if (thermalTarget) {
      let readout = "OFF";
      if (humidifierMode) {
        const target = inferTargetHumidity({ ...attrs, ...climateAttrs, ...humidifierAttrs });
        readout = isHumidityEnabled({ ...attrs, ...climateAttrs, ...humidifierAttrs }) && target != null ? `${Math.round(target)}%` : "OFF";
      } else {
        readout = isHeatActive(attrs) ? heatingTargetReadout(thermalAttrs) : "OFF";
      }
      thermalTarget.textContent = readout;
      thermalTarget.classList.toggle("muted", readout === "—" || readout === "OFF");
    }

    const thermalLabel = this._rootEl.querySelector('[data-part="thermal-label"]');
    if (thermalLabel) thermalLabel.textContent = humidifierMode ? "Humidity control" : "Heating";

    const thermalStepper = this._rootEl.querySelector('[data-stepper="thermal"]');
    if (thermalStepper) {
      thermalStepper.setAttribute("data-thermal-mode", humidifierMode ? "humidity" : "temperature");
      thermalStepper.setAttribute(
        "aria-label",
        humidifierMode ? "Humidity target control" : "Heating target temperature",
      );
    }

    const thermalIconSlot = this._rootEl.querySelector('[data-part="thermal-icon"]');
    if (thermalIconSlot) {
      const icon = humidifierMode ? "mdi:water" : "mdi:radiator";
      mountHaIcon(thermalIconSlot, icon, 26);
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
    this._toggleEngaged(
      '[data-stepper="thermal"]',
      humidifierMode ? isHumidityEnabled({ ...attrs, ...climateAttrs, ...humidifierAttrs }) : isHeatActive(attrs),
    );
    this._toggleEngaged('[data-stepper="oscillation"]', attrs.oscillation_enabled === true);
    this._toggleEngaged('button[data-action="night"]', isNightModeActive(attrs));
    this._toggleEngaged('button[data-action="direction"]', directionValue !== "forward");
  }

  async _onAction(action) {
    const hass = this._hass;
    const configuredEntityId = this._config.entity;
    if (!hass || !configuredEntityId) return;
    const { fanEntityId, climateEntityId, humidifierEntityId } = resolveEntityPair(hass, configuredEntityId);
    const entityId = fanEntityId || configuredEntityId;
    if (!entityId) return;

    const st = entityState(hass, entityId);
    const attrs = st?.attributes || {};
    const climateAttrs = climateEntityId ? hass?.states?.[climateEntityId]?.attributes || {} : {};
    const humidifierAttrs = humidifierEntityId ? hass?.states?.[humidifierEntityId]?.attributes || {} : {};
    const thermalAttrs = mergedThermalAttrs(attrs, climateAttrs);
    const humidifierMode = humidityCapability(attrs, climateAttrs, humidifierAttrs);
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
          if (humidifierMode) {
            const sourceAttrs = { ...attrs, ...climateAttrs, ...humidifierAttrs };
            const { min, max } = humidityRange(sourceAttrs);
            const dir = action === "heat_minus" ? -1 : 1;
            const base = inferTargetHumidity(sourceAttrs);
            const current = base == null ? min : Math.max(min, Math.min(max, Math.round(base)));
            const next = Math.max(min, Math.min(max, current + dir));
            const patch = {
              target_humidity: next,
              humidity: next,
              humidity_enabled: "ON",
            };
            this._applyOptimisticPatch(patch);
            if (domain === "fan") {
              await hass.callService(domain, "turn_on", { entity_id: entityId });
            } else if (domain === "humidifier") {
              await hass.callService("humidifier", "turn_on", { entity_id: entityId });
            }
            if (humidifierEntityId && hass?.services?.humidifier?.set_humidity) {
              await hass.callService("humidifier", "set_humidity", { entity_id: humidifierEntityId, humidity: next });
            } else if (hass?.services?.humidifier?.set_humidity && domain === "humidifier") {
              await hass.callService("humidifier", "set_humidity", { entity_id: entityId, humidity: next });
            } else if (climateEntityId && hass?.services?.climate?.set_humidity) {
              await hass.callService("climate", "set_humidity", { entity_id: climateEntityId, humidity: next });
            } else {
              console.warn(
                "Dyson Remote: No humidity target service available for",
                entityId,
                "(tried humidifier.set_humidity and related climate entity)",
              );
            }
          } else {
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
          this._applyOptimisticPatch(
            {
              oscillation_enabled: nextDeg > 0,
              oscillation_span: nextDeg,
            },
            { oscPresetIndex: nextIdx },
          );
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
        case "direction": {
          const next = toggledDirection(attrs.direction);
          this._applyOptimisticPatch({ direction: next });
          if (hass?.services?.[domain]?.set_direction) {
            await hass.callService(domain, "set_direction", { entity_id: entityId, direction: next });
          } else {
            await hass.callService(domain, "turn_on", { entity_id: entityId, direction: next });
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
  description: `Control strip styled like the Dyson mobile app (build ${DYSON_REMOTE_BUILD})`,
});

class DysonRemoteCardEditor extends HTMLElement {
  static get _schema() {
    return [
      {
        name: "entity",
        selector: {
          entity: {
            domain: ["fan", "climate"],
          },
        },
      },
      {
        name: "show_temperature_header",
        selector: { boolean: {} },
      },
      {
        name: "mushroom_shell",
        selector: { boolean: {} },
      },
    ];
  }

  setConfig(config) {
    this._config = {
      entity: "",
      title: "",
      show_temperature_header: true,
      mushroom_shell: true,
      oscillation_presets: [0, 45, 90, 180, 350],
      ...config,
    };
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._config || !this.shadowRoot) {
      this._render();
      return;
    }
    const form = this.shadowRoot.getElementById("form");
    if (form) form.hass = hass;
  }

  _emitConfig(config) {
    const normalized = { ...(config || {}) };
    const trimmedTitle = typeof normalized.title === "string" ? normalized.title.trim() : "";
    if (trimmedTitle) normalized.title = trimmedTitle;
    else delete normalized.title;
    this.dispatchEvent(
      new CustomEvent("config-changed", {
        detail: { config: normalized },
        bubbles: true,
        composed: true,
      }),
    );
  }

  _render() {
    if (!this._config) return;
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });

    const formTag = customElements.get("ha-form")
      ? "ha-form"
      : customElements.get("hui-form")
        ? "hui-form"
        : null;
    const hasForm = Boolean(formTag);
    if (!hasForm && !this._waitingForForm) {
      this._waitingForForm = true;
      const done = () => {
        this._waitingForForm = false;
        this._render();
      };
      if (!customElements.get("ha-form")) {
        customElements.whenDefined("ha-form").then(done).catch(() => {});
      }
      if (!customElements.get("hui-form")) {
        customElements.whenDefined("hui-form").then(done).catch(() => {});
      }
    }

    this.shadowRoot.innerHTML = `
      <style>
        :host { display:block; padding: 8px 0; }
        .wrap { display:grid; gap: 10px; }
        .field { display:grid; gap: 6px; }
        .field label { font-size: 13px; color: var(--secondary-text-color); }
        .field input[type="text"] {
          width: 100%;
          box-sizing: border-box;
          padding: 8px 10px;
          border-radius: 8px;
          border: 1px solid var(--divider-color);
          background: var(--card-background-color);
          color: var(--primary-text-color);
        }
        .fallback { display:grid; gap: 8px; }
        .fallback label { font-size: 13px; color: var(--secondary-text-color); }
        .fallback input[type="text"] {
          width: 100%;
          box-sizing: border-box;
          padding: 8px 10px;
          border-radius: 8px;
          border: 1px solid var(--divider-color);
          background: var(--card-background-color);
          color: var(--primary-text-color);
        }
        .hint {
          font-size: 12px;
          color: var(--secondary-text-color);
          opacity: 0.8;
        }
      </style>
      <div class="wrap">
        <div class="field">
          <label for="titleInput">Title (optional)</label>
          <input id="titleInput" type="text" placeholder="Living Room" />
        </div>
        ${hasForm ? `<${formTag} id="form"></${formTag}>` : `
          <div class="fallback">
            <label>Entity (fan.* or climate.*)</label>
            <input id="entityInput" type="text" placeholder="fan.dyson_... or climate.dyson_..." />
            <label>
              <input id="showTemperatureHeaderInput" type="checkbox" />
              Show temperature header
            </label>
            <label>
              <input id="mushroomShellInput" type="checkbox" />
              Use mushroom-style shell
            </label>
            <div class="hint">Waiting for Home Assistant form components...</div>
          </div>
        `}
      </div>
    `;

    const titleInput = this.shadowRoot.getElementById("titleInput");
    titleInput.value = this._config.title || "";
    const emitWithTitle = (next) => this._emitConfig({ ...next, title: titleInput.value });
    titleInput.addEventListener("change", () => emitWithTitle(this._config));

    if (hasForm) {
      const form = this.shadowRoot.getElementById("form");
      form.hass = this._hass;
      form.data = this._config;
      form.schema = DysonRemoteCardEditor._schema;
      form.computeLabel = (schema) => {
        if (schema.name === "entity") return "Entity";
        if (schema.name === "show_temperature_header") return "Show temperature header";
        if (schema.name === "mushroom_shell") return "Use mushroom-style shell";
        return schema.name;
      };
      form.addEventListener("value-changed", (ev) => {
        emitWithTitle({ ...this._config, ...(ev.detail?.value || {}) });
      });
    } else {
      const entityInput = this.shadowRoot.getElementById("entityInput");
      const showTemperatureHeaderInput = this.shadowRoot.getElementById("showTemperatureHeaderInput");
      const mushroomShellInput = this.shadowRoot.getElementById("mushroomShellInput");
      entityInput.value = this._config.entity || "";
      showTemperatureHeaderInput.checked = Boolean(this._config.show_temperature_header);
      mushroomShellInput.checked = Boolean(this._config.mushroom_shell);
      const emit = () => {
        emitWithTitle({
          ...this._config,
          entity: entityInput.value.trim(),
          show_temperature_header: Boolean(showTemperatureHeaderInput.checked),
          mushroom_shell: Boolean(mushroomShellInput.checked),
        });
      };
      entityInput.addEventListener("change", emit);
      showTemperatureHeaderInput.addEventListener("change", emit);
      mushroomShellInput.addEventListener("change", emit);
    }
  }
}

if (!customElements.get("dyson-remote-card-editor")) {
  customElements.define("dyson-remote-card-editor", DysonRemoteCardEditor);
}
