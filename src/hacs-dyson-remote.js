import { computeAirQualitySummary } from "./air-quality-logic.js";
import { buildDysonRemoteCardEditorSchema } from "./dyson-editor-schema.js";
import {
  buildHumiditySetpointServiceCalls,
  executeHumiditySetpointCalls,
  normalizeHumidityWrite,
} from "./humidity-write-plan.js";
import {
  adjustFanPercentage,
  adjustTargetTemperature,
  airflowCenterLabel,
  ambientTemperature,
  climateHumidityAutoOn,
  humiditySetpointIsAutoTarget,
  coolingDotActive,
  entityIsPowered,
  findHeatPresetName,
  formatTargetTemperature,
  heatingTargetReadout,
  adjustTargetHumidityByStep,
  humidityRangeIntersect,
  humidityStepperBounds,
  humidifierAutoHumidifyControlEngaged,
  humidifierComboMode,
  humidifierPurifyControlEngaged,
  isHumidityEnabled,
  inferTargetHumidity,
  snapTargetHumidityToStep,
  targetHumidityMatchesExpected,
  inferOscillationPresetIndex,
  isAirflowControlEngaged,
  isAutoModeActive,
  isHeatActive,
  isNightModeActive,
  nextOscillationIndex,
  normalizeOscillationPresets,
  normalizePresetModes,
  oscillationDisplayFromSelect,
  oscillationIsEnabled,
  oscillationPresetLabel,
  oscillationSelectLooksLikePreset,
  pickHumidifierModeForAutoToggle,
  pickSelectOptionHumidityAuto,
  resolvedHumidityAutoToggleEntityId,
  resolvedHumidityTargetNumberEntityId,
  resolveHumidifierEntityId,
  snapTemperatureToStep,
  temperatureStepAndBounds,
} from "./dyson-logic.js";

const _dysonRemoteBuildToken = "__DYSON_CARD_BUILD__";
const DYSON_REMOTE_BUILD = _dysonRemoteBuildToken.startsWith("__DYSON_")
  ? "dev"
  : _dysonRemoteBuildToken;

/** Pairs: editor/form use show_*; YAML may drop false, so we persist off state as hide_*: true. */
const AIR_SUBSECTION_FLAG_PAIRS = [
  ["show_air_quality_category", "hide_air_quality_category"],
  ["show_air_quality_pollutant", "hide_air_quality_pollutant"],
  ["show_air_quality_bar", "hide_air_quality_bar"],
];

function airSubsectionEnabled(config, showKey, hideKey) {
  if (config[hideKey] === true) return false;
  if (config[hideKey] === false) return true;
  if (config[showKey] === false) return false;
  return true;
}

/** ha-form may omit false keys or pass non-boolean toggles; normalize to true/false/undefined. */
function coerceAirSubsectionShow(val) {
  if (val === true || val === "true" || val === 1) return true;
  if (val === false || val === "false" || val === 0) return false;
  return undefined;
}

function airSubsectionFormValues(config) {
  return {
    show_air_quality_category: airSubsectionEnabled(
      config,
      "show_air_quality_category",
      "hide_air_quality_category",
    ),
    show_air_quality_pollutant: airSubsectionEnabled(
      config,
      "show_air_quality_pollutant",
      "hide_air_quality_pollutant",
    ),
    show_air_quality_bar: airSubsectionEnabled(config, "show_air_quality_bar", "hide_air_quality_bar"),
  };
}

/**
 * Lovelace often strips `false` booleans from saved YAML, so subsection "off" is stored as hide_*: true.
 */
function persistAirSubsectionKeys(config) {
  const out = { ...config };
  for (const [showKey, hideKey] of AIR_SUBSECTION_FLAG_PAIRS) {
    const v = coerceAirSubsectionShow(out[showKey]);
    const on = v !== false;
    if (!on) {
      out[hideKey] = true;
    } else {
      /* Explicit false so Lovelace shallow-merges clear a previous hide_*: true in the preview. */
      out[hideKey] = false;
    }
    delete out[showKey];
  }
  return out;
}

/** Merge editor form state; prefer live `form.data` over `detail.value` so false booleans are not dropped. */
function mergeConfigWithFormAirSubsections(prevConfig, formValue) {
  const merged = { ...prevConfig, ...(formValue || {}) };
  for (const [showKey, hideKey] of AIR_SUBSECTION_FLAG_PAIRS) {
    if (formValue && showKey in formValue) {
      const c = coerceAirSubsectionShow(formValue[showKey]);
      merged[showKey] = c !== undefined ? c : Boolean(formValue[showKey]);
    } else {
      merged[showKey] = airSubsectionEnabled(merged, showKey, hideKey);
    }
  }
  return merged;
}

function entityState(hass, entityId) {
  return hass?.states?.[entityId] || null;
}

/** Optional card `humidity_step` (number or numeric string). */
function parseConfigHumidityStep(v) {
  if (typeof v === "number" && Number.isFinite(v) && v > 0) return Math.round(v);
  if (typeof v === "string" && v.trim()) {
    const n = Number(v.trim());
    if (Number.isFinite(n) && n > 0) return Math.round(n);
  }
  return undefined;
}

/** Optional title alignment. */
function normalizeTitleAlignment(v) {
  const s = typeof v === "string" ? v.trim().toLowerCase() : "";
  if (s === "center" || s === "right") return s;
  return "left";
}

/** HA rejects unknown `climate.set_humidity` keys; only send `humidity_auto` if the service schema includes it. */
function climateSetHumiditySupportsHumidityAuto(hass) {
  const fields = hass?.services?.climate?.set_humidity?.fields;
  return typeof fields === "object" && fields !== null && Object.prototype.hasOwnProperty.call(fields, "humidity_auto");
}

async function toggleHumidityAutoViaSibling(hass, entityId, wantAutoOn) {
  const st = hass?.states?.[entityId];
  if (!st) return false;
  const domain = entityId.split(".")[0];
  try {
    if (domain === "switch") {
      if (wantAutoOn) await hass.callService("switch", "turn_on", { entity_id: entityId });
      else await hass.callService("switch", "turn_off", { entity_id: entityId });
      return true;
    }
    if (domain === "select") {
      const options = st.attributes?.options;
      const opt = pickSelectOptionHumidityAuto(options, wantAutoOn);
      if (opt == null) return false;
      await hass.callService("select", "select_option", { entity_id: entityId, option: opt });
      return true;
    }
  } catch (err) {
    console.warn("Dyson Remote: humidity auto sibling toggle failed", entityId, err);
  }
  return false;
}

async function tryHumidifierAutoMode(hass, humidifierEntityId, wantAuto, humidifierAttrs) {
  if (!humidifierEntityId || !hass?.services?.humidifier?.set_mode) return false;
  const mode = pickHumidifierModeForAutoToggle(humidifierAttrs?.available_modes, wantAuto);
  if (mode == null) return false;
  try {
    await hass.callService("humidifier", "set_mode", { entity_id: humidifierEntityId, mode });
    return true;
  } catch (err) {
    console.warn("Dyson Remote: humidifier.set_mode (auto humidify) failed", err);
    return false;
  }
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
  const states = hass?.states;
  if (!states) return null;
  const climates = Object.keys(states).filter((id) => id.startsWith("climate."));
  const dysonHumidifierClimates = climates.filter((id) => {
    const a = states[id]?.attributes;
    if (!a || typeof a.min_humidity !== "number" || typeof a.max_humidity !== "number") return false;
    return Object.prototype.hasOwnProperty.call(a, "humidity_auto");
  });
  if (dysonHumidifierClimates.length === 1) return dysonHumidifierClimates[0];
  return null;
}

function pickClimateEntityForFan(hass, fanEntityId, config) {
  const trimmed = typeof config?.climate_entity === "string" ? config.climate_entity.trim() : "";
  if (trimmed.startsWith("climate.") && hass?.states?.[trimmed]) return trimmed;
  return relatedClimateEntityId(hass, fanEntityId);
}

function effectiveFanEntityId(hass, fanEntityId, climateEntityId, configuredEntityId) {
  if (fanEntityId && hass?.states?.[fanEntityId]) return fanEntityId;
  if (climateEntityId) {
    const f = relatedFanEntityId(hass, climateEntityId);
    if (f && hass?.states?.[f]) return f;
  }
  if (typeof configuredEntityId === "string" && configuredEntityId.startsWith("fan.") && hass?.states?.[configuredEntityId]) {
    return configuredEntityId;
  }
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

function fanEntityObjectId(fanEntityId) {
  if (!fanEntityId || typeof fanEntityId !== "string") return "";
  const idx = fanEntityId.indexOf(".");
  return idx >= 0 ? fanEntityId.slice(idx + 1) : "";
}

/**
 * libdyson / HA Dyson often exposes angle presets on `select.<device_id>_oscillation`
 * (e.g. 45°, 90°, …). Driving that entity updates the device; fan.oscillate alone may not.
 */
function resolvedOscillationSelectEntityId(hass, fanEntityId, configuredId) {
  const trimmed = typeof configuredId === "string" ? configuredId.trim() : "";
  if (trimmed && hass?.states?.[trimmed] && trimmed.startsWith("select.")) {
    return trimmed;
  }
  const oid = fanEntityObjectId(fanEntityId);
  if (!oid) return null;
  const candidate = `select.${oid}_oscillation`;
  if (hass?.states?.[candidate]) return candidate;

  const prefix = `select.${oid}_`;
  const ids = Object.keys(hass?.states || {});
  for (const id of ids) {
    if (!id.startsWith(prefix) || !id.includes("oscillation")) continue;
    const st = hass.states[id];
    if (oscillationSelectLooksLikePreset(st)) return id;
  }
  for (const id of ids) {
    if (!id.startsWith("select.")) continue;
    if (!id.includes(oid) || !id.toLowerCase().includes("oscillation")) continue;
    const st = hass.states[id];
    if (oscillationSelectLooksLikePreset(st)) return id;
  }
  return null;
}

/** Map numeric preset (e.g. 45) to the integration's option label (e.g. "45°"). */
function matchOscillationSelectOption(options, degrees) {
  if (!degrees || degrees <= 0 || !Array.isArray(options)) return null;
  for (const opt of options) {
    if (typeof opt !== "string") continue;
    const n = parseInt(opt.replace(/[^\d]/g, ""), 10);
    if (Number.isFinite(n) && n === degrees) return opt;
  }
  return null;
}

function resolveEntityPair(hass, configuredEntityId, config = {}) {
  if (!configuredEntityId || typeof configuredEntityId !== "string") {
    return { fanEntityId: null, climateEntityId: null, humidifierEntityId: null };
  }
  if (configuredEntityId.startsWith("fan.")) {
    const climateEntityId = pickClimateEntityForFan(hass, configuredEntityId, config);
    return {
      fanEntityId: configuredEntityId,
      climateEntityId,
      humidifierEntityId: resolveHumidifierEntityId(
        hass.states,
        configuredEntityId,
        climateEntityId,
        config.humidifier_entity,
      ),
    };
  }
  if (configuredEntityId.startsWith("climate.")) {
    const fanEntityId = relatedFanEntityId(hass, configuredEntityId);
    return {
      fanEntityId,
      climateEntityId: configuredEntityId,
      humidifierEntityId: resolveHumidifierEntityId(hass.states, fanEntityId, configuredEntityId, config.humidifier_entity),
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
  const climateEntityId = pickClimateEntityForFan(hass, configuredEntityId, config);
  return {
    fanEntityId: configuredEntityId,
    climateEntityId,
    humidifierEntityId: resolveHumidifierEntityId(hass.states, configuredEntityId, climateEntityId, config.humidifier_entity),
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

/**
 * Humidity readout, ± stepper, and optimistic reconcile must use the same merge order:
 * climate + humidifier, then primary entity (fan or configured climate) last — matches `_updateDynamic` readout.
 */
function mergedHumidityCardAttrs(primaryAttrs, climateAttrs, humidifierAttrs) {
  return { ...(climateAttrs || {}), ...(humidifierAttrs || {}), ...(primaryAttrs || {}) };
}

function mountHaIcon(slot, icon, sizePx) {
  if (!slot) return;
  slot.textContent = "";
  const hi = document.createElement("ha-icon");
  hi.icon = icon;
  hi.style.width = `${sizePx}px`;
  hi.style.height = `${sizePx}px`;
  hi.style.color = "inherit";
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
    this._optimisticClimateHumidityAutoExpected = null;
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
      show_air_quality_header: config.show_air_quality_header === true,
      show_air_quality_category: airSubsectionEnabled(
        config,
        "show_air_quality_category",
        "hide_air_quality_category",
      ),
      show_air_quality_pollutant: airSubsectionEnabled(
        config,
        "show_air_quality_pollutant",
        "hide_air_quality_pollutant",
      ),
      show_air_quality_bar: airSubsectionEnabled(config, "show_air_quality_bar", "hide_air_quality_bar"),
      oscillation_presets: normalizeOscillationPresets(config.oscillation_presets),
      title: typeof config.title === "string" ? config.title : "",
      title_alignment: normalizeTitleAlignment(config.title_alignment),
      oscillation_select_entity:
        typeof config.oscillation_select_entity === "string" ? config.oscillation_select_entity.trim() : "",
      climate_entity: typeof config.climate_entity === "string" ? config.climate_entity.trim() : "",
      humidity_auto_entity:
        typeof config.humidity_auto_entity === "string" ? config.humidity_auto_entity.trim() : "",
      humidifier_entity: typeof config.humidifier_entity === "string" ? config.humidifier_entity.trim() : "",
      humidity_target_entity:
        typeof config.humidity_target_entity === "string" ? config.humidity_target_entity.trim() : "",
      humidity_step: parseConfigHumidityStep(config.humidity_step),
      humidity_write: normalizeHumidityWrite(config.humidity_write),
    };
    this._renderStatic();
    this._updateDynamic();
  }

  getCardSize() {
    return 12;
  }

  static getStubConfig() {
    return { entity: "fan.dyson" };
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

  async _setCoolingMode(hass, domain, entityId, attrs, climateAttrs) {
    const climateEntityId = relatedClimateEntityId(hass, entityId);
    if (climateEntityId && hass?.services?.climate?.set_hvac_mode) {
      const ca = climateAttrs || hass?.states?.[climateEntityId]?.attributes || {};
      const modes = Array.isArray(ca.hvac_modes) ? ca.hvac_modes : [];
      const norm = (m) => String(m).toLowerCase();
      const pick =
        modes.find((m) => norm(m) === "fan_only") ||
        modes.find((m) => norm(m) === "fan") ||
        modes.find((m) => norm(m) === "dry");
      const hvacMode = pick || "fan_only";
      await hass.callService("climate", "set_hvac_mode", {
        entity_id: climateEntityId,
        hvac_mode: hvacMode,
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
    const selectId = resolvedOscillationSelectEntityId(
      hass,
      entityId,
      this._config.oscillation_select_entity,
    );

    if (degrees === 0) {
      await hass.callService(domain, "oscillate", { entity_id: entityId, oscillating: false });
      return;
    }

    if (selectId && hass?.services?.select?.select_option) {
      const options = hass.states?.[selectId]?.attributes?.options;
      const option = matchOscillationSelectOption(options, degrees);
      if (option) {
        try {
          await hass.callService("select", "select_option", { entity_id: selectId, option });
          return;
        } catch (err) {
          console.warn("Dyson Remote: select.select_option for oscillation failed", err);
        }
      }
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
      .inner-remote {
        background: var(--drc-bg);
        border-radius: inherit;
        color: var(--drc-text);
        padding: 14px 14px 16px;
        box-sizing: border-box;
      }
      .title {
        display: block;
        font: inherit;
        font-size: inherit;
        line-height: 1.4;
        letter-spacing: inherit;
        font-weight: inherit;
        color: var(--primary-text-color, var(--drc-text));
        margin: 0;
        padding: 4px 2px 12px;
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
      .aq-header {
        text-align: center;
        margin-bottom: 18px;
        --aq-accent: #34d399;
        padding: 14px 16px 12px;
        border-radius: 16px;
        box-sizing: border-box;
        /* Avoid CSS keyword transparent in gradients: it is rgba(0,0,0,0) and
           interpolates through a dark band between stops. */
        background: linear-gradient(
          180deg,
          color-mix(in srgb, var(--aq-accent) 28%, rgba(255, 255, 255, 0)) 0%,
          color-mix(in srgb, var(--aq-accent) 9%, rgba(255, 255, 255, 0)) 52%,
          rgba(255, 255, 255, 0) 100%
        );
      }
      .aq-header[hidden] {
        display: none !important;
      }
      .aq-title-row {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 10px;
        position: relative;
        margin-bottom: 8px;
        min-height: 36px;
      }
      .aq-title-row[hidden] {
        display: none !important;
      }
      .aq-title {
        position: relative;
        font-size: clamp(1.35rem, 4.5cqi, 1.7rem);
        font-weight: 700;
        letter-spacing: 0.02em;
        color: var(--aq-accent);
      }
      .aq-title-icon {
        position: relative;
        color: var(--aq-accent);
      }
      .aq-title-icon ha-icon {
        color: var(--aq-accent) !important;
        --icon-primary-color: var(--aq-accent);
      }
      .aq-subtitle {
        font-size: 13px;
        font-weight: 500;
        margin-bottom: 12px;
        line-height: 1.4;
      }
      .aq-subtitle[hidden] {
        display: none !important;
      }
      .aq-sub-bullet {
        color: var(--aq-accent);
        margin-right: 5px;
        font-weight: 700;
      }
      .aq-sub-bullet[hidden] {
        display: none !important;
      }
      .aq-sub-text {
        color: var(--drc-muted);
      }
      .aq-header.aq--accent-subtitle .aq-sub-text {
        color: color-mix(in srgb, var(--aq-accent) 78%, #a8a8ad);
      }
      .aq-bar-track {
        position: relative;
        height: 14px;
        margin: 0 auto 8px;
        max-width: 92%;
      }
      .aq-bar-track[hidden] {
        display: none !important;
      }
      .aq-bar-segments {
        display: flex;
        gap: 3px;
        height: 10px;
        border-radius: 999px;
        overflow: hidden;
        background: rgba(0, 0, 0, 0.28);
        align-items: stretch;
        position: relative;
        z-index: 1;
      }
      .aq-seg {
        flex: 1 1 0;
        min-width: 0;
        transition: opacity 0.2s ease, box-shadow 0.2s ease;
        border-radius: 0;
      }
      .aq-seg:first-child {
        border-radius: 999px 0 0 999px;
      }
      .aq-seg:last-child {
        border-radius: 0 999px 999px 0;
      }
      .aq-seg.is-dim {
        opacity: 0.4;
      }
      .aq-seg.is-active {
        opacity: 1;
        box-shadow: 0 0 8px color-mix(in srgb, var(--aq-accent) 55%, transparent);
      }
      .aq-thumb {
        position: absolute;
        width: 14px;
        height: 14px;
        top: 50%;
        left: 10%;
        transform: translate(-50%, -50%);
        border-radius: 50%;
        background: rgba(255, 255, 255, 0.96);
        border: 2px solid var(--aq-accent);
        box-shadow:
          0 0 6px color-mix(in srgb, var(--aq-accent) 70%, transparent),
          0 0 12px color-mix(in srgb, var(--aq-accent) 40%, transparent);
        z-index: 2;
        pointer-events: none;
        transition: left 0.25s ease, border-color 0.2s ease, box-shadow 0.2s ease;
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
      /*
       * Footer row: invisible spacer (col 1) + Night + Direction so auto-placement centers Night even when
       * @container or other rules drop explicit grid-column (e.g. max-width:345px matching a squeezed host).
       */
      .cell--footer-spacer {
        visibility: hidden;
        pointer-events: none;
      }
      .cell--footer-spacer .btn-circle,
      .cell--footer-spacer .label {
        visibility: hidden;
      }
      /*
       * Pin stepper row + combo column swap only when the card is wide enough for three columns.
       * (Footer rules above apply whenever .grid has three columns — the default before max-width:345px.)
       */
      @container (min-width: 346px) {
        .cell--stepper-osc,
        .cell--stepper-thermal,
        .cell--stepper-airflow {
          grid-row: 2;
        }
        /* Fan: columns 1–3 follow DOM (osc | thermal | airflow). Combo: osc | airflow | humidity. */
        .grid--combo-humid .cell--stepper-osc {
          grid-column: 1;
        }
        .grid--combo-humid .cell--stepper-airflow {
          grid-column: 2;
        }
        .grid--combo-humid .cell--stepper-thermal {
          grid-column: 3;
        }
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
      /* [hidden] must beat .icon-slot display:grid (same specificity; otherwise hidden is ignored). */
      .icon-slot[hidden],
      .auto-word[hidden] {
        display: none !important;
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
      button[data-action="cooling"]:not(.is-engaged) [data-part="humidifier-purify-auto"] {
        color: rgba(255, 255, 255, 0.38);
      }
      button[data-action="cooling"].is-engaged [data-part="humidifier-purify-auto"] {
        color: #ffffff;
      }
      button[data-action="auto_mode"]:not(.is-engaged) [data-part="auto-humidify-icon"] {
        color: rgba(255, 255, 255, 0.38);
      }
      button[data-action="auto_mode"].is-engaged [data-part="auto-humidify-icon"] {
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
        .cell--stepper-osc,
        .cell--stepper-thermal,
        .cell--stepper-airflow {
          grid-row: auto;
        }
        .cell--footer-spacer {
          display: none;
        }
      }
    `;

    const shell = document.createElement("ha-card");
    shell.className = "shell";
    shell.dataset.part = "shell";

    const inner = document.createElement("div");
    inner.className = "inner-remote";
    inner.innerHTML = `
      <div class="title" data-part="title"></div>
      <div class="aq-header" data-part="aq-header" hidden>
        <div class="aq-title-row" data-part="aq-title-row">
          <span class="aq-title" data-part="aq-title">—</span>
          <span class="icon-slot aq-title-icon" data-part="aq-icon-slot" data-ha-icon="mdi:check-circle-outline" data-ha-size="26"></span>
        </div>
        <div class="aq-subtitle" data-part="aq-subtitle-wrap">
          <span class="aq-sub-bullet" data-part="aq-bullet">•</span><span class="aq-sub-text" data-part="aq-subtext"></span>
        </div>
        <div class="aq-bar-track" data-part="aq-bar-track">
          <div class="aq-bar-segments" data-part="aq-segments">
            <div class="aq-seg" data-aq-seg="0"></div>
            <div class="aq-seg" data-aq-seg="1"></div>
            <div class="aq-seg" data-aq-seg="2"></div>
            <div class="aq-seg" data-aq-seg="3"></div>
            <div class="aq-seg" data-aq-seg="4"></div>
          </div>
          <div class="aq-thumb" data-part="aq-thumb"></div>
        </div>
      </div>
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
            <span class="icon-slot" data-part="cooling-circle-icon" data-ha-icon="mdi:circle" data-ha-size="30"></span>
            <span class="auto-word" data-part="humidifier-purify-auto" hidden>AUTO</span>
          </button>
          <div class="label" data-part="cooling-label">Cooling</div>
        </div>
        <div class="cell">
          <button type="button" class="btn-circle" data-action="auto_mode" aria-label="Auto mode">
            <span class="auto-word" data-part="auto-word">AUTO</span>
            <span class="icon-slot" data-part="auto-humidify-icon" hidden data-ha-icon="mdi:water" data-ha-size="28"></span>
          </button>
          <div class="label" data-part="auto-label">Auto mode</div>
        </div>

        <div class="cell cell--stepper-osc">
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
        <div class="cell cell--stepper-thermal">
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
        <div class="cell cell--stepper-airflow">
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

        <div class="cell cell--footer-spacer" aria-hidden="true">
          <div class="btn-circle"></div>
          <div class="label"> </div>
        </div>
        <div class="cell cell--footer-night">
          <button type="button" class="btn-circle" data-action="night" aria-label="Night mode">
            <span class="icon-slot" data-ha-icon="mdi:weather-night" data-ha-size="28"></span>
          </button>
          <div class="label">Night mode</div>
        </div>
        <div class="cell cell--footer-direction">
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
      titleEl.style.textAlign = normalizeTitleAlignment(this._config.title_alignment);
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
    this._optimisticClimateHumidityAutoExpected = null;
  }

  _reconcileClimateHumidityAutoOptimistic(climateEntityId) {
    if (this._optimisticClimateHumidityAutoExpected == null || !climateEntityId || !this._hass?.states) return;
    const ca = this._hass.states[climateEntityId]?.attributes || {};
    if (climateHumidityAutoOn(ca) === this._optimisticClimateHumidityAutoExpected) {
      this._optimisticClimateHumidityAutoExpected = null;
    }
  }

  /** Start or restart the 12s clear countdown (call when applying new optimistic state). */
  _bumpOptimisticClearTimer() {
    const hasFan = this._optimisticAttrs && Object.keys(this._optimisticAttrs).length > 0;
    const hasClimate = this._optimisticClimateHumidityAutoExpected != null;
    const hasOsc = this._optimisticOscPresetIndex != null;
    if (!hasFan && !hasClimate && !hasOsc) {
      if (this._optimisticClearTimer) {
        clearTimeout(this._optimisticClearTimer);
        this._optimisticClearTimer = null;
      }
      return;
    }
    if (this._optimisticClearTimer) {
      clearTimeout(this._optimisticClearTimer);
    }
    this._optimisticClearTimer = setTimeout(() => {
      this._clearOptimisticState();
      this._updateDynamic();
    }, 12000);
  }

  /** Stop timer if nothing pending; otherwise leave an existing countdown alone (avoid resetting every hass poll). */
  _maybeResyncOptimisticClearTimer() {
    const hasFan = this._optimisticAttrs && Object.keys(this._optimisticAttrs).length > 0;
    const hasClimate = this._optimisticClimateHumidityAutoExpected != null;
    const hasOsc = this._optimisticOscPresetIndex != null;
    if (!hasFan && !hasClimate && !hasOsc) {
      if (this._optimisticClearTimer) {
        clearTimeout(this._optimisticClearTimer);
        this._optimisticClearTimer = null;
      }
      return;
    }
    if (this._optimisticClearTimer) return;
    this._optimisticClearTimer = setTimeout(() => {
      this._clearOptimisticState();
      this._updateDynamic();
    }, 12000);
  }

  /**
   * Drop optimistic overlays only when real entity state matches what we asked for,
   * so the UI does not snap back to stale values before HA catches up.
   */
  _reconcileOptimisticState(st, climateEntityId, humidifierEntityId, fanEntityId) {
    if (this._optimisticAttrs && this._optimisticExpected) {
    const realFan = st?.attributes || {};
    const climateAttrs = climateEntityId ? this._hass?.states?.[climateEntityId]?.attributes || {} : {};
    const humidifierAttrs = humidifierEntityId ? this._hass?.states?.[humidifierEntityId]?.attributes || {} : {};
    const thermalReal = mergedThermalAttrs(realFan, climateAttrs);
    const humidityCombined = mergedHumidityCardAttrs(realFan, climateAttrs, humidifierAttrs);

    const nextPatch = { ...this._optimisticAttrs };
    const nextExpected = { ...this._optimisticExpected };
    const presets = this._config.oscillation_presets || normalizeOscillationPresets(null);

    const del = (key) => {
      delete nextPatch[key];
      delete nextExpected[key];
    };

    if (this._optimisticOscPresetIndex != null && presets.length) {
      const fid = fanEntityId || this._config.entity;
      const selId = resolvedOscillationSelectEntityId(this._hass, fid, this._config.oscillation_select_entity);
      const selectSt = selId ? this._hass?.states?.[selId] : null;
      const fromSel = oscillationDisplayFromSelect(selectSt, presets, realFan);
      const idx = fromSel != null ? fromSel.presetIndex : inferOscillationPresetIndex(realFan, presets);
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

    if (nextPatch.preset_mode !== undefined && nextExpected.preset_mode !== undefined) {
      const r = realFan.preset_mode;
      const exp = nextExpected.preset_mode;
      if (
        typeof r === "string" &&
        typeof exp === "string" &&
        r.toLowerCase().trim() === exp.toLowerCase().trim()
      ) {
        del("preset_mode");
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
        ok = targetHumidityMatchesExpected(humidityCombined, humExp);
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
      this._optimisticAttrs = null;
      this._optimisticExpected = null;
    } else {
      this._optimisticAttrs = nextPatch;
      this._optimisticExpected = nextExpected;
    }
    }
    this._maybeResyncOptimisticClearTimer();
  }

  _humidityStepperBounds(fanAttrs, climateAttrs, humidifierAttrs) {
    const step = this._config?.humidity_step;
    const options =
      typeof step === "number" && Number.isFinite(step) && step > 0 ? { humidityStepOverride: step } : undefined;
    return humidityStepperBounds(fanAttrs, climateAttrs, humidifierAttrs, options);
  }

  _applyOptimisticPatch(patch, meta = {}) {
    if (!patch || typeof patch !== "object") return;
    this._optimisticAttrs = { ...(this._optimisticAttrs || {}), ...patch };
    this._optimisticExpected = { ...(this._optimisticExpected || {}), ...patch };
    if (meta.oscPresetIndex != null) {
      this._optimisticOscPresetIndex = meta.oscPresetIndex;
    }
    this._bumpOptimisticClearTimer();
    this._updateDynamic();
  }

  _updateDynamic() {
    if (!this._rootEl || !this._hass) return;
    const { fanEntityId, climateEntityId, humidifierEntityId } = resolveEntityPair(
      this._hass,
      this._config.entity,
      this._config,
    );
    const st = fanEntityId ? entityState(this._hass, fanEntityId) : entityState(this._hass, this._config.entity);
    this._reconcileClimateHumidityAutoOptimistic(climateEntityId);
    this._reconcileOptimisticState(st, climateEntityId, humidifierEntityId, fanEntityId);
    const realFanAttrs = st?.attributes || {};
    const attrs = { ...realFanAttrs, ...(this._optimisticAttrs || {}) };
    const climateAttrsRaw = climateEntityId ? this._hass?.states?.[climateEntityId]?.attributes || {} : {};
    const climateAttrs =
      this._optimisticClimateHumidityAutoExpected != null && climateEntityId
        ? {
            ...climateAttrsRaw,
            humidity_auto: this._optimisticClimateHumidityAutoExpected ? "ON" : "OFF",
          }
        : climateAttrsRaw;
    const humidifierAttrs = humidifierEntityId ? this._hass?.states?.[humidifierEntityId]?.attributes || {} : {};
    const thermalAttrs = mergedThermalAttrs(attrs, climateAttrs);
    const humidifierStateExists = Boolean(humidifierEntityId && this._hass?.states?.[humidifierEntityId]);
    const humidifierMode = humidifierComboMode(
      this._config.entity,
      humidifierEntityId,
      humidifierStateExists,
      climateAttrs,
    );
    this._rootEl?.querySelector(".grid")?.classList.toggle("grid--combo-humid", humidifierMode);
    /* Same merge as humidity readout: primary entity (+ optimistic) last; avoids humidifier `is_on` masking climate `humidity_enabled: OFF`. */
    const mergedHumidity = humidifierMode ? mergedHumidityCardAttrs(attrs, climateAttrs, humidifierAttrs) : null;

    const tempEl = this._rootEl.querySelector('[data-part="temp"]');
    if (tempEl && this._config.show_temperature_header) {
      const txt = formatTargetTemperature(thermalAttrs, thermalAttrs.temperature_unit);
      tempEl.textContent = txt || "";
      tempEl.parentElement.hidden = !txt;
    }

    const aqHeader = this._rootEl.querySelector('[data-part="aq-header"]');
    if (aqHeader) {
      if (!this._config.show_air_quality_header) {
        aqHeader.hidden = true;
      } else {
        const oid = fanEntityObjectId(fanEntityId || this._config.entity);
        const aq = computeAirQualitySummary(this._hass, oid, realFanAttrs);
        if (!aq) {
          aqHeader.hidden = true;
        } else {
          const showCat = this._config.show_air_quality_category !== false;
          const showPoll = this._config.show_air_quality_pollutant !== false;
          const showBar = this._config.show_air_quality_bar !== false;
          const showAnyPart = showCat || showPoll || showBar;

          if (!showAnyPart) {
            aqHeader.hidden = true;
          } else {
            aqHeader.hidden = false;
            aqHeader.style.setProperty("--aq-accent", aq.accentHex);
            aqHeader.classList.toggle("aq--accent-subtitle", showPoll && !aq.subtitle.bullet);

            const titleRow = this._rootEl.querySelector('[data-part="aq-title-row"]');
            if (titleRow) titleRow.hidden = !showCat;

            const aqTitle = this._rootEl.querySelector('[data-part="aq-title"]');
            if (aqTitle) aqTitle.textContent = aq.title;

            const iconSlot = this._rootEl.querySelector('[data-part="aq-icon-slot"]');
            if (iconSlot) mountHaIcon(iconSlot, aq.icon, 26);

            const subWrap = this._rootEl.querySelector('[data-part="aq-subtitle-wrap"]');
            if (subWrap) subWrap.hidden = !showPoll;

            const bulletEl = this._rootEl.querySelector('[data-part="aq-bullet"]');
            const subEl = this._rootEl.querySelector('[data-part="aq-subtext"]');
            if (bulletEl) bulletEl.hidden = !aq.subtitle.bullet;
            if (subEl) subEl.textContent = aq.subtitle.text;

            const barTrack = this._rootEl.querySelector('[data-part="aq-bar-track"]');
            if (barTrack) barTrack.hidden = !showBar;

            const segs = this._rootEl.querySelectorAll("[data-aq-seg]");
            segs.forEach((el) => {
              const i = Number(el.getAttribute("data-aq-seg"));
              el.style.backgroundColor = aq.segmentHex[i] || "#555";
              el.classList.toggle("is-active", i === aq.levelIndex);
              el.classList.toggle("is-dim", i !== aq.levelIndex);
            });

            const thumb = this._rootEl.querySelector('[data-part="aq-thumb"]');
            if (thumb) {
              const pct = ((aq.levelIndex + 0.5) / 5) * 100;
              thumb.style.left = `${pct}%`;
            }
          }
        }
      }
    }

    const titleEl = this._rootEl.querySelector('[data-part="title"]');
    if (titleEl) {
      const title = typeof this._config.title === "string" ? this._config.title.trim() : "";
      titleEl.textContent = title;
      titleEl.style.textAlign = normalizeTitleAlignment(this._config.title_alignment);
      titleEl.hidden = !title;
    }

    const autoWord = this._rootEl.querySelector('[data-part="auto-word"]');
    const coolingCircle = this._rootEl.querySelector('[data-part="cooling-circle-icon"]');
    const humidifierPurifyAuto = this._rootEl.querySelector('[data-part="humidifier-purify-auto"]');
    const autoHumidifyIcon = this._rootEl.querySelector('[data-part="auto-humidify-icon"]');
    const coolingBtn = this._rootEl.querySelector('button[data-action="cooling"]');
    const autoModeBtn = this._rootEl.querySelector('button[data-action="auto_mode"]');
    if (coolingBtn) {
      coolingBtn.setAttribute("aria-label", humidifierMode ? "Auto purify" : "Cooling");
    }
    if (autoModeBtn) {
      autoModeBtn.setAttribute("aria-label", humidifierMode ? "Auto humidify" : "Auto mode");
    }
    if (humidifierMode) {
      if (coolingCircle) coolingCircle.hidden = true;
      if (humidifierPurifyAuto) humidifierPurifyAuto.hidden = false;
      if (autoWord) autoWord.hidden = true;
      if (autoHumidifyIcon) {
        autoHumidifyIcon.hidden = false;
        mountHaIcon(autoHumidifyIcon, "mdi:water", 28);
      }
    } else {
      if (coolingCircle) coolingCircle.hidden = false;
      if (humidifierPurifyAuto) humidifierPurifyAuto.hidden = true;
      if (autoWord) autoWord.hidden = false;
      if (autoHumidifyIcon) autoHumidifyIcon.hidden = true;
    }
    if (autoWord && !humidifierMode) {
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
      if (humidifierMode && mergedHumidity) {
        if (humiditySetpointIsAutoTarget(climateAttrs, humidifierAttrs)) {
          readout = "AUTO";
        } else {
          const { min: hMin, max: hMax, step: hStep } = this._humidityStepperBounds(
            realFanAttrs,
            climateAttrs,
            humidifierAttrs,
          );
          const stepSize = Math.max(1, hStep);
          const raw = inferTargetHumidity(mergedHumidity);
          const snapped =
            raw != null && Number.isFinite(Number(raw))
              ? snapTargetHumidityToStep(raw, hMin, hMax, stepSize)
              : null;
          readout =
            isHumidityEnabled(mergedHumidity) && snapped != null ? `${Math.round(snapped)}%` : "OFF";
        }
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
    const oscillationFanId = fanEntityId || this._config.entity;
    const oscSelectId = resolvedOscillationSelectEntityId(
      this._hass,
      oscillationFanId,
      this._config.oscillation_select_entity,
    );
    const oscSelectSt = oscSelectId ? this._hass?.states?.[oscSelectId] : null;
    const oscFromSelect = oscillationDisplayFromSelect(oscSelectSt, presets, realFanAttrs);

    const optOsc = this._optimisticAttrs;
    const oscOptimisticLabel =
      optOsc &&
      (optOsc.oscillation_span !== undefined || Object.hasOwn(optOsc, "oscillation_enabled"))
        ? !oscillationIsEnabled(optOsc)
          ? { label: "OFF", engaged: false }
          : {
              label: oscillationPresetLabel(Number(optOsc.oscillation_span) || 0),
              engaged: oscillationIsEnabled(optOsc),
            }
        : null;

    const oscMid = this._rootEl.querySelector('[data-part="osc-mid"]');
    if (oscMid) {
      if (oscFromSelect) {
        oscMid.textContent = oscFromSelect.label;
        oscMid.classList.toggle("muted", oscFromSelect.label === "OFF" || oscFromSelect.label === "—");
      } else if (oscOptimisticLabel) {
        oscMid.textContent = oscOptimisticLabel.label;
        oscMid.classList.toggle("muted", oscOptimisticLabel.label === "OFF" || oscOptimisticLabel.label === "—");
      } else {
        const oi = inferOscillationPresetIndex(attrs, presets);
        const deg = presets[oi] ?? 0;
        oscMid.textContent = oscillationPresetLabel(deg);
        oscMid.classList.toggle("muted", deg === 0);
      }
    }

    this._toggleEngaged('button[data-action="power"]', entityIsPowered(st, attrs));
    this._toggleEngaged(
      'button[data-action="cooling"]',
      humidifierMode ? humidifierPurifyControlEngaged(attrs, climateAttrs) : coolingDotActive(attrs),
    );
    this._toggleEngaged(
      'button[data-action="auto_mode"]',
      humidifierMode
        ? humidifierAutoHumidifyControlEngaged(attrs, climateAttrs, humidifierAttrs)
        : isAutoModeActive(attrs),
    );
    this._toggleEngaged('[data-stepper="airflow"]', isAirflowControlEngaged(st, attrs));
    this._toggleEngaged(
      '[data-stepper="thermal"]',
      humidifierMode && mergedHumidity ? isHumidityEnabled(mergedHumidity) : isHeatActive(attrs),
    );
    this._toggleEngaged(
      '[data-stepper="oscillation"]',
      oscFromSelect
        ? oscFromSelect.engaged
        : oscOptimisticLabel
          ? oscOptimisticLabel.engaged
          : oscillationIsEnabled(attrs),
    );
    this._toggleEngaged('button[data-action="night"]', isNightModeActive(attrs));
    this._toggleEngaged('button[data-action="direction"]', directionValue !== "forward");
  }

  /**
   * From AUTO target humidity, first − should leave auto and keep a concrete % (same services as Auto humidify toggle).
   */
  async _humidityStepperExitAutoFromMinus(hass, { attrs, climateEntityId, climateAttrs, humidifierEntityId, humidifierAttrs }) {
    if (!humiditySetpointIsAutoTarget(climateAttrs, humidifierAttrs)) return false;

    const merged = mergedHumidityCardAttrs(attrs, climateAttrs, humidifierAttrs);
    const { min, max, step } = this._humidityStepperBounds(attrs, climateAttrs, humidifierAttrs);
    const hRaw = inferTargetHumidity(merged);
    const hum = snapTargetHumidityToStep(hRaw, min, max, Math.max(1, step));

    let handled = false;
    let usedHumidifierModeForAuto = false;

    if (
      climateEntityId &&
      hass?.services?.climate?.set_humidity &&
      climateAttrs != null &&
      Object.prototype.hasOwnProperty.call(climateAttrs, "humidity_auto")
    ) {
      const supportsHumidityAutoField = climateSetHumiditySupportsHumidityAuto(hass);
      const humidityAutoSiblingId = resolvedHumidityAutoToggleEntityId(
        hass.states,
        climateEntityId,
        this._config.humidity_auto_entity,
      );
      try {
        if (supportsHumidityAutoField) {
          await hass.callService("climate", "set_humidity", {
            entity_id: climateEntityId,
            humidity: hum,
            humidity_auto: false,
          });
          this._optimisticClimateHumidityAutoExpected = false;
          this._bumpOptimisticClearTimer();
          handled = true;
        } else if (
          humidityAutoSiblingId &&
          (await toggleHumidityAutoViaSibling(hass, humidityAutoSiblingId, false))
        ) {
          this._optimisticClimateHumidityAutoExpected = false;
          this._bumpOptimisticClearTimer();
          handled = true;
        } else if (
          humidifierEntityId &&
          (await tryHumidifierAutoMode(hass, humidifierEntityId, false, humidifierAttrs))
        ) {
          usedHumidifierModeForAuto = true;
          this._optimisticClimateHumidityAutoExpected = false;
          this._bumpOptimisticClearTimer();
          handled = true;
        } else {
          await hass.callService("climate", "set_humidity", {
            entity_id: climateEntityId,
            humidity: hum,
          });
          this._optimisticClimateHumidityAutoExpected = false;
          this._bumpOptimisticClearTimer();
          handled = true;
        }
      } catch (err) {
        console.warn("Dyson Remote: exit humidity auto (−) failed", err);
        return false;
      }
      if (
        handled &&
        humidifierEntityId &&
        hass?.services?.humidifier?.set_humidity &&
        !usedHumidifierModeForAuto
      ) {
        try {
          await hass.callService("humidifier", "set_humidity", {
            entity_id: humidifierEntityId,
            humidity: hum,
          });
        } catch (e) {
          console.warn("Dyson Remote: humidifier.set_humidity after exit auto (−) failed", e);
        }
      }
    } else if (
      humidifierEntityId &&
      climateEntityId &&
      climateAttrs != null &&
      !Object.prototype.hasOwnProperty.call(climateAttrs, "humidity_auto") &&
      hass?.services?.humidifier?.set_mode
    ) {
      const autoNow =
        (typeof humidifierAttrs?.mode === "string" && humidifierAttrs.mode.toLowerCase().trim() === "auto") ||
        climateHumidityAutoOn(climateAttrs);
      if (autoNow && (await tryHumidifierAutoMode(hass, humidifierEntityId, false, humidifierAttrs))) {
        this._optimisticClimateHumidityAutoExpected = false;
        this._bumpOptimisticClearTimer();
        handled = true;
      }
    }

    if (handled) {
      this._applyOptimisticPatch({
        target_humidity: hum,
        humidity: hum,
        humidity_enabled: "ON",
      });
      this._updateDynamic();
    }
    return handled;
  }

  /** At minimum manual %, − turns humidify off (Off in the Dyson list). */
  async _humidityStepperDisable(hass, { climateEntityId, climateAttrs, humidifierEntityId, humidifierAttrs }) {
    this._applyOptimisticPatch({ humidity_enabled: "OFF" });
    let ok = false;
    if (humidifierEntityId && hass?.services?.humidifier?.set_mode) {
      const modes = humidifierAttrs?.available_modes;
      if (Array.isArray(modes)) {
        const offMode = modes.find((m) => typeof m === "string" && m.toLowerCase().trim() === "off");
        if (offMode) {
          try {
            await hass.callService("humidifier", "set_mode", {
              entity_id: humidifierEntityId,
              mode: offMode,
            });
            ok = true;
          } catch (e) {
            console.warn("Dyson Remote: humidifier.set_mode off (humidity −) failed", e);
          }
        }
      }
    }
    if (!ok && humidifierEntityId && hass?.services?.humidifier?.turn_off) {
      try {
        await hass.callService("humidifier", "turn_off", { entity_id: humidifierEntityId });
        ok = true;
      } catch (e) {
        console.warn("Dyson Remote: humidifier.turn_off (humidity −) failed", e);
      }
    }
    if (!ok && climateEntityId && hass?.services?.climate?.set_hvac_mode && Array.isArray(climateAttrs.hvac_modes)) {
      const norm = (m) => String(m).toLowerCase();
      const modes = climateAttrs.hvac_modes;
      const cm = typeof climateAttrs.hvac_mode === "string" ? climateAttrs.hvac_mode.toLowerCase() : "";
      if (cm === "humidify") {
        const fanOnly =
          modes.find((m) => norm(m) === "fan_only") ||
          modes.find((m) => norm(m) === "fan") ||
          modes.find((m) => norm(m) === "dry");
        if (fanOnly) {
          try {
            await hass.callService("climate", "set_hvac_mode", {
              entity_id: climateEntityId,
              hvac_mode: fanOnly,
            });
            ok = true;
          } catch (e) {
            console.warn("Dyson Remote: climate.set_hvac_mode away from humidify (humidity −) failed", e);
          }
        }
      }
    }
    this._updateDynamic();
    return ok;
  }

  async _onAction(action) {
    const hass = this._hass;
    const configuredEntityId = this._config.entity;
    if (!hass || !configuredEntityId) return;
    const { fanEntityId, climateEntityId, humidifierEntityId } = resolveEntityPair(hass, configuredEntityId, this._config);
    const entityId = fanEntityId || configuredEntityId;
    if (!entityId) return;

    const st = entityState(hass, entityId);
    const attrs = st?.attributes || {};
    const climateAttrs = climateEntityId ? hass?.states?.[climateEntityId]?.attributes || {} : {};
    const humidifierAttrs = humidifierEntityId ? hass?.states?.[humidifierEntityId]?.attributes || {} : {};
    const thermalAttrs = mergedThermalAttrs(attrs, climateAttrs);
    const humidifierStateExists = Boolean(humidifierEntityId && hass?.states?.[humidifierEntityId]);
    const humidifierMode = humidifierComboMode(
      configuredEntityId,
      humidifierEntityId,
      humidifierStateExists,
      climateAttrs,
    );
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
            await this._setCoolingMode(hass, domain, entityId, attrs, climateAttrs);
          } catch (err) {
            console.warn("Dyson Remote: cooling mode switch failed", err);
          }
          /* Combo "Auto purify": climate fan_only is not enough — engagement also requires fan Auto airflow. */
          if (humidifierMode) {
            const fanTargetId = effectiveFanEntityId(hass, fanEntityId, climateEntityId, configuredEntityId);
            if (fanTargetId) {
              const fanDomain = fanTargetId.split(".")[0] || "fan";
              const fanSt = entityState(hass, fanTargetId);
              const fam = fanSt?.attributes || {};
              const pm = normalizePresetModes(fam.preset_modes);
              const autoName = pm.find((m) => m.toLowerCase() === "auto");
              const svc = hass?.services?.[fanDomain];
              if (autoName && svc?.set_preset_mode) {
                this._applyOptimisticPatch({ preset_mode: autoName, auto_mode: true });
                try {
                  await hass.callService(fanDomain, "set_preset_mode", { entity_id: fanTargetId, preset_mode: autoName });
                } catch (err) {
                  console.warn("Dyson Remote: Auto purify fan Auto preset failed", err);
                }
              } else if (svc?.turn_on && Object.hasOwn(svc.turn_on.fields || {}, "auto_mode")) {
                this._applyOptimisticPatch({ auto_mode: true });
                try {
                  await hass.callService(fanDomain, "turn_on", { entity_id: fanTargetId, auto_mode: true });
                } catch (err) {
                  console.warn("Dyson Remote: Auto purify fan.turn_on auto_mode failed", err);
                }
              }
            }
          }
          /* Humidifier+purifier climate entities often have no target temperature — skip ambient sync. */
          if (!humidifierMode) {
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
          }
          break;
        }
        case "auto_mode": {
          await hass.callService(domain, "turn_on", { entity_id: entityId });
          let humidifierAutoHandled = false;
          if (
            humidifierMode &&
            climateEntityId &&
            hass?.services?.climate?.set_hvac_mode &&
            Array.isArray(climateAttrs.hvac_modes)
          ) {
            const norm = (m) => String(m).toLowerCase();
            const modes = climateAttrs.hvac_modes;
            const humidifyMode = modes.find((m) => norm(m) === "humidify");
            if (humidifyMode) {
              const cm = typeof climateAttrs.hvac_mode === "string" ? climateAttrs.hvac_mode.toLowerCase() : "";
              const fanOnly =
                modes.find((m) => norm(m) === "fan_only") ||
                modes.find((m) => norm(m) === "fan") ||
                modes.find((m) => norm(m) === "dry");
              try {
                if (cm === "humidify" && fanOnly) {
                  await hass.callService("climate", "set_hvac_mode", {
                    entity_id: climateEntityId,
                    hvac_mode: fanOnly,
                  });
                } else {
                  await hass.callService("climate", "set_hvac_mode", {
                    entity_id: climateEntityId,
                    hvac_mode: humidifyMode,
                  });
                }
                humidifierAutoHandled = true;
              } catch (err) {
                console.warn("Dyson Remote: Auto humidify hvac_mode failed", err);
              }
            }
          }
          if (
            !humidifierAutoHandled &&
            humidifierMode &&
            climateEntityId &&
            hass?.services?.climate?.set_humidity &&
            climateAttrs != null &&
            Object.prototype.hasOwnProperty.call(climateAttrs, "humidity_auto")
          ) {
            const merged = mergedHumidityCardAttrs(attrs, climateAttrs, humidifierAttrs);
            const hRaw = inferTargetHumidity(merged);
            const { min: lo, max: hi, step: humStep } = humidityRangeIntersect([attrs, climateAttrs, humidifierAttrs]);
            const hum = snapTargetHumidityToStep(hRaw ?? (lo + hi) / 2, lo, hi, humStep);
            const autoNow = climateHumidityAutoOn(climateAttrs);
            const wantAuto = !autoNow;
            const supportsHumidityAutoField = climateSetHumiditySupportsHumidityAuto(hass);
            const humidityAutoSiblingId = resolvedHumidityAutoToggleEntityId(
              hass.states,
              climateEntityId,
              this._config.humidity_auto_entity,
            );
            let usedHumidifierModeForAuto = false;
            try {
              if (supportsHumidityAutoField) {
                await hass.callService("climate", "set_humidity", {
                  entity_id: climateEntityId,
                  humidity: hum,
                  humidity_auto: wantAuto,
                });
                this._optimisticClimateHumidityAutoExpected = wantAuto;
                this._bumpOptimisticClearTimer();
                this._updateDynamic();
                humidifierAutoHandled = true;
              } else if (
                humidityAutoSiblingId &&
                (await toggleHumidityAutoViaSibling(hass, humidityAutoSiblingId, wantAuto))
              ) {
                this._optimisticClimateHumidityAutoExpected = wantAuto;
                this._bumpOptimisticClearTimer();
                this._updateDynamic();
                humidifierAutoHandled = true;
              } else if (
                humidifierEntityId &&
                (await tryHumidifierAutoMode(hass, humidifierEntityId, wantAuto, humidifierAttrs))
              ) {
                usedHumidifierModeForAuto = true;
                this._optimisticClimateHumidityAutoExpected = wantAuto;
                this._bumpOptimisticClearTimer();
                this._updateDynamic();
                humidifierAutoHandled = true;
              } else {
                await hass.callService("climate", "set_humidity", {
                  entity_id: climateEntityId,
                  humidity: hum,
                });
                console.warn(
                  "Dyson Remote: Auto humidify cannot toggle humidity_auto (climate.set_humidity has no humidity_auto field; no select/switch found; humidifier.set_mode unavailable). Set optional humidity_auto_entity in the card config.",
                );
                humidifierAutoHandled = true;
              }
            } catch (err) {
              console.warn("Dyson Remote: climate.set_humidity humidity_auto toggle failed", err);
            }
            if (
              humidifierAutoHandled &&
              humidifierEntityId &&
              hass?.services?.humidifier?.set_humidity &&
              !usedHumidifierModeForAuto
            ) {
              try {
                await hass.callService("humidifier", "set_humidity", {
                  entity_id: humidifierEntityId,
                  humidity: hum,
                });
              } catch (e) {
                console.warn("Dyson Remote: humidifier.set_humidity (paired auto humidify) failed", e);
              }
            }
          }
          if (
            !humidifierAutoHandled &&
            humidifierMode &&
            humidifierEntityId &&
            climateEntityId &&
            climateAttrs != null &&
            !Object.prototype.hasOwnProperty.call(climateAttrs, "humidity_auto") &&
            hass?.services?.humidifier?.set_mode
          ) {
            const autoNow =
              (typeof humidifierAttrs?.mode === "string" && humidifierAttrs.mode.toLowerCase().trim() === "auto") ||
              climateHumidityAutoOn(climateAttrs);
            const wantAuto = !autoNow;
            if (await tryHumidifierAutoMode(hass, humidifierEntityId, wantAuto, humidifierAttrs)) {
              this._optimisticClimateHumidityAutoExpected = wantAuto;
              this._bumpOptimisticClearTimer();
              this._updateDynamic();
              humidifierAutoHandled = true;
            }
          }
          if (humidifierAutoHandled) break;
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
          const airflowFanId = effectiveFanEntityId(hass, fanEntityId, climateEntityId, configuredEntityId);
          const speedSt = airflowFanId ? entityState(hass, airflowFanId) : st;
          const speedAttrs = speedSt?.attributes || attrs;
          const base =
            typeof speedAttrs.percentage === "number" && Number.isFinite(speedAttrs.percentage)
              ? speedAttrs.percentage
              : typeof attrs.percentage === "number" && Number.isFinite(attrs.percentage)
                ? attrs.percentage
                : 40;
          const manual = normalizePresetModes(speedAttrs.preset_modes).find((m) => m.toLowerCase() === "manual");
          const nextPct = adjustFanPercentage(base, dir, speedAttrs, 100);
          const patch = {
            percentage: nextPct,
            auto_mode: false,
          };
          if (isAutoModeActive(speedAttrs) && manual) {
            patch.preset_mode = manual;
          }
          const svcId = airflowFanId || entityId;
          const svcDomain = svcId.split(".")[0] || "fan";
          if (!hass?.services?.[svcDomain]?.set_percentage) {
            console.warn(
              "Dyson Remote: cannot change airflow — no fan.set_percentage for",
              svcId,
              "(use a fan.* entity or ensure the integration exposes percentage on this entity)",
            );
            break;
          }
          this._applyOptimisticPatch(patch);
          await hass.callService(svcDomain, "turn_on", { entity_id: svcId });
          if (isAutoModeActive(speedAttrs)) {
            if (manual) {
              await hass.callService(svcDomain, "set_preset_mode", { entity_id: svcId, preset_mode: manual });
            }
            await hass.callService(svcDomain, "set_percentage", { entity_id: svcId, percentage: nextPct });
          } else {
            await hass.callService(svcDomain, "set_percentage", { entity_id: svcId, percentage: nextPct });
          }
          break;
        }
        case "heat_minus":
        case "heat_plus": {
          if (humidifierMode) {
            const sourceAttrs = mergedHumidityCardAttrs(attrs, climateAttrs, humidifierAttrs);
            if (action === "heat_minus") {
              const exited = await this._humidityStepperExitAutoFromMinus(hass, {
                attrs,
                climateEntityId,
                climateAttrs,
                humidifierEntityId,
                humidifierAttrs,
              });
              if (exited) break;
            }
            const { min, max, step } = this._humidityStepperBounds(attrs, climateAttrs, humidifierAttrs);
            const stepSize = Math.max(1, step);
            const dir = action === "heat_minus" ? -1 : 1;
            const baseRaw = inferTargetHumidity(sourceAttrs);
            const baseSnapped = snapTargetHumidityToStep(baseRaw, min, max, stepSize);
            if (action === "heat_minus" && isHumidityEnabled(sourceAttrs) && baseSnapped <= min) {
              await this._humidityStepperDisable(hass, {
                climateEntityId,
                climateAttrs,
                humidifierEntityId,
                humidifierAttrs,
              });
              break;
            }
            const next = adjustTargetHumidityByStep(baseSnapped, dir, min, max, stepSize);
            const patch = {
              target_humidity: next,
              humidity: next,
            };
            if (!isHumidityEnabled(sourceAttrs)) {
              patch.humidity_enabled = "ON";
            }
            this._applyOptimisticPatch(patch);
            if (domain === "fan") {
              await hass.callService(domain, "turn_on", { entity_id: entityId });
            } else if (domain === "humidifier") {
              await hass.callService("humidifier", "turn_on", { entity_id: entityId });
            } else if (domain === "climate" && hass?.services?.climate?.turn_on) {
              try {
                await hass.callService("climate", "turn_on", { entity_id: entityId });
              } catch (err) {
                console.warn("Dyson Remote: climate.turn_on before humidity step failed", err);
              }
            }
            const humidityNumberId = resolvedHumidityTargetNumberEntityId(
              hass.states,
              climateEntityId,
              humidifierEntityId,
              this._config.humidity_target_entity,
            );
            const humidityCalls = buildHumiditySetpointServiceCalls(hass, {
              next,
              climateEntityId,
              humidifierEntityId,
              configuredEntityId: entityId,
              humidityNumberId,
              humidityWrite: this._config.humidity_write,
            });
            const humidityTargetSent = await executeHumiditySetpointCalls(hass, humidityCalls);
            if (!humidityTargetSent) {
              console.warn(
                "Dyson Remote: No humidity target service available for",
                entityId,
                "(tried humidifier / climate / number.set_value per humidity_write)",
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
          const oscSelId = resolvedOscillationSelectEntityId(hass, entityId, this._config.oscillation_select_entity);
          const oscSelSt = oscSelId ? hass.states[oscSelId] : null;
          const oscFromSelect = oscillationDisplayFromSelect(oscSelSt, presets, attrs);
          const idx =
            oscFromSelect != null ? oscFromSelect.presetIndex : inferOscillationPresetIndex(attrs, presets);
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
  static _schemaFor(data) {
    return buildDysonRemoteCardEditorSchema(data);
  }

  setConfig(config) {
    this._config = {
      entity: "",
      title: "",
      title_alignment: "left",
      oscillation_select_entity: "",
      climate_entity: "",
      humidity_auto_entity: "",
      humidifier_entity: "",
      humidity_target_entity: "",
      humidity_write: "auto",
      show_temperature_header: true,
      show_air_quality_header: false,
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
    const normalized = persistAirSubsectionKeys({ ...(config || {}) });
    delete normalized.advanced_dyson_entities;
    const trimmedTitle = typeof normalized.title === "string" ? normalized.title.trim() : "";
    if (trimmedTitle) normalized.title = trimmedTitle;
    else delete normalized.title;
    normalized.title_alignment = normalizeTitleAlignment(normalized.title_alignment);
    const trimmedOscSel =
      typeof normalized.oscillation_select_entity === "string" ? normalized.oscillation_select_entity.trim() : "";
    if (trimmedOscSel) normalized.oscillation_select_entity = trimmedOscSel;
    else delete normalized.oscillation_select_entity;
    const trimmedClimate =
      typeof normalized.climate_entity === "string" ? normalized.climate_entity.trim() : "";
    if (trimmedClimate) normalized.climate_entity = trimmedClimate;
    else delete normalized.climate_entity;
    const trimmedHumAuto =
      typeof normalized.humidity_auto_entity === "string" ? normalized.humidity_auto_entity.trim() : "";
    if (trimmedHumAuto) normalized.humidity_auto_entity = trimmedHumAuto;
    else delete normalized.humidity_auto_entity;
    const trimmedHumidifier =
      typeof normalized.humidifier_entity === "string" ? normalized.humidifier_entity.trim() : "";
    if (trimmedHumidifier) normalized.humidifier_entity = trimmedHumidifier;
    else delete normalized.humidifier_entity;
    const trimmedHumTarget =
      typeof normalized.humidity_target_entity === "string" ? normalized.humidity_target_entity.trim() : "";
    if (trimmedHumTarget) normalized.humidity_target_entity = trimmedHumTarget;
    else delete normalized.humidity_target_entity;
    const trimmedHumWrite =
      typeof normalized.humidity_write === "string" ? normalized.humidity_write.trim().toLowerCase() : "";
    if (trimmedHumWrite === "humidifier" || trimmedHumWrite === "climate") {
      normalized.humidity_write = trimmedHumWrite;
    } else if (trimmedHumWrite === "auto") {
      normalized.humidity_write = "auto";
    } else {
      delete normalized.humidity_write;
    }
    if (
      normalized.humidity_step === "" ||
      normalized.humidity_step === undefined ||
      normalized.humidity_step === null ||
      (typeof normalized.humidity_step === "string" && !String(normalized.humidity_step).trim())
    ) {
      delete normalized.humidity_step;
    }
    this._config = { ...normalized };
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
        .field select {
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
        .aq-sub-opts[hidden] {
          display: none !important;
        }
      </style>
      <div class="wrap">
        <div class="field">
          <label for="titleInput">Title</label>
          <input id="titleInput" type="text" placeholder="Living Room" />
        </div>
        <div class="field">
          <label for="titleAlignmentInput">Title alignment</label>
          <select id="titleAlignmentInput">
            <option value="left">Left</option>
            <option value="center">Center</option>
            <option value="right">Right</option>
          </select>
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
              <input id="showAirQualityHeaderInput" type="checkbox" />
              Show air quality header
            </label>
            <div class="aq-sub-opts" data-part="aq-sub-opts">
              <label>
                <input id="showAirQualityCategoryInput" type="checkbox" />
                Show category
              </label>
              <label>
                <input id="showAirQualityPollutantInput" type="checkbox" />
                Show pollutant
              </label>
              <label>
                <input id="showAirQualityBarInput" type="checkbox" />
                Show air quality bar
              </label>
            </div>
            <div class="hint">Waiting for Home Assistant form components...</div>
          </div>
        `}
      </div>
    `;

    const titleInput = this.shadowRoot.getElementById("titleInput");
    const titleAlignmentInput = this.shadowRoot.getElementById("titleAlignmentInput");
    titleInput.value = this._config.title || "";
    titleAlignmentInput.value = normalizeTitleAlignment(this._config.title_alignment);
    const emitWithTitle = (next) =>
      this._emitConfig({
        ...next,
        title: titleInput.value,
        title_alignment: normalizeTitleAlignment(titleAlignmentInput.value),
      });
    titleInput.addEventListener("change", () => emitWithTitle(this._config));
    titleAlignmentInput.addEventListener("change", () => emitWithTitle(this._config));

    if (hasForm) {
      const form = this.shadowRoot.getElementById("form");
      form.hass = this._hass;
      form.data = {
        entity: this._config.entity || "",
        oscillation_select_entity: this._config.oscillation_select_entity || "",
        climate_entity: this._config.climate_entity || "",
        humidity_auto_entity: this._config.humidity_auto_entity || "",
        humidifier_entity: this._config.humidifier_entity || "",
        humidity_target_entity: this._config.humidity_target_entity || "",
        show_temperature_header: this._config.show_temperature_header !== false,
        show_air_quality_header: this._config.show_air_quality_header === true,
        ...airSubsectionFormValues(this._config),
      };
      form.schema = DysonRemoteCardEditor._schemaFor(form.data);
      form.computeLabel = (schema) => {
        if (schema.type === "expandable" && typeof schema.title === "string") return schema.title;
        if (schema.name === "entity") return "Entity";
        if (schema.name === "oscillation_select_entity") return "Oscillation select";
        if (schema.name === "climate_entity") return "Paired climate (optional)";
        if (schema.name === "humidity_auto_entity") return "Humidity auto entity (optional)";
        if (schema.name === "humidifier_entity") return "Paired humidifier (optional)";
        if (schema.name === "humidity_target_entity") return "Humidity target number (optional)";
        if (schema.name === "show_temperature_header") return "Show temperature header";
        if (schema.name === "show_air_quality_header") return "Show air quality header";
        if (schema.name === "show_air_quality_category") return "Show category";
        if (schema.name === "show_air_quality_pollutant") return "Show pollutant";
        if (schema.name === "show_air_quality_bar") return "Show air quality bar";
        return schema.name;
      };
      form.computeHelper = (schema) => {
        if (schema.type === "expandable") {
          return "Only if automatic entity matching fails for your integration.";
        }
        if (schema.name === "oscillation_select_entity") {
          return "Optional.";
        }
        if (schema.name === "climate_entity") {
          return "When fan and climate entity ids differ (e.g. some Dyson humidifiers), set the humidifier climate entity here.";
        }
        if (schema.name === "humidity_auto_entity") {
          return "If Auto humidify does nothing, pick the select or switch that toggles auto target humidity for this device (when climate.set_humidity has no humidity_auto field).";
        }
        if (schema.name === "humidifier_entity") {
          return "When the fan entity id does not match humidifier.* on the device, set the real humidifier entity here.";
        }
        if (schema.name === "humidity_target_entity") {
          return "If +/- does nothing, pick the number entity that sets target humidity (some integrations use this instead of climate).";
        }
        return undefined;
      };
      form.addEventListener("value-changed", (ev) => {
        const raw = form.data != null ? form.data : ev.detail?.value;
        const merged = mergeConfigWithFormAirSubsections(this._config, raw);
        form.schema = DysonRemoteCardEditor._schemaFor(merged);
        emitWithTitle(merged);
      });
    } else {
      const entityInput = this.shadowRoot.getElementById("entityInput");
      const showTemperatureHeaderInput = this.shadowRoot.getElementById("showTemperatureHeaderInput");
      const showAirQualityHeaderInput = this.shadowRoot.getElementById("showAirQualityHeaderInput");
      const showAirQualityCategoryInput = this.shadowRoot.getElementById("showAirQualityCategoryInput");
      const showAirQualityPollutantInput = this.shadowRoot.getElementById("showAirQualityPollutantInput");
      const showAirQualityBarInput = this.shadowRoot.getElementById("showAirQualityBarInput");
      const aqSubOpts = this.shadowRoot.querySelector('[data-part="aq-sub-opts"]');
      entityInput.value = this._config.entity || "";
      showTemperatureHeaderInput.checked = Boolean(this._config.show_temperature_header);
      showAirQualityHeaderInput.checked = Boolean(this._config.show_air_quality_header);
      const subVals = airSubsectionFormValues(this._config);
      showAirQualityCategoryInput.checked = subVals.show_air_quality_category;
      showAirQualityPollutantInput.checked = subVals.show_air_quality_pollutant;
      showAirQualityBarInput.checked = subVals.show_air_quality_bar;
      const syncAqSubVisibility = () => {
        if (aqSubOpts) aqSubOpts.hidden = !showAirQualityHeaderInput.checked;
      };
      syncAqSubVisibility();
      const emit = () => {
        emitWithTitle({
          ...this._config,
          entity: entityInput.value.trim(),
          show_temperature_header: Boolean(showTemperatureHeaderInput.checked),
          show_air_quality_header: Boolean(showAirQualityHeaderInput.checked),
          show_air_quality_category: Boolean(showAirQualityCategoryInput.checked),
          show_air_quality_pollutant: Boolean(showAirQualityPollutantInput.checked),
          show_air_quality_bar: Boolean(showAirQualityBarInput.checked),
        });
      };
      entityInput.addEventListener("change", emit);
      showTemperatureHeaderInput.addEventListener("change", emit);
      showAirQualityHeaderInput.addEventListener("change", () => {
        syncAqSubVisibility();
        emit();
      });
      showAirQualityCategoryInput.addEventListener("change", emit);
      showAirQualityPollutantInput.addEventListener("change", emit);
      showAirQualityBarInput.addEventListener("change", emit);
    }
  }
}

if (!customElements.get("dyson-remote-card-editor")) {
  customElements.define("dyson-remote-card-editor", DysonRemoteCardEditor);
}
