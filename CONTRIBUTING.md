# Contributing

Thanks for contributing to Dyson Remote.

## Local setup

```bash
npm install
```

## Build

```bash
npm run build
```

This writes `dist/hacs-dyson-remote.js`, which should be committed for releases so HACS users do not need to build locally.

## Test

Run all tests:

```bash
npm test
```

Run integration tests only:

```bash
npm run test:integration
```

Integration tests use a simulated Home Assistant `hass` object (Vitest + Happy DOM), covering behaviors such as:

- vertical stepper structure (`+` on top, `-` on bottom)
- engaged-state transitions
- oscillation stepper service calls

## Local harness (no Home Assistant server required)

```bash
npm run dev:harness
```

Then open [http://localhost:4173/dev/harness.html](http://localhost:4173/dev/harness.html).

The harness includes:

- mock `hass.states` and `hass.services`
- live controls for `is_on`, auto, heating, oscillation, temperatures, and fan percentage
- real click handling and a service-call log

## Security scanning

Use Semgrep locally:

```bash
semgrep scan --config auto .
```

If you are authenticated to Semgrep Cloud and your workflow expects policy checks, `semgrep ci` can also be used.

## Release checklist

1. Update docs (`README.md` and any relevant pages).
2. Run `npm test`.
3. Run `npm run build`.
4. Commit source changes and updated `dist/hacs-dyson-remote.js`.
5. Create/tag release according to your release process.
