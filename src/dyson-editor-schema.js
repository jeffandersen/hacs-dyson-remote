/**
 * Home Assistant `ha-form` schema for the Dyson Remote card visual editor.
 * Optional entity overrides use `type: "expandable"` with `flatten: true` so nested
 * fields read/write the same flat `form.data` keys as before (see home-assistant/frontend ha-form).
 *
 * @param {Record<string, unknown>} data - Current form data (drives conditional air-quality sub-fields).
 * @returns {readonly unknown[]}
 */
export function buildDysonRemoteCardEditorSchema(data) {
  const d = data || {};
  const aqHeaderOn = d.show_air_quality_header === true;
  const sub = aqHeaderOn
    ? [
        { name: "show_air_quality_category", selector: { boolean: {} } },
        { name: "show_air_quality_pollutant", selector: { boolean: {} } },
        { name: "show_air_quality_bar", selector: { boolean: {} } },
      ]
    : [];
  return [
    {
      name: "entity",
      selector: {
        entity: {
          domain: ["fan", "climate"],
        },
      },
    },
    {
      type: "expandable",
      name: "advanced_dyson_entities",
      title: "Advanced entity overrides",
      expanded: false,
      flatten: true,
      schema: [
        {
          name: "oscillation_select_entity",
          selector: {
            entity: {
              domain: ["select"],
            },
          },
        },
        {
          name: "climate_entity",
          selector: {
            entity: {
              domain: ["climate"],
            },
          },
        },
        {
          name: "humidity_auto_entity",
          selector: {
            entity: {
              domain: ["select", "switch"],
            },
          },
        },
        {
          name: "humidifier_entity",
          selector: {
            entity: {
              domain: ["humidifier"],
            },
          },
        },
        {
          name: "humidity_target_entity",
          selector: {
            entity: {
              domain: ["number"],
            },
          },
        },
        {
          name: "humidity_step",
          selector: {
            number: {
              min: 1,
              max: 50,
              mode: "box",
            },
          },
        },
        {
          name: "humidity_write",
          selector: {
            select: {
              mode: "dropdown",
              options: [
                { value: "auto", label: "Auto (humidifier first, then climate)" },
                { value: "humidifier", label: "Humidifier entity only" },
                { value: "climate", label: "Climate entity only" },
              ],
            },
          },
        },
      ],
    },
    {
      name: "show_temperature_header",
      selector: { boolean: {} },
    },
    {
      name: "show_air_quality_header",
      selector: { boolean: {} },
    },
    ...sub,
    {
      name: "mushroom_shell",
      selector: { boolean: {} },
    },
  ];
}
