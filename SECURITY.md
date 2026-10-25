# Security policy

Report vulnerabilities privately to security@hybridcloudworks.com (or via GitHub private vulnerability reporting). Please do not open public issues for security findings. Expect an acknowledgement within 3 business days.

Scope highlights: the appliance authenticates every request with Entra ID, uses managed identity or workload identity federation (never client secrets), discovers through Azure Resource Graph with Reader-only RBAC, and ships with execution disabled in the project profile. Assessments are session-only in the first release. The published packages (`@hybridcloudworks/migration-core`, `@hybridcloudworks/migration-ui`) contain no Azure client and no credential handling; they are published with provenance via npm trusted publishing. Issues in the web-front edition's lab API belong to `https://github.com/saulpatinojr/HCW-MigrateOrchestrator_AddOn/blob/main/SECURITY.md`. Supported version: `main` and the latest `v*` release.
