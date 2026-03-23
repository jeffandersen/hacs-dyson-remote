import test from "node:test";
import assert from "node:assert/strict";
import { computeAirQualitySummary, dysonCategoryToLevel } from "../src/air-quality-logic.js";

function hassWithSensors(states) {
  return { states: { ...states } };
}

test("computeAirQualitySummary returns null without readings", () => {
  assert.equal(computeAirQualitySummary(hassWithSensors({}), "dev", {}), null);
});

test("computeAirQualitySummary uses PM2.5 µg/m³ bands", () => {
  const hass = hassWithSensors({
    "sensor.dev_pm25": {
      state: "8",
      attributes: { friendly_name: "PM 2.5", device_class: "pm25" },
    },
  });
  const g = computeAirQualitySummary(hass, "dev", {});
  assert.equal(g.title, "Good");
  assert.equal(g.levelIndex, 0);
  assert.equal(g.subtitle.bullet, true);
  assert.equal(g.subtitle.text, "PM2.5");

  hass.states["sensor.dev_pm25"].state = "40";
  const m = computeAirQualitySummary(hass, "dev", {});
  assert.equal(m.title, "Poor");
  assert.equal(m.subtitle.bullet, false);
  assert.equal(m.subtitle.text, "PM2.5 elevated");
});

test("Dyson air_quality_index uses category attribute not numeric state", () => {
  const hass = hassWithSensors({
    "sensor.dyson_zz7_ca_mja1790a_air_quality_index": {
      state: "7",
      attributes: {
        device_class: "aqi",
        friendly_name: "Dyson Hot Cool Air Quality Index",
        category: "Good",
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
  assert.equal(dysonCategoryToLevel("Good"), 0);
  assert.equal(dysonCategoryToLevel("Fair"), 1);
  assert.equal(dysonCategoryToLevel("Poor"), 2);
  assert.equal(dysonCategoryToLevel("Very poor"), 3);
  assert.equal(dysonCategoryToLevel("Severe"), 4);
});

test("dominant pollutant falls back to sensor.*_dominant_pollutant", () => {
  const hass = hassWithSensors({
    "sensor.dev_air_quality_index": {
      state: "2",
      attributes: {
        category: "Fair",
        device_class: "aqi",
        friendly_name: "Dyson Air Quality Index",
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
  const hass = hassWithSensors({});
  const f = computeAirQualitySummary(hass, "x", { particulate_matter_2_5: 160 });
  assert.equal(f.title, "Severe");
});
