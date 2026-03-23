export default {
  test: {
    environment: "happy-dom",
    include: ["integration/**/*.vitest.mjs"],
    setupFiles: ["integration/setup.mjs"],
  },
};
