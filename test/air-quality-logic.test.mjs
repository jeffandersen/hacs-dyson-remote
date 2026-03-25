import test from "node:test";
import assert from "node:assert/strict";
import { computeAirQualitySummary, dysonCategoryToLevel } from "../src/air-quality-logic.js";

function hassWithSensors(states) {
  return { states: { ...states } };
}

// ---------------------------------------------------------------------------
// Air quality summary
// See CLAUDE.md: "Air quality" section
// Five-level scale: Good(0) Fair(1) Poor(2) Very poor(3) Severe(4)
// Colors: #22C55E → #EAB308 → #F97316 → #EF4444 → #A855F7
// ---------------------------------------------------------------------------

test("computeAirQualitySummary returns null without readings", () => {
  // No sensors and no fan attrs → card should show nothing rather than a bogus level
  assert.equal(computeAirQualitySummary(hassWithSensors({}), "dev", {}), null);
});

test("computeAirQualitySummary uses PM2.5 µg/m³ bands", () => {
  // 8 µg/m³ PM2.5 is below the Good threshold
  const hass = hassWithSensors({
    "sensor.dev_pm25": {
      state: "8",
      attributes: { friendly_name: "PM 2.5", device_class: "pm25" },
    },
  });
  const g = computeAirQualitySummary(hass, "dev", {});
  assert.equal(g.title, "Good");
  assert.equal(g.levelIndex, 0); // 0 = Good (first of five levels)
  assert.equal(g.subtitle.bullet, true); // bullet dot shown for specific pollutant
  assert.equal(g.subtitle.text, "PM2.5");

  // 40 µg/m³ PM2.5 is in the Poor band
  hass.states["sensor.dev_pm25"].state = "40";
  const m = computeAirQualitySummary(hass, "dev", {});
  assert.equal(m.title, "Poor");
  assert.equal(m.subtitle.bullet, false); // elevated subtitle format uses no bullet
  assert.equal(m.subtitle.text, "PM2.5 elevated");
});

test("Dyson air_quality_index uses category attribute not numeric state", () => {
  // hass-dyson AQI sensor exposes a `category` attribute ("Good"/"Fair"/etc.)
  // The card must use this string, NOT the numeric state (which uses a different scale).
  // See CLAUDE.md: "uses category attribute (Good/Fair/Poor/Very poor/Severe), not the raw numeric state"
  const hass = hassWithSensors({
    "sensor.dyson_zz7_ca_mja1790a_air_quality_index": {
      state: "7", // numeric AQI — must be ignored
      attributes: {
        device_class: "aqi",
        friendly_name: "Dyson Hot Cool Air Quality Index",
        category: "Good", // this is what we read
        dominant_pollutants: "VOC",
      },
    },
  });
  const r = computeAirQualitySummary(hass, "dyson_zz7_ca_mja1790a", {});
  assert.equal(r.title, "Good");
  assert.equal(r.levelIndex, 0);
  assert.equal(r.subtitle.bullet, true);
  assert.equal(r.subtitle.text, "VOC");
});

test("dysonCategoryToLevel parses Dyson strings", () => {
  // Maps the five Dyson category strings to 0-based level indices used throughout the card.
  assert.equal(dysonCategoryToLevel("Good"), 0);
  assert.equal(dysonCategoryToLevel("Fair"), 1);
  assert.equal(dysonCategoryToLevel("Poor"), 2);
  assert.equal(dysonCategoryToLevel("Very poor"), 3);
  assert.equal(dysonCategoryToLevel("Severe"), 4);
});

test("dominant pollutant falls back to sensor.*_dominant_pollutant", () => {
  // When the AQI sensor has no dominant_pollutants attr, the card falls back to
  // a separate sensor.<oid>_dominant_pollutant entity.
  // See CLAUDE.md: "Dominant pollutant: dominant_pollutants / dominant_pollutant attribute on
  // the AQI sensor, or sensor.<device_oid>_dominant_pollutant state"
  const hass = hassWithSensors({
    "sensor.dev_air_quality_index": {
      state: "2",
      attributes: {
        category: "Fair",
        device_class: "aqi",
        friendly_name: "Dyson Air Quality Index",
        // no dominant_pollutants here
      },
    },
    "sensor.dev_dominant_pollutant": {
      state: "PM2.5",
      attributes: {},
    },
  });
  const r = computeAirQualitySummary(hass, "dev", {});
  assert.equal(r.title, "Fair");
  assert.equal(r.subtitle.text, "PM2.5");
});

test("computeAirQualitySummary uses VOC index and rising subtitle", () => {
  // VOC index 9 is in the Severe band; subtitle uses "rising" wording
  const hass = hassWithSensors({
    "sensor.dev_voc_index": {
      state: "9",
      attributes: { friendly_name: "VOC", device_class: "aqi" },
    },
  });
  const s = computeAirQualitySummary(hass, "dev", {});
  assert.equal(s.title, "Severe");
  assert.equal(s.subtitle.text, "VOC rising");
});

test("computeAirQualitySummary reads fan particulate attributes", () => {
  // Last fallback: raw particulate_matter_2_5 etc. on the fan entity attributes.
  // 160 µg/m³ PM2.5 is in the Severe band.
  const hass = hassWithSensors({});
  const f = computeAirQualitySummary(hass, "x", { particulate_matter_2_5: 160 });
  assert.equal(f.title, "Severe");
});
