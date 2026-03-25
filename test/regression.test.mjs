/**
 * REGRESSION TESTS — DO NOT DELETE OR MODIFY ASSERTIONS
 *
 * Each test here was written to catch a specific bug that was previously shipped
 * and subsequently fixed. If a test in this file fails, the implementation has
 * regressed. Fix the implementation.
 *
 * Rules for this file:
 * - Never delete a test.
 * - Never change an expected value in an assertion without explicit user sign-off
 *   AND a comment referencing the commit that changed the expected behavior.
 * - Adding new tests is always welcome — do so at the bottom of the file with a
 *   comment referencing the commit/issue that motivated the regression.
 * - test.todo() is acceptable for tracking known unresolved issues; weakening an
 *   existing assertion is not.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  humidityRangeIntersect,
  humidityStepperBounds,
  normalizeNightModeValue,
  isNightModeActive,
  oscillationIsEnabled,
  isAutoModeActive,
  fanLevelFromPercentage,
  percentageFromFanLevel,
  snapTargetHumidityToStep,
  adjustTargetHumidityByStep,
} from "../src/dyson-logic.js";

// ---------------------------------------------------------------------------
// Regression: humidity stepper range too narrow (fixed in 00b0fe9)
//
// Bug: humidityRangeIntersect used Math.max() to select the minimum bound, which
// picked the *most restrictive* floor rather than the *widest* floor. A climate
// entity reporting min_humidity: 50 (display-only) would block the stepper from
// going below 50% even though the physical device accepts 30%.
//
// Correct behaviour: use Math.min() for the lower bound so the full physical
// range is available. The tightest max is still applied (Math.min of maxima).
// ---------------------------------------------------------------------------

test("REGRESSION 00b0fe9: humidityRangeIntersect uses lowest min, not highest", () => {
  // Before fix: Math.max([50, 30]) = 50 → stepper started at 50, not 30
  // After fix:  Math.min([50, 30]) = 30 → stepper correctly starts at 30
  const r = humidityRangeIntersect([
    { min_humidity: 50, max_humidity: 70 }, // climate (display-only floor)
    { min_humidity: 30, max_humidity: 70 }, // humidifier (physical range)
  ]);
  assert.equal(r.min, 30, "min must be the lowest floor across entities, not the highest");
  assert.equal(r.max, 70);
});

test("REGRESSION 00b0fe9: humidityStepperBounds prefers humidifier range over narrower climate", () => {
  // The climate entity may report a smaller max for display purposes.
  // The humidifier entity's range is the writable physical range and must win.
  const fan = { min_humidity: 30, max_humidity: 50 };
  const climate = { min_humidity: 30, max_humidity: 50, target_humidity_step: 1 };
  const humidifier = { min_humidity: 30, max_humidity: 70 }; // physical range
  const r = humidityStepperBounds(fan, climate, humidifier);
  assert.equal(r.max, 70, "humidifier max_humidity must win over stricter climate max");
  assert.equal(r.min, 30);
  assert.equal(r.step, 10, "Dyson 30-70 range must infer step=10, not 1 from climate");
});

test("REGRESSION 00b0fe9: humidityStepperBounds infers step=10 for 30-70 Dyson range", () => {
  // The humidifier entity from hass-dyson typically lacks target_humidity_step,
  // but the physical device only accepts increments of 10. Before this fix the
  // step fell back to 1 from climate, causing the card to send values like 31, 32…
  // which the firmware silently rejects or rounds unpredictably.
  const humidifier = { min_humidity: 30, max_humidity: 70 }; // no explicit step
  const r = humidityStepperBounds(null, null, humidifier);
  assert.equal(r.step, 10, "step must be inferred as 10 for the standard Dyson 30-70 range");
});

// ---------------------------------------------------------------------------
// Regression: night mode "OFF" string evaluated as truthy (fixed in 072d186)
//
// Bug: The implementation was using Boolean(value) or a truthy check on the
// night_mode attribute. In JavaScript, Boolean("OFF") === true, so the card
// showed Night Mode as active when the device reported night_mode: "OFF".
//
// Correct behaviour: normalizeNightModeValue must explicitly check for the
// string "OFF"/"FALSE" and return false.
// ---------------------------------------------------------------------------

test("REGRESSION 072d186: normalizeNightModeValue('OFF') is false, not truthy", () => {
  // Boolean("OFF") === true in JavaScript — must NOT use bare truthy check
  assert.equal(normalizeNightModeValue("OFF"), false, '"OFF" string must normalize to false');
  assert.equal(normalizeNightModeValue("off"), false, '"off" string must normalize to false');
  assert.equal(normalizeNightModeValue("FALSE"), false, '"FALSE" must normalize to false');
  assert.equal(normalizeNightModeValue("0"), false, '"0" must normalize to false');
});

test("REGRESSION 072d186: normalizeNightModeValue('ON') is true", () => {
  assert.equal(normalizeNightModeValue("ON"), true, '"ON" string must normalize to true');
  assert.equal(normalizeNightModeValue("on"), true, '"on" string must normalize to true');
  assert.equal(normalizeNightModeValue(true), true, 'boolean true must stay true');
});

test("REGRESSION 072d186: isNightModeActive string OFF does not show night mode as on", () => {
  // Direct card-level check: night_mode: "OFF" from hass-dyson must not show Night Mode engaged
  assert.equal(isNightModeActive({ night_mode: "OFF" }), false);
  assert.equal(isNightModeActive({ night_mode: "off" }), false);
  assert.equal(isNightModeActive({ night_mode: "ON" }), true);
});

// ---------------------------------------------------------------------------
// Regression: oscillation_span: 0 must override oscillation_enabled: true
// (related to fix c39479e / oscillation logic hardening)
//
// Bug: when the Dyson device remembered its last sweep angle (e.g., 45°)
// but sweep was disabled, both oscillation_enabled and oscillation_mode would
// still show the remembered value. The card showed oscillation as active.
//
// Correct behaviour: oscillation_span: 0 is the ground-truth signal that sweep
// is off, and it must win over any other attribute.
// See CLAUDE.md: "Returns false when oscillation_span is explicitly 0 — even if
// oscillation_mode / select state still shows a remembered angle."
// ---------------------------------------------------------------------------

test("REGRESSION c39479e: oscillation_span=0 overrides oscillation_enabled=true", () => {
  assert.equal(
    oscillationIsEnabled({ oscillation_enabled: true, oscillation_span: 0 }),
    false,
    "oscillation_span:0 must win over oscillation_enabled:true",
  );
});

test("REGRESSION c39479e: oscillation_span=0 overrides oscillating=true", () => {
  assert.equal(
    oscillationIsEnabled({ oscillating: true, oscillation_span: 0 }),
    false,
    "oscillation_span:0 must win over oscillating:true",
  );
});

test('REGRESSION c39479e: oscillation_span=0 overrides string "true" oscillation_enabled', () => {
  assert.equal(
    oscillationIsEnabled({ oscillation_enabled: "true", oscillation_span: 0 }),
    false,
    'oscillation_span:0 must win even when oscillation_enabled is string "true"',
  );
});

// ---------------------------------------------------------------------------
// Regression: fan level / percentage scale integrity
//
// If the scale changes (e.g., mapping breaks for a specific level), the iOS
// app-mimicking display will show wrong numbers. This round-trip test catches
// any corruption of the level ↔ percentage mapping.
// ---------------------------------------------------------------------------

test("REGRESSION scale: fan level 1–10 round-trips through percentage without loss", () => {
  // Each level maps to a percentage that maps back to the same level.
  // A change to the scale (e.g., 1-based vs 0-based, different divisor) breaks all levels.
  for (let level = 0; level <= 10; level++) {
    const pct = percentageFromFanLevel(level);
    const back = fanLevelFromPercentage(pct);
    assert.equal(back, level, `level ${level} → ${pct}% → level ${back} (expected ${level})`);
  }
});

// ---------------------------------------------------------------------------
// Regression: humidity stepper must never go below min or above max
//
// Prevents a stepper that allows sending out-of-range values to the device,
// which can cause firmware errors or silent no-ops that confuse the user.
// ---------------------------------------------------------------------------

test("REGRESSION bounds: adjustTargetHumidityByStep clamps at min and max", () => {
  // Step down at floor → stays at floor
  assert.equal(adjustTargetHumidityByStep(30, -1, 30, 70, 10), 30, "step down from min must clamp at min");
  // Step up at ceiling → stays at ceiling
  assert.equal(adjustTargetHumidityByStep(70, +1, 30, 70, 10), 70, "step up from max must clamp at max");
});

test("REGRESSION bounds: snapTargetHumidityToStep clamps out-of-range inputs", () => {
  // Values below min must snap to min; values above max must snap to max
  assert.equal(snapTargetHumidityToStep(10, 30, 70, 10), 30, "below-min input must snap to min");
  assert.equal(snapTargetHumidityToStep(90, 30, 70, 10), 70, "above-max input must snap to max");
  assert.equal(snapTargetHumidityToStep(null, 30, 70, 10), 30, "null input must snap to min");
});
