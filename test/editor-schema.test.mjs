import test from "node:test";
import assert from "node:assert/strict";
import { buildDysonRemoteCardEditorSchema } from "../src/dyson-editor-schema.js";

// ---------------------------------------------------------------------------
// Visual editor schema
// See CLAUDE.md: "Visual editor (dyson-editor-schema.js)" section
// Uses ha-form schema. Key fields live in a flattened expandable section.
// ---------------------------------------------------------------------------

test("editor schema nests optional entity fields in a flattened expandable", () => {
  // Advanced entity overrides must be collapsed by default (expanded: false)
  // and flattened into the main config (flatten: true) so ha-form writes them
  // at the top-level config key, not nested under the expandable's key.
  const schema = buildDysonRemoteCardEditorSchema({});
  const expandable = schema.find((s) => s && s.type === "expandable");
  assert.ok(expandable);
  assert.equal(expandable.flatten, true);
  assert.equal(expandable.expanded, false);
  assert.ok(Array.isArray(expandable.schema));
  // The exact set and order of override fields matters — these map directly to
  // documented config keys in CLAUDE.md: "Optional overrides" table.
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
  // Air quality sub-options should only appear when the user has enabled the AQ header,
  // to avoid cluttering the editor with irrelevant controls.
  // See CLAUDE.md: "When air quality header is on, sub-fields appear"
  const off = buildDysonRemoteCardEditorSchema({ show_air_quality_header: false }).map((s) => s.name);
  assert.ok(!off.includes("show_air_quality_category"));
  const on = buildDysonRemoteCardEditorSchema({ show_air_quality_header: true }).map((s) => s.name);
  assert.ok(on.includes("show_air_quality_category"));
  assert.ok(on.includes("show_air_quality_pollutant"));
  assert.ok(on.includes("show_air_quality_bar"));
});
