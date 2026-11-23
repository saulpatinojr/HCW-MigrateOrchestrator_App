# Contributing

1. Fork/branch, `npm ci`, make the change, `npm test`, `npm run rules:validate`.
   New functionality and every bug fix come with an automated test that fails without the change; code that reads
   outside input (a CSV upload, a fetched page) also gets property-based tests with `fast-check` (`*.property.test.ts`).
2. Rule changes need Microsoft Learn sources, a change report and a regenerated snapshot (`docs/rules/README.md`).
3. Fill the PR template honestly: what you ran, what you did not, and why. Link requirement IDs.
4. Keep ADRs for design decisions and `VALIDATION.md` for limitations current.
5. Be kind; see `CODE_OF_CONDUCT.md`.
