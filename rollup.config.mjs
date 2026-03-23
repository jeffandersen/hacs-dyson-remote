export default {
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
