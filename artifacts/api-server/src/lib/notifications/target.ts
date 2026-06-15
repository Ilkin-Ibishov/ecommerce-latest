// Feature: super-admin-platform
// Pure notification targeting logic for platform messages.
// Resolves target scope and validates content + target store IDs.

export type TargetScope = 'single' | 'set' | 'broadcast';

export interface TargetingInput {
  content: string;
  targetStoreIds: string[] | 'broadcast';
  registeredStoreIds: string[];  // all stores in the registry
  disabledStoreIds: string[];    // stores with platform_status='disabled'
}

export type TargetingResult =
  | { valid: true; scope: TargetScope; resolvedTargetIds: string[] }
  | { valid: false; httpStatus: 400 | 404; error: string };

/**
 * Resolves notification targets for a Platform_Message.
 *
 * Rules:
 * 1. Content must be non-empty, non-whitespace, and ≤5000 chars (else 400).
 * 2. Broadcast → targets all registered stores excluding disabled ones (R8.3).
 * 3. Single target (1 id) → must exist in registry AND not be disabled (R8.1: "not disabled"); else 404.
 * 4. Set target (2–1000 ids) → all must exist in registry (else 404, nothing created);
 *    disabled stores in a set are included (only broadcast excludes disabled per R8.3).
 * 5. Target set >1000 → 400.
 * 6. Empty target array → 400.
 */
export function resolveNotificationTargets(input: TargetingInput): TargetingResult {
  const { content, targetStoreIds, registeredStoreIds, disabledStoreIds } = input;

  // --- Content validation (R8.5) ---
  const trimmed = content.trim();
  if (trimmed.length === 0 || content.length > 5000) {
    return {
      valid: false,
      httpStatus: 400,
      error: 'Content must be between 1 and 5000 characters',
    };
  }

  // --- Broadcast targeting (R8.3) ---
  if (targetStoreIds === 'broadcast') {
    const disabledSet = new Set(disabledStoreIds);
    const resolvedTargetIds = registeredStoreIds.filter(id => !disabledSet.has(id));
    return { valid: true, scope: 'broadcast', resolvedTargetIds };
  }

  // --- Array targeting ---
  if (targetStoreIds.length === 0) {
    return {
      valid: false,
      httpStatus: 400,
      error: 'Target set must contain at least one store',
    };
  }

  if (targetStoreIds.length > 1000) {
    return {
      valid: false,
      httpStatus: 400,
      error: 'Target set must not exceed 1000 stores',
    };
  }

  // Check all target IDs exist in the registry (R8.6)
  const registeredSet = new Set(registeredStoreIds);
  const missingIds = targetStoreIds.filter(id => !registeredSet.has(id));
  if (missingIds.length > 0) {
    return {
      valid: false,
      httpStatus: 404,
      error: 'One or more target stores not found in registry',
    };
  }

  // --- Single target (R8.1) ---
  if (targetStoreIds.length === 1) {
    const storeId = targetStoreIds[0];
    const disabledSet = new Set(disabledStoreIds);
    // R8.1: targeted at a specific Store whose Platform_Status is not disabled
    if (disabledSet.has(storeId)) {
      return {
        valid: false,
        httpStatus: 404,
        error: 'One or more target stores not found in registry',
      };
    }
    return { valid: true, scope: 'single', resolvedTargetIds: [storeId] };
  }

  // --- Set target (2–1000) (R8.2) ---
  // All IDs exist (checked above). Disabled stores in a set are included;
  // only broadcast explicitly excludes disabled (R8.3).
  return { valid: true, scope: 'set', resolvedTargetIds: [...targetStoreIds] };
}
