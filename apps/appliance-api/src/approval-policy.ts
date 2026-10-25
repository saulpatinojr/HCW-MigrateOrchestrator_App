/**
 * Two-person rule for approvals (ADR-0031, security follow-up F-05 of issue 83).
 *
 * A recorded approval (POST /api/approvals) only lets a Resource Mover initiateMove (production-deploy) or commit
 * (data-cutover) run when the person who recorded it is NOT the person asking to execute. Before this, one Migration.Execute
 * holder could approve and then run their own move, so the "explicit human approval" was a click-through.
 *
 * AMO_ALLOW_SELF_APPROVAL=true switches the rule off for a lab or a single-operator appliance, where there is no second person.
 * It is off by default, the Terraform in this repository never sets it, and the API logs and audits when an execution used
 * the person's own approval. Any other value than true or false (or unset or empty) stops the API at startup, so a typo can
 * neither silently weaken nor silently keep the rule.
 */
import type { ApprovalRecord } from "./repository.js";

export const ALLOW_SELF_APPROVAL_VAR = "AMO_ALLOW_SELF_APPROVAL";

export function parseAllowSelfApproval(value: string | undefined): boolean {
  if (value === undefined || value.trim() === "") return false;
  const v = value.trim().toLowerCase();
  if (v === "true") return true;
  if (v === "false") return false;
  throw new Error(`refusing to start: ${ALLOW_SELF_APPROVAL_VAR} is ${JSON.stringify(value)}; it takes true (lab or single-operator mode: the person who approves may also execute) or false (the default: a second person must approve), docs/deployment/enterprise.md`);
}

export interface CountedApprovals {
  /** The approvals the execution gate may use. */
  counted: ApprovalRecord[];
  /** How many were set aside because the executing person recorded them (always 0 when self-approval is allowed). */
  setAside: number;
  /** True when an approval that the executing person recorded themselves was counted (only possible in self-approval mode). */
  usedOwnApproval: boolean;
}

export function countableApprovals(records: readonly ApprovalRecord[], actor: string, allowSelfApproval: boolean): CountedApprovals {
  const mine = (r: ApprovalRecord) => r.approvedBy.toLowerCase() === actor.toLowerCase();
  if (allowSelfApproval) return { counted: [...records], setAside: 0, usedOwnApproval: records.some(mine) };
  const counted = records.filter((r) => !mine(r));
  return { counted, setAside: records.length - counted.length, usedOwnApproval: false };
}

export const SELF_APPROVAL_REFUSAL = "an approval that you recorded yourself does not count (two-person rule): another Migration.Execute holder must record it, or an administrator can set AMO_ALLOW_SELF_APPROVAL=true for a lab or single-operator appliance";
