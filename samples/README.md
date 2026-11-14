# Samples

Everything in this folder is fictional. No company, subscription, person or resource in it is real.

- `resources-csv/sample-resources.csv` is a made-up Azure resource export. It is the input the tests, the README
  commands and the release smoke test assess. It follows the naming convention shared by the Hybrid Cloud Works
  repositories (owner decision 2026-11-14):
  - the one subscription id, `00000000-0000-0000-0000-000000000001`, is a placeholder that names no real subscription
    (further placeholders, if a sample ever needs them, count up in the last digits: `…000000000002` and so on);
  - the subscription is called `hcw-sample-prod`, and every resource and resource group name starts with
    `hcw-sample-`;
  - Azure forbids hyphens in two of the names, so those drop them: the storage account is `hcwsamplestbillingprod`
    (lowercase letters and numbers only) and the container registry is `hcwsampleacrbilling` (letters and numbers
    only);
  - `privatelink.database.windows.net` keeps its name because Azure fixes it: it is the private DNS zone every Azure
    SQL private endpoint uses, not a name anyone chooses.

  Each name stays inside the length and character rules Azure sets for its resource type (for example 24 characters
  for a key vault, which is why it is `hcw-sample-kv-billing`); the rules are listed on Microsoft Learn,
  [Naming rules and restrictions for Azure resources](https://learn.microsoft.com/en-us/azure/azure-resource-manager/management/resource-name-rules).
- `expected-reports/` holds the reports the engine produces from that file (the golden files that
  `tests/golden-files/` compares against). They are generated, not written by hand: change them only with
  `npm run goldens:update` and explain the difference in the pull request.

Never add a real tenant id, subscription id, customer inventory, name, email address or hostname here, and never
replace this data with a real export, even an edited one.
