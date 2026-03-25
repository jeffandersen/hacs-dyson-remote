import test from "node:test";
import assert from "node:assert/strict";
import {
  buildHumiditySetpointServiceCalls,
  humidifierEntityIdsForHumidityWrite,
  normalizeHumidityWrite,
} from "../src/humidity-write-plan.js";

// ---------------------------------------------------------------------------
// Humidity write plan
// See CLAUDE.md: "Humidity write path (humidity-write-plan.js)" section
// Order for `auto`: humidifier.set_humidity → climate.set_humidity → number.set_value
// Only one path fires per press to avoid race conditions — but the plan builds
// the ordered list; the caller fires only the first available.
// ---------------------------------------------------------------------------

const mockHass = (partialServices) => ({
  services: {
    humidifier: { set_humidity: {} },
    climate: { set_humidity: {} },
    number: { set_value: {} },
    ...(partialServices || {}),
  },
});

test("normalizeHumidityWrite", () => {
  // undefined → default mode "auto"
  assert.equal(normalizeHumidityWrite(undefined), "auto");
  // case-insensitive
  assert.equal(normalizeHumidityWrite("CLIMATE"), "climate");
  // trims whitespace
  assert.equal(normalizeHumidityWrite(" humidifier "), "humidifier");
});

test("humidifierEntityIdsForHumidityWrite dedupes card humidifier", () => {
  // When the configured entity IS the humidifier, don't duplicate it in the list
  assert.deepEqual(humidifierEntityIdsForHumidityWrite("humidifier.a", "humidifier.a"), ["humidifier.a"]);
  // Fan entity configured → humidifier is the discovered entity only
  assert.deepEqual(humidifierEntityIdsForHumidityWrite("humidifier.a", "fan.b"), ["humidifier.a"]);
  // No discovered humidifier but card entity is a humidifier.* → use it
  assert.deepEqual(humidifierEntityIdsForHumidityWrite(null, "humidifier.c"), ["humidifier.c"]);
});

test("buildHumiditySetpointServiceCalls auto: humidifier then climate then number", () => {
  // `auto` mode builds all three calls in priority order.
  // Caller fires only the first one that succeeds — but the plan must be in this order.
  // See CLAUDE.md: "Only one path fires per press to avoid race conditions."
  const hass = mockHass();
  const calls = buildHumiditySetpointServiceCalls(hass, {
    next: 50,
    climateEntityId: "climate.x",
    humidifierEntityId: "humidifier.x",
    configuredEntityId: "fan.y",
    humidityNumberId: "number.z",
    humidityWrite: "auto",
  });
  assert.equal(calls.length, 3);
  assert.equal(calls[0].domain, "humidifier"); // first priority
  assert.equal(calls[1].domain, "climate");    // second priority
  assert.equal(calls[2].domain, "number");     // last resort
});

test("buildHumiditySetpointServiceCalls climate mode skips humidifier", () => {
  // humidity_write: "climate" — user explicitly wants climate path, skip humidifier
  const hass = mockHass();
  const calls = buildHumiditySetpointServiceCalls(hass, {
    next: 50,
    climateEntityId: "climate.x",
    humidifierEntityId: "humidifier.x",
    configuredEntityId: "fan.y",
    humidityNumberId: "number.z",
    humidityWrite: "climate",
  });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].domain, "climate");
  assert.equal(calls[1].domain, "number");
});

test("buildHumiditySetpointServiceCalls humidifier mode skips climate", () => {
  // humidity_write: "humidifier" — user explicitly wants humidifier path, skip climate
  const hass = mockHass();
  const calls = buildHumiditySetpointServiceCalls(hass, {
    next: 50,
    climateEntityId: "climate.x",
    humidifierEntityId: "humidifier.x",
    configuredEntityId: "fan.y",
    humidityNumberId: "number.z",
    humidityWrite: "humidifier",
  });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].domain, "humidifier");
  assert.equal(calls[1].domain, "number");
});

test("buildHumiditySetpointServiceCalls omits calls when service missing", () => {
  // If humidifier.set_humidity is absent from hass.services, skip that call entirely.
  // Prevents calling unavailable services that would cause HA errors.
  const hass = mockHass({ humidifier: {}, climate: { set_humidity: {} }, number: { set_value: {} } });
  const calls = buildHumiditySetpointServiceCalls(hass, {
    next: 50,
    climateEntityId: "climate.x",
    humidifierEntityId: "humidifier.x",
    configuredEntityId: "fan.y",
    humidityNumberId: null,       // number entity not available either
    humidityWrite: "auto",
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].domain, "climate");
});
