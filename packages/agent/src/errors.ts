export type ValidationGateReason =
  | "validations_not_approved"
  | "legacy_verification_plan_not_approved";

export type ValidationGateValidation = {
  id: string;
  title?: string | null;
  status: string;
  orderIndex?: number | null;
};

export type ValidationGateErrorJson = {
  code: "VALIDATION_GATE_FAILED";
  error: "validation_gate";
  message: string;
  status: 412;
  taskId: string;
  reason: ValidationGateReason;
  hint: string;
  missingValidations: ValidationGateValidation[];
  validations: ValidationGateValidation[];
  unapprovedValidations: ValidationGateValidation[];
  legacyVerificationPlanStatus?: string | null;
};

export class ValidationGateError extends Error {
  public readonly code = "VALIDATION_GATE_FAILED";
  public readonly status = 412;
  public readonly taskId: string;
  public readonly reason: ValidationGateReason;
  public readonly hint: string;
  public readonly validations: ValidationGateValidation[];
  public readonly unapprovedValidations: ValidationGateValidation[];
  public readonly legacyVerificationPlanStatus?: string | null;

  constructor(input: {
    taskId: string;
    reason: ValidationGateReason;
    message: string;
    validations?: readonly ValidationGateValidation[];
    unapprovedValidations?: readonly ValidationGateValidation[];
    legacyVerificationPlanStatus?: string | null;
    hint?: string | null;
  }) {
    super(input.message);
    this.name = "ValidationGateError";
    this.taskId = input.taskId;
    this.reason = input.reason;
    this.validations = [...(input.validations ?? [])];
    this.unapprovedValidations = [...(input.unapprovedValidations ?? [])];
    this.legacyVerificationPlanStatus = input.legacyVerificationPlanStatus;
    this.hint = input.hint ?? getValidationGateHint(input.reason, this.unapprovedValidations);
    Object.setPrototypeOf(this, new.target.prototype);
  }

  toJSON(): ValidationGateErrorJson {
    return {
      code: this.code,
      error: "validation_gate",
      message: this.message,
      status: this.status,
      taskId: this.taskId,
      reason: this.reason,
      hint: this.hint,
      missingValidations: this.unapprovedValidations,
      validations: this.validations,
      unapprovedValidations: this.unapprovedValidations,
      legacyVerificationPlanStatus: this.legacyVerificationPlanStatus ?? null,
    };
  }
}

function getValidationGateHint(
  reason: ValidationGateReason,
  unapprovedValidations: readonly ValidationGateValidation[],
): string {
  if (reason === "validations_not_approved" && unapprovedValidations.length > 0) {
    const first = unapprovedValidations[0];
    return first?.id
      ? `Approve via /validation:approve ${first.id} or open the review URL.`
      : "Approve the proposed validations or open the review URL.";
  }

  return "No validations defined - run /plan:generate or /validation:create.";
}
