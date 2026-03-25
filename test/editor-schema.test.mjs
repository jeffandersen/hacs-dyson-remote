import test from "node:test";
import assert from "node:assert/strict";
import { buildDysonRemoteCardEditorSchema } from "../src/dyson-editor-schema.js";

test("editor schema nests optional entity fields in a flattened expandable", () => {
  const schema = buildDysonRemoteCardEditorSchema({});
  const expandable = schema.find((s) => s && s.type === "expandable");
  assert.ok(expandable);
  assert.equal(expandable.flatten, true);
  assert.equal(expandable.expanded, false);
  assert.ok(Array.isArray(expandable.schema));
  const names = expandable.schema.map((row) => row.name);
  assert.deepEqual(names, [
    "oscillation_select_entity",
    "climate_entity",
    "humidity_auto_entity",
    "night_mode_entity",
    "humidifier_entity",
    "humidity_target_entity",
    "humidity_step",
    "humidity_write",
  ]);
});

test("editor schema includes air quality sub-fields when header is on", () => {
  const off = buildDysonRemoteCardEditorSchema({ show_air_quality_header: false }).map((s) => s.name);
  assert.ok(!off.includes("show_air_quality_category"));
  const on = buildDysonRemoteCardEditorSchema({ show_air_quality_header: true }).map((s) => s.name);
  assert.ok(on.includes("show_air_quality_category"));
  assert.ok(on.includes("show_air_quality_pollutant"));
  assert.ok(on.includes("show_air_quality_bar"));
});
