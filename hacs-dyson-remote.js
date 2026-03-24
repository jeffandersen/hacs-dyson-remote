/**
 * Dyson-style air quality: five-step scale (green → yellow → orange → red → purple).
 * Prefers libdyson `sensor.*_air_quality_index` + `category` / `dominant_pollutants` when present.
 */

const AQ_LEVEL_COUNT = 5;

/** Segment fills: Good → Fair → Poor → Very poor → Severe (Dyson-style). */
const AQ_SEGMENT_HEX = ["#22C55E", "#EAB308", "#F97316", "#EF4444", "#A855F7"];

/** Title / icon / thumb accent per level. */
const AQ_ACCENT_HEX = ["#4ADE80", "#FACC15", "#FB923C", "#F87171", "#C084FC"];

const AQ_LEVEL_META = [
  /** Outline variants so the glyph is single-color (filled MDI circles use a fixed light “knockout”). */
  { key: "good", label: "Good", icon: "mdi:check-circle-outline" },
  { key: "fair", label: "Fair", icon: "mdi:minus-circle-outline" },
  { key: "poor", label: "Poor", icon: "mdi:alert-circle-outline" },
  { key: "very_poor", label: "Very poor", icon: "mdi:alert-circle-outline" },
  { key: "severe", label: "Severe", icon: "mdi:alert-octagon-outline" },
];

const POLLUTANT_LABEL = {
  pm25: "PM2.5",
  pm10: "PM10",
  voc: "VOC",
  no2: "NO₂",
  hcho: "HCHO",
  aqi: "Air quality",
};

/** Prefer this order when two pollutants tie on level (first = wins tie). */
const POLLUTANT_PRIORITY = ["pm25", "pm10", "voc", "no2", "hcho", "aqi"];

function priorityRank(kind) {
  const i = POLLUTANT_PRIORITY.indexOf(kind);
  return i < 0 ? 99 : i;
}

function classifyPollutant(entityId, friendlyName, deviceClass) {
  const lu = (entityId || "").toLowerCase();
  const fn = (friendlyName || "").toLowerCase();
  const dc = (deviceClass || "").toString().toLowerCase();
  if (dc === "pm25" || lu.includes("pm25") || lu.includes("pm_2_5") || lu.includes("pm2.5")) return "pm25";
  if (dc === "pm10" || lu.includes("pm10") || lu.includes("pm_10")) return "pm10";
  if (lu.includes("voc") || fn.includes("volatile organic")) return "voc";
  if (lu.includes("no2") || fn.includes("nitrogen dioxide")) return "no2";
  if (lu.includes("hcho") || lu.includes("formaldehyde") || fn.includes("hcho")) return "hcho";
  if (dc === "aqi" || (lu.includes("aqi") && !lu.includes("voc") && !lu.includes("no2"))) return "aqi";
  return null;
}

/** libdyson exposes overall status on `sensor.<device>_air_quality_index` — use this, not raw index as PM. */
function isDysonAirQualityIndexSensor(entityId, attrs) {
  const lu = (entityId || "").toLowerCase();
  if (lu.includes("air_quality_index")) return true;
  const fn = (attrs?.friendly_name || "").toLowerCase();
  return attrs?.device_class === "aqi" && fn.includes("air quality") && fn.includes("index");
}

/**
 * Map Dyson `category` attribute (and similar strings) to level 0..4.
 */
function dysonCategoryToLevel(raw) {
  if (raw == null || raw === "") return null;
  const s = String(raw).trim().toLowerCase();
  if (!s || s === "unknown" || s === "unavailable") return null;
  if (/^good|excellent|green/.test(s)) return 0;
  if (/^fair|^moderate|yellow/.test(s)) return 1;
  if (/very\s*poor|very\s*bad|very\s*high/.test(s)) return 3;
  if (/^poor|bad|orange/.test(s)) return 2;
  if (/severe|extreme|hazardous|purple/.test(s)) return 4;
  if (/^red|critical/.test(s)) return 3;
  return null;
}

function levelFromDysonAirQualityIndexSensor(entityId, state, attrs, hass, deviceObjectId) {
  let cat = dysonCategoryToLevel(attrs?.category);
  if (cat == null && hass?.states && deviceObjectId) {
    const dp = hass.states[`sensor.${deviceObjectId}_dominant_pollutant`];
    cat = dysonCategoryToLevel(dp?.attributes?.category);
  }
  if (cat != null) return cat;
  const stLvl = stringStateToLevel(state);
  if (stLvl != null) return stLvl;
  // Do not map numeric `state` here: Dyson index numbers are not the same scale as PM/VOC buckets
  // and often disagree with `category` (e.g. state 7 + category Good).
  return null;
}

function numericLevelForKind(kind, value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (kind === "pm25") {
    if (value <= 12) return 0;
    if (value <= 35) return 1;
    if (value <= 55) return 2;
    if (value <= 150) return 3;
    return 4;
  }
  if (kind === "pm10") {
    if (value <= 25) return 0;
    if (value <= 50) return 1;
    if (value <= 100) return 2;
    if (value <= 200) return 3;
    return 4;
  }
  if (kind === "voc" || kind === "no2") {
    const v = Math.round(value);
    if (v <= 2) return 0;
    if (v <= 4) return 1;
    if (v <= 6) return 2;
    if (v <= 8) return 3;
    return 4;
  }
  if (kind === "aqi") {
    const v = Math.round(value);
    if (v <= 2) return 0;
    if (v <= 4) return 1;
    if (v <= 6) return 2;
    if (v <= 8) return 3;
    return 4;
  }
  if (kind === "hcho") {
    if (value <= 0.02) return 0;
    if (value <= 0.05) return 1;
    if (value <= 0.1) return 2;
    if (value <= 0.2) return 3;
    return 4;
  }
  return null;
}

function stringStateToLevel(stateStr) {
  if (typeof stateStr !== "string") return null;
  const s = stateStr.trim().toLowerCase();
  if (!s || s === "unknown" || s === "unavailable") return null;
  return dysonCategoryToLevel(s);
}

function parseNumericState(state) {
  if (typeof state === "number" && Number.isFinite(state)) return state;
  if (typeof state === "string" && state.trim() !== "" && state !== "unknown" && state !== "unavailable") {
    const n = Number.parseFloat(state);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function formatPollutantDisplay(raw) {
  if (raw == null) return null;
  if (Array.isArray(raw)) {
    for (const item of raw) {
      const f = formatPollutantDisplay(item);
      if (f) return f;
    }
    return null;
  }
  const s = String(raw).trim();
  if (!s) return null;
  const compact = s.toUpperCase().replace(/\s+/g, "");
  if (compact === "VOC" || s.toLowerCase().includes("volatile")) return "VOC";
  if (compact === "NO2" || s.includes("NO₂") || s.toLowerCase().includes("nitrogen")) return "NO₂";
  if (/pm\s*2\.?5|pm25/i.test(s)) return "PM2.5";
  if (/pm\s*10|pm10/i.test(s)) return "PM10";
  if (/hcho|formaldehyde/i.test(s)) return "HCHO";
  return s;
}

function dominantPollutantLabel(hass, deviceObjectId, aqiAttrs) {
  const fromAqi =
    aqiAttrs?.dominant_pollutants ?? aqiAttrs?.dominant_pollutant ?? aqiAttrs?.dominant_pollutants_list;
  let formatted = formatPollutantDisplay(fromAqi);
  if (formatted) return formatted;
  if (hass?.states && deviceObjectId) {
    const sid = `sensor.${deviceObjectId}_dominant_pollutant`;
    const st = hass.states[sid];
    if (st) {
      formatted = formatPollutantDisplay(st.state);
      if (formatted) return formatted;
      formatted = formatPollutantDisplay(st.attributes?.dominant_pollutant ?? st.attributes?.pollutant);
      if (formatted) return formatted;
    }
  }
  return null;
}

function resolveDysonAirQualityIndex(hass, deviceObjectId) {
  if (!deviceObjectId || !hass?.states) return null;
  let bestId = null;
  let bestSt = null;
  for (const [eid, st] of Object.entries(hass.states)) {
    if (!eid.startsWith("sensor.")) continue;
    if (!eid.includes(deviceObjectId)) continue;
    if (!isDysonAirQualityIndexSensor(eid, st.attributes)) continue;
    if (eid.toLowerCase().includes("air_quality_index")) {
      bestId = eid;
      bestSt = st;
      break;
    }
    if (!bestId) {
      bestId = eid;
      bestSt = st;
    }
  }
  if (!bestId || !bestSt) return null;
  const level = levelFromDysonAirQualityIndexSensor(bestId, bestSt.state, bestSt.attributes, hass, deviceObjectId);
  if (level == null) return null;
  const pollutantLabel = dominantPollutantLabel(hass, deviceObjectId, bestSt.attributes);
  return { levelIndex: level, pollutantLabel, sourceEntityId: bestId };
}

function fanAttributeReadings(attrs) {
  const a = attrs || {};
  const out = [];
  const tryPush = (kind, value) => {
    const n = parseNumericState(value);
    if (n == null) return;
    const lvl = numericLevelForKind(kind, n);
    if (lvl == null) return;
    out.push({ kind, value: n, level: lvl, source: "fan" });
  };
  tryPush("pm25", a.particulate_matter_2_5 ?? a.pm25);
  tryPush("pm10", a.particulate_matter_10 ?? a.pm10);
  tryPush("voc", a.volatile_organic_compounds ?? a.volatile_organic_compounds_index ?? a.voc_index);
  tryPush("no2", a.nitrogen_dioxide ?? a.nitrogen_dioxide_index ?? a.no2);
  tryPush("hcho", a.formaldehyde ?? a.hcho);
  const aqiCat = dysonCategoryToLevel(a.air_quality_category ?? a.category);
  if (aqiCat != null) {
    out.push({ kind: "aqi", value: 0, level: aqiCat, source: "fan" });
  } else {
    tryPush("aqi", a.air_quality_index ?? a.aqi);
  }
  return out;
}

function sensorReadingsForDevice(hass, deviceObjectId) {
  const out = [];
  if (!deviceObjectId || !hass?.states) return out;
  for (const [eid, st] of Object.entries(hass.states)) {
    if (!eid.startsWith("sensor.")) continue;
    if (!eid.includes(deviceObjectId)) continue;
    if (isDysonAirQualityIndexSensor(eid, st.attributes)) continue;
    const kind = classifyPollutant(eid, st.attributes?.friendly_name, st.attributes?.device_class);
    if (!kind) continue;
    const strLvl = stringStateToLevel(st.state);
    const num = parseNumericState(st.state);
    let level;
    if (strLvl != null) level = strLvl;
    else if (num != null) level = numericLevelForKind(kind, num);
    else continue;
    out.push({ kind, value: num ?? 0, level, source: "sensor", entityId: eid });
  }
  return out;
}

function pickDominant(readings) {
  if (!readings.length) return null;
  let best = readings[0];
  for (let i = 1; i < readings.length; i++) {
    const r = readings[i];
    if (r.level > best.level) best = r;
    else if (r.level === best.level && priorityRank(r.kind) < priorityRank(best.kind)) best = r;
  }
  return best;
}

function mergeReadingsByKind(readings) {
  const map = new Map();
  for (const r of readings) {
    const prev = map.get(r.kind);
    if (!prev || r.level > prev.level) map.set(r.kind, r);
    else if (r.level === prev.level && priorityRank(r.kind) < priorityRank(prev.kind)) map.set(r.kind, r);
  }
  return [...map.values()];
}

function isGasPollutantName(name) {
  return /voc|no₂|no2|hcho|formaldehyde|nitrogen|organic/i.test(name || "");
}

function buildSubtitle(pollutantDisplayName, kindForLabel, levelIndex) {
  const name =
    pollutantDisplayName || (kindForLabel ? POLLUTANT_LABEL[kindForLabel] || kindForLabel : null) || "Air quality";
  if (levelIndex <= 1) {
    return { bullet: true, text: name };
  }
  const suffix = isGasPollutantName(name) ? "rising" : "elevated";
  return { bullet: false, text: `${name} ${suffix}` };
}

/**
 * @param {object|null} hass Home Assistant hass object
 * @param {string} deviceObjectId e.g. dyson_zz7_ca_mja1790a (no domain)
 * @param {object} fanAttrs merged fan attributes
 * @returns {null | { levelIndex: number, title: string, icon: string, accentHex: string, subtitle: { bullet: boolean, text: string }, segmentHex: string[] }}
 */
function computeAirQualitySummary(hass, deviceObjectId, fanAttrs) {
  const dyson = resolveDysonAirQualityIndex(hass, deviceObjectId);
  if (dyson) {
    const levelIndex = Math.min(AQ_LEVEL_COUNT - 1, Math.max(0, dyson.levelIndex));
    const meta = AQ_LEVEL_META[levelIndex];
    const subtitle = buildSubtitle(dyson.pollutantLabel, null, levelIndex);
    return {
      levelIndex,
      title: meta.label,
      icon: meta.icon,
      accentHex: AQ_ACCENT_HEX[levelIndex],
      subtitle,
      segmentHex: [...AQ_SEGMENT_HEX],
    };
  }

  const fromFan = fanAttributeReadings(fanAttrs);
  const fromSensors = sensorReadingsForDevice(hass, deviceObjectId);
  const readings = mergeReadingsByKind([...fromFan, ...fromSensors]);
  if (!readings.length) return null;

  const dominant = pickDominant(readings);
  const maxLevel = Math.max(...readings.map((r) => r.level));
  const levelIndex = Math.min(AQ_LEVEL_COUNT - 1, Math.max(0, maxLevel));
  const meta = AQ_LEVEL_META[levelIndex];
  const pollutantGuess = dominantPollutantLabel(hass, deviceObjectId, {});
  const subtitle = buildSubtitle(pollutantGuess, dominant.kind, levelIndex);

  return {
    levelIndex,
    title: meta.label,
    icon: meta.icon,
    accentHex: AQ_ACCENT_HEX[levelIndex],
    subtitle,
    segmentHex: [...AQ_SEGMENT_HEX],
  };
}

/**
 * Home Assistant `ha-form` schema for the Dyson Remote card visual editor.
 * Optional entity overrides use `type: "expandable"` with `flatten: true` so nested
 * fields read/write the same flat `form.data` keys as before (see home-assistant/frontend ha-form).
 *
 * @param {Record<string, unknown>} data - Current form data (drives conditional air-quality sub-fields).
 * @returns {readonly unknown[]}
 */
function buildDysonRemoteCardEditorSchema(data) {
  const d = data || {};
  const aqHeaderOn = d.show_air_quality_header === true;
  const sub = aqHeaderOn
    ? [
        { name: "show_air_quality_category", selector: { boolean: {} } },
        { name: "show_air_quality_pollutant", selector: { boolean: {} } },
        { name: "show_air_quality_bar", selector: { boolean: {} } },
      ]
    : [];
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
      type: "expandable",
      name: "advanced_dyson_entities",
      title: "Advanced entity overrides",
      expanded: false,
      flatten: true,
      schema: [
        {
          name: "oscillation_select_entity",
          selector: {
            entity: {
              domain: ["select"],
            },
          },
        },
        {
          name: "climate_entity",
          selector: {
            entity: {
              domain: ["climate"],
            },
          },
        },
        {
          name: "humidity_auto_entity",
          selector: {
            entity: {
              domain: ["select", "switch"],
            },
          },
        },
        {
          name: "humidifier_entity",
          selector: {
            entity: {
              domain: ["humidifier"],
            },
          },
        },
        {
          name: "humidity_target_entity",
          selector: {
            entity: {
              domain: ["number"],
            },
          },
        },
        {
          name: "humidity_step",
          selector: {
            number: {
              min: 1,
              max: 50,
              mode: "box",
            },
          },
        },
        {
          name: "humidity_write",
          selector: {
            select: {
              mode: "dropdown",
              options: [
                { value: "auto", label: "Auto (humidifier first, then climate)" },
                { value: "humidifier", label: "Humidifier entity only" },
                { value: "climate", label: "Climate entity only" },
              ],
            },
          },
        },
      ],
    },
    {
      name: "show_temperature_header",
      selector: { boolean: {} },
    },
    {
      name: "show_air_quality_header",
      selector: { boolean: {} },
    },
    ...sub,
  ];
}

/**
 * Ordered Home Assistant service calls for setting combo-device target humidity.
 * Pure planning + executor so behavior is unit-testable without the Lovelace card.
 */

/** @typedef {{ domain: string, service: string, data: Record<string, unknown> }} HumidityServiceCall */

/**
 * @param {unknown} v
 * @returns {"auto" | "humidifier" | "climate"}
 */
function normalizeHumidityWrite(v) {
  const s = typeof v === "string" ? v.trim().toLowerCase() : "";
  if (s === "humidifier" || s === "climate") return s;
  return "auto";
}

/**
 * @param {string | null | undefined} humidifierEntityId
 * @param {string | null | undefined} configuredEntityId
 * @returns {string[]}
 */
function humidifierEntityIdsForHumidityWrite(humidifierEntityId, configuredEntityId) {
  const domain = typeof configuredEntityId === "string" ? configuredEntityId.split(".")[0] : "";
  const ids = [];
  if (humidifierEntityId) ids.push(humidifierEntityId);
  if (domain === "humidifier" && configuredEntityId && !ids.includes(configuredEntityId)) {
    ids.push(configuredEntityId);
  }
  return ids;
}

/**
 * @param {HumidityServiceCall[]} calls
 * @returns {HumidityServiceCall[]}
 */
function dedupeHumidityCalls(calls) {
  const seen = new Set();
  const out = [];
  for (const c of calls) {
    const key = `${c.domain}\0${c.service}\0${JSON.stringify(c.data)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

/**
 * Build ordered service calls for `humidifier.set_humidity` / `climate.set_humidity` / `number.set_value`.
 * Execution should stop after the first call that succeeds (see `executeHumiditySetpointCalls`).
 *
 * @param {object} hass - Home Assistant object with `services`
 * @param {object} ctx
 * @param {number} ctx.next - Target humidity %
 * @param {string | null | undefined} ctx.climateEntityId
 * @param {string | null | undefined} ctx.humidifierEntityId
 * @param {string} ctx.configuredEntityId - Card `entity` id
 * @param {string | null | undefined} ctx.humidityNumberId - Resolved `number.*` target entity
 * @param {unknown} ctx.humidityWrite - `"auto"` | `"humidifier"` | `"climate"`
 * @returns {HumidityServiceCall[]}
 */
function buildHumiditySetpointServiceCalls(hass, ctx) {
  const mode = normalizeHumidityWrite(ctx.humidityWrite);
  const {
    next,
    climateEntityId,
    humidifierEntityId,
    configuredEntityId,
    humidityNumberId,
  } = ctx;

  const hasHum = Boolean(hass?.services?.humidifier?.set_humidity);
  const hasCli = Boolean(hass?.services?.climate?.set_humidity);
  const hasNum = Boolean(hass?.services?.number?.set_value);

  /** @type {HumidityServiceCall[]} */
  const calls = [];

  const pushHum = (entity_id) => {
    if (entity_id && hasHum) {
      calls.push({
        domain: "humidifier",
        service: "set_humidity",
        data: { entity_id, humidity: next },
      });
    }
  };
  const pushCli = () => {
    if (climateEntityId && hasCli) {
      calls.push({
        domain: "climate",
        service: "set_humidity",
        data: { entity_id: climateEntityId, humidity: next },
      });
    }
  };
  const pushNum = () => {
    if (humidityNumberId && hasNum) {
      calls.push({
        domain: "number",
        service: "set_value",
        data: { entity_id: humidityNumberId, value: next },
      });
    }
  };

  if (mode === "climate") {
    pushCli();
    pushNum();
    return dedupeHumidityCalls(calls);
  }

  const humIds = humidifierEntityIdsForHumidityWrite(humidifierEntityId, configuredEntityId);
  for (const id of humIds) pushHum(id);

  if (mode === "humidifier") {
    pushNum();
    return dedupeHumidityCalls(calls);
  }

  pushCli();
  pushNum();
  return dedupeHumidityCalls(calls);
}

/**
 * @param {object} hass
 * @param {HumidityServiceCall[]} calls
 * @returns {Promise<boolean>} True if any call succeeded
 */
async function executeHumiditySetpointCalls(hass, calls) {
  for (const c of calls) {
    try {
      await hass.callService(c.domain, c.service, c.data);
      return true;
    } catch (err) {
      console.warn(`Dyson Remote: ${c.domain}.${c.service} (humidity target) failed`, err);
    }
  }
  return false;
}

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
  if (typeof pm === "string" && pm.toLowerCase() === "auto") return true;
  const fss = attrs.fan_speed_setting;
  if (typeof fss === "string" && /^\s*auto\s*$/i.test(fss)) return true;
  return false;
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
function climateHumidityAutoOn(climateAttrs) {
  return climateAttrBooleanOn(climateAttrs?.humidity_auto);
}

/** True when the device is targeting humidity automatically (climate `humidity_auto` or humidifier `mode: auto`). */
function humiditySetpointIsAutoTarget(climateAttrs, humidifierAttrs) {
  if (climateHumidityAutoOn(climateAttrs)) return true;
  const hm = typeof humidifierAttrs?.mode === "string" ? humidifierAttrs.mode.toLowerCase().trim() : "";
  return hm === "auto";
}

function objectIdFromEntityId(entityId) {
  if (typeof entityId !== "string" || !entityId.includes(".")) return "";
  return entityId.slice(entityId.indexOf(".") + 1);
}

/**
 * `humidifier.*` ids to try when pairing a fan card with a different `climate.*` (Dyson device serial is usually on climate/humidifier, not a renamed fan).
 * Climate object id is tried first, then the fan.
 */
function orderedHumidifierEntityCandidates(fanEntityId, climateEntityId) {
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
function resolveHumidifierEntityId(states, fanEntityId, climateEntityId, humidifierEntityOverride) {
  const trimmed = typeof humidifierEntityOverride === "string" ? humidifierEntityOverride.trim() : "";
  if (trimmed.startsWith("humidifier.") && states?.[trimmed]) return trimmed;
  for (const id of orderedHumidifierEntityCandidates(fanEntityId, climateEntityId)) {
    if (states?.[id]) return id;
  }
  return null;
}

/** Optional `number.*` target humidity (some integrations expose this instead of acting on climate.set_humidity). */
function resolvedHumidityTargetNumberEntityId(
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
function humidityRangeIntersect(attrObjects) {
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
function humidityStepperBounds(fanAttrs, climateAttrs, humidifierAttrs, options) {
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
function snapTargetHumidityToStep(value, min, max, step) {
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
function adjustTargetHumidityByStep(snapped, dir, min, max, step) {
  const s = Math.max(1, Number(step) || 1);
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  const delta = dir > 0 ? s : -s;
  const next = snapped + delta;
  return Math.max(lo, Math.min(hi, next));
}

/** Map humidifier `available_modes` to the mode string for auto vs manual target humidity (hass-dyson: normal / auto). */
function pickHumidifierModeForAutoToggle(availableModes, wantAuto) {
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
function pickSelectOptionHumidityAuto(options, wantAutoOn) {
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
function resolvedHumidityAutoToggleEntityId(states, climateEntityId, humidityAutoEntityTrimmed) {
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
function isHumidityEnabled(attrs) {
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
function inferTargetHumidity(attrs) {
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
function targetHumidityMatchesExpected(attrs, expected) {
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
function humidifierPurifyControlEngaged(fanAttrs, climateAttrs) {
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
function humidifierAutoHumidifyControlEngaged(fanAttrs, climateAttrs, humidifierAttrs) {
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
function humidifierComboMode(
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

/**
 * Normalizes fan/select oscillation state (booleans, strings, span, HA fan.oscillating).
 */
function oscillationIsEnabled(attrs) {
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

function inferOscillationPresetIndex(attrs, presets) {
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

function oscillationSelectLooksLikePreset(selectState) {
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
function oscillationMergeForEnabled(selectAttrs, fanAttrs) {
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

/**
 * libdyson `select.*_oscillation` carries `oscillation_enabled` / `oscillation_mode` that track
 * the physical device and Dyson app; `fan` attributes are often wrong or delayed.
 * When the select only has `options` + state (no oscillation_* keys yet), we still treat it as the
 * oscillation control if options look like angle presets, and merge fan attrs to decide enabled.
 * Returns null if this does not look like an oscillation select (use fan attrs only).
 */
function oscillationDisplayFromSelect(selectState, presets, fanAttrs = null) {
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

const _dysonRemoteBuildToken = "1.0.0+2026-03-24";
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

function sleepTimerMinutesFromAttrs(attrs) {
  const v = attrs?.sleep_timer;
  if (typeof v === "number" && Number.isFinite(v) && v > 0) {
    /* hass-dyson commonly exposes seconds; guard small minute-like values too. */
    return v > 600 ? Math.round(v / 60) : Math.round(v);
  }
  if (typeof v === "string" && v.trim()) {
    const s = v.trim();
    const mmss = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (mmss) {
      const h = Number(mmss[1] || 0);
      const m = Number(mmss[2] || 0);
      const sec = Number(mmss[3] || 0);
      return h * 60 + m + (sec >= 30 ? 1 : 0);
    }
    const n = Number(s);
    if (Number.isFinite(n) && n > 0) return n > 600 ? Math.round(n / 60) : Math.round(n);
  }
  return 0;
}

function formatSleepTimerLabel(minutes) {
  if (!minutes || minutes <= 0) return "OFF";
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

function resolvedDeviceId(hass, entityId) {
  if (!entityId || typeof entityId !== "string") return "";
  const entities = hass?.entities;
  const registryDeviceId = entities && typeof entities === "object" ? entities[entityId]?.device_id : null;
  if (typeof registryDeviceId === "string" && registryDeviceId.trim()) return registryDeviceId.trim();
  const stateDeviceId = hass?.states?.[entityId]?.attributes?.device_id;
  if (typeof stateDeviceId === "string" && stateDeviceId.trim()) return stateDeviceId.trim();
  return "";
}

function normalizeOscillationChoiceLabel(label) {
  const s = typeof label === "string" ? label.trim() : "";
  if (!s) return "";
  return /^off$/i.test(s) ? "OFF" : s;
}

function oscillationChoiceDegrees(label) {
  const s = typeof label === "string" ? label.trim() : "";
  if (!s) return null;
  if (/^off$/i.test(s)) return 0;
  const m = s.match(/(\d+)/);
  return m ? Number(m[1]) : null;
}

function oscillationChoiceKey(label, idx) {
  const base = String(label || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `osc_choice_${base || "option"}_${idx}`;
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
    this._timerOverlayOpen = false;
    this._oscillationOverlayOpen = false;
    this._oscillationChoices = [];
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

  async _setSleepTimer(hass, deviceId, minutes) {
    if (!deviceId || !minutes || minutes <= 0) return false;
    const candidates = [
      ["hass_dyson", "set_sleep_timer"],
      ["dyson", "set_sleep_timer"],
    ];
    for (const [domain, service] of candidates) {
      if (!hass?.services?.[domain]?.[service]) continue;
      await hass.callService(domain, service, { device_id: deviceId, minutes });
      return true;
    }
    return false;
  }

  async _cancelSleepTimer(hass, deviceId) {
    if (!deviceId) return false;
    const candidates = [
      ["hass_dyson", "cancel_sleep_timer"],
      ["dyson", "cancel_sleep_timer"],
    ];
    for (const [domain, service] of candidates) {
      if (!hass?.services?.[domain]?.[service]) continue;
      await hass.callService(domain, service, { device_id: deviceId });
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
        position: relative;
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
      .timer-overlay {
        position: absolute;
        inset: 10px;
        z-index: 7;
        border-radius: 14px;
        padding: 16px;
        background: color-mix(in srgb, #000 86%, var(--ha-card-background, #1c1c1c));
        border: 1px solid color-mix(in srgb, var(--divider-color, #666) 70%, transparent);
        box-shadow: 0 12px 28px rgba(0, 0, 0, 0.45);
        display: grid;
        grid-template-rows: auto auto 1fr auto;
        gap: 12px;
      }
      .timer-overlay[hidden] {
        display: none !important;
      }
      .timer-overlay__title {
        text-align: center;
        font-size: 1rem;
        opacity: 0.95;
        grid-row: 1;
      }
      .timer-overlay__subtitle {
        text-align: center;
        font-size: 0.9rem;
        color: var(--drc-muted);
        margin-top: -4px;
        grid-row: 2;
      }
      .timer-grid {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 8px;
        align-content: start;
        grid-row: 3;
      }
      .timer-chip {
        border: 1px solid color-mix(in srgb, var(--divider-color, #666) 70%, transparent);
        border-radius: 999px;
        background: color-mix(in srgb, var(--drc-surface-idle) 85%, #000);
        color: var(--drc-text);
        min-height: 34px;
        padding: 0 10px;
      }
      .timer-chip:hover {
        background: color-mix(in srgb, var(--drc-surface-on) 55%, #000);
      }
      .timer-chip.is-active {
        background: color-mix(in srgb, var(--drc-surface-on) 85%, #000);
        border-color: color-mix(in srgb, #fff 35%, var(--divider-color, #666));
        box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.22);
      }
      .timer-actions {
        display: flex;
        gap: 10px;
        align-items: center;
      }
      .timer-overlay .timer-actions {
        grid-row: 4;
        align-self: end;
      }
      .timer-actions .timer-chip {
        flex: 1;
      }
      .timer-actions .overlay-close {
        margin-left: auto;
        min-width: 96px;
      }
      .osc-overlay {
        position: absolute;
        inset: 10px;
        z-index: 8;
        border-radius: 14px;
        padding: 16px;
        background: color-mix(in srgb, #000 86%, var(--ha-card-background, #1c1c1c));
        border: 1px solid color-mix(in srgb, var(--divider-color, #666) 70%, transparent);
        box-shadow: 0 12px 28px rgba(0, 0, 0, 0.45);
        display: grid;
        grid-template-rows: auto 1fr auto;
        gap: 12px;
      }
      .osc-overlay[hidden] {
        display: none !important;
      }
      .osc-overlay__title {
        text-align: center;
        font-size: 1rem;
        opacity: 0.95;
      }
      .osc-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 8px;
      }
      .osc-chip {
        border: 1px solid color-mix(in srgb, var(--divider-color, #666) 70%, transparent);
        border-radius: 999px;
        background: color-mix(in srgb, var(--drc-surface-idle) 85%, #000);
        color: var(--drc-text);
        min-height: 34px;
        padding: 0 10px;
      }
      .osc-chip:hover {
        background: color-mix(in srgb, var(--drc-surface-on) 55%, #000);
      }
      .osc-chip.is-active {
        background: color-mix(in srgb, var(--drc-surface-on) 85%, #000);
        border-color: color-mix(in srgb, #fff 35%, var(--divider-color, #666));
        box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.22);
      }
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
        height: var(--drc-pill-h);
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
      [data-stepper="oscillation"] .stepper-btn--ghost {
        visibility: hidden;
        pointer-events: none;
      }
      .cell--stepper-osc .label,
      .cell--stepper-thermal .label,
      .cell--stepper-airflow .label {
        min-height: calc(var(--drc-label-size) * 2.4);
        display: flex;
        align-items: flex-start;
        justify-content: center;
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
        .timer-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        .osc-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
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
          <button
            type="button"
            class="stepper-pill"
            data-stepper="oscillation"
            data-action="oscillation"
            aria-label="Oscillation selection"
          >
            <span class="icon-slot" data-ha-icon="mdi:rotate-360" data-ha-size="26"></span>
            <div class="stepper-col">
              <span class="stepper-btn stepper-btn--ghost" aria-hidden="true">+</span>
              <span class="stepper-readout muted" data-part="osc-mid">OFF</span>
              <span class="stepper-btn stepper-btn--ghost" aria-hidden="true">−</span>
            </div>
          </button>
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

        <div class="cell cell--footer-timer">
          <button type="button" class="btn-circle" data-action="timer" aria-label="Timer">
            <span class="icon-slot" data-ha-icon="mdi:timer-outline" data-ha-size="28"></span>
          </button>
          <div class="label" data-part="timer-label">Timer</div>
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
      <div class="timer-overlay" data-part="timer-overlay" hidden>
        <div class="timer-overlay__title">Set sleep timer</div>
        <div class="timer-overlay__subtitle" data-part="timer-remaining" hidden></div>
        <div class="timer-grid">
          <button type="button" class="timer-chip" data-action="timer_set_15">15m</button>
          <button type="button" class="timer-chip" data-action="timer_set_30">30m</button>
          <button type="button" class="timer-chip" data-action="timer_set_45">45m</button>
          <button type="button" class="timer-chip" data-action="timer_set_60">1h</button>
          <button type="button" class="timer-chip" data-action="timer_set_120">2h</button>
          <button type="button" class="timer-chip" data-action="timer_set_180">3h</button>
          <button type="button" class="timer-chip" data-action="timer_set_240">4h</button>
          <button type="button" class="timer-chip" data-action="timer_set_300">5h</button>
          <button type="button" class="timer-chip" data-action="timer_set_360">6h</button>
          <button type="button" class="timer-chip" data-action="timer_set_420">7h</button>
          <button type="button" class="timer-chip" data-action="timer_set_480">8h</button>
          <button type="button" class="timer-chip" data-action="timer_set_540">9h</button>
        </div>
        <div class="timer-actions">
          <button type="button" class="timer-chip" data-action="timer_cancel">Cancel timer</button>
          <button type="button" class="timer-chip overlay-close" data-action="timer_close">Close</button>
        </div>
      </div>
      <div class="osc-overlay" data-part="osc-overlay" hidden>
        <div class="osc-overlay__title">Oscillation</div>
        <div class="osc-grid" data-part="osc-options"></div>
        <div class="timer-actions">
          <button type="button" class="osc-chip overlay-close" data-action="osc_close">Close</button>
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
      oscillation: ['[data-stepper="oscillation"]'],
      timer: ['button[data-action="timer"]'],
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
    const timerMinutes = sleepTimerMinutesFromAttrs(attrs);
    const timerLabel = this._rootEl.querySelector('[data-part="timer-label"]');
    if (timerLabel) timerLabel.textContent = timerMinutes > 0 ? `${formatSleepTimerLabel(timerMinutes)} left` : "Timer";
    const timerOverlay = this._rootEl.querySelector('[data-part="timer-overlay"]');
    if (timerOverlay) timerOverlay.hidden = !this._timerOverlayOpen;
    const timerRemaining = this._rootEl.querySelector('[data-part="timer-remaining"]');
    if (timerRemaining) {
      timerRemaining.hidden = timerMinutes <= 0;
      timerRemaining.textContent = timerMinutes > 0 ? `Remaining: ${formatSleepTimerLabel(timerMinutes)}` : "";
    }
    const timerPresetButtons = this._rootEl.querySelectorAll('button[data-action^="timer_set_"]');
    let nearestPreset = null;
    let nearestDiff = Number.POSITIVE_INFINITY;
    timerPresetButtons.forEach((btn) => {
      const m = /^timer_set_(\d+)$/.exec(btn.getAttribute("data-action") || "");
      const preset = m ? Number(m[1]) : 0;
      if (!(preset > 0) || !(timerMinutes > 0)) return;
      const diff = Math.abs(preset - timerMinutes);
      if (diff < nearestDiff || (diff === nearestDiff && (nearestPreset == null || preset < nearestPreset))) {
        nearestDiff = diff;
        nearestPreset = preset;
      }
    });
    timerPresetButtons.forEach((btn) => {
      const m = /^timer_set_(\d+)$/.exec(btn.getAttribute("data-action") || "");
      const preset = m ? Number(m[1]) : 0;
      btn.classList.toggle("is-active", timerMinutes > 0 && preset === nearestPreset);
    });

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
    const oscOptions = Array.isArray(oscSelectSt?.attributes?.options)
      ? oscSelectSt.attributes.options.filter(
          (v) => typeof v === "string" && v.trim() && !/^custom$/i.test(v.trim()),
        )
      : [];
    const hasOffOption = oscOptions.some((v) => /^off$/i.test(String(v).trim()));
    const overlayOptions = hasOffOption ? oscOptions : ["OFF", ...oscOptions];
    this._oscillationChoices =
      oscOptions.length > 0
        ? overlayOptions.map((raw, i) => {
            const label = normalizeOscillationChoiceLabel(raw);
            const isSyntheticOff = !hasOffOption && i === 0 && label === "OFF";
            return {
              key: oscillationChoiceKey(raw, i),
              label,
              option: isSyntheticOff ? null : raw,
              degrees: oscillationChoiceDegrees(raw),
            };
          })
        : presets.map((deg, i) => ({
            key: oscillationChoiceKey(oscillationPresetLabel(deg), i),
            label: oscillationPresetLabel(deg),
            option: null,
            degrees: Number(deg),
          }));

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

    let currentOscLabel = "OFF";
    if (oscFromSelect) {
      currentOscLabel = oscFromSelect.label;
    } else if (oscOptimisticLabel) {
      currentOscLabel = oscOptimisticLabel.label;
    } else {
      const oi = inferOscillationPresetIndex(attrs, presets);
      const deg = presets[oi] ?? 0;
      currentOscLabel = oscillationPresetLabel(deg);
    }
    const oscMid = this._rootEl.querySelector('[data-part="osc-mid"]');
    if (oscMid) {
      oscMid.textContent = currentOscLabel;
      oscMid.classList.toggle("muted", currentOscLabel === "OFF" || currentOscLabel === "—");
    }
    const oscOverlay = this._rootEl.querySelector('[data-part="osc-overlay"]');
    if (oscOverlay) oscOverlay.hidden = !this._oscillationOverlayOpen;
    const oscOptionsEl = this._rootEl.querySelector('[data-part="osc-options"]');
    if (oscOptionsEl) {
      const overlayCurrentLabel =
        oscOptions.length > 0 && typeof oscSelectSt?.state === "string" && oscSelectSt.state.trim()
          ? normalizeOscillationChoiceLabel(oscSelectSt.state)
          : currentOscLabel;
      const normalizedCurrent = normalizeOscillationChoiceLabel(overlayCurrentLabel).toLowerCase();
      const overlayCurrentDegrees = oscillationChoiceDegrees(overlayCurrentLabel);
      oscOptionsEl.innerHTML = this._oscillationChoices
        .map((c) => {
          const isActive =
            (overlayCurrentDegrees != null &&
              c.degrees != null &&
              Number(c.degrees) === Number(overlayCurrentDegrees)) ||
            c.label.toLowerCase() === normalizedCurrent;
          return `<button type="button" class="osc-chip${isActive ? " is-active" : ""}" data-action="${c.key}">${c.label}</button>`;
        })
        .join("");
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
    this._toggleEngaged('button[data-action="timer"]', timerMinutes > 0);
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
    const timerDeviceId = resolvedDeviceId(hass, entityId);

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
    const oscSelectId = resolvedOscillationSelectEntityId(hass, entityId, this._config.oscillation_select_entity);

    if (this._pendingActions.has(action)) return;
    this._pendingActions.add(action);
    this._setBusy(action, true);

    try {
      const timerSetMatch = /^timer_set_(\d+)$/.exec(action);
      if (timerSetMatch) {
        const minutes = Math.max(1, Number(timerSetMatch[1] || 0));
        const ok = await this._setSleepTimer(hass, timerDeviceId, minutes);
        if (!ok) {
          console.warn(
            "Dyson Remote: sleep timer service not available for",
            entityId,
            "(expected hass.entities[entity_id].device_id and hass_dyson.set_sleep_timer)",
          );
        }
        this._timerOverlayOpen = false;
        this._updateDynamic();
        return;
      }
      const oscChoice = this._oscillationChoices.find((c) => c.key === action);
      if (oscChoice) {
        if (oscChoice.degrees != null) {
          this._applyOptimisticPatch({
            oscillation_enabled: oscChoice.degrees > 0,
            oscillation_span: oscChoice.degrees,
          });
        }
        await hass.callService(domain, "turn_on", { entity_id: entityId });
        if (oscChoice.option && oscSelectId && hass?.services?.select?.select_option) {
          await hass.callService("select", "select_option", { entity_id: oscSelectId, option: oscChoice.option });
        } else {
          await this._applyOscillationPreset(hass, domain, entityId, Number(oscChoice.degrees || 0));
        }
        this._oscillationOverlayOpen = false;
        this._updateDynamic();
        return;
      }
      switch (action) {
        case "oscillation": {
          this._oscillationOverlayOpen = true;
          this._updateDynamic();
          break;
        }
        case "osc_close": {
          this._oscillationOverlayOpen = false;
          this._updateDynamic();
          break;
        }
        case "timer": {
          this._timerOverlayOpen = true;
          this._updateDynamic();
          break;
        }
        case "timer_close": {
          this._timerOverlayOpen = false;
          this._updateDynamic();
          break;
        }
        case "timer_cancel": {
          const ok = await this._cancelSleepTimer(hass, timerDeviceId);
          if (!ok) {
            console.warn(
              "Dyson Remote: cancel sleep timer service not available for",
              entityId,
              "(expected hass.entities[entity_id].device_id and hass_dyson.cancel_sleep_timer)",
            );
          }
          this._timerOverlayOpen = false;
          this._updateDynamic();
          break;
        }
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
