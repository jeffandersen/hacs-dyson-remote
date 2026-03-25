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
  adjustTargetHumidityByStep,
  humidityRangeIntersect,
  humidityStepperBounds,
  snapTargetHumidityToStep,
  humidifierAutoHumidifyControlEngaged,
  humidifierComboMode,
  humidifierPurifyControlEngaged,
  inferTargetHumidity,
  targetHumidityMatchesExpected,
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
  resolvedNightModeSwitchEntityId,
  snapTemperatureToStep,
  temperatureStepAndBounds,
} from "../src/dyson-logic.js";

// ---------------------------------------------------------------------------
// Preset mode normalization
// ---------------------------------------------------------------------------

test("normalizePresetModes accepts comma-separated strings", () => {
  // hass-dyson can return preset_modes as a comma-separated string rather than
  // an array. The card must normalize this before array operations.
  assert.deepEqual(normalizePresetModes("Auto, Manual, Heat"), ["Auto", "Manual", "Heat"]);
});

test("findHeatPresetName", () => {
  // Returns the first preset containing "heat" (case-insensitive), or null if
  // none exists. Used to detect whether Heat mode is available on this device.
  assert.equal(findHeatPresetName(["Auto", "Manual", "Heat"]), "Heat");
  assert.equal(findHeatPresetName(["Auto", "Focus heat mode"]), "Focus heat mode");
  assert.equal(findHeatPresetName(["Auto"]), null);
});

// ---------------------------------------------------------------------------
// Auto mode detection
// Three independent attribute signals must all trigger auto mode.
// See CLAUDE.md: "Fan auto mode is detected by any of: auto_mode === true,
// preset_mode === 'Auto', or fan_speed_setting matching /^\s*auto\s*$/i"
// ---------------------------------------------------------------------------

test("isAutoModeActive", () => {
  assert.equal(isAutoModeActive({ auto_mode: true }), true);
  assert.equal(isAutoModeActive({ preset_mode: "Auto" }), true);
  assert.equal(isAutoModeActive({ preset_mode: "Manual" }), false);
  // fan_speed_setting: Dyson-style string; case/whitespace-insensitive match
  assert.equal(isAutoModeActive({ fan_speed_setting: "Auto" }), true);
  assert.equal(isAutoModeActive({ fan_speed_setting: "  auto  " }), true);
});

// ---------------------------------------------------------------------------
// Heat detection
// ---------------------------------------------------------------------------

test("isHeatActive uses heating_mode, heating_enabled, and preset", () => {
  // heating_mode is a string "ON"/"OFF" on some hass-dyson builds
  assert.equal(isHeatActive({ heating_mode: "ON" }), true);
  // heating_enabled is a boolean on other builds
  assert.equal(isHeatActive({ heating_enabled: true }), true);
  // preset_mode match: device must have Heat in preset_modes and be in that mode
  assert.equal(isHeatActive({ preset_modes: ["Heat"], preset_mode: "Heat" }), true);
  assert.equal(isHeatActive({ heating_mode: "OFF", heating_enabled: false, preset_mode: "Manual" }), false);
});

// ---------------------------------------------------------------------------
// Humidifier combo control states
// See CLAUDE.md: "Combo humidifier mode" section
// ---------------------------------------------------------------------------

test("humidifierPurifyControlEngaged follows climate hvac_mode and fan auto airflow", () => {
  // Auto Purify = fan is in Auto mode AND climate is in fan_only (purifying, not humidifying)
  // humidity_auto being ON does not disable purify — that flag means auto *target*, not mode
  assert.equal(humidifierPurifyControlEngaged({ preset_mode: "Manual" }, { hvac_mode: "humidify" }), false);
  assert.equal(humidifierPurifyControlEngaged({ preset_mode: "Manual" }, { hvac_mode: "fan_only" }), false);
  assert.equal(humidifierPurifyControlEngaged({ preset_mode: "Auto" }, { hvac_mode: "fan_only" }), true);
  assert.equal(humidifierPurifyControlEngaged({ auto_mode: true }, { hvac_mode: "fan_only" }), true);
  assert.equal(humidifierPurifyControlEngaged({ preset_mode: "Manual" }, { hvac_mode: "off" }), false);
});

test("humidifierAutoHumidifyControlEngaged follows climate hvac_mode", () => {
  // Auto Humidify = climate in humidify mode (regardless of fan auto state)
  assert.equal(humidifierAutoHumidifyControlEngaged({ preset_mode: "Auto" }, { hvac_mode: "humidify" }), true);
  // fan auto + fan_only = purify mode, NOT auto humidify
  assert.equal(humidifierAutoHumidifyControlEngaged({ auto_mode: true }, { hvac_mode: "fan_only" }), false);
  assert.equal(humidifierAutoHumidifyControlEngaged({ preset_mode: "Manual" }, { hvac_mode: "fan_only" }), false);
});

test("humidifierAutoHumidifyControlEngaged uses Dyson climate humidity_auto", () => {
  // humidity_auto is a Dyson-specific attribute on the climate entity.
  // "ON" / true means auto humidity target is active.
  assert.equal(humidifierAutoHumidifyControlEngaged({}, { hvac_mode: "fan_only", humidity_auto: "ON" }), true);
  assert.equal(humidifierAutoHumidifyControlEngaged({}, { humidity_auto: true }), true);
  assert.equal(humidifierAutoHumidifyControlEngaged({}, { humidity_auto: "OFF", hvac_mode: "fan_only" }), false);
});

test("humidifierAutoHumidifyControlEngaged treats paired humidifier mode auto as engaged", () => {
  // hass-dyson can also represent auto-humidify via humidifier.mode === "auto"
  assert.equal(
    humidifierAutoHumidifyControlEngaged(
      { preset_mode: "Manual" },
      { humidity_auto: "OFF", hvac_mode: "fan_only" },
      { mode: "auto" },
    ),
    true,
  );
});

// ---------------------------------------------------------------------------
// Humidity stepper bounds
// See CLAUDE.md: "humidityStepperBounds() prefers the humidifier entity's
// min/max over the climate's, which may be narrower for display purposes.
// Step inferred: if range divides cleanly by 10 with ≤10 positions, use 10."
// ---------------------------------------------------------------------------

test("humidityRangeIntersect tightens max when climate is stricter than humidifier", () => {
  // The intersection takes the most restrictive bounds across all entities.
  // min_humidity: both agree at 30; max_humidity: 50 is stricter than 70 → result is 50.
  const r = humidityRangeIntersect([
    { min_humidity: 30, max_humidity: 50 },
    { min_humidity: 30, max_humidity: 70 },
  ]);
  assert.equal(r.min, 30);
  assert.equal(r.max, 50);
});

test("humidityRangeIntersect uses lowest advertised min when entities disagree", () => {
  // Use the widest min (lowest value) to avoid narrowing the range unnecessarily.
  const r = humidityRangeIntersect([
    { min_humidity: 50, max_humidity: 70 },
    { min_humidity: 30, max_humidity: 70 },
  ]);
  assert.equal(r.min, 30);
  assert.equal(r.max, 70);
});

test("humidityRangeIntersect picks largest humidity step from attrs", () => {
  // The largest step wins so the stepper matches the coarsest physical device constraint.
  const r = humidityRangeIntersect([
    { min_humidity: 30, max_humidity: 70, target_humidity_step: 1 },
    { min_humidity: 30, max_humidity: 70, humidity_step: 10 },
  ]);
  assert.equal(r.step, 10);
});

test("humidityStepperBounds prefers humidifier range and infers step=10 for Dyson 30–70", () => {
  // The humidifier entity's range is authoritative for the physical device limits.
  // The climate entity may report a narrower display range — we ignore that for stepper bounds.
  // (70-30)/4 = 10 levels of 10% each; the inferred step is 10.
  const fan = { min_humidity: 30, max_humidity: 50 };
  const climate = { min_humidity: 30, max_humidity: 50, target_humidity_step: 1 };
  const humidifier = { min_humidity: 30, max_humidity: 70 };
  const r = humidityStepperBounds(fan, climate, humidifier);
  assert.equal(r.min, 30);
  assert.equal(r.max, 70);
  assert.equal(r.step, 10);
});

test("humidityStepperBounds uses explicit humidifier step when present", () => {
  // target_humidity_step on the humidifier entity takes priority over inference.
  const humidifier = { min_humidity: 30, max_humidity: 70, target_humidity_step: 5 };
  const r = humidityStepperBounds(null, null, humidifier);
  assert.equal(r.step, 5);
});

test("humidityStepperBounds falls back to intersection without humidifier", () => {
  // When no humidifier entity is present, intersection of fan+climate is used.
  const fan = { min_humidity: 30, max_humidity: 50 };
  const climate = { min_humidity: 30, max_humidity: 50, target_humidity_step: 1 };
  const r = humidityStepperBounds(fan, climate, null);
  assert.equal(r.min, 30);
  assert.equal(r.max, 50);
  assert.equal(r.step, 1);
});

test("humidityStepperBounds humidityStepOverride wins over inferred step", () => {
  // Card config `humidity_step` allows the user to override inference.
  const humidifier = { min_humidity: 30, max_humidity: 70 };
  const r = humidityStepperBounds(null, null, humidifier, { humidityStepOverride: 5 });
  assert.equal(r.step, 5);
});

test("snapTargetHumidityToStep and adjustTargetHumidityByStep", () => {
  // snapTargetHumidityToStep rounds to the nearest step: 48 → 50 (step=10, min=30)
  assert.equal(snapTargetHumidityToStep(48, 30, 70, 10), 50);
  // null input snaps to min
  assert.equal(snapTargetHumidityToStep(null, 30, 70, 10), 30);
  // adjustTargetHumidityByStep: step down from 50 → 40
  assert.equal(adjustTargetHumidityByStep(50, -1, 30, 70, 10), 40);
  // clamps at min: step down from 30 → 30 (stays at floor)
  assert.equal(adjustTargetHumidityByStep(30, -1, 30, 70, 10), 30);
});

test("pickHumidifierModeForAutoToggle maps hass-dyson normal/auto", () => {
  // hass-dyson uses "normal" / "auto" as humidifier modes.
  // "auto" means auto humidity target, "normal" means manual target.
  assert.equal(pickHumidifierModeForAutoToggle(["normal", "auto"], true), "auto");
  assert.equal(pickHumidifierModeForAutoToggle(["normal", "auto"], false), "normal");
});

test("humiditySetpointIsAutoTarget", () => {
  // climate.humidity_auto "ON" → auto target engaged, regardless of humidifier state
  assert.equal(humiditySetpointIsAutoTarget({ humidity_auto: "ON" }, {}), true);
  // humidifier.mode "auto" also counts as auto target
  assert.equal(humiditySetpointIsAutoTarget({ humidity_auto: "OFF" }, { mode: "auto" }), true);
  // both say no → not auto
  assert.equal(humiditySetpointIsAutoTarget({ humidity_auto: "OFF" }, { mode: "normal" }), false);
});

test("climateHasDysonStyleHumidityTarget", () => {
  // Dyson-style: presence of humidity_auto attribute (even when "OFF") signals Dyson format
  assert.equal(climateHasDysonStyleHumidityTarget({ humidity_auto: "OFF" }), true);
  // target_humidity_formatted (e.g. "0050") also signals Dyson format
  assert.equal(climateHasDysonStyleHumidityTarget({ target_humidity_formatted: "0050" }), true);
  // Plain climate entity with numeric target_humidity does not use Dyson format
  assert.equal(climateHasDysonStyleHumidityTarget({ target_humidity: 50, min_humidity: 30 }), false);
});

test("orderedHumidifierEntityCandidates prefers climate object id", () => {
  // Try humidifier.<climate_oid> first, then humidifier.<fan_oid>
  // See CLAUDE.md entity resolution table: "humidifier.<climate object id> first"
  assert.deepEqual(
    orderedHumidifierEntityCandidates("fan.a", "climate.b"),
    ["humidifier.b", "humidifier.a"],
  );
});

test("resolveHumidifierEntityId finds humidifier for climate when fan id mismatches", () => {
  // Device serial in climate entity id should match humidifier entity id
  const states = { "humidifier.serial1": { state: "on", attributes: {} } };
  assert.equal(resolveHumidifierEntityId(states, "fan.other", "climate.serial1", ""), "humidifier.serial1");
  // No climate entity → cannot resolve humidifier
  assert.equal(resolveHumidifierEntityId(states, "fan.other", null, ""), null);
});

test("resolvedHumidityTargetNumberEntityId", () => {
  // Prefers number.<oid>_target_humidity by naming convention
  const states = {
    "number.dev_target_humidity": { state: "45", attributes: {} },
    "number.manual": { state: "50", attributes: {} },
  };
  assert.equal(
    resolvedHumidityTargetNumberEntityId(states, "climate.dev", "humidifier.dev", ""),
    "number.dev_target_humidity",
  );
  // Explicit config override wins over discovery
  assert.equal(resolvedHumidityTargetNumberEntityId(states, "climate.dev", null, "number.manual"), "number.manual");
});

test("pickSelectOptionHumidityAuto", () => {
  // Finds the correct option string for enabling/disabling auto humidity via a select entity.
  // Looks for options containing "on"/"off" or "auto"/"manual" patterns (case-insensitive).
  assert.equal(pickSelectOptionHumidityAuto(["off", "on"], true), "on");
  assert.equal(pickSelectOptionHumidityAuto(["OFF", "ON"], false), "OFF");
  assert.equal(pickSelectOptionHumidityAuto(["Manual", "Automatic"], true), "Automatic");
  // Empty options → cannot pick → null (caller should fall through to next strategy)
  assert.equal(pickSelectOptionHumidityAuto([], true), null);
});

test("resolvedHumidityAutoToggleEntityId prefers config and discovers select by object id", () => {
  const states = {
    "select.my_override": { state: "on", attributes: {} },
    "select.dyson_device_humidity_auto": { state: "off", attributes: { options: [] } },
  };
  // Explicit config override always wins
  assert.equal(
    resolvedHumidityAutoToggleEntityId(states, "climate.dyson_device", "select.my_override"),
    "select.my_override",
  );
  // Discovery: select.<climate_oid>_humidity_auto
  assert.equal(resolvedHumidityAutoToggleEntityId(states, "climate.dyson_device", ""), "select.dyson_device_humidity_auto");
  // No match → null
  assert.equal(resolvedHumidityAutoToggleEntityId(states, "climate.other", ""), null);
});

test("humidifierPurifyControlEngaged on for fan_only + auto fan even when humidity_auto on (Dyson)", () => {
  // Key Dyson quirk: humidity_auto "ON" means the *target* is auto-selected,
  // NOT that the device is in humidify mode. Auto Purify can still be engaged.
  // See CLAUDE.md: "humidity_auto being on does not turn this off"
  assert.equal(
    humidifierPurifyControlEngaged({ preset_mode: "Auto", auto_mode: true }, { hvac_mode: "fan_only", humidity_auto: "ON" }),
    true,
  );
});

test("isHumidityEnabled treats Dyson humidity_enabled HUMD", () => {
  // humidity_enabled is a Dyson-specific attribute using non-standard strings.
  // "HUMD" and "ON"/"HUMIDIFY" mean humidity is active; "OFF" means inactive.
  // See CLAUDE.md: climate attributes table, humidity_enabled row.
  assert.equal(isHumidityEnabled({ humidity_enabled: "HUMD" }), true);
  assert.equal(isHumidityEnabled({ humidity_enabled: "ON" }), true);
  assert.equal(isHumidityEnabled({ humidity_enabled: "OFF" }), false);
  // target_humidity persists when humidity is OFF (Dyson quirk) — must not infer enabled from it
  // See CLAUDE.md: "target_humidity keeps last value even when humidity is off"
  assert.equal(isHumidityEnabled({ humidity_enabled: "OFF", target_humidity: 70, target_humidity_formatted: "0070" }), false);
});

test("inferTargetHumidity reads target_humidity_formatted", () => {
  // Priority: Dyson-formatted string ("0070" → 70) > numeric target_humidity > ambient humidity
  assert.equal(inferTargetHumidity({ target_humidity_formatted: "0070" }), 70);
  assert.equal(inferTargetHumidity({ target_humidity: 55 }), 55);
  // Ambient humidity is last resort (no setpoint present)
  assert.equal(inferTargetHumidity({ humidity: 40 }), 40);
});

test("targetHumidityMatchesExpected ignores raw humidity when numeric target disagrees (ambient vs setpoint)", () => {
  // The ambient humidity sensor (`humidity` attr) must never be used to confirm
  // that a setpoint change was accepted — only target_humidity / target_humidity_formatted count.
  // See CLAUDE.md: "Raw humidity is intentionally ignored during reconcile"
  assert.equal(
    targetHumidityMatchesExpected({ target_humidity: 50, humidity: 49 }, 49),
    false, // ambient matches expected but setpoint (50) does not
  );
  assert.equal(targetHumidityMatchesExpected({ target_humidity: 49, humidity: 45 }, 49), true);
  assert.equal(targetHumidityMatchesExpected({ target_humidity: 50, humidity: 48 }, 49), false);
});

test("targetHumidityMatchesExpected reads formatted setpoint", () => {
  // Dyson-formatted target_humidity_formatted ("0049") must be parsed correctly
  assert.equal(targetHumidityMatchesExpected({ target_humidity_formatted: "0049" }, 49), true);
});

// ---------------------------------------------------------------------------
// Combo mode detection
// See CLAUDE.md: "humidifierComboMode() triggers when any of [4 conditions]"
// ---------------------------------------------------------------------------

test("humidifierComboMode is false for humidity-only fan attributes", () => {
  // A plain fan that reports a humidity sensor but has no paired humidifier
  // entity and no humidify hvac_mode must NOT show combo controls.
  assert.equal(
    humidifierComboMode("fan.living", null, false, { hvac_modes: ["off", "fan_only"] }),
    false,
  );
});

test("humidifierComboMode when linked humidifier entity exists in HA", () => {
  // humidifierEntityPresent=true triggers combo mode (condition 2 in CLAUDE.md)
  assert.equal(humidifierComboMode("fan.living", "humidifier.living", true, {}), true);
  // Entity id present but not in states → no combo
  assert.equal(humidifierComboMode("fan.living", "humidifier.living", false, {}), false);
});

test("humidifierComboMode when climate exposes humidify", () => {
  // Presence of "humidify" in hvac_modes signals a combo model (condition 3)
  assert.equal(
    humidifierComboMode("fan.living", null, false, { hvac_modes: ["off", "fan_only", "humidify"] }),
    true,
  );
});

test("humidifierComboMode when climate has Dyson humidity_auto or HUMD", () => {
  // Dyson Dyson Dyson — presence of humidity_auto attribute alone triggers combo (condition 4)
  assert.equal(humidifierComboMode("fan.x", null, false, { humidity_auto: "OFF" }), true);
  assert.equal(humidifierComboMode("fan.x", null, false, { humidity_enabled: "HUMD" }), true);
});

test("humidifierComboMode for humidifier.* entity", () => {
  // If the card is configured with a humidifier.* entity directly, always combo (condition 1)
  assert.equal(humidifierComboMode("humidifier.living", null, false, {}), true);
});

// ---------------------------------------------------------------------------
// Airflow / fan level display
// See CLAUDE.md: "Speed mapping: Percentages map to display levels 0–10 (10% per level)"
// ---------------------------------------------------------------------------

test("airflowCenterLabel", () => {
  // Auto mode → "AUTO" label (regardless of speed)
  assert.equal(airflowCenterLabel({ auto_mode: true, fan_speed_setting: "AUTO" }), "AUTO");
  // percentage: 0 → "OFF" (fan is on but at zero airflow)
  assert.equal(airflowCenterLabel({ auto_mode: false, percentage: 0 }), "OFF");
  // percentage: 40 → level 4 (40% / 10% per level)
  assert.equal(airflowCenterLabel({ auto_mode: false, percentage: 40 }), "4");
});

test("formatTargetTemperature hides invalid sensor readings", () => {
  // -273.15°C is absolute zero — libdyson reports this when no reading is available.
  // The card must hide it rather than displaying a nonsensical temperature.
  assert.equal(formatTargetTemperature({ target_temperature: 21.05, temperature_unit: "°C" }), "21°C");
  assert.equal(formatTargetTemperature({ target_temperature: -273.15, temperature_unit: "°C" }), null);
});

test("nextManualFanPercentage wraps at max", () => {
  // Cycling past max wraps back to the lowest manual level (not 0/Auto)
  assert.equal(nextManualFanPercentage(0, 10, 100), 10);
  assert.equal(nextManualFanPercentage(100, 10, 100), 10); // wraps: 100+10 > 100 → back to step
});

// ---------------------------------------------------------------------------
// Oscillation
// See CLAUDE.md: "Oscillation" section
// Default presets: [0, 45, 90, 180, 350] — 0 always means Off
// ---------------------------------------------------------------------------

test("oscillation presets and labels", () => {
  // null config → use built-in Dyson presets
  assert.deepEqual(normalizeOscillationPresets(null), [0, 45, 90, 180, 350]);
  // 0 is always the "Off" entry
  assert.equal(oscillationPresetLabel(0), "OFF");
  assert.equal(oscillationPresetLabel(90), "90°");
});

test("inferOscillationPresetIndex", () => {
  const p = [0, 45, 90, 180, 350];
  // oscillation_enabled: false → index 0 (Off)
  assert.equal(inferOscillationPresetIndex({ oscillation_enabled: false }, p), 0);
  // oscillation_enabled + span 88 → nearest preset is 90° (index 2)
  assert.equal(inferOscillationPresetIndex({ oscillation_enabled: true, oscillation_span: 88 }, p), 2);
  // string "false" must be treated as disabled
  assert.equal(inferOscillationPresetIndex({ oscillation_enabled: "false", oscillation_span: 0 }, p), 0);
  // enabled but no span → fallback to index 0 (no angle info)
  assert.equal(inferOscillationPresetIndex({ oscillation_enabled: true }, p), 0);
});

test("oscillationIsEnabled", () => {
  // oscillation_enabled: false → off
  assert.equal(oscillationIsEnabled({ oscillation_enabled: false }), false);
  // string "false" must be treated as disabled (hass-dyson returns strings)
  assert.equal(oscillationIsEnabled({ oscillation_enabled: "false", oscillation_span: 0 }), false);
  // oscillation_span: 0 → off even if no oscillation_enabled attr (libdyson quirk)
  // See CLAUDE.md: "Returns false when oscillation_span is explicitly 0 — even if
  // oscillation_mode / select state still shows a remembered angle"
  assert.equal(oscillationIsEnabled({ oscillation_span: 0 }), false);
  assert.equal(oscillationIsEnabled({ oscillation_enabled: true, oscillation_span: 45 }), true);
  // oscillating (HA standard attr) also works
  assert.equal(oscillationIsEnabled({ oscillating: false }), false);
  assert.equal(oscillationIsEnabled({ oscillating: true }), true);
});

test("oscillationDisplayFromSelect matches libdyson select entity", () => {
  const p = [0, 45, 90, 180, 350];
  // No select entity → null (fall back to fan attrs)
  assert.equal(oscillationDisplayFromSelect(null, p), null);
  // Select entity with only state+options (no oscillation_* keys) → fall back to fan attrs → null
  assert.equal(oscillationDisplayFromSelect({ state: "45°", attributes: {} }, p), null);

  // Select has only options (no oscillation_* keys): use fan attrs to determine enabled/disabled.
  // Fan attrs not provided → defaults to disabled → OFF
  const optionsOnlyState = {
    state: "45°",
    attributes: { options: ["45°", "90°", "180°", "350°", "Breeze", "Custom"] },
  };
  assert.equal(oscillationDisplayFromSelect(optionsOnlyState, p).label, "OFF");
  assert.equal(
    oscillationDisplayFromSelect(optionsOnlyState, p, { oscillating: false, oscillation_span: 0 }).label,
    "OFF",
  );

  // Select has oscillation_enabled: false — sweep is OFF even though state shows "45°"
  // This is the libdyson quirk: the device remembers last angle but sweep is disabled
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

  // Select has oscillation_enabled: true + span 45 → actively sweeping at 45°
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

  // oscillation_span: 0 disables even with an oscillation_mode present
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
  // Cycling backwards from index 0 wraps to the last preset (Off → 350° → ...)
  assert.equal(nextOscillationIndex(0, -1, 5), 4);
  // Cycling forward from last index wraps to 0 (Off)
  assert.equal(nextOscillationIndex(4, 1, 5), 0);
});

// ---------------------------------------------------------------------------
// Cooling / heating display
// ---------------------------------------------------------------------------

test("coolingDotActive", () => {
  // Cooling dot is active when heat mode is NOT on
  assert.equal(coolingDotActive({ heating_mode: "OFF" }), true);
  assert.equal(coolingDotActive({ heating_mode: "ON" }), false);
});

// ---------------------------------------------------------------------------
// Power state
// ---------------------------------------------------------------------------

test("entityIsPowered prefers is_on", () => {
  // is_on attribute takes priority over HA state string (hass-dyson sets both)
  assert.equal(entityIsPowered({ state: "off" }, { is_on: true }), true);
  assert.equal(entityIsPowered({ state: "on" }, { is_on: false }), false);
  // No is_on attr → fall back to state string
  assert.equal(entityIsPowered({ state: "on" }, {}), true);
  assert.equal(entityIsPowered({}, {}), false);
});

// ---------------------------------------------------------------------------
// Night mode
// hass-dyson returns night_mode as bool OR "ON"/"OFF" string — both must work.
// ---------------------------------------------------------------------------

test("isNightModeActive", () => {
  assert.equal(isNightModeActive({ night_mode: true }), true);
  assert.equal(isNightModeActive({ night_mode: false }), false);
  // String variants from older hass-dyson builds
  assert.equal(isNightModeActive({ night_mode: "ON" }), true);
  assert.equal(isNightModeActive({ night_mode: "off" }), false);
  assert.equal(isNightModeActive({ night_mode: "OFF" }), false);
});

test("resolvedNightModeSwitchEntityId", () => {
  // hass-dyson implements night mode as a switch entity, not via fan.turn_on.
  // See CLAUDE.md: "Night mode and sleep timer" section.
  const deviceId = "dev1";
  const states = {
    "fan.my_fan": { state: "on", attributes: {} },
    "climate.my_fan": { state: "fan_only", attributes: {} },
    "switch.my_fan_night_mode": { state: "off", attributes: {} },
  };
  const entities = {
    "fan.my_fan": { device_id: deviceId },
    "switch.my_fan_night_mode": { device_id: deviceId },
  };
  // Discovers switch.<fan_oid>_night_mode
  assert.equal(
    resolvedNightModeSwitchEntityId(states, entities, deviceId, "fan.my_fan", "climate.my_fan", ""),
    "switch.my_fan_night_mode",
  );
  // Explicit config override returns itself
  assert.equal(
    resolvedNightModeSwitchEntityId(states, entities, deviceId, "fan.my_fan", "climate.my_fan", "switch.my_fan_night_mode"),
    "switch.my_fan_night_mode",
  );
  // Discovery by friendly_name "Night mode" when id doesn't follow naming convention
  const statesNamed = {
    "fan.x": { state: "on", attributes: {} },
    "switch.dyson_random": {
      state: "off",
      attributes: { friendly_name: "Night mode" },
    },
  };
  const entNamed = {
    "fan.x": { device_id: "d1" },
    "switch.dyson_random": { device_id: "d1" },
  };
  assert.equal(resolvedNightModeSwitchEntityId(statesNamed, entNamed, "d1", "fan.x", null, ""), "switch.dyson_random");
});

// ---------------------------------------------------------------------------
// Airflow engaged state
// ---------------------------------------------------------------------------

test("isAirflowControlEngaged", () => {
  // Off → not engaged
  assert.equal(isAirflowControlEngaged({ state: "off" }, { is_on: false }), false);
  // On + auto mode → engaged
  assert.equal(isAirflowControlEngaged({ state: "on" }, { is_on: true, auto_mode: true }), true);
  // On + manual speed → engaged
  assert.equal(isAirflowControlEngaged({ state: "on" }, { is_on: true, percentage: 40 }), true);
});

// ---------------------------------------------------------------------------
// Temperature
// ---------------------------------------------------------------------------

test("ambientTemperature", () => {
  assert.equal(ambientTemperature({ current_temperature: 19.2 }), 19.2);
  // -273.15°C = absolute zero = libdyson sentinel for "no reading"; must return null
  assert.equal(ambientTemperature({ current_temperature: -273.15 }), null);
});

test("adjustFanPercentage clamps", () => {
  assert.equal(adjustFanPercentage(40, 1, { percentage_step: 10 }), 50);
  assert.equal(adjustFanPercentage(5, -1, { percentage_step: 10 }), 0);
  assert.equal(adjustFanPercentage(95, 1, { percentage_step: 10 }), 100);
});

test("fan level conversion helpers", () => {
  // Dyson iOS app shows levels 1–10. 0% = Off (level 0), 10% = level 1, ..., 100% = level 10.
  // See CLAUDE.md: "Speed mapping: Percentages map to display levels 0–10 (10% per level)"
  assert.equal(fanLevelFromPercentage(0), 0);
  assert.equal(fanLevelFromPercentage(10), 1);
  assert.equal(fanLevelFromPercentage(40), 4);
  assert.equal(percentageFromFanLevel(0), 0);
  assert.equal(percentageFromFanLevel(7), 70);
});

test("snapTemperatureToStep", () => {
  // Snaps to nearest step boundary: 21.2 with step=0.5 → 21.0
  assert.equal(snapTemperatureToStep(21.2, 7, 40, 0.5), 21);
  assert.equal(snapTemperatureToStep(21.24, 7, 40, 0.5), 21);
});

test("adjustTargetTemperature", () => {
  const attrs = { min_temp: 7, max_temp: 40, temperature_step: 1, target_temperature: 21 };
  assert.equal(adjustTargetTemperature(21, 1, attrs), 22);
  // Clamps at min: step down from 7 → stays at 7
  assert.equal(adjustTargetTemperature(7, -1, attrs), 7);
});

test("heatingTargetReadout", () => {
  assert.equal(
    heatingTargetReadout({ target_temperature: 21.5, temperature_unit: "°C", temperature_step: 0.5 }),
    "21.5°C",
  );
  // Absolute-zero sentinel → show em-dash placeholder
  assert.equal(heatingTargetReadout({ target_temperature: -300, temperature_unit: "°C" }), "—");
});

test("temperatureStepAndBounds", () => {
  // min/max may be reported in either order — result should always be {min < max}
  const b = temperatureStepAndBounds({ min_temp: 30, max_temp: 10, temperature_step: 0.5 });
  assert.equal(b.min, 10);
  assert.equal(b.max, 30);
  assert.equal(b.step, 0.5);
});

// ---------------------------------------------------------------------------
// INVARIANT TESTS
// These test mathematical and logical properties rather than specific values.
// They are structurally immune to tautological rewrites — you cannot make them
// pass by changing an expected value without breaking the invariant itself.
// ---------------------------------------------------------------------------

test("INVARIANT: fanLevelFromPercentage and percentageFromFanLevel are strict inverses", () => {
  // Every level 0–10 must survive a round-trip through both functions unchanged.
  // If either function changes its scale, this fails for ALL levels simultaneously,
  // making the regression impossible to silently paper over.
  for (let level = 0; level <= 10; level++) {
    const pct = percentageFromFanLevel(level);
    assert.equal(
      fanLevelFromPercentage(pct),
      level,
      `round-trip failed: level ${level} → ${pct}% → ${fanLevelFromPercentage(pct)}`,
    );
  }
});

test("INVARIANT: fanLevelFromPercentage output is always an integer in 0–10", () => {
  // The iOS Dyson app shows levels 1–10 (plus 0 for off). Any value outside this
  // range or any fractional value would display incorrectly.
  for (let pct = 0; pct <= 100; pct += 10) {
    const level = fanLevelFromPercentage(pct);
    assert.ok(
      Number.isInteger(level) && level >= 0 && level <= 10,
      `fanLevelFromPercentage(${pct}) = ${level}, expected integer 0–10`,
    );
  }
});

test("INVARIANT: auto mode detection is consistent across all three attribute signals", () => {
  // All three ways of signalling auto mode must produce the same result.
  // If one path is broken, the card shows inconsistent state.
  const autoSignals = [
    { auto_mode: true },
    { preset_mode: "Auto" },
    { fan_speed_setting: "AUTO" },
    { fan_speed_setting: "  auto  " },
  ];
  for (const attrs of autoSignals) {
    assert.equal(
      isAutoModeActive(attrs),
      true,
      `auto not detected via ${JSON.stringify(attrs)}`,
    );
  }
  const nonAutoSignals = [
    { auto_mode: false },
    { preset_mode: "Manual" },
    { fan_speed_setting: "0004" },
  ];
  for (const attrs of nonAutoSignals) {
    assert.equal(
      isAutoModeActive(attrs),
      false,
      `incorrectly detected auto via ${JSON.stringify(attrs)}`,
    );
  }
});

test("INVARIANT: snapTargetHumidityToStep output is always within [min, max]", () => {
  // Whatever input value is given, the snapped result must stay within bounds.
  const min = 30, max = 70, step = 10;
  const inputs = [0, 15, 29, 30, 31, 50, 69, 70, 71, 100, null, undefined];
  for (const input of inputs) {
    const snapped = snapTargetHumidityToStep(input, min, max, step);
    assert.ok(
      snapped >= min && snapped <= max,
      `snapTargetHumidityToStep(${input}) = ${snapped}, expected in [${min}, ${max}]`,
    );
  }
});

test("INVARIANT: adjustTargetHumidityByStep never exceeds bounds", () => {
  // Stepping up from max or down from min must clamp, never overflow.
  const min = 30, max = 70, step = 10;
  assert.equal(adjustTargetHumidityByStep(70, +1, min, max, step), 70, "step up from max should clamp");
  assert.equal(adjustTargetHumidityByStep(30, -1, min, max, step), 30, "step down from min should clamp");
});

test("INVARIANT: oscillationIsEnabled is false whenever oscillation_span is explicitly 0", () => {
  // oscillation_span: 0 means sweep is off — this must win over any other attribute.
  // The device remembers the last angle but sweep is disabled.
  // See CLAUDE.md: "Returns false when oscillation_span is explicitly 0 — even if
  // oscillation_mode/select state still shows a remembered angle"
  const span0Variants = [
    { oscillation_span: 0 },
    { oscillation_enabled: true, oscillation_span: 0 },        // enabled=true but span=0
    { oscillation_mode: "45°", oscillation_span: 0 },           // mode set but span=0
    { oscillating: true, oscillation_span: 0 },                 // oscillating=true but span=0
    { oscillation_enabled: "true", oscillation_span: 0 },       // string "true" but span=0
  ];
  for (const attrs of span0Variants) {
    assert.equal(
      oscillationIsEnabled(attrs),
      false,
      `oscillationIsEnabled should be false when oscillation_span=0, attrs=${JSON.stringify(attrs)}`,
    );
  }
});

test("INVARIANT: humidifierComboMode triggers for all documented conditions", () => {
  // Each of the four conditions in CLAUDE.md must independently trigger combo mode.
  // If any condition is removed, the relevant device type loses its humidity controls.

  // Condition 1: configured entity starts with humidifier.*
  assert.equal(humidifierComboMode("humidifier.x", null, false, {}), true, "condition 1: humidifier.* entity");

  // Condition 2: paired humidifier.* entity exists in hass.states
  assert.equal(humidifierComboMode("fan.x", "humidifier.x", true, {}), true, "condition 2: humidifier in states");

  // Condition 3: climate lists "humidify" in hvac_modes
  assert.equal(
    humidifierComboMode("fan.x", null, false, { hvac_modes: ["off", "fan_only", "humidify"] }),
    true,
    "condition 3: humidify in hvac_modes",
  );

  // Condition 4a: climate has humidity_auto attribute (any value)
  assert.equal(humidifierComboMode("fan.x", null, false, { humidity_auto: "OFF" }), true, "condition 4a: humidity_auto attr");

  // Condition 4b: climate has humidity_enabled: "HUMD"
  assert.equal(humidifierComboMode("fan.x", null, false, { humidity_enabled: "HUMD" }), true, "condition 4b: HUMD");

  // Counter-check: plain fan with no humidifier signals → no combo
  assert.equal(
    humidifierComboMode("fan.x", null, false, { hvac_modes: ["off", "fan_only"] }),
    false,
    "plain fan should not trigger combo",
  );
});
