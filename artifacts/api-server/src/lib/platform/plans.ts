/**
 * Subscription plan validation, guards, and the assignment invariant — pure functions.
 *
 * Feature: super-admin-platform
 * Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 13.7, 13.8, 13.9, 13.13, 13.14
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PlanRecord {
  id: string;
  name: string;
  name_normalized: string;
  price: number; // 0.00 to 999999999.99
  billing_interval: 'monthly' | 'yearly';
  feature_flags: Record<string, boolean>;
  quota_limits: Record<string, number>;
  archived: boolean;
}

export interface PlanCreateInput {
  name: string;
  price: number;
  billing_interval: string;
  feature_flags?: Record<string, boolean>;
  quota_limits?: Record<string, number>;
}

export type PlanValidationResult =
  | { valid: true }
  | { valid: false; httpStatus: 400 | 409; errors: string[] };

export type ArchiveResult =
  | { success: true }
  | { success: false; httpStatus: 409; error: string };

export type AssignResult =
  | { success: true }
  | { success: false; httpStatus: 409; error: string };

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VALID_BILLING_INTERVALS = ['monthly', 'yearly'] as const;
const MAX_NAME_LENGTH = 120;
const MIN_PRICE = 0;
const MAX_PRICE = 999999999.99;

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

function validateNameField(name: unknown): string[] {
  if (name == null || typeof name !== 'string') {
    return ['name is required'];
  }
  const trimmed = name.trim();
  if (trimmed.length < 1 || trimmed.length > MAX_NAME_LENGTH) {
    return ['name must be 1 to 120 characters'];
  }
  return [];
}

function validatePriceField(price: unknown): string[] {
  if (price == null || typeof price !== 'number' || isNaN(price)) {
    return ['price must be between 0 and 999999999.99'];
  }
  if (price < MIN_PRICE || price > MAX_PRICE) {
    return ['price must be between 0 and 999999999.99'];
  }
  return [];
}

function validateBillingIntervalField(interval: unknown): string[] {
  if (
    interval == null ||
    typeof interval !== 'string' ||
    !(VALID_BILLING_INTERVALS as readonly string[]).includes(interval)
  ) {
    return ['billing_interval must be monthly or yearly'];
  }
  return [];
}

function checkNameCollision(
  name: string,
  existingPlans: PlanRecord[],
  excludeId?: string,
): boolean {
  const normalized = name.trim().toLowerCase();
  return existingPlans.some(
    (plan) =>
      plan.name_normalized === normalized &&
      (excludeId == null || plan.id !== excludeId),
  );
}

// ---------------------------------------------------------------------------
// Plan create validation (R13.1, R13.2, R13.3, R13.4)
// ---------------------------------------------------------------------------

/**
 * Validate a plan creation request.
 *
 * - name: 1-120 chars, non-empty → else error "name must be 1 to 120 characters"
 * - price: number 0.00-999999999.99 → else error "price must be between 0 and 999999999.99"
 * - billing_interval: must be 'monthly' or 'yearly' → else error
 * - Case-insensitive name collision against existingPlans.name_normalized → httpStatus 409
 * - On all valid → { valid: true }
 */
export function validatePlanCreate(
  input: PlanCreateInput,
  existingPlans: PlanRecord[],
): PlanValidationResult {
  const errors: string[] = [];

  errors.push(...validateNameField(input.name));
  errors.push(...validatePriceField(input.price));
  errors.push(...validateBillingIntervalField(input.billing_interval));

  if (errors.length > 0) {
    return { valid: false, httpStatus: 400, errors };
  }

  // Name collision check (case-insensitive) — only if name passed basic validation
  if (checkNameCollision(input.name, existingPlans)) {
    return {
      valid: false,
      httpStatus: 409,
      errors: ['a plan with this name already exists'],
    };
  }

  return { valid: true };
}

// ---------------------------------------------------------------------------
// Plan edit validation (R13.5, R13.3, R13.4)
// ---------------------------------------------------------------------------

/**
 * Validate a plan edit request.
 *
 * Same validation on changed fields; name collision check excludes currentPlan.id.
 */
export function validatePlanEdit(
  input: Partial<PlanCreateInput>,
  currentPlan: PlanRecord,
  existingPlans: PlanRecord[],
): PlanValidationResult {
  const errors: string[] = [];

  // Only validate fields that are provided (partial update)
  if (input.name !== undefined) {
    errors.push(...validateNameField(input.name));
  }
  if (input.price !== undefined) {
    errors.push(...validatePriceField(input.price));
  }
  if (input.billing_interval !== undefined) {
    errors.push(...validateBillingIntervalField(input.billing_interval));
  }

  if (errors.length > 0) {
    return { valid: false, httpStatus: 400, errors };
  }

  // Name collision check (case-insensitive), excluding the current plan
  if (input.name !== undefined) {
    if (checkNameCollision(input.name, existingPlans, currentPlan.id)) {
      return {
        valid: false,
        httpStatus: 409,
        errors: ['a plan with this name already exists'],
      };
    }
  }

  return { valid: true };
}

// ---------------------------------------------------------------------------
// Archive guard (R13.6, R13.13)
// ---------------------------------------------------------------------------

/**
 * Check whether a plan can be archived.
 *
 * If assignedStoreCount > 0 → { success: false, httpStatus: 409, error: "Plan has assigned stores" }
 */
export function canArchivePlan(
  _planId: string,
  assignedStoreCount: number,
): ArchiveResult {
  if (assignedStoreCount > 0) {
    return {
      success: false,
      httpStatus: 409,
      error: 'Plan has assigned stores',
    };
  }
  return { success: true };
}

// ---------------------------------------------------------------------------
// Delete guard (R13.9)
// ---------------------------------------------------------------------------

/**
 * Check whether a plan can be deleted.
 *
 * Same guard as archive: if assignedStoreCount > 0 → 409.
 */
export function canDeletePlan(
  _planId: string,
  assignedStoreCount: number,
): ArchiveResult {
  if (assignedStoreCount > 0) {
    return {
      success: false,
      httpStatus: 409,
      error: 'Plan has assigned stores',
    };
  }
  return { success: true };
}

// ---------------------------------------------------------------------------
// Assign guard (R13.8, R13.14)
// ---------------------------------------------------------------------------

/**
 * Check whether a plan can be assigned to a Store.
 *
 * Plan must exist in plans AND not be archived.
 * If not found → { success: false, httpStatus: 409, error: "Plan not found" }
 * If archived → { success: false, httpStatus: 409, error: "Plan is archived" }
 */
export function canAssignPlan(planId: string, plans: PlanRecord[]): AssignResult {
  const plan = plans.find((p) => p.id === planId);

  if (!plan) {
    return { success: false, httpStatus: 409, error: 'Plan not found' };
  }

  if (plan.archived) {
    return { success: false, httpStatus: 409, error: 'Plan is archived' };
  }

  return { success: true };
}

// ---------------------------------------------------------------------------
// Assignable set (R13.6)
// ---------------------------------------------------------------------------

/**
 * Return only plans where archived === false.
 * Archived plans are excluded from the assignable set.
 */
export function getAssignablePlans(plans: PlanRecord[]): PlanRecord[] {
  return plans.filter((plan) => !plan.archived);
}
