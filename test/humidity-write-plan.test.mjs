import test from "node:test";
import assert from "node:assert/strict";
import {
  buildHumiditySetpointServiceCalls,
  humidifierEntityIdsForHumidityWrite,
  normalizeHumidityWrite,
} from "../src/humidity-write-plan.js";

const mockHass = (partialServices) => ({
  services: {
    humidifier: { set_humidity: {} },
    climate: { set_humidity: {} },
    number: { set_value: {} },
    ...(partialServices || {}),
  },
});

test("normalizeHumidityWrite", () => {
  assert.equal(normalizeHumidityWrite(undefined), "auto");
  assert.equal(normalizeHumidityWrite("CLIMATE"), "climate");
  assert.equal(normalizeHumidityWrite(" humidifier "), "humidifier");
});

test("humidifierEntityIdsForHumidityWrite dedupes card humidifier", () => {
  assert.deepEqual(humidifierEntityIdsForHumidityWrite("humidifier.a", "humidifier.a"), ["humidifier.a"]);
  assert.deepEqual(humidifierEntityIdsForHumidityWrite("humidifier.a", "fan.b"), ["humidifier.a"]);
  assert.deepEqual(humidifierEntityIdsForHumidityWrite(null, "humidifier.c"), ["humidifier.c"]);
});

test("buildHumiditySetpointServiceCalls auto: humidifier then climate then number", () => {
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
  assert.equal(calls[0].domain, "humidifier");
  assert.equal(calls[1].domain, "climate");
  assert.equal(calls[2].domain, "number");
});

test("buildHumiditySetpointServiceCalls climate mode skips humidifier", () => {
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
  const hass = mockHass({ humidifier: {}, climate: { set_humidity: {} }, number: { set_value: {} } });
  const calls = buildHumiditySetpointServiceCalls(hass, {
    next: 50,
    climateEntityId: "climate.x",
    humidifierEntityId: "humidifier.x",
    configuredEntityId: "fan.y",
    humidityNumberId: null,
    humidityWrite: "auto",
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].domain, "climate");
});
