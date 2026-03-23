/**
 * Dyson-style air quality: five-step scale (green → yellow → orange → red → purple).
 * Prefers libdyson `sensor.*_air_quality_index` + `category` / `dominant_pollutants` when present.
 */

export const AQ_LEVEL_COUNT = 5;

/** Segment fills: Good → Fair → Poor → Very poor → Severe (Dyson-style). */
export const AQ_SEGMENT_HEX = ["#22C55E", "#EAB308", "#F97316", "#EF4444", "#A855F7"];

/** Title / icon / thumb accent per level. */
export const AQ_ACCENT_HEX = ["#4ADE80", "#FACC15", "#FB923C", "#F87171", "#C084FC"];

export const AQ_LEVEL_META = [
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
export function dysonCategoryToLevel(raw) {
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
export function computeAirQualitySummary(hass, deviceObjectId, fanAttrs) {
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
