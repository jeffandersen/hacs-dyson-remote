import test from "node:test";
import assert from "node:assert/strict";
import {
  adjustFanPercentage,
  adjustTargetTemperature,
  airflowCenterLabel,
  ambientTemperature,
  climateHasDysonStyleHumidityTarget,
  humiditySetpointIsAutoTarget,
  coolingDotActive,
  orderedHumidifierEntityCandidates,
  resolveHumidifierEntityId,
  resolvedHumidityTargetNumberEntityId,
  entityIsPowered,
  humidityRangeIntersect,
  humidifierAutoHumidifyControlEngaged,
  humidifierComboMode,
  humidifierPurifyControlEngaged,
  inferTargetHumidity,
  isHumidityEnabled,
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
  oscillationDisplayFromSelect,
  oscillationIsEnabled,
  oscillationPresetLabel,
  pickHumidifierModeForAutoToggle,
  pickSelectOptionHumidityAuto,
  resolvedHumidityAutoToggleEntityId,
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
  assert.equal(isAutoModeActive({ fan_speed_setting: "Auto" }), true);
  assert.equal(isAutoModeActive({ fan_speed_setting: "  auto  " }), true);
});

test("isHeatActive uses heating_mode, heating_enabled, and preset", () => {
  assert.equal(isHeatActive({ heating_mode: "ON" }), true);
  assert.equal(isHeatActive({ heating_enabled: true }), true);
  assert.equal(isHeatActive({ preset_modes: ["Heat"], preset_mode: "Heat" }), true);
  assert.equal(isHeatActive({ heating_mode: "OFF", heating_enabled: false, preset_mode: "Manual" }), false);
});

test("humidifierPurifyControlEngaged follows climate hvac_mode and fan auto airflow", () => {
  assert.equal(humidifierPurifyControlEngaged({ preset_mode: "Manual" }, { hvac_mode: "humidify" }), false);
  assert.equal(humidifierPurifyControlEngaged({ preset_mode: "Manual" }, { hvac_mode: "fan_only" }), false);
  assert.equal(humidifierPurifyControlEngaged({ preset_mode: "Auto" }, { hvac_mode: "fan_only" }), true);
  assert.equal(humidifierPurifyControlEngaged({ auto_mode: true }, { hvac_mode: "fan_only" }), true);
  assert.equal(humidifierPurifyControlEngaged({ preset_mode: "Manual" }, { hvac_mode: "off" }), false);
});

test("humidifierAutoHumidifyControlEngaged follows climate hvac_mode", () => {
  assert.equal(humidifierAutoHumidifyControlEngaged({ preset_mode: "Auto" }, { hvac_mode: "humidify" }), true);
  assert.equal(humidifierAutoHumidifyControlEngaged({ auto_mode: true }, { hvac_mode: "fan_only" }), false);
  assert.equal(humidifierAutoHumidifyControlEngaged({ preset_mode: "Manual" }, { hvac_mode: "fan_only" }), false);
});

test("humidifierAutoHumidifyControlEngaged uses Dyson climate humidity_auto", () => {
  assert.equal(humidifierAutoHumidifyControlEngaged({}, { hvac_mode: "fan_only", humidity_auto: "ON" }), true);
  assert.equal(humidifierAutoHumidifyControlEngaged({}, { humidity_auto: true }), true);
  assert.equal(humidifierAutoHumidifyControlEngaged({}, { humidity_auto: "OFF", hvac_mode: "fan_only" }), false);
});

test("humidifierAutoHumidifyControlEngaged treats paired humidifier mode auto as engaged", () => {
  assert.equal(
    humidifierAutoHumidifyControlEngaged(
      { preset_mode: "Manual" },
      { humidity_auto: "OFF", hvac_mode: "fan_only" },
      { mode: "auto" },
    ),
    true,
  );
});

test("humidityRangeIntersect tightens max when climate is stricter than humidifier", () => {
  const r = humidityRangeIntersect([
    { min_humidity: 30, max_humidity: 50 },
    { min_humidity: 30, max_humidity: 70 },
  ]);
  assert.equal(r.min, 30);
  assert.equal(r.max, 50);
});

test("pickHumidifierModeForAutoToggle maps hass-dyson normal/auto", () => {
  assert.equal(pickHumidifierModeForAutoToggle(["normal", "auto"], true), "auto");
  assert.equal(pickHumidifierModeForAutoToggle(["normal", "auto"], false), "normal");
});

test("humiditySetpointIsAutoTarget", () => {
  assert.equal(humiditySetpointIsAutoTarget({ humidity_auto: "ON" }, {}), true);
  assert.equal(humiditySetpointIsAutoTarget({ humidity_auto: "OFF" }, { mode: "auto" }), true);
  assert.equal(humiditySetpointIsAutoTarget({ humidity_auto: "OFF" }, { mode: "normal" }), false);
});

test("climateHasDysonStyleHumidityTarget", () => {
  assert.equal(climateHasDysonStyleHumidityTarget({ humidity_auto: "OFF" }), true);
  assert.equal(climateHasDysonStyleHumidityTarget({ target_humidity_formatted: "0050" }), true);
  assert.equal(climateHasDysonStyleHumidityTarget({ target_humidity: 50, min_humidity: 30 }), false);
});

test("orderedHumidifierEntityCandidates prefers climate object id", () => {
  assert.deepEqual(
    orderedHumidifierEntityCandidates("fan.a", "climate.b"),
    ["humidifier.b", "humidifier.a"],
  );
});

test("resolveHumidifierEntityId finds humidifier for climate when fan id mismatches", () => {
  const states = { "humidifier.serial1": { state: "on", attributes: {} } };
  assert.equal(resolveHumidifierEntityId(states, "fan.other", "climate.serial1", ""), "humidifier.serial1");
  assert.equal(resolveHumidifierEntityId(states, "fan.other", null, ""), null);
});

test("resolvedHumidityTargetNumberEntityId", () => {
  const states = {
    "number.dev_target_humidity": { state: "45", attributes: {} },
    "number.manual": { state: "50", attributes: {} },
  };
  assert.equal(
    resolvedHumidityTargetNumberEntityId(states, "climate.dev", "humidifier.dev", ""),
    "number.dev_target_humidity",
  );
  assert.equal(resolvedHumidityTargetNumberEntityId(states, "climate.dev", null, "number.manual"), "number.manual");
});

test("pickSelectOptionHumidityAuto", () => {
  assert.equal(pickSelectOptionHumidityAuto(["off", "on"], true), "on");
  assert.equal(pickSelectOptionHumidityAuto(["OFF", "ON"], false), "OFF");
  assert.equal(pickSelectOptionHumidityAuto(["Manual", "Automatic"], true), "Automatic");
  assert.equal(pickSelectOptionHumidityAuto([], true), null);
});

test("resolvedHumidityAutoToggleEntityId prefers config and discovers select by object id", () => {
  const states = {
    "select.my_override": { state: "on", attributes: {} },
    "select.dyson_device_humidity_auto": { state: "off", attributes: { options: [] } },
  };
  assert.equal(
    resolvedHumidityAutoToggleEntityId(states, "climate.dyson_device", "select.my_override"),
    "select.my_override",
  );
  assert.equal(resolvedHumidityAutoToggleEntityId(states, "climate.dyson_device", ""), "select.dyson_device_humidity_auto");
  assert.equal(resolvedHumidityAutoToggleEntityId(states, "climate.other", ""), null);
});

test("humidifierPurifyControlEngaged on for fan_only + auto fan even when humidity_auto on (Dyson)", () => {
  assert.equal(
    humidifierPurifyControlEngaged({ preset_mode: "Auto", auto_mode: true }, { hvac_mode: "fan_only", humidity_auto: "ON" }),
    true,
  );
});

test("isHumidityEnabled treats Dyson humidity_enabled HUMD", () => {
  assert.equal(isHumidityEnabled({ humidity_enabled: "HUMD" }), true);
  assert.equal(isHumidityEnabled({ humidity_enabled: "ON" }), true);
  assert.equal(isHumidityEnabled({ humidity_enabled: "OFF" }), false);
  assert.equal(isHumidityEnabled({ humidity_enabled: "OFF", target_humidity: 70, target_humidity_formatted: "0070" }), false);
});

test("inferTargetHumidity reads target_humidity_formatted", () => {
  assert.equal(inferTargetHumidity({ target_humidity_formatted: "0070" }), 70);
  assert.equal(inferTargetHumidity({ target_humidity: 55 }), 55);
  assert.equal(inferTargetHumidity({ humidity: 40 }), 40);
});

test("humidifierComboMode is false for humidity-only fan attributes", () => {
  assert.equal(
    humidifierComboMode("fan.living", null, false, { hvac_modes: ["off", "fan_only"] }),
    false,
  );
});

test("humidifierComboMode when linked humidifier entity exists in HA", () => {
  assert.equal(humidifierComboMode("fan.living", "humidifier.living", true, {}), true);
  assert.equal(humidifierComboMode("fan.living", "humidifier.living", false, {}), false);
});

test("humidifierComboMode when climate exposes humidify", () => {
  assert.equal(
    humidifierComboMode("fan.living", null, false, { hvac_modes: ["off", "fan_only", "humidify"] }),
    true,
  );
});

test("humidifierComboMode when climate has Dyson humidity_auto or HUMD", () => {
  assert.equal(humidifierComboMode("fan.x", null, false, { humidity_auto: "OFF" }), true);
  assert.equal(humidifierComboMode("fan.x", null, false, { humidity_enabled: "HUMD" }), true);
});

test("humidifierComboMode for humidifier.* entity", () => {
  assert.equal(humidifierComboMode("humidifier.living", null, false, {}), true);
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
  assert.equal(inferOscillationPresetIndex({ oscillation_enabled: "false", oscillation_span: 0 }, p), 0);
  assert.equal(inferOscillationPresetIndex({ oscillation_enabled: true }, p), 0);
});

test("oscillationIsEnabled", () => {
  assert.equal(oscillationIsEnabled({ oscillation_enabled: false }), false);
  assert.equal(oscillationIsEnabled({ oscillation_enabled: "false", oscillation_span: 0 }), false);
  assert.equal(oscillationIsEnabled({ oscillation_span: 0 }), false);
  assert.equal(oscillationIsEnabled({ oscillation_enabled: true, oscillation_span: 45 }), true);
  assert.equal(oscillationIsEnabled({ oscillating: false }), false);
  assert.equal(oscillationIsEnabled({ oscillating: true }), true);
});

test("oscillationDisplayFromSelect matches libdyson select entity", () => {
  const p = [0, 45, 90, 180, 350];
  assert.equal(oscillationDisplayFromSelect(null, p), null);
  assert.equal(oscillationDisplayFromSelect({ state: "45°", attributes: {} }, p), null);

  const optionsOnlyState = {
    state: "45°",
    attributes: { options: ["45°", "90°", "180°", "350°", "Breeze", "Custom"] },
  };
  assert.equal(oscillationDisplayFromSelect(optionsOnlyState, p).label, "OFF");
  assert.equal(
    oscillationDisplayFromSelect(optionsOnlyState, p, { oscillating: false, oscillation_span: 0 }).label,
    "OFF",
  );

  const offOnDevice = {
    state: "45°",
    attributes: {
      oscillation_enabled: false,
      oscillation_mode: "45°",
      oscillation_span: 45,
    },
  };
  const offDisp = oscillationDisplayFromSelect(offOnDevice, p);
  assert.equal(offDisp.label, "OFF");
  assert.equal(offDisp.engaged, false);
  assert.equal(offDisp.presetIndex, 0);

  const on45 = {
    state: "45°",
    attributes: {
      oscillation_enabled: true,
      oscillation_mode: "45°",
      oscillation_span: 45,
    },
  };
  const onDisp = oscillationDisplayFromSelect(on45, p);
  assert.equal(onDisp.label, "45°");
  assert.equal(onDisp.engaged, true);
  assert.equal(onDisp.presetIndex, 1);

  const modeOnlyOff = {
    state: "45°",
    attributes: {
      oscillation_mode: "45°",
      oscillation_span: 0,
    },
  };
  const modeOff = oscillationDisplayFromSelect(modeOnlyOff, p);
  assert.equal(modeOff.label, "OFF");
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
