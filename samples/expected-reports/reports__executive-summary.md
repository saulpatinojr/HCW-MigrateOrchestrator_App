# Executive summary — Hybrid Cloud Works Migration Explorer

> Hybrid Cloud Works Migration Explorer: analysis of an exported inventory only. No Azure tenant was accessed.
> Dispositions are rule-based recommendations, not an authoritative Microsoft assessment. Validate every conditional or unknown item with an authenticated inspection and the current Microsoft Learn move-support matrix.
> Generated Terraform, scripts and runbooks are illustrative and not production-approved until validated (fmt/validate/scan/plan/human approval).

- Assessment ID: `<assessment-id>`
- Generated: 2026-10-03T12:00:00.000Z
- Input hash (sha256): `fa6cba1f71b04dc1ba86fc9326e5c843734f480b72a057685408cd9b67364c33`
- Rules: 1.0.35 (checksum `<rules-checksum>`)
- Operation assessed: **region-relocation** → westus3
- Authenticated against Azure: **no**

## Totals

- Resources: **29**
- Unknown / requires validation: **1**
- Confidence: high 0, medium 28, low 1
- Complexity band: **high**

| Disposition | Count |
|---|---|
| native-move | 7 |
| orchestrated-migration | 2 |
| recreate-and-migrate | 11 |
| recreate-only | 6 |
| retain | 2 |
| unknown-requires-validation | 1 |

## Key blockers

- Rule requires human review before this disposition is accepted. (5)
- No rule coverage: disposition cannot be determined automatically. (1)

## Assumptions from the questionnaire

- `desiredOperation` was not supplied; a default was assumed
- `destinationSubscriptionId` was not supplied; a default was assumed
- `destinationResourceGroup` was not supplied; a default was assumed
- `existingLandingZone` was not supplied; a default was assumed
- `environmentType` was not supplied; a default was assumed
- `rtoHours` was not supplied; a default was assumed
- `rpoMinutes` was not supplied; a default was assumed
- `migrationMode` was not supplied; a default was assumed
- `sourceAvailableDuringSync` was not supplied; a default was assumed
- `dataResidency` was not supplied; a default was assumed
- `regulatoryRestrictions` was not supplied; a default was assumed
- `namingPrefix` was not supplied; a default was assumed
- `requiredTags` was not supplied; a default was assumed
- `applicationGroupTagKey` was not supplied; a default was assumed
- `publicAccessPolicy` was not supplied; a default was assumed
- `privateEndpointsRequired` was not supplied; a default was assumed
- `includeDataMigrationExamples` was not supplied; a default was assumed
