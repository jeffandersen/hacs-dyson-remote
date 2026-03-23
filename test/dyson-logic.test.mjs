import test from "node:test";
import assert from "node:assert/strict";
import {
  adjustFanPercentage,
  adjustTargetTemperature,
  airflowCenterLabel,
  ambientTemperature,
  coolingDotActive,
  entityIsPowered,
  fanLevelFromPercentage,
  findHeatPresetName,
  formatTargetTemperature,
  heatingTargetReadout,
  isAirflowControlEngaged,
  isAutoModeActive,
  isHeatActive,
  isNightModeActive,
  nextManualFanPercentage,
  percentageFromFanLevel,
  inferOscillationPresetIndex,
  nextOscillationIndex,
  normalizeOscillationPresets,
  normalizePresetModes,
  oscillationPresetLabel,
  snapTemperatureToStep,
  temperatureStepAndBounds,
} from "../src/dyson-logic.js";

test("normalizePresetModes accepts comma-separated strings", () => {
  assert.deepEqual(normalizePresetModes("Auto, Manual, Heat"), ["Auto", "Manual", "Heat"]);
});

test("findHeatPresetName", () => {
  assert.equal(findHeatPresetName(["Auto", "Manual", "Heat"]), "Heat");
  assert.equal(findHeatPresetName(["Auto", "Focus heat mode"]), "Focus heat mode");
  assert.equal(findHeatPresetName(["Auto"]), null);
});

test("isAutoModeActive", () => {
  assert.equal(isAutoModeActive({ auto_mode: true }), true);
  assert.equal(isAutoModeActive({ preset_mode: "Auto" }), true);
  assert.equal(isAutoModeActive({ preset_mode: "Manual" }), false);
});

test("isHeatActive uses heating_mode, heating_enabled, and preset", () => {
  assert.equal(isHeatActive({ heating_mode: "ON" }), true);
  assert.equal(isHeatActive({ heating_enabled: true }), true);
  assert.equal(isHeatActive({ preset_modes: ["Heat"], preset_mode: "Heat" }), true);
  assert.equal(isHeatActive({ heating_mode: "OFF", heating_enabled: false, preset_mode: "Manual" }), false);
});

test("airflowCenterLabel", () => {
  assert.equal(airflowCenterLabel({ auto_mode: true, fan_speed_setting: "AUTO" }), "AUTO");
  assert.equal(airflowCenterLabel({ auto_mode: false, percentage: 0 }), "OFF");
  assert.equal(airflowCenterLabel({ auto_mode: false, percentage: 40 }), "4");
});

test("formatTargetTemperature hides invalid sensor readings", () => {
  assert.equal(formatTargetTemperature({ target_temperature: 21.05, temperature_unit: "°C" }), "21°C");
  assert.equal(formatTargetTemperature({ target_temperature: -273.15, temperature_unit: "°C" }), null);
});

test("nextManualFanPercentage wraps at max", () => {
  assert.equal(nextManualFanPercentage(0, 10, 100), 10);
  assert.equal(nextManualFanPercentage(100, 10, 100), 10);
});

test("oscillation presets and labels", () => {
  assert.deepEqual(normalizeOscillationPresets(null), [0, 45, 90, 180, 350]);
  assert.equal(oscillationPresetLabel(0), "OFF");
  assert.equal(oscillationPresetLabel(90), "90°");
});

test("inferOscillationPresetIndex", () => {
  const p = [0, 45, 90, 180, 350];
  assert.equal(inferOscillationPresetIndex({ oscillation_enabled: false }, p), 0);
  assert.equal(inferOscillationPresetIndex({ oscillation_enabled: true, oscillation_span: 88 }, p), 2);
});

test("nextOscillationIndex wraps", () => {
  assert.equal(nextOscillationIndex(0, -1, 5), 4);
  assert.equal(nextOscillationIndex(4, 1, 5), 0);
});

test("coolingDotActive", () => {
  assert.equal(coolingDotActive({ heating_mode: "OFF" }), true);
  assert.equal(coolingDotActive({ heating_mode: "ON" }), false);
});

test("entityIsPowered prefers is_on", () => {
  assert.equal(entityIsPowered({ state: "off" }, { is_on: true }), true);
  assert.equal(entityIsPowered({ state: "on" }, { is_on: false }), false);
  assert.equal(entityIsPowered({ state: "on" }, {}), true);
  assert.equal(entityIsPowered({}, {}), false);
});

test("isNightModeActive", () => {
  assert.equal(isNightModeActive({ night_mode: true }), true);
  assert.equal(isNightModeActive({ night_mode: false }), false);
});

test("isAirflowControlEngaged", () => {
  assert.equal(isAirflowControlEngaged({ state: "off" }, { is_on: false }), false);
  assert.equal(isAirflowControlEngaged({ state: "on" }, { is_on: true, auto_mode: true }), true);
  assert.equal(isAirflowControlEngaged({ state: "on" }, { is_on: true, percentage: 40 }), true);
});

test("ambientTemperature", () => {
  assert.equal(ambientTemperature({ current_temperature: 19.2 }), 19.2);
  assert.equal(ambientTemperature({ current_temperature: -273.15 }), null);
});

test("adjustFanPercentage clamps", () => {
  assert.equal(adjustFanPercentage(40, 1, { percentage_step: 10 }), 50);
  assert.equal(adjustFanPercentage(5, -1, { percentage_step: 10 }), 0);
  assert.equal(adjustFanPercentage(95, 1, { percentage_step: 10 }), 100);
});

test("fan level conversion helpers", () => {
  assert.equal(fanLevelFromPercentage(0), 0);
  assert.equal(fanLevelFromPercentage(10), 1);
  assert.equal(fanLevelFromPercentage(40), 4);
  assert.equal(percentageFromFanLevel(0), 0);
  assert.equal(percentageFromFanLevel(7), 70);
});

test("snapTemperatureToStep", () => {
  assert.equal(snapTemperatureToStep(21.2, 7, 40, 0.5), 21);
  assert.equal(snapTemperatureToStep(21.24, 7, 40, 0.5), 21);
});

test("adjustTargetTemperature", () => {
  const attrs = { min_temp: 7, max_temp: 40, temperature_step: 1, target_temperature: 21 };
  assert.equal(adjustTargetTemperature(21, 1, attrs), 22);
  assert.equal(adjustTargetTemperature(7, -1, attrs), 7);
});

test("heatingTargetReadout", () => {
  assert.equal(
    heatingTargetReadout({ target_temperature: 21.5, temperature_unit: "°C", temperature_step: 0.5 }),
    "21.5°C",
  );
  assert.equal(heatingTargetReadout({ target_temperature: -300, temperature_unit: "°C" }), "—");
});

test("temperatureStepAndBounds", () => {
  const b = temperatureStepAndBounds({ min_temp: 30, max_temp: 10, temperature_step: 0.5 });
  assert.equal(b.min, 10);
  assert.equal(b.max, 30);
  assert.equal(b.step, 0.5);
});
