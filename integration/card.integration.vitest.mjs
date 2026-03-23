import { describe, expect, test } from "vitest";

import "../src/hacs-dyson-remote.js";

const FAN_ENTITY_ID = "fan.dyson_device";
const CLIMATE_ENTITY_ID = "climate.dyson_device";

function createMockHass(overrides = {}) {
  const entityId = FAN_ENTITY_ID;
  const climateId = CLIMATE_ENTITY_ID;
  const states = {
    [entityId]: {
      state: "on",
      attributes: {
        is_on: true,
        preset_modes: ["Auto", "Manual", "Heat"],
        preset_mode: "Manual",
        percentage: 40,
        percentage_step: 10,
        direction: "forward",
        auto_mode: false,
        heating_mode: "OFF",
        oscillation_enabled: false,
        oscillation_span: 0,
        current_temperature: 21,
        target_temperature: 21,
        temperature_step: 1,
        min_temp: 7,
        max_temp: 37,
        night_mode: false,
        temperature_unit: "°C",
      },
    },
    [climateId]: {
      state: "fan_only",
      attributes: {
        hvac_modes: ["off", "fan_only", "heat"],
        hvac_mode: "fan_only",
        min_temp: 1,
        max_temp: 37,
        target_temp_step: 1,
        current_temperature: 20.8,
        temperature: 22,
      },
    },
  };

  const calls = [];
  const hass = {
    states,
    services: {
      fan: { turn_on: {}, turn_off: {}, set_percentage: {}, set_temperature: {}, oscillate: {}, set_preset_mode: {}, set_direction: {} },
      climate: { set_hvac_mode: {}, set_temperature: {}, set_humidity: {} },
      humidifier: { turn_on: {}, turn_off: {}, set_humidity: {} },
      dyson: { set_angle: {}, set_night_mode: {} },
    },
    callService: async (domain, service, data) => {
      calls.push({ domain, service, data });
    },
    ...overrides,
  };
  hass.__calls = calls;
  return hass;
}

function nextTick() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function createCard(hass) {
  const card = document.createElement("dyson-remote-card");
  card.setConfig({ entity: FAN_ENTITY_ID });
  card.hass = hass;
  document.body.appendChild(card);
  return card;
}

function createCardWithEntity(hass, entityId) {
  const card = document.createElement("dyson-remote-card");
  card.setConfig({ entity: entityId });
  card.hass = hass;
  document.body.appendChild(card);
  return card;
}

describe("dyson-remote-card integration harness", () => {
  test("stepper layout is vertical (+, readout, -)", () => {
    const card = createCard(createMockHass());
    const col = card.shadowRoot.querySelector('[data-stepper="airflow"] .stepper-col');
    const children = [...col.children];

    expect(children[0].getAttribute("data-action")).toBe("airflow_plus");
    expect(children[1].getAttribute("data-part")).toBe("airflow-mid");
    expect(children[2].getAttribute("data-action")).toBe("airflow_minus");
  });

  test("power engaged state tracks on/off", () => {
    const hass = createMockHass();
    const card = createCard(hass);
    const power = card.shadowRoot.querySelector('button[data-action="power"]');
    expect(power.classList.contains("is-engaged")).toBe(true);

    hass.states[FAN_ENTITY_ID].attributes.is_on = false;
    card.hass = hass;
    expect(power.classList.contains("is-engaged")).toBe(false);
  });

  test("oscillation + cycles to next preset and calls services", async () => {
    const hass = createMockHass();
    const card = createCard(hass);
    const plus = card.shadowRoot.querySelector('button[data-action="osc_plus"]');
    plus.click();
    await nextTick();

    const hasSetAngle = hass.__calls.some((c) => c.domain === "dyson" && c.service === "set_angle");
    const hasOscillateOn = hass.__calls.some(
      (c) => c.domain === "fan" && c.service === "oscillate" && c.data.oscillating === true,
    );
    expect(hasSetAngle).toBe(true);
    expect(hasOscillateOn).toBe(true);
  });

  test("heating +/- does not send temperature to fan.turn_on", async () => {
    const hass = createMockHass();
    const card = createCard(hass);
    const plus = card.shadowRoot.querySelector('button[data-action="heat_plus"]');
    plus.click();
    await nextTick();

    const invalidFanTurnOn = hass.__calls.some(
      (c) => c.domain === "fan" && c.service === "turn_on" && Object.hasOwn(c.data || {}, "temperature"),
    );
    expect(invalidFanTurnOn).toBe(false);
    const usedClimateTemp = hass.__calls.some((c) => c.domain === "climate" && c.service === "set_temperature");
    expect(usedClimateTemp).toBe(true);
  });

  test("cooling uses climate fan_only mode when climate entity exists", async () => {
    const hass = createMockHass({
      states: {
        [FAN_ENTITY_ID]: {
          state: "on",
          attributes: {
            is_on: true,
            preset_modes: ["Auto", "Manual", "Heat"],
            preset_mode: "Heat",
            heating_mode: "ON",
            current_temperature: 21,
            target_temperature: 24,
            temperature_step: 1,
            min_temp: 7,
            max_temp: 37,
          },
        },
        [CLIMATE_ENTITY_ID]: {
          state: "heat",
          attributes: {
            hvac_modes: ["off", "fan_only", "heat"],
            hvac_mode: "heat",
          },
        },
      },
    });

    const card = createCard(hass);
    const cool = card.shadowRoot.querySelector('button[data-action="cooling"]');
    cool.click();
    await nextTick();

    const switchedClimate = hass.__calls.some(
      (c) =>
        c.domain === "climate" &&
        c.service === "set_hvac_mode" &&
        c.data.entity_id === CLIMATE_ENTITY_ID &&
        c.data.hvac_mode === "fan_only",
    );
    expect(switchedClimate).toBe(true);
  });

  test("cooling ambient sync uses climate current_temperature when fan reports invalid value", async () => {
    const hass = createMockHass({
      states: {
        [FAN_ENTITY_ID]: {
          state: "on",
          attributes: {
            is_on: true,
            current_temperature: -273.15,
            target_temperature: 21.95,
            min_temp: 1,
            max_temp: 37,
            target_temp_step: 1,
            preset_modes: ["Auto", "Manual", "Heat"],
            preset_mode: "Manual",
          },
        },
        [CLIMATE_ENTITY_ID]: {
          state: "fan_only",
          attributes: {
            current_temperature: 20.8,
            target_temperature: 22,
            min_temp: 1,
            max_temp: 37,
            target_temp_step: 1,
            temperature_unit: "°C",
            hvac_modes: ["off", "fan_only", "heat"],
            hvac_mode: "fan_only",
          },
        },
      },
    });

    const card = createCard(hass);
    const cool = card.shadowRoot.querySelector('button[data-action="cooling"]');
    cool.click();
    await nextTick();

    const climateTempCall = hass.__calls.find((c) => c.domain === "climate" && c.service === "set_temperature");
    expect(climateTempCall).toBeTruthy();
    expect(climateTempCall.data.temperature).toBe(21);
  });

  test("card works when configured entity is climate.*", () => {
    const hass = createMockHass();
    const card = createCardWithEntity(hass, CLIMATE_ENTITY_ID);
    const airflowReadout = card.shadowRoot.querySelector('[data-part="airflow-mid"]');
    expect(airflowReadout).toBeTruthy();
    expect(airflowReadout.textContent).toContain("4");
  });

  test("readouts show OFF when fan is off and heating is off", () => {
    const hass = createMockHass({
      states: {
        "fan.dyson_zz7_ca_mja1790a": {
          state: "off",
          attributes: {
            is_on: false,
            percentage: 50,
            heating_mode: "OFF",
            heating_enabled: false,
            target_temperature: 24,
          },
        },
      },
    });
    const card = createCard(hass);
    const airflow = card.shadowRoot.querySelector('[data-part="airflow-mid"]');
    const heating = card.shadowRoot.querySelector('[data-part="thermal-target"]');
    expect(airflow.textContent).toBe("OFF");
    expect(heating.textContent).toBe("OFF");
  });

  test("humidifier capability switches thermal control label and icon", () => {
    const hass = createMockHass({
      states: {
        [FAN_ENTITY_ID]: {
          state: "on",
          attributes: {
            is_on: true,
            percentage: 50,
            humidity_enabled: "ON",
            target_humidity: 40,
            min_humidity: 30,
            max_humidity: 70,
          },
        },
        "humidifier.dyson_device": {
          state: "on",
          attributes: {
            min_humidity: 30,
            max_humidity: 70,
            humidity: 40,
          },
        },
      },
    });
    const card = createCard(hass);
    const label = card.shadowRoot.querySelector('[data-part="thermal-label"]');
    const readout = card.shadowRoot.querySelector('[data-part="thermal-target"]');
    const thermal = card.shadowRoot.querySelector('[data-stepper="thermal"]');
    const icon = card.shadowRoot.querySelector('[data-part="thermal-icon"] ha-icon');
    const coolingLabel = card.shadowRoot.querySelector('[data-part="cooling-label"]');
    const autoLabel = card.shadowRoot.querySelector('[data-part="auto-label"]');
    expect(label.textContent).toBe("Humidity control");
    expect(readout.textContent).toBe("40%");
    expect(thermal.getAttribute("data-thermal-mode")).toBe("humidity");
    expect(icon.icon).toBe("mdi:water");
    expect(coolingLabel.textContent).toBe("Auto purify");
    expect(autoLabel.textContent).toBe("Auto humidify");
  });

  test("humidity +/- calls humidifier.set_humidity when humidifier entity exists", async () => {
    const hass = createMockHass({
      states: {
        [FAN_ENTITY_ID]: {
          state: "on",
          attributes: {
            is_on: true,
            target_humidity: 40,
            humidity_enabled: "ON",
            min_humidity: 30,
            max_humidity: 50,
          },
        },
        "humidifier.dyson_device": {
          state: "on",
          attributes: {
            min_humidity: 30,
            max_humidity: 70,
            humidity: 40,
          },
        },
      },
    });
    const card = createCard(hass);
    const plus = card.shadowRoot.querySelector('button[data-action="heat_plus"]');
    plus.click();
    await nextTick();

    const humidifierCall = hass.__calls.find(
      (c) => c.domain === "humidifier" && c.service === "set_humidity" && c.data.entity_id === "humidifier.dyson_device",
    );
    expect(humidifierCall).toBeTruthy();
    expect(humidifierCall.data.humidity).toBe(41);
  });

  test("night action does not send night_mode via fan.turn_on", async () => {
    const hass = createMockHass();
    const card = createCard(hass);
    const night = card.shadowRoot.querySelector('button[data-action="night"]');
    night.click();
    await nextTick();

    const invalidNightPayload = hass.__calls.some(
      (c) => c.domain === "fan" && c.service === "turn_on" && Object.hasOwn(c.data || {}, "night_mode"),
    );
    expect(invalidNightPayload).toBe(false);
  });

  test("oscillation action does not send oscillating via fan.turn_on", async () => {
    const hass = createMockHass();
    const card = createCard(hass);
    const osc = card.shadowRoot.querySelector('button[data-action="osc_plus"]');
    osc.click();
    await nextTick();

    const invalidOscPayload = hass.__calls.some(
      (c) => c.domain === "fan" && c.service === "turn_on" && Object.hasOwn(c.data || {}, "oscillating"),
    );
    expect(invalidOscPayload).toBe(false);
  });

  test("airflow direction toggles via fan.set_direction", async () => {
    const hass = createMockHass();
    const card = createCard(hass);
    const directionBtn = card.shadowRoot.querySelector('button[data-action="direction"]');
    directionBtn.click();
    await nextTick();

    const directionCall = hass.__calls.find((c) => c.domain === "fan" && c.service === "set_direction");
    expect(directionCall).toBeTruthy();
    expect(directionCall.data.direction).toBe("reverse");
  });
});
