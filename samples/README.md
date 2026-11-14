# Samples

Everything in this folder is fictional. No company, subscription, person or resource in it is real.

- `resources-csv/sample-resources.csv` is a made-up Azure resource export. It is the input the tests, the README
  commands and the release smoke test assess. "Contoso" is the fictional company Microsoft uses in its own examples,
  and the one subscription id in it, `00000000-0000-4000-8000-000000000001`, is a placeholder that names no real
  subscription.
- `expected-reports/` holds the reports the engine produces from that file (the golden files that
  `tests/golden-files/` compares against). They are generated, not written by hand: change them only with
  `npm run goldens:update` and explain the difference in the pull request.

Never add a real tenant id, subscription id, customer inventory, name, email address or hostname here, and never
replace this data with a real export, even an edited one.
