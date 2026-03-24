import { describe, expect, test, vi } from "vitest";

import "../src/hacs-dyson-remote.js";

const FAN_ENTITY_ID = "fan.dyson_device";
const CLIMATE_ENTITY_ID = "climate.dyson_device";

function createMockHass(overrides = {}) {
  const entityId = FAN_ENTITY_ID;
  const climateId = CLIMATE_ENTITY_ID;
  const deviceId = "device-dyson-1";
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
    entities: {
      [entityId]: { device_id: deviceId },
      [climateId]: { device_id: deviceId },
    },
    services: {
      fan: { turn_on: {}, turn_off: {}, set_percentage: {}, set_temperature: {}, oscillate: {}, set_preset_mode: {}, set_direction: {} },
      climate: { set_hvac_mode: {}, set_temperature: {}, set_humidity: {} },
      humidifier: { turn_on: {}, turn_off: {}, set_humidity: {}, set_mode: {} },
      dyson: { set_angle: {}, set_night_mode: {} },
      hass_dyson: { set_sleep_timer: {}, cancel_sleep_timer: {} },
      select: { select_option: {} },
      switch: { turn_on: {}, turn_off: {} },
      number: { set_value: {} },
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

function createCardWithConfig(hass, config) {
  const card = document.createElement("dyson-remote-card");
  card.setConfig(config);
  card.hass = hass;
  document.body.appendChild(card);
  return card;
}

describe("dyson-remote-card integration harness", () => {
  test("footer row includes timer, night, direction controls", () => {
    const card = createCard(createMockHass());
    const grid = card.shadowRoot.querySelector(".grid");
    const cells = [...grid.children].filter((el) => el.classList?.contains("cell"));
    const iTimer = cells.findIndex((c) => c.classList.contains("cell--footer-timer"));
    const iNight = cells.findIndex((c) => c.classList.contains("cell--footer-night"));
    const iDirection = cells.findIndex((c) => c.classList.contains("cell--footer-direction"));
    expect(iTimer).toBeGreaterThanOrEqual(0);
    expect(iNight).toBeGreaterThan(iTimer);
    expect(iDirection).toBeGreaterThan(iNight);
  });

  test("timer button opens overlay and cancel calls hass_dyson.cancel_sleep_timer", async () => {
    const hass = createMockHass();
    const card = createCard(hass);
    const timerBtn = card.shadowRoot.querySelector('button[data-action="timer"]');
    timerBtn.click();
    await nextTick();
    const overlay = card.shadowRoot.querySelector('[data-part="timer-overlay"]');
    expect(overlay.hidden).toBe(false);
    const cancel = card.shadowRoot.querySelector('button[data-action="timer_cancel"]');
    cancel.click();
    await nextTick();
    const call = hass.__calls.find((c) => c.domain === "hass_dyson" && c.service === "cancel_sleep_timer");
    expect(call).toBeTruthy();
    expect(call.data.device_id).toBe("device-dyson-1");
  });

  test("timer preset calls hass_dyson.set_sleep_timer and closes overlay", async () => {
    const hass = createMockHass();
    const card = createCard(hass);
    card.shadowRoot.querySelector('button[data-action="timer"]').click();
    await nextTick();
    card.shadowRoot.querySelector('button[data-action="timer_set_120"]').click();
    await nextTick();
    const call = hass.__calls.find((c) => c.domain === "hass_dyson" && c.service === "set_sleep_timer");
    expect(call).toBeTruthy();
    expect(call.data.device_id).toBe("device-dyson-1");
    expect(call.data.minutes).toBe(120);
    const overlay = card.shadowRoot.querySelector('[data-part="timer-overlay"]');
    expect(overlay.hidden).toBe(true);
  });

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

  test("oscillation uses select.select_option when select.<fan>_oscillation exists", async () => {
    const selectId = "select.dyson_device_oscillation";
    const hass = createMockHass();
    hass.states[selectId] = {
      state: "45°",
      attributes: {
        options: ["45°", "90°", "180°", "350°", "Custom"],
      },
    };
    const card = createCard(hass);
    const plus = card.shadowRoot.querySelector('button[data-action="osc_plus"]');
    plus.click();
    await nextTick();

    const selectCall = hass.__calls.find((c) => c.domain === "select" && c.service === "select_option");
    expect(selectCall).toBeTruthy();
    expect(selectCall.data.entity_id).toBe(selectId);
    expect(selectCall.data.option).toBe("45°");

    const hasSetAngle = hass.__calls.some((c) => c.domain === "dyson" && c.service === "set_angle");
    expect(hasSetAngle).toBe(false);
  });

  test("oscillation readout uses select.oscillation_enabled when fan attrs disagree", () => {
    const selectId = "select.dyson_device_oscillation";
    const hass = createMockHass();
    hass.states[FAN_ENTITY_ID].attributes.oscillation_enabled = true;
    hass.states[FAN_ENTITY_ID].attributes.oscillation_span = 45;
    hass.states[selectId] = {
      state: "45°",
      attributes: {
        options: ["45°", "90°", "180°", "350°", "Custom"],
        oscillation_enabled: false,
        oscillation_mode: "45°",
        oscillation_span: 45,
      },
    };
    const card = createCard(hass);
    const oscMid = card.shadowRoot.querySelector('[data-part="osc-mid"]');
    expect(oscMid.textContent).toBe("OFF");
  });

  test("oscillation readout uses fan attrs when select only has options + state (no oscillation_* keys)", () => {
    const selectId = "select.dyson_device_oscillation";
    const hass = createMockHass();
    hass.states[FAN_ENTITY_ID].attributes.oscillating = false;
    hass.states[FAN_ENTITY_ID].attributes.oscillation_enabled = false;
    hass.states[FAN_ENTITY_ID].attributes.oscillation_span = 0;
    hass.states[selectId] = {
      state: "45°",
      attributes: {
        options: ["45°", "90°", "180°", "350°", "Breeze", "Custom"],
      },
    };
    const card = createCard(hass);
    const oscMid = card.shadowRoot.querySelector('[data-part="osc-mid"]');
    expect(oscMid.textContent).toBe("OFF");
  });

  test("oscillation select auto-discovery supports non-default select id suffixes", () => {
    const hass = createMockHass();
    hass.states[FAN_ENTITY_ID].attributes.oscillation_enabled = true;
    hass.states[FAN_ENTITY_ID].attributes.oscillation_span = 45;
    hass.states["select.dyson_device_oscillation_mode"] = {
      state: "45°",
      attributes: {
        options: ["45°", "90°", "180°", "350°", "Breeze", "Custom"],
        oscillation_enabled: false,
        oscillation_mode: "45°",
        oscillation_span: 0,
      },
    };
    const card = createCard(hass);
    const oscMid = card.shadowRoot.querySelector('[data-part="osc-mid"]');
    expect(oscMid.textContent).toBe("OFF");
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

  test("fan with humidity attributes but no combo keeps heating thermal UI", () => {
    const hass = createMockHass();
    Object.assign(hass.states[FAN_ENTITY_ID].attributes, {
      target_humidity: 50,
      min_humidity: 30,
      max_humidity: 70,
    });
    const card = createCard(hass);
    expect(card.shadowRoot.querySelector('[data-part="thermal-label"]').textContent).toBe("Heating");
    expect(card.shadowRoot.querySelector('[data-part="thermal-icon"] ha-icon').icon).toBe("mdi:radiator");
    expect(card.shadowRoot.querySelector('[data-part="cooling-label"]').textContent).toBe("Cooling");
    expect(card.shadowRoot.querySelector('[data-part="auto-label"]').textContent).toBe("Auto mode");
    expect(card.shadowRoot.querySelector('[data-part="cooling-circle-icon"]').hidden).toBe(false);
    expect(card.shadowRoot.querySelector('[data-part="humidifier-purify-auto"]').hidden).toBe(true);
    expect(card.shadowRoot.querySelector('[data-part="auto-word"]').hidden).toBe(false);
    expect(card.shadowRoot.querySelector('[data-part="auto-humidify-icon"]').hidden).toBe(true);
    const circle = card.shadowRoot.querySelector('[data-part="cooling-circle-icon"]');
    expect(circle.hidden).toBe(false);
    expect(getComputedStyle(circle).display).not.toBe("none");
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
    expect(card.shadowRoot.querySelector('[data-part="cooling-circle-icon"]').hidden).toBe(true);
    expect(card.shadowRoot.querySelector('[data-part="humidifier-purify-auto"]').hidden).toBe(false);
    expect(card.shadowRoot.querySelector('[data-part="auto-word"]').hidden).toBe(true);
    const autoHumidifyIcon = card.shadowRoot.querySelector('[data-part="auto-humidify-icon"]');
    expect(autoHumidifyIcon.hidden).toBe(false);
    expect(autoHumidifyIcon.querySelector("ha-icon")?.icon).toBe("mdi:water");
    const coolingCircle = card.shadowRoot.querySelector('[data-part="cooling-circle-icon"]');
    expect(coolingCircle.hidden).toBe(true);
    expect(getComputedStyle(coolingCircle).display).toBe("none");
    expect(getComputedStyle(autoHumidifyIcon).display).not.toBe("none");
  });

  test("main grid uses combo humidifier column-order class only in combo mode", () => {
    expect(createCard(createMockHass()).shadowRoot.querySelector(".grid")?.classList.contains("grid--combo-humid")).toBe(
      false,
    );
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
          attributes: { min_humidity: 30, max_humidity: 70, humidity: 40 },
        },
      },
    });
    expect(createCard(hass).shadowRoot.querySelector(".grid")?.classList.contains("grid--combo-humid")).toBe(true);
  });

  test("Auto purify in combo mode sets climate fan_only and fan Auto preset", async () => {
    const hass = createMockHass({
      states: {
        [FAN_ENTITY_ID]: {
          state: "on",
          attributes: {
            is_on: true,
            preset_modes: ["Auto", "Manual", "Heat"],
            preset_mode: "Manual",
            percentage: 50,
            auto_mode: false,
            heating_mode: "OFF",
            heating_enabled: false,
            direction: "forward",
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
        [CLIMATE_ENTITY_ID]: {
          state: "humidify",
          attributes: {
            hvac_modes: ["off", "fan_only", "humidify", "heat"],
            hvac_mode: "humidify",
            min_temp: 1,
            max_temp: 37,
            target_temp_step: 1,
            current_temperature: 20.8,
            temperature: 22,
          },
        },
        "humidifier.dyson_device": {
          state: "on",
          attributes: { min_humidity: 30, max_humidity: 70, humidity: 40 },
        },
      },
    });
    const card = createCard(hass);
    const cooling = card.shadowRoot.querySelector('button[data-action="cooling"]');
    cooling.click();
    await nextTick();

    const hvacCall = hass.__calls.find(
      (c) => c.domain === "climate" && c.service === "set_hvac_mode" && c.data.entity_id === CLIMATE_ENTITY_ID,
    );
    expect(hvacCall).toBeTruthy();
    expect(hvacCall.data.hvac_mode).toBe("fan_only");

    const presetCall = hass.__calls.find(
      (c) => c.domain === "fan" && c.service === "set_preset_mode" && c.data.entity_id === FAN_ENTITY_ID,
    );
    expect(presetCall).toBeTruthy();
    expect(presetCall.data.preset_mode).toBe("Auto");
  });

  test("auto_mode calls climate.set_humidity with humidity_auto when no humidify hvac mode (Dyson-style)", async () => {
    const hass = createMockHass();
    hass.services.climate.set_humidity = {
      fields: { entity_id: {}, humidity: {}, humidity_auto: {} },
    };
    hass.states["humidifier.dyson_device"] = {
      state: "on",
      attributes: { min_humidity: 30, max_humidity: 50, humidity: 40 },
    };
    Object.assign(hass.states[CLIMATE_ENTITY_ID].attributes, {
      hvac_modes: ["off", "fan_only"],
      hvac_mode: "fan_only",
      min_humidity: 30,
      max_humidity: 50,
      target_humidity: 44,
      humidity_auto: "OFF",
    });
    const card = createCard(hass);
    const autoBtn = card.shadowRoot.querySelector('button[data-action="auto_mode"]');
    autoBtn.click();
    await nextTick();

    const humCall = hass.__calls.find(
      (c) => c.domain === "climate" && c.service === "set_humidity" && c.data.entity_id === CLIMATE_ENTITY_ID,
    );
    expect(humCall).toBeTruthy();
    expect(humCall.data.humidity).toBe(44);
    expect(humCall.data.humidity_auto).toBe(true);
  });

  test("auto_mode uses humidifier.set_mode when set_humidity schema lacks humidity_auto and no sibling", async () => {
    const hass = createMockHass();
    hass.services.climate.set_humidity = { fields: { entity_id: {}, humidity: {} } };
    hass.states["humidifier.dyson_device"] = {
      state: "on",
      attributes: {
        min_humidity: 30,
        max_humidity: 70,
        humidity: 40,
        mode: "normal",
        available_modes: ["normal", "auto"],
      },
    };
    Object.assign(hass.states[CLIMATE_ENTITY_ID].attributes, {
      hvac_modes: ["off", "fan_only"],
      hvac_mode: "fan_only",
      min_humidity: 30,
      max_humidity: 50,
      target_humidity: 44,
      humidity_auto: "OFF",
    });
    const card = createCard(hass);
    const autoBtn = card.shadowRoot.querySelector('button[data-action="auto_mode"]');
    autoBtn.click();
    await nextTick();

    const modeCall = hass.__calls.find(
      (c) => c.domain === "humidifier" && c.service === "set_mode" && c.data.entity_id === "humidifier.dyson_device",
    );
    expect(modeCall).toBeTruthy();
    expect(modeCall.data.mode).toBe("auto");
    const humCalls = hass.__calls.filter((c) => c.domain === "climate" && c.service === "set_humidity");
    expect(humCalls.length).toBe(0);
  });

  test("auto_mode omits humidity_auto when climate.set_humidity schema has no humidity_auto field", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const hass = createMockHass();
      hass.services.climate.set_humidity = { fields: { entity_id: {}, humidity: {} } };
      hass.states["humidifier.dyson_device"] = {
        state: "on",
        attributes: { min_humidity: 30, max_humidity: 50, humidity: 40 },
      };
      Object.assign(hass.states[CLIMATE_ENTITY_ID].attributes, {
        hvac_modes: ["off", "fan_only"],
        hvac_mode: "fan_only",
        min_humidity: 30,
        max_humidity: 50,
        target_humidity: 44,
        humidity_auto: "OFF",
      });
      const card = createCard(hass);
      const autoBtn = card.shadowRoot.querySelector('button[data-action="auto_mode"]');
      autoBtn.click();
      await nextTick();

      const humCall = hass.__calls.find(
        (c) => c.domain === "climate" && c.service === "set_humidity" && c.data.entity_id === CLIMATE_ENTITY_ID,
      );
      expect(humCall).toBeTruthy();
      expect(humCall.data.humidity).toBe(44);
      expect("humidity_auto" in humCall.data).toBe(false);
    } finally {
      warnSpy.mockRestore();
    }
  });

  test("auto_mode uses discovered select.*_humidity_auto when set_humidity schema lacks humidity_auto", async () => {
    const hass = createMockHass();
    hass.services.climate.set_humidity = { fields: { entity_id: {}, humidity: {} } };
    hass.states["select.dyson_device_humidity_auto"] = {
      state: "off",
      attributes: { options: ["off", "on"] },
    };
    hass.states["humidifier.dyson_device"] = {
      state: "on",
      attributes: { min_humidity: 30, max_humidity: 50, humidity: 40 },
    };
    Object.assign(hass.states[CLIMATE_ENTITY_ID].attributes, {
      hvac_modes: ["off", "fan_only"],
      hvac_mode: "fan_only",
      min_humidity: 30,
      max_humidity: 50,
      target_humidity: 44,
      humidity_auto: "OFF",
    });
    const card = createCard(hass);
    const autoBtn = card.shadowRoot.querySelector('button[data-action="auto_mode"]');
    autoBtn.click();
    await nextTick();

    const selCall = hass.__calls.find(
      (c) => c.domain === "select" && c.service === "select_option" && c.data.entity_id === "select.dyson_device_humidity_auto",
    );
    expect(selCall).toBeTruthy();
    expect(selCall.data.option).toBe("on");
    const humCalls = hass.__calls.filter((c) => c.domain === "climate" && c.service === "set_humidity");
    expect(humCalls.length).toBe(0);
  });

  test("humidity +/- calls humidifier.set_humidity when humidifier entity exists (step inferred as 10)", async () => {
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
    expect(humidifierCall.data.humidity).toBe(50);
  });

  test("humidity +/- prefers humidifier.set_humidity over climate when both exist", async () => {
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
        [CLIMATE_ENTITY_ID]: {
          state: "fan_only",
          attributes: {
            ...(createMockHass().states[CLIMATE_ENTITY_ID]?.attributes || {}),
            hvac_modes: ["off", "fan_only"],
            hvac_mode: "fan_only",
            min_humidity: 30,
            max_humidity: 50,
            target_humidity: 40,
            humidity_auto: "OFF",
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
    expect(humidifierCall.data.humidity).toBe(50);
    const climateCalls = hass.__calls.filter((c) => c.domain === "climate" && c.service === "set_humidity");
    expect(climateCalls.length).toBe(0);
  });

  test("humidity +/- uses climate only when humidity_write is climate", async () => {
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
        [CLIMATE_ENTITY_ID]: {
          state: "fan_only",
          attributes: {
            ...(createMockHass().states[CLIMATE_ENTITY_ID]?.attributes || {}),
            hvac_modes: ["off", "fan_only"],
            hvac_mode: "fan_only",
            min_humidity: 30,
            max_humidity: 50,
            target_humidity: 40,
            humidity_auto: "OFF",
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
    const card = createCardWithConfig(hass, { entity: FAN_ENTITY_ID, humidity_write: "climate" });
    const plus = card.shadowRoot.querySelector('button[data-action="heat_plus"]');
    plus.click();
    await nextTick();

    const climateCall = hass.__calls.find(
      (c) => c.domain === "climate" && c.service === "set_humidity" && c.data.entity_id === CLIMATE_ENTITY_ID,
    );
    expect(climateCall).toBeTruthy();
    expect(climateCall.data.humidity).toBe(50);
    const humidifierCalls = hass.__calls.filter((c) => c.domain === "humidifier" && c.service === "set_humidity");
    expect(humidifierCalls.length).toBe(0);
  });

  test("humidity +/- reaches humidifier matched to climate when fan entity id differs", async () => {
    const altFan = "fan.renamed_room";
    const hass = createMockHass({
      states: {
        [altFan]: {
          state: "on",
          attributes: {
            is_on: true,
            target_humidity: 40,
            humidity_enabled: "ON",
            min_humidity: 30,
            max_humidity: 50,
          },
        },
        [CLIMATE_ENTITY_ID]: {
          state: "fan_only",
          attributes: {
            hvac_modes: ["off", "fan_only"],
            hvac_mode: "fan_only",
            min_humidity: 30,
            max_humidity: 50,
            target_humidity: 40,
            humidity_auto: "OFF",
          },
        },
        "humidifier.dyson_device": {
          state: "on",
          attributes: { min_humidity: 30, max_humidity: 50, humidity: 40 },
        },
      },
    });
    const card = createCardWithConfig(hass, { entity: altFan, climate_entity: CLIMATE_ENTITY_ID });
    const plus = card.shadowRoot.querySelector('button[data-action="heat_plus"]');
    plus.click();
    await nextTick();

    const humidifierCall = hass.__calls.find(
      (c) => c.domain === "humidifier" && c.service === "set_humidity" && c.data.entity_id === "humidifier.dyson_device",
    );
    expect(humidifierCall).toBeTruthy();
    expect(humidifierCall.data.humidity).toBe(50);
    const climateCalls = hass.__calls.filter((c) => c.domain === "climate" && c.service === "set_humidity");
    expect(climateCalls.length).toBe(0);
  });

  test("humidity + uses humidifier range (not climate) so 50 → 60 when humidifier allows 70", async () => {
    const hass = createMockHass({
      states: {
        [FAN_ENTITY_ID]: {
          state: "on",
          attributes: {
            is_on: true,
            target_humidity: 50,
            humidity_enabled: "ON",
            min_humidity: 30,
            max_humidity: 50,
          },
        },
        [CLIMATE_ENTITY_ID]: {
          state: "fan_only",
          attributes: {
            ...(createMockHass().states[CLIMATE_ENTITY_ID]?.attributes || {}),
            hvac_modes: ["off", "fan_only"],
            hvac_mode: "fan_only",
            min_humidity: 30,
            max_humidity: 50,
            target_humidity: 50,
            humidity_auto: "OFF",
          },
        },
        "humidifier.dyson_device": {
          state: "on",
          attributes: {
            min_humidity: 30,
            max_humidity: 70,
            humidity: 50,
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
    expect(humidifierCall.data.humidity).toBe(60);
  });

  test("humidity + with climate as card entity calls climate.turn_on before humidifier.set_humidity", async () => {
    const hass = createMockHass({
      states: {
        [CLIMATE_ENTITY_ID]: {
          state: "fan_only",
          attributes: {
            hvac_modes: ["off", "fan_only"],
            hvac_mode: "fan_only",
            min_humidity: 30,
            max_humidity: 50,
            target_humidity: 40,
            humidity: 40,
            humidity_auto: "OFF",
          },
        },
        "humidifier.dyson_device": {
          state: "on",
          attributes: { min_humidity: 30, max_humidity: 70, humidity: 40 },
        },
      },
    });
    delete hass.states[FAN_ENTITY_ID];
    hass.services.climate.turn_on = {};
    const card = createCardWithEntity(hass, CLIMATE_ENTITY_ID);
    const plus = card.shadowRoot.querySelector('button[data-action="heat_plus"]');
    plus.click();
    await nextTick();

    const turnIdx = hass.__calls.findIndex((c) => c.domain === "climate" && c.service === "turn_on");
    const humIdx = hass.__calls.findIndex(
      (c) => c.domain === "humidifier" && c.service === "set_humidity" && c.data.entity_id === "humidifier.dyson_device",
    );
    expect(turnIdx).toBeGreaterThanOrEqual(0);
    expect(humIdx).toBeGreaterThanOrEqual(0);
    expect(turnIdx).toBeLessThan(humIdx);
    expect(hass.__calls[humIdx].data.humidity).toBe(50);
  });

  test("humidity stepper uses same merge as readout when fan target_humidity overrides climate", async () => {
    const hass = createMockHass({
      states: {
        [FAN_ENTITY_ID]: {
          state: "on",
          attributes: {
            ...createMockHass().states[FAN_ENTITY_ID].attributes,
            target_humidity: 52,
            min_humidity: 30,
            max_humidity: 70,
          },
        },
        [CLIMATE_ENTITY_ID]: {
          state: "fan_only",
          attributes: {
            hvac_modes: ["off", "fan_only"],
            hvac_mode: "fan_only",
            min_humidity: 30,
            max_humidity: 70,
            target_humidity: 50,
            humidity_auto: "OFF",
            humidity_enabled: "HUMD",
          },
        },
        "humidifier.dyson_device": {
          state: "on",
          attributes: { min_humidity: 30, max_humidity: 70, humidity: 52 },
        },
      },
    });
    const card = createCard(hass);
    expect(card.shadowRoot.querySelector('[data-part="thermal-target"]').textContent).toBe("50%");
    card.shadowRoot.querySelector('button[data-action="heat_minus"]').click();
    await nextTick();
    const humidifierCall = hass.__calls.find(
      (c) => c.domain === "humidifier" && c.service === "set_humidity" && c.data.entity_id === "humidifier.dyson_device",
    );
    expect(humidifierCall).toBeTruthy();
    expect(humidifierCall.data.humidity).toBe(40);
  });

  test("humidity readout shows optimistic step when climate entity is card (no fan state)", async () => {
    const hass = createMockHass({
      states: {
        [CLIMATE_ENTITY_ID]: {
          state: "fan_only",
          attributes: {
            hvac_modes: ["off", "fan_only"],
            hvac_mode: "fan_only",
            min_humidity: 30,
            max_humidity: 50,
            target_humidity: 50,
            humidity: 50,
            humidity_auto: "OFF",
            humidity_enabled: "HUMD",
          },
        },
        "humidifier.dyson_device": {
          state: "on",
          attributes: { min_humidity: 30, max_humidity: 70, humidity: 50, mode: "normal" },
        },
      },
    });
    delete hass.states[FAN_ENTITY_ID];
    hass.services.climate.turn_on = {};
    const card = createCardWithEntity(hass, CLIMATE_ENTITY_ID);
    card.shadowRoot.querySelector('button[data-action="heat_minus"]').click();
    await nextTick();
    expect(card.shadowRoot.querySelector('[data-part="thermal-target"]').textContent).toBe("40%");
  });

  test("humidity readout shows AUTO after auto humidify from climate card", async () => {
    const hass = createMockHass();
    hass.services.climate.set_humidity = {
      fields: { entity_id: {}, humidity: {}, humidity_auto: {} },
    };
    hass.services.climate.turn_on = {};
    hass.states["humidifier.dyson_device"] = {
      state: "on",
      attributes: {
        mode: "normal",
        available_modes: ["normal", "auto"],
        min_humidity: 30,
        max_humidity: 70,
      },
    };
    Object.assign(hass.states[CLIMATE_ENTITY_ID].attributes, {
      hvac_modes: ["off", "fan_only"],
      hvac_mode: "fan_only",
      min_humidity: 30,
      max_humidity: 50,
      target_humidity: 50,
      humidity: 50,
      humidity_auto: "OFF",
      humidity_enabled: "HUMD",
    });
    delete hass.states[FAN_ENTITY_ID];
    const card = createCardWithEntity(hass, CLIMATE_ENTITY_ID);
    card.shadowRoot.querySelector('button[data-action="auto_mode"]').click();
    await nextTick();
    expect(card.shadowRoot.querySelector('[data-part="thermal-target"]').textContent).toBe("AUTO");
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

  test("air quality hide_* keys turn off subsections", () => {
    const hass = createMockHass();
    hass.states["sensor.dyson_device_pm25"] = {
      state: "14",
      attributes: { friendly_name: "PM 2.5", device_class: "pm25" },
    };
    const card = createCardWithConfig(hass, {
      entity: FAN_ENTITY_ID,
      show_air_quality_header: true,
      hide_air_quality_category: true,
    });
    expect(card.shadowRoot.querySelector('[data-part="aq-header"]').hidden).toBe(false);
    expect(card.shadowRoot.querySelector('[data-part="aq-title-row"]').hidden).toBe(true);
    const css = [...card.shadowRoot.querySelectorAll("style")].map((s) => s.textContent).join("\n");
    expect(css).toContain(".aq-title-row[hidden]");
  });

  test("air quality header shows when enabled and matching sensors exist", () => {
    const hass = createMockHass();
    hass.states["sensor.dyson_device_pm25"] = {
      state: "14",
      attributes: { friendly_name: "PM 2.5", device_class: "pm25" },
    };
    const card = createCardWithConfig(hass, {
      entity: FAN_ENTITY_ID,
      show_air_quality_header: true,
    });
    const aq = card.shadowRoot.querySelector('[data-part="aq-header"]');
    expect(aq.hidden).toBe(false);
    const title = card.shadowRoot.querySelector('[data-part="aq-title"]');
    expect(title.textContent).toBe("Fair");
  });

  test("air quality header gradient avoids black-band transparent keyword", () => {
    const hass = createMockHass();
    hass.states["sensor.dyson_device_pm25"] = {
      state: "14",
      attributes: { friendly_name: "PM 2.5", device_class: "pm25" },
    };
    const card = createCardWithConfig(hass, {
      entity: FAN_ENTITY_ID,
      show_air_quality_header: true,
    });
    const css = [...card.shadowRoot.querySelectorAll("style")]
      .map((s) => s.textContent)
      .join("\n");
    expect(css).toContain(".aq-header");
    expect(css).toContain("rgba(255, 255, 255, 0) 100%");
  });

  test("air quality header can hide color bar only", () => {
    const hass = createMockHass();
    hass.states["sensor.dyson_device_pm25"] = {
      state: "14",
      attributes: { friendly_name: "PM 2.5", device_class: "pm25" },
    };
    const card = createCardWithConfig(hass, {
      entity: FAN_ENTITY_ID,
      show_air_quality_header: true,
      show_air_quality_bar: false,
    });
    expect(card.shadowRoot.querySelector('[data-part="aq-header"]').hidden).toBe(false);
    expect(card.shadowRoot.querySelector('[data-part="aq-bar-track"]').hidden).toBe(true);
    expect(card.shadowRoot.querySelector('[data-part="aq-title-row"]').hidden).toBe(false);
  });

  test("air quality header hides when all sub-sections are off", () => {
    const hass = createMockHass();
    hass.states["sensor.dyson_device_pm25"] = {
      state: "14",
      attributes: { friendly_name: "PM 2.5", device_class: "pm25" },
    };
    const card = createCardWithConfig(hass, {
      entity: FAN_ENTITY_ID,
      show_air_quality_header: true,
      show_air_quality_category: false,
      show_air_quality_pollutant: false,
      show_air_quality_bar: false,
    });
    expect(card.shadowRoot.querySelector('[data-part="aq-header"]').hidden).toBe(true);
  });

  test("title renders above temperature from config", () => {
    const hass = createMockHass();
    const card = createCardWithConfig(hass, { entity: FAN_ENTITY_ID, title: "Living Room" });
    const titleEl = card.shadowRoot.querySelector('[data-part="title"]');
    expect(titleEl.hidden).toBe(false);
    expect(titleEl.textContent).toBe("Living Room");
  });

  test("title remains hidden when config title is blank or whitespace", () => {
    const hass = createMockHass();
    hass.states[FAN_ENTITY_ID].attributes.friendly_name = "Bedroom Dyson";
    const card = createCardWithConfig(hass, { entity: FAN_ENTITY_ID, title: "   " });
    const titleEl = card.shadowRoot.querySelector('[data-part="title"]');
    expect(titleEl.hidden).toBe(true);
    expect(titleEl.textContent).toBe("");
  });
});
