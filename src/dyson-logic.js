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
  if (typeof pm === "string" && pm.toLowerCase() === "auto") return true;
  const fss = attrs.fan_speed_setting;
  if (typeof fss === "string" && /^\s*auto\s*$/i.test(fss)) return true;
  return false;
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

/** True for common HA / Dyson-style on values (string ON, boolean true, etc.). */
function climateAttrBooleanOn(val) {
  if (val === true) return true;
  if (val === false || val == null) return false;
  if (typeof val === "string") {
    const u = val.toUpperCase().trim();
    return u === "ON" || u === "TRUE" || u === "YES" || u === "1";
  }
  return false;
}

/**
 * libdyson / Dyson Gen1-style `climate.*`: `humidity_auto` (e.g. ON) vs `hvac_mode: humidify` only.
 */
export function climateHumidityAutoOn(climateAttrs) {
  return climateAttrBooleanOn(climateAttrs?.humidity_auto);
}

/** True when the device is targeting humidity automatically (climate `humidity_auto` or humidifier `mode: auto`). */
export function humiditySetpointIsAutoTarget(climateAttrs, humidifierAttrs) {
  if (climateHumidityAutoOn(climateAttrs)) return true;
  const hm = typeof humidifierAttrs?.mode === "string" ? humidifierAttrs.mode.toLowerCase().trim() : "";
  return hm === "auto";
}

/**
 * True when target humidity is driven by the climate entity (Dyson humidifier climates expose
 * `humidity_auto` and/or `target_humidity_formatted`). The stepper should call `climate.set_humidity`
 * first even if a `humidifier.*` entity exists, or writes may no-op while the app still updates climate.
 */
export function climateHasDysonStyleHumidityTarget(climateAttrs) {
  const a = climateAttrs || {};
  if (Object.prototype.hasOwnProperty.call(a, "humidity_auto")) return true;
  if (typeof a.target_humidity_formatted === "string") return true;
  return false;
}

export function objectIdFromEntityId(entityId) {
  if (typeof entityId !== "string" || !entityId.includes(".")) return "";
  return entityId.slice(entityId.indexOf(".") + 1);
}

/**
 * `humidifier.*` ids to try when pairing a fan card with a different `climate.*` (Dyson device serial is usually on climate/humidifier, not a renamed fan).
 * Climate object id is tried first, then the fan.
 */
export function orderedHumidifierEntityCandidates(fanEntityId, climateEntityId) {
  const ids = [];
  const seen = new Set();
  const pushBase = (base) => {
    const oid = objectIdFromEntityId(base);
    if (!oid) return;
    const id = `humidifier.${oid}`;
    if (!seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  };
  pushBase(climateEntityId);
  pushBase(fanEntityId);
  return ids;
}

/**
 * @param {Record<string, unknown>|null|undefined} states - `hass.states`
 */
export function resolveHumidifierEntityId(states, fanEntityId, climateEntityId, humidifierEntityOverride) {
  const trimmed = typeof humidifierEntityOverride === "string" ? humidifierEntityOverride.trim() : "";
  if (trimmed.startsWith("humidifier.") && states?.[trimmed]) return trimmed;
  for (const id of orderedHumidifierEntityCandidates(fanEntityId, climateEntityId)) {
    if (states?.[id]) return id;
  }
  return null;
}

/** Optional `number.*` target humidity (some integrations expose this instead of acting on climate.set_humidity). */
export function resolvedHumidityTargetNumberEntityId(
  states,
  climateEntityId,
  humidifierEntityId,
  humidityTargetEntityTrimmed,
) {
  const manual = typeof humidityTargetEntityTrimmed === "string" ? humidityTargetEntityTrimmed.trim() : "";
  if (manual && states?.[manual]) {
    const dom = manual.split(".")[0];
    if (dom === "number") return manual;
  }
  const oids = [];
  for (const eid of [climateEntityId, humidifierEntityId]) {
    const oid = objectIdFromEntityId(eid);
    if (oid && !oids.includes(oid)) oids.push(oid);
  }
  for (const oid of oids) {
    const cands = [`number.${oid}_target_humidity`, `number.${oid}_humidifier_target`];
    for (const id of cands) {
      if (states?.[id]) return id;
    }
  }
  for (const oid of oids) {
    for (const id of Object.keys(states || {})) {
      if (!id.startsWith("number.")) continue;
      if (!id.includes(oid)) continue;
      const lo = id.toLowerCase();
      if (!lo.includes("humidity")) continue;
      if (lo.includes("target") || lo.includes("setpoint")) return id;
    }
  }
  return null;
}

/**
 * Bounds for humidity +/- and `climate.set_humidity` clamping.
 *
 * **Maximum:** `min(max_humidity)` so a stricter climate cap (e.g. 50) still wins over a humidifier (70).
 * **Minimum:** `min(min_humidity)` so a humidifier that allows 30% is not blocked by a climate entity that
 * wrongly advertises 50% as its floor (Dyson-style targets are often 30–70 plus Off / Auto).
 *
 * **Step:** largest positive `target_humidity_step` / `humidity_step` among attrs so 10% increments win over 1.
 */
export function humidityRangeIntersect(attrObjects) {
  const list = Array.isArray(attrObjects) ? attrObjects.filter((a) => a && typeof a === "object") : [];
  const mins = [];
  const maxs = [];
  const steps = [];
  for (const a of list) {
    if (typeof a.min_humidity === "number" && Number.isFinite(a.min_humidity)) mins.push(a.min_humidity);
    if (typeof a.max_humidity === "number" && Number.isFinite(a.max_humidity)) maxs.push(a.max_humidity);
    const st = a.target_humidity_step ?? a.humidity_step;
    if (typeof st === "number" && Number.isFinite(st) && st > 0) steps.push(st);
  }
  const minRaw = mins.length ? Math.min(...mins) : 30;
  const maxRaw = maxs.length ? Math.min(...maxs) : 70;
  const stepRaw = steps.length ? Math.max(...steps) : 1;
  const lo = Math.min(minRaw, maxRaw);
  const hi = Math.max(minRaw, maxRaw);
  return { min: lo, max: hi, step: Math.max(1, stepRaw) };
}

/**
 * Stepper bounds for humidity +/−. When a humidifier entity exists with an explicit
 * writable range, its min/max take priority — the climate entity's range may be narrower
 * (display-only or device-level clamping) and would incorrectly cap the stepper.
 *
 * Step size: the humidifier entity's step is checked first, then an inference from its
 * range. Dyson devices typically only accept multiples of 10 (30,40,50,60,70) but HA
 * may report `target_humidity_step: 1` on the climate entity. When the humidifier range
 * divides cleanly by 10 and the span is short (≤100 / step gives ≤10 positions), use 10;
 * same for 5. This avoids sending unsupported values that can crash device firmware.
 */
/**
 * @param {Record<string, unknown> | null | undefined} fanAttrs
 * @param {Record<string, unknown> | null | undefined} climateAttrs
 * @param {Record<string, unknown> | null | undefined} humidifierAttrs
 * @param {{ humidityStepOverride?: number } | null | undefined} [options]
 */
export function humidityStepperBounds(fanAttrs, climateAttrs, humidifierAttrs, options) {
  const all = [fanAttrs, climateAttrs, humidifierAttrs].filter(Boolean);
  const { min: iMin, max: iMax, step: intersectedStep } = humidityRangeIntersect(all);
  const override = options?.humidityStepOverride;
  const applyOverride = (step) => {
    if (typeof override === "number" && Number.isFinite(override) && override > 0) {
      return Math.max(1, Math.round(override));
    }
    return step;
  };
  const h = humidifierAttrs || {};
  if (typeof h.min_humidity === "number" && typeof h.max_humidity === "number") {
    const lo = Math.min(h.min_humidity, h.max_humidity);
    const hi = Math.max(h.min_humidity, h.max_humidity);
    const step = applyOverride(inferHumidifierStep(h, lo, hi, intersectedStep));
    return { min: lo, max: hi, step };
  }
  return { min: iMin, max: iMax, step: applyOverride(intersectedStep) };
}

/**
 * Pick the best step for the humidifier entity. Prefers an explicit attribute, then
 * infers from the range (Dyson humidifiers use multiples of 10 but HA may not expose
 * a step attribute on the humidifier entity).
 */
function inferHumidifierStep(humidifierAttrs, min, max, fallbackStep) {
  const explicit = humidifierAttrs.target_humidity_step ?? humidifierAttrs.humidity_step;
  if (typeof explicit === "number" && Number.isFinite(explicit) && explicit > 0) {
    return Math.max(1, explicit);
  }
  const span = max - min;
  if (span > 0) {
    for (const candidate of [10, 5]) {
      if (span % candidate === 0 && span / candidate <= 10) return candidate;
    }
  }
  return Math.max(1, fallbackStep);
}

/** Snap a target % to the device's humidity step grid (from `min`, usually 30 with step 10). */
export function snapTargetHumidityToStep(value, min, max, step) {
  const s = Math.max(1, Number(step) || 1);
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  if (value == null || !Number.isFinite(Number(value))) return lo;
  const v = Math.round(Number(value));
  const k = Math.round((v - lo) / s);
  const snapped = lo + k * s;
  return Math.max(lo, Math.min(hi, snapped));
}

/** One +/- step on the humidity grid after values are snapped. */
export function adjustTargetHumidityByStep(snapped, dir, min, max, step) {
  const s = Math.max(1, Number(step) || 1);
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  const delta = dir > 0 ? s : -s;
  const next = snapped + delta;
  return Math.max(lo, Math.min(hi, next));
}

/** Map humidifier `available_modes` to the mode string for auto vs manual target humidity (hass-dyson: normal / auto). */
export function pickHumidifierModeForAutoToggle(availableModes, wantAuto) {
  if (!Array.isArray(availableModes) || !availableModes.length) return null;
  const strs = availableModes.filter((m) => typeof m === "string" && m.trim());
  if (!strs.length) return null;
  if (wantAuto) {
    const exact = strs.find((m) => m.toLowerCase().trim() === "auto");
    if (exact) return exact;
    return strs.find((m) => /\bauto\b/i.test(m)) || null;
  }
  const norm = strs.find((m) => /^(normal|manual)$/i.test(m.trim()));
  if (norm) return norm;
  return strs.find((m) => m.toLowerCase().trim() !== "auto") || null;
}

/** Pick a `select` option string for auto vs manual humidity (sibling entity when `climate.set_humidity` has no `humidity_auto`). */
export function pickSelectOptionHumidityAuto(options, wantAutoOn) {
  if (!Array.isArray(options) || !options.length) return null;
  for (const o of options) {
    if (typeof o !== "string") continue;
    const u = o.toUpperCase().trim();
    if (wantAutoOn) {
      if (u === "ON" || u === "TRUE" || u === "YES" || u === "1" || u === "AUTO" || u === "AUTOMATIC") return o;
    } else if (u === "OFF" || u === "FALSE" || u === "NO" || u === "0" || u === "MANUAL") {
      return o;
    }
  }
  if (wantAutoOn) {
    const hit = options.find((o) => typeof o === "string" && /\b(auto|automatic)\b/i.test(o));
    return hit || null;
  }
  const hit = options.find((o) => typeof o === "string" && /\b(manual|off)\b/i.test(o));
  return hit || null;
}

/**
 * `select.*` / `switch.*` that mirrors climate `humidity_auto` when the set_humidity service has no toggle field.
 *
 * @param {Record<string, unknown>|null|undefined} states - `hass.states`
 * @param {string|null|undefined} humidityAutoEntityTrimmed - optional configured entity id
 */
/**
 * hass-dyson (cmgrayb) exposes night mode as `switch.*_night_mode` on the device; `fan.turn_on` does not apply it.
 * Optional `night_mode_entity` in card config overrides discovery.
 *
 * @param {Record<string, unknown>|null|undefined} states - `hass.states`
 * @param {Record<string, { device_id?: string }>|null|undefined} entities - `hass.entities` (registry)
 * @param {string} deviceId - device registry id from `hass.entities[fan].device_id`
 */
export function resolvedNightModeSwitchEntityId(
  states,
  entities,
  deviceId,
  fanEntityId,
  climateEntityId,
  overrideTrimmed,
) {
  const manual = typeof overrideTrimmed === "string" ? overrideTrimmed.trim() : "";
  if (manual && manual.startsWith("switch.") && states?.[manual]) return manual;

  for (const base of [fanEntityId, climateEntityId]) {
    const oid = objectIdFromEntityId(base);
    if (!oid) continue;
    const id = `switch.${oid}_night_mode`;
    if (states?.[id]) return id;
  }

  if (entities && typeof entities === "object" && deviceId) {
    for (const entityId of Object.keys(entities)) {
      if (!entityId.startsWith("switch.") || !states?.[entityId]) continue;
      const entry = entities[entityId];
      if (!entry || entry.device_id !== deviceId) continue;
      if (entityId.toLowerCase().includes("night_mode")) return entityId;
    }
    for (const entityId of Object.keys(entities)) {
      if (!entityId.startsWith("switch.") || !states?.[entityId]) continue;
      const entry = entities[entityId];
      if (!entry || entry.device_id !== deviceId) continue;
      const fn = states[entityId]?.attributes?.friendly_name;
      if (typeof fn === "string" && /\bnight\b/i.test(fn) && /\bmode\b/i.test(fn)) return entityId;
    }
  }

  return null;
}

export function resolvedHumidityAutoToggleEntityId(states, climateEntityId, humidityAutoEntityTrimmed) {
  const manual = typeof humidityAutoEntityTrimmed === "string" ? humidityAutoEntityTrimmed.trim() : "";
  if (manual && states?.[manual]) {
    const dom = manual.split(".")[0];
    if (dom === "select" || dom === "switch") return manual;
  }
  if (!climateEntityId || !states) return null;
  const oid = objectIdFromEntityId(climateEntityId);
  if (!oid) return null;
  const candidates = [
    `select.${oid}_humidity_auto`,
    `select.${oid}_auto_humidity`,
    `switch.${oid}_humidity_auto`,
  ];
  for (const id of candidates) {
    if (states[id]) return id;
  }
  for (const id of Object.keys(states)) {
    if (!id.startsWith("select.")) continue;
    if (!id.includes(oid)) continue;
    const lower = id.toLowerCase();
    if (lower.includes("humidity") && lower.includes("auto")) return id;
  }
  return null;
}

/**
 * Humidifier / target humidity considered active (fan, climate, or humidifier attributes).
 * Dyson often uses `humidity_enabled: HUMD` instead of ON.
 */
export function isHumidityEnabled(attrs) {
  const a = attrs || {};
  if (typeof a.humidity_enabled === "string") {
    const u = a.humidity_enabled.toUpperCase().trim();
    if (u === "ON" || u === "HUMD" || u === "HUMIDIFY") return true;
    return false;
  }
  if (typeof a.humidity_enabled === "boolean") return a.humidity_enabled;
  if (typeof a.is_on === "boolean") return a.is_on;
  return false;
}

/**
 * Target % for humidifier UI. Prefers numeric `target_humidity`, then Dyson `target_humidity_formatted`
 * (e.g. "0070"), then `humidity` as last resort (may be current reading on some entities).
 */
export function inferTargetHumidity(attrs) {
  const a = attrs || {};
  if (typeof a.target_humidity === "number" && Number.isFinite(a.target_humidity)) {
    return a.target_humidity;
  }
  const formatted = a.target_humidity_formatted;
  if (typeof formatted === "string") {
    const digits = formatted.replace(/\D/g, "");
    if (digits.length) {
      const n = parseInt(digits, 10);
      if (Number.isFinite(n)) {
        if (n > 100) return Math.min(100, Math.round(n / 100));
        return Math.min(100, n);
      }
    }
  }
  if (typeof a.humidity === "number" && Number.isFinite(a.humidity)) {
    return a.humidity;
  }
  return null;
}

/**
 * True when merged entity attributes indicate the setpoint has caught up to `expected` (rounded).
 * Used to clear optimistic UI after `set_humidity`.
 *
 * Dyson-style entities often expose both `target_humidity` (setpoint) and `humidity` (current
 * reading). If we treated any field matching `expected` as success, ambient `humidity` could
 * equal the new setpoint while `target_humidity` was still stale — reconcile would drop the
 * overlay and `inferTargetHumidity` would keep showing the old target (UI bounce).
 *
 * So: when numeric `target_humidity` is present, only that and `target_humidity_formatted` can
 * satisfy a match; raw `humidity` is ignored unless there is no numeric target (setpoint may live
 * only in `humidity` on some entities).
 */
export function targetHumidityMatchesExpected(attrs, expected) {
  if (typeof expected !== "number" || !Number.isFinite(expected)) return false;
  const want = Math.round(expected);
  const a = attrs || {};
  const hasNumericTarget = typeof a.target_humidity === "number" && Number.isFinite(a.target_humidity);
  if (hasNumericTarget && Math.round(a.target_humidity) === want) return true;
  const formatted = a.target_humidity_formatted;
  if (typeof formatted === "string") {
    const digits = formatted.replace(/\D/g, "");
    if (digits.length) {
      const n = parseInt(digits, 10);
      if (Number.isFinite(n)) {
        const parsed = n > 100 ? Math.min(100, Math.round(n / 100)) : Math.min(100, n);
        if (parsed === want) return true;
      }
    }
  }
  if (!hasNumericTarget && typeof a.humidity === "number" && Number.isFinite(a.humidity)) {
    return Math.round(a.humidity) === want;
  }
  return false;
}

/**
 * When the device is a humidifier/purifier combo, "Auto purify" follows `climate.hvac_mode`
 * (hass-dyson: humidify vs fan_only). In fan-only / purify climate mode, the dot also tracks
 * **fan** auto airflow so a manual speed readout is not paired with a lit purify dot.
 * Dyson `humidity_auto` does not turn this off: it only means auto target humidity; purify
 * can still be fan_only with auto airflow while that flag is on.
 */
export function humidifierPurifyControlEngaged(fanAttrs, climateAttrs) {
  const cm =
    typeof climateAttrs?.hvac_mode === "string" ? climateAttrs.hvac_mode.toLowerCase().trim() : "";
  if (cm === "humidify") return false;
  if (cm === "fan_only" || cm === "fan" || cm === "dry") {
    return isAutoModeActive(fanAttrs);
  }
  if (cm === "off") return false;
  return coolingDotActive(fanAttrs);
}

/**
 * "Auto humidify" engaged when the paired climate is in humidify mode or Dyson `humidity_auto`;
 * the paired `humidifier.*` is in `auto` mode (hass-dyson); otherwise fan Auto preset.
 */
export function humidifierAutoHumidifyControlEngaged(fanAttrs, climateAttrs, humidifierAttrs) {
  const hm = typeof humidifierAttrs?.mode === "string" ? humidifierAttrs.mode.toLowerCase().trim() : "";
  if (hm === "auto") return true;
  if (climateHumidityAutoOn(climateAttrs)) return true;
  const cm =
    typeof climateAttrs?.hvac_mode === "string" ? climateAttrs.hvac_mode.toLowerCase().trim() : "";
  if (cm === "humidify") return true;
  if (cm === "fan_only" || cm === "fan" || cm === "dry") return false;
  return isAutoModeActive(fanAttrs);
}

/**
 * Humidifier **combo mode** (humidity stepper, Auto purify / Auto humidify, climate humidify actions).
 * True only if at least one of:
 * 1. Configured entity is `humidifier.*`
 * 2. `resolveEntityPair` resolved a `humidifier.*` id and it exists in `hass.states`
 * 3. Paired `climate.*` lists `humidify` in `hvac_modes`
 * 4. Paired `climate.*` has libdyson-style `humidity_auto` or `humidity_enabled` HUMD / HUMIDIFY
 *
 * Not true for ordinary fans that only expose humidity / target_humidity attributes.
 *
 * @param {string|null|undefined} configuredEntityId - Lovelace entity id
 * @param {string|null|undefined} humidifierEntityId - e.g. from `humidifier.<same_object_id>`
 * @param {boolean} humidifierStateExists - `hass.states[humidifierEntityId]` is present
 * @param {object} [climateAttrs] - paired climate attributes
 */
export function humidifierComboMode(
  configuredEntityId,
  humidifierEntityId,
  humidifierStateExists,
  climateAttrs,
) {
  if (typeof configuredEntityId === "string" && configuredEntityId.startsWith("humidifier.")) return true;
  if (typeof humidifierEntityId === "string" && humidifierEntityId && humidifierStateExists) return true;
  const modes = climateAttrs?.hvac_modes;
  if (Array.isArray(modes) && modes.some((m) => String(m).toLowerCase() === "humidify")) return true;
  const he = climateAttrs?.humidity_enabled;
  if (typeof he === "string") {
    const u = he.toUpperCase().trim();
    if (u === "HUMD" || u === "HUMIDIFY") return true;
  }
  if (climateAttrs != null && Object.prototype.hasOwnProperty.call(climateAttrs, "humidity_auto")) {
    return true;
  }
  return false;
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

  // oscillation_span: 0 is ground-truth that sweep is disabled, regardless of what
  // oscillation_enabled / oscillating report. The device remembers the last angle
  // (mode attr may still show it) but physically the sweep is off.
  // See CLAUDE.md: "Returns false when oscillation_span is explicitly 0 — even if
  // oscillation_mode / select state still shows a remembered angle."
  const span = Number(attrs.oscillation_span);
  if (Number.isFinite(span) && span === 0) return false;

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

  if (Number.isFinite(span) && span > 0) return true;

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

  // When the select entity has an explicit oscillation_enabled attribute it is the
  // authoritative enabled signal (e.g. hass-dyson humidifiers). In that case skip
  // oscillation_span entirely — humidifiers always report span=0 even while sweeping,
  // so including it would cause oscillationIsEnabled to incorrectly return false.
  if (!Object.hasOwn(s, "oscillation_enabled")) {
    if (Object.hasOwn(s, "oscillation_span")) out.oscillation_span = s.oscillation_span;
    else if (Object.hasOwn(f, "oscillation_span")) out.oscillation_span = f.oscillation_span;
  }

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

/**
 * Some integrations expose `night_mode` as booleans; others use strings (e.g. ON/OFF).
 * Never use `Boolean(string)` for reconciliation — `Boolean("OFF")` is true in JavaScript.
 */
export function normalizeNightModeValue(v) {
  if (v === true || v === 1) return true;
  if (v === false || v == null || v === 0 || v === "") return false;
  if (typeof v === "string") {
    const s = v.trim().toUpperCase();
    if (s === "OFF" || s === "FALSE" || s === "0" || s === "NO") return false;
    if (s === "ON" || s === "TRUE" || s === "1" || s === "YES") return true;
    return false;
  }
  return false;
}

export function isNightModeActive(attrs) {
  return normalizeNightModeValue(attrs?.night_mode);
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
