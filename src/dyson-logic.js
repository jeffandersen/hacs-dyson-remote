/**
 * Pure helpers for Dyson-style fan entities (attributes vary by integration).
 */

export function normalizePresetModes(presetModes) {
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

export function findHeatPresetName(presetModes) {
  const modes = normalizePresetModes(presetModes);
  const exact = modes.find((m) => m.toLowerCase() === "heat");
  if (exact) return exact;
  return modes.find((m) => /\bheat\b/i.test(m)) || null;
}

export function isAutoModeActive(attrs) {
  if (!attrs) return false;
  if (attrs.auto_mode === true) return true;
  const pm = attrs.preset_mode;
  return typeof pm === "string" && pm.toLowerCase() === "auto";
}

export function isHeatActive(attrs) {
  if (!attrs) return false;
  const hm = attrs.heating_mode;
  if (typeof hm === "string" && hm.toUpperCase() === "ON") return true;
  if (attrs.heating_enabled === true) return true;
  const heatName = findHeatPresetName(attrs.preset_modes);
  if (heatName && attrs.preset_mode === heatName) return true;
  return false;
}

export function coolingDotActive(attrs) {
  return !isHeatActive(attrs);
}

export function airflowCenterLabel(attrs) {
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

export const DEFAULT_OSCILLATION_PRESETS = [0, 45, 90, 180, 350];

export function normalizeOscillationPresets(list) {
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

export function oscillationPresetLabel(degrees) {
  if (!degrees) return "OFF";
  return `${degrees}°`;
}

/**
 * Normalizes fan/select oscillation state (booleans, strings, span, HA fan.oscillating).
 */
export function oscillationIsEnabled(attrs) {
  if (!attrs || typeof attrs !== "object") return false;
  if (attrs.oscillating === false) return false;
  if (attrs.oscillating === true) return true;

  const v = attrs.oscillation_enabled;
  if (v === false || v === 0) return false;
  if (v === true || v === 1) return true;
  if (typeof v === "string") {
    const s = v.toLowerCase().trim();
    if (s === "false" || s === "off" || s === "0") return false;
    if (s === "true" || s === "on" || s === "1") return true;
  }

  const span = Number(attrs.oscillation_span);
  if (Number.isFinite(span) && span > 0) return true;
  if (Number.isFinite(span) && span <= 0) return false;

  const al = typeof attrs.angle_low === "number" ? attrs.angle_low : attrs.oscillation_angle_low;
  const ah = typeof attrs.angle_high === "number" ? attrs.angle_high : attrs.oscillation_angle_high;
  if (typeof al === "number" && typeof ah === "number" && Number.isFinite(al) && Number.isFinite(ah)) {
    if (Math.abs(ah - al) > 1) return true;
  }

  return false;
}

export function inferOscillationPresetIndex(attrs, presets) {
  if (!presets || !presets.length) return 0;
  if (!oscillationIsEnabled(attrs)) return 0;
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
  return 0;
}

export function oscillationSelectLooksLikePreset(selectState) {
  const a = selectState?.attributes;
  if (!a || typeof a !== "object") return false;
  if (
    Object.hasOwn(a, "oscillation_enabled") ||
    Object.hasOwn(a, "oscillation_span") ||
    Object.hasOwn(a, "oscillation_mode")
  ) {
    return true;
  }
  const opts = a.options;
  if (!Array.isArray(opts)) return false;
  return opts.some(
    (o) =>
      typeof o === "string" &&
      ((/\d/.test(o) && /°|deg(ree)?s?\b/i.test(o)) || /breeze|custom/i.test(o)),
  );
}

/** Prefer select oscillation keys when present; otherwise fall back to fan (partial select attrs in editor/preview). */
export function oscillationMergeForEnabled(selectAttrs, fanAttrs) {
  const s = selectAttrs && typeof selectAttrs === "object" ? selectAttrs : {};
  const f = fanAttrs && typeof fanAttrs === "object" ? fanAttrs : {};
  const out = {};
  if (Object.hasOwn(s, "oscillating")) out.oscillating = s.oscillating;
  else if (Object.hasOwn(f, "oscillating")) out.oscillating = f.oscillating;

  if (Object.hasOwn(s, "oscillation_enabled")) out.oscillation_enabled = s.oscillation_enabled;
  else if (Object.hasOwn(f, "oscillation_enabled")) out.oscillation_enabled = f.oscillation_enabled;

  if (Object.hasOwn(s, "oscillation_span")) out.oscillation_span = s.oscillation_span;
  else if (Object.hasOwn(f, "oscillation_span")) out.oscillation_span = f.oscillation_span;

  const alS = s.oscillation_angle_low;
  const ahS = s.oscillation_angle_high;
  if (typeof alS === "number" && Number.isFinite(alS)) out.oscillation_angle_low = alS;
  else if (typeof f.angle_low === "number" && Number.isFinite(f.angle_low)) out.angle_low = f.angle_low;
  else if (typeof f.oscillation_angle_low === "number" && Number.isFinite(f.oscillation_angle_low)) {
    out.oscillation_angle_low = f.oscillation_angle_low;
  }

  if (typeof ahS === "number" && Number.isFinite(ahS)) out.oscillation_angle_high = ahS;
  else if (typeof f.angle_high === "number" && Number.isFinite(f.angle_high)) out.angle_high = f.angle_high;
  else if (typeof f.oscillation_angle_high === "number" && Number.isFinite(f.oscillation_angle_high)) {
    out.oscillation_angle_high = f.oscillation_angle_high;
  }

  if (Object.hasOwn(s, "oscillation_angle")) out.oscillation_angle = s.oscillation_angle;
  else if (Object.hasOwn(f, "oscillation_angle")) out.oscillation_angle = f.oscillation_angle;

  return out;
}

export function nextOscillationIndex(currentIndex, direction, len) {
  const n = Math.max(1, len);
  let i = currentIndex + (direction < 0 ? -1 : 1);
  if (i < 0) i = n - 1;
  if (i >= n) i = 0;
  return i;
}

/**
 * libdyson `select.*_oscillation` carries `oscillation_enabled` / `oscillation_mode` that track
 * the physical device and Dyson app; `fan` attributes are often wrong or delayed.
 * When the select only has `options` + state (no oscillation_* keys yet), we still treat it as the
 * oscillation control if options look like angle presets, and merge fan attrs to decide enabled.
 * Returns null if this does not look like an oscillation select (use fan attrs only).
 */
export function oscillationDisplayFromSelect(selectState, presets, fanAttrs = null) {
  if (!selectState || !presets?.length) return null;
  const a = selectState.attributes || {};
  if (!oscillationSelectLooksLikePreset(selectState)) return null;

  const merged = oscillationMergeForEnabled(a, fanAttrs);
  if (!oscillationIsEnabled(merged)) {
    return { label: "OFF", engaged: false, presetIndex: 0 };
  }

  const attrsForInfer = () => ({
    oscillation_enabled: true,
    oscillation_span: a.oscillation_span,
    oscillation_angle: a.oscillation_angle,
    angle_low: typeof a.oscillation_angle_low === "number" ? a.oscillation_angle_low : undefined,
    angle_high: typeof a.oscillation_angle_high === "number" ? a.oscillation_angle_high : undefined,
  });

  const modeStr =
    typeof a.oscillation_mode === "string"
      ? a.oscillation_mode
      : typeof selectState.state === "string"
        ? selectState.state
        : "";

  const engaged = oscillationIsEnabled(merged);

  const parsedDeg = parseInt(String(modeStr).replace(/[^\d]/g, ""), 10);
  if (Number.isFinite(parsedDeg) && presets.includes(parsedDeg)) {
    const idx = presets.indexOf(parsedDeg);
    return { label: oscillationPresetLabel(parsedDeg), engaged, presetIndex: idx };
  }

  if (/custom|breeze/i.test(String(modeStr))) {
    const oi = inferOscillationPresetIndex(attrsForInfer(), presets);
    const deg = presets[oi] ?? 0;
    return {
      label: deg === 0 ? String(modeStr) : oscillationPresetLabel(deg),
      engaged,
      presetIndex: oi,
    };
  }

  if (modeStr) {
    const oi = inferOscillationPresetIndex({ ...attrsForInfer(), oscillation_enabled: true }, presets);
    return { label: modeStr, engaged, presetIndex: oi };
  }

  const oi = inferOscillationPresetIndex({ ...attrsForInfer(), oscillation_enabled: true }, presets);
  const deg = presets[oi] ?? 0;
  return { label: oscillationPresetLabel(deg), engaged, presetIndex: oi };
}

export function formatTargetTemperature(attrs, temperatureUnit) {
  if (!attrs || typeof attrs.target_temperature !== "number" || !Number.isFinite(attrs.target_temperature)) {
    return null;
  }
  if (attrs.target_temperature <= -200) return null;
  const u = typeof temperatureUnit === "string" && temperatureUnit.trim() ? temperatureUnit.trim() : "°C";
  return `${Math.round(attrs.target_temperature)}${u === "°C" || u === "°F" ? u : ` ${u}`}`;
}

export function ambientTemperature(attrs) {
  const t = attrs?.current_temperature;
  if (typeof t !== "number" || !Number.isFinite(t) || t <= -200) return null;
  return t;
}

export function temperatureStepAndBounds(attrs) {
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

export function snapTemperatureToStep(value, min, max, step) {
  const s = step > 0 ? step : 1;
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  const clamped = Math.min(hi, Math.max(lo, value));
  const k = Math.round((clamped - lo) / s);
  const snapped = lo + k * s;
  const rounded = Math.round(snapped * 1000) / 1000;
  return Math.min(hi, Math.max(lo, rounded));
}

export function adjustTargetTemperature(current, direction, attrs) {
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

export function heatingTargetReadout(attrs) {
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

export function adjustFanPercentage(current, direction, attrs, max = 100) {
  const cap = typeof max === "number" && max > 0 ? max : 100;
  const base = typeof current === "number" && Number.isFinite(current) ? current : 0;
  const curLevel = fanLevelFromPercentage(base, cap);
  const nextLevel = Math.min(10, Math.max(0, curLevel + (direction < 0 ? -1 : 1)));
  return percentageFromFanLevel(nextLevel, cap);
}

export function fanLevelFromPercentage(percentage, max = 100) {
  const cap = typeof max === "number" && max > 0 ? max : 100;
  if (typeof percentage !== "number" || !Number.isFinite(percentage)) return 0;
  const clamped = Math.min(cap, Math.max(0, percentage));
  if (clamped <= 0) return 0;
  return Math.min(10, Math.max(1, Math.round((clamped / cap) * 10)));
}

export function percentageFromFanLevel(level, max = 100) {
  const cap = typeof max === "number" && max > 0 ? max : 100;
  const lv = Math.min(10, Math.max(0, Number(level) || 0));
  if (lv <= 0) return 0;
  return Math.round((lv / 10) * cap);
}

export function nextManualFanPercentage(current, step, max) {
  const s = typeof step === "number" && step > 0 ? step : 10;
  const cap = typeof max === "number" && max > 0 ? max : 100;
  const base = typeof current === "number" && Number.isFinite(current) ? current : 0;
  const next = base >= cap ? s : Math.min(cap, base + s);
  return next;
}

export function entityIsPowered(st, attrs) {
  if (attrs && typeof attrs.is_on === "boolean") return attrs.is_on;
  const s = st?.state;
  if (typeof s !== "string" || !s.trim()) return false;
  return s !== "off" && s !== "unavailable";
}

export function isNightModeActive(attrs) {
  return attrs?.night_mode === true;
}

export function isAirflowControlEngaged(st, attrs) {
  if (!entityIsPowered(st, attrs)) return false;
  if (isAutoModeActive(attrs)) return true;
  const pct = attrs.percentage;
  if (typeof pct === "number" && pct > 0) return true;
  const fs = attrs.fan_state;
  if (typeof fs === "string" && fs.toUpperCase() === "ON") return true;
  return false;
}
