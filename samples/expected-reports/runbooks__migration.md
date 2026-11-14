# Migration runbook

> DEMO — NOT FOR PRODUCTION. Placeholder scopes; execution disabled by default.

| Field | Value |
|---|---|
| Purpose | Migration runbook for region-relocation to westus3 |
| Scope | 29 resources, assessment <assessment-id> |
| Roles | Migration lead (approver), platform engineer (executor), data owner (reconciliation sign-off), security (identity/RBAC review) |
| Evidence to retain | Command output, plan files, reconciliation results, approval records |

## Steps by wave

### Wave 1: Foundation: network, identity, secrets, logging

- Entry: Destination landing zone scope approved; Address space and naming approved
- [ ] hcw-sample-log-prod-eus: terraform plan/apply the generated module → reconstruct configuration → rebind identities
- [ ] hcw-sample-kv-bill: backup source → restore to destination → verify inventory
- [ ] hcw-sample-id-billing-app: terraform plan/apply the generated module → reconstruct configuration → rebind identities
- [ ] hcw-sample-pip-lb-billing: add to Resource Mover move collection → prepare → initiate move → commit after validation
- [ ] hcw-sample-vnet-billing-prod-eus: add to Resource Mover move collection → prepare → initiate move → commit after validation
- [ ] hcw-sample-nsg-app: add to Resource Mover move collection → prepare → initiate move → commit after validation
- [ ] hcw-sample-rg-billing-prod-eus: terraform plan/apply the generated module → reconstruct configuration → rebind identities
- [ ] hcw-sample-snet-app: add to Resource Mover move collection → prepare → initiate move → commit after validation
- Exit: VNets/subnets/NSGs reachable; Key Vaults and identities exist; Log Analytics receiving data

### Wave 2: Data platforms: storage, databases, registries

- Entry: Wave 1 complete; Private connectivity in place; Data copy tooling authorised
- [ ] hcw-sample-sql-billing-prod-eus: create geo-secondary / failover group → wait for seeding → planned failover at cutover
- [ ] hcw-sample-billingdb: create geo-secondary / failover group → wait for seeding → planned failover at cutover
- [ ] hcw-sample-cosmos-billing-prod: follow service-native relocation (e.g. Cosmos DB add region → change write region → remove source)
- [ ] hcwsamplestbilling: define Storage Mover project/job → initial copy → incremental → cutover
- [ ] hcw-sample-psql-billing-prod-eus: create cross-region replica → monitor lag → promote at cutover
- [ ] hcwsampleacrbilling: create registry → az acr import per repository/tag → verify manifest digests
- Exit: Initial copy complete; Reconciliation plan agreed

### Wave 3: Edge and platform: load balancers, gateways, private endpoints, plans

- Entry: Wave 2 initial copy complete
- [ ] hcw-sample-asp-billing-prod-eus: terraform plan/apply the generated module → reconstruct configuration → rebind identities
- [ ] hcw-sample-lb-billing-prod: add to Resource Mover move collection → prepare → initiate move → commit after validation
- [ ] hcw-sample-pe-sql-billing: terraform plan/apply the generated module → reconstruct configuration → rebind identities
- Exit: Frontends healthy against staging backends

### Wave 4: Compute and applications

- Entry: Waves 1–3 complete; Change freeze scheduled
- [ ] hcw-sample-app-billing-web-prod: create app/plan → deploy from pipeline → bind domains/certs → swap
- [ ] hcw-sample-avset-billing: add to Resource Mover move collection → prepare → initiate move → commit after validation
- [ ] hcw-sample-func-billing-jobs-prod: create app/plan → deploy from pipeline → bind domains/certs → swap
- [ ] hcw-sample-nic-vm-billing-01: add to Resource Mover move collection → prepare → initiate move → commit after validation
- [ ] hcw-sample-vm-billing-01_OsDisk: add to Resource Mover move collection → prepare → initiate move → commit after validation
- [ ] hcw-sample-vm-billing-01: add to Resource Mover move collection → prepare → initiate move → commit after validation
- Exit: Smoke tests pass; Final data sync reconciled; DNS cutover

### Wave 5: Observability, backup and DR re-protection

- Entry: Wave 4 cutover accepted
- [ ] hcw-sample-ag-platform-oncall: requires validation before scheduling
- [ ] hcw-sample-alert-vm-cpu: terraform plan/apply the generated module → reconstruct configuration → rebind identities
- [ ] hcw-sample-appi-billing-prod: terraform plan/apply the generated module → reconstruct configuration → rebind identities
- [ ] privatelink.database.windows.net: requires validation before scheduling
- [ ] hcw-sample-rsv-prod-eus: terraform plan/apply the generated module → reconstruct configuration → rebind identities
- Exit: Alerts firing on destination; Backup/DR protection re-enabled

### Wave 6: Requires validation / manual review

- Entry: Authenticated inspection completed
- [ ] hcw-sample-quantum-research-01: requires validation before scheduling
- Exit: Each item assigned to a wave or retired

## Escalation

- Any failed validation → stop the wave, do not proceed to cutover; invoke rollback.md for completed steps if required.
