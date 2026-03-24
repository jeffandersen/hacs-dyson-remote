import replace from "@rollup/plugin-replace";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const pkg = JSON.parse(readFileSync(fileURLToPath(new URL("./package.json", import.meta.url)), "utf8"));
const buildId = `${pkg.version || "0.0.0"}+${new Date().toISOString().slice(0, 10)}`;

export default {
  plugins: [
    replace({
      preventAssignment: true,
      delimiters: ["", ""],
      values: {
        '"__DYSON_CARD_BUILD__"': JSON.stringify(buildId),
      },
    }),
  ],
  input: "src/hacs-dyson-remote.js",
  output: [
    {
      file: "dist/hacs-dyson-remote.js",
      format: "es",
      inlineDynamicImports: true,
    },
    {
      file: "hacs-dyson-remote.js",
      format: "es",
      inlineDynamicImports: true,
    },
  ],
};
