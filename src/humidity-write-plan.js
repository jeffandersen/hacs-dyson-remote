/**
 * Ordered Home Assistant service calls for setting combo-device target humidity.
 * Pure planning + executor so behavior is unit-testable without the Lovelace card.
 */

/** @typedef {{ domain: string, service: string, data: Record<string, unknown> }} HumidityServiceCall */

/**
 * @param {unknown} v
 * @returns {"auto" | "humidifier" | "climate"}
 */
export function normalizeHumidityWrite(v) {
  const s = typeof v === "string" ? v.trim().toLowerCase() : "";
  if (s === "humidifier" || s === "climate") return s;
  return "auto";
}

/**
 * @param {string | null | undefined} humidifierEntityId
 * @param {string | null | undefined} configuredEntityId
 * @returns {string[]}
 */
export function humidifierEntityIdsForHumidityWrite(humidifierEntityId, configuredEntityId) {
  const domain = typeof configuredEntityId === "string" ? configuredEntityId.split(".")[0] : "";
  const ids = [];
  if (humidifierEntityId) ids.push(humidifierEntityId);
  if (domain === "humidifier" && configuredEntityId && !ids.includes(configuredEntityId)) {
    ids.push(configuredEntityId);
  }
  return ids;
}

/**
 * @param {HumidityServiceCall[]} calls
 * @returns {HumidityServiceCall[]}
 */
function dedupeHumidityCalls(calls) {
  const seen = new Set();
  const out = [];
  for (const c of calls) {
    const key = `${c.domain}\0${c.service}\0${JSON.stringify(c.data)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

/**
 * Build ordered service calls for `humidifier.set_humidity` / `climate.set_humidity` / `number.set_value`.
 * Execution should stop after the first call that succeeds (see `executeHumiditySetpointCalls`).
 *
 * @param {object} hass - Home Assistant object with `services`
 * @param {object} ctx
 * @param {number} ctx.next - Target humidity %
 * @param {string | null | undefined} ctx.climateEntityId
 * @param {string | null | undefined} ctx.humidifierEntityId
 * @param {string} ctx.configuredEntityId - Card `entity` id
 * @param {string | null | undefined} ctx.humidityNumberId - Resolved `number.*` target entity
 * @param {unknown} ctx.humidityWrite - `"auto"` | `"humidifier"` | `"climate"`
 * @returns {HumidityServiceCall[]}
 */
export function buildHumiditySetpointServiceCalls(hass, ctx) {
  const mode = normalizeHumidityWrite(ctx.humidityWrite);
  const {
    next,
    climateEntityId,
    humidifierEntityId,
    configuredEntityId,
    humidityNumberId,
  } = ctx;

  const hasHum = Boolean(hass?.services?.humidifier?.set_humidity);
  const hasCli = Boolean(hass?.services?.climate?.set_humidity);
  const hasNum = Boolean(hass?.services?.number?.set_value);

  /** @type {HumidityServiceCall[]} */
  const calls = [];

  const pushHum = (entity_id) => {
    if (entity_id && hasHum) {
      calls.push({
        domain: "humidifier",
        service: "set_humidity",
        data: { entity_id, humidity: next },
      });
    }
  };
  const pushCli = () => {
    if (climateEntityId && hasCli) {
      calls.push({
        domain: "climate",
        service: "set_humidity",
        data: { entity_id: climateEntityId, humidity: next },
      });
    }
  };
  const pushNum = () => {
    if (humidityNumberId && hasNum) {
      calls.push({
        domain: "number",
        service: "set_value",
        data: { entity_id: humidityNumberId, value: next },
      });
    }
  };

  if (mode === "climate") {
    pushCli();
    pushNum();
    return dedupeHumidityCalls(calls);
  }

  const humIds = humidifierEntityIdsForHumidityWrite(humidifierEntityId, configuredEntityId);
  for (const id of humIds) pushHum(id);

  if (mode === "humidifier") {
    pushNum();
    return dedupeHumidityCalls(calls);
  }

  pushCli();
  pushNum();
  return dedupeHumidityCalls(calls);
}

/**
 * @param {object} hass
 * @param {HumidityServiceCall[]} calls
 * @returns {Promise<boolean>} True if any call succeeded
 */
export async function executeHumiditySetpointCalls(hass, calls) {
  for (const c of calls) {
    try {
      await hass.callService(c.domain, c.service, c.data);
      return true;
    } catch (err) {
      console.warn(`Dyson Remote: ${c.domain}.${c.service} (humidity target) failed`, err);
    }
  }
  return false;
}
