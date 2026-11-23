# Rule refresh reports

`learn-diff.{json,md}` are produced by `scripts/refresh-rules-from-learn.mjs` (weekly via `rules-refresh.yml`, or by hand).
They are evidence for a rule change, never a rule change themselves. Offline: `node scripts/refresh-rules-from-learn.mjs --from <saved-learn-markdown.md>`.

`learn-diff-reviewed.json` is written by hand. It lists the disagreements a person compared with Microsoft Learn and decided
to keep, each with the reason and a link to the pull request or issue where it was decided. The script reads it and shows
those rows in the report under "Reviewed and kept as they are", apart from new ones. An entry covers one rule field with one
pair of values (`rule`: what the rule says, `learn`: what the report says Learn says); when either changes, the entry stops
matching, the row is reported as new again, and the entry is listed as no longer matching so it can be deleted.

To keep a rule as it is after reviewing a new row, add an entry:

```json
{ "ruleId": "azure.compute.disks", "field": "resourceGroupMove", "rule": "supported", "learn": "conditional", "reason": "Why the rule stays, in a sentence.", "decidedIn": "https://github.com/saulpatinojr/HCW-MigrateOrchestrator_App/pull/136", "decidedOn": "2026-11-22" }
```

`field` is `resourceGroupMove`, `subscriptionMove` or `regionRelocation`. `npm test` fails when an entry names a rule that
does not exist or a value the rule no longer has.
