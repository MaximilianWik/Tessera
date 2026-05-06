# tools

Helper scripts. None of these run at site runtime — they're for development and CI only.

## `ci-run-tests.mjs`

Runs `tests.html` in headless Chromium via Playwright and exits non-zero if any test failed. Used by `.github/workflows/ci.yml`.

To run locally:
```sh
npm install --no-save playwright
npx playwright install --with-deps chromium
node tools/ci-run-tests.mjs
```
