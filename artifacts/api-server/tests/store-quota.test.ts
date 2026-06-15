import { describe, it, expect } from 'vitest';
import {
  getEffectiveLimit,
  claimQuota,
  releaseQuota,
  startNewWindow,
  isReadBlocked,
  queryQuotaUsage,
  assessLimitReduction,
  simulateConcurrentClaims,
} from '../src/lib/store-hooks/quota';

/**
 * Unit tests for store-side quota enforcement logic.
 *
 * Feature: super-admin-platform
 * Properties: 25, 26
 * Requirements: 15.1, 15.2, 15.3, 15.4, 15.5, 15.6, 15.7, 15.9, 15.11, 15.12
 */

describe('getEffectiveLimit', () => {
  it('returns 0 when no plan is assigned (null)', () => {
    expect(getEffectiveLimit(null, 'products')).toBe(0);
  });

  it('returns 0 when the resource is not in the plan', () => {
    expect(getEffectiveLimit({ orders_monthly: 100 }, 'products')).toBe(0);
  });

  it('returns the limit from the plan when the resource is defined', () => {
    expect(getEffectiveLimit({ products: 50 }, 'products')).toBe(50);
  });

  it('floors floating point limits to integers', () => {
    expect(getEffectiveLimit({ products: 10.9 }, 'products')).toBe(10);
  });

  it('clamps negative limits to 0', () => {
    expect(getEffectiveLimit({ products: -5 }, 'products')).toBe(0);
  });

  it('returns 0 for NaN values', () => {
    expect(getEffectiveLimit({ products: NaN }, 'products')).toBe(0);
  });

  it('handles large limits correctly', () => {
    expect(getEffectiveLimit({ products: 2147483647 }, 'products')).toBe(2147483647);
  });
});

describe('claimQuota', () => {
  describe('create below limit → allowed + increment (R15.3)', () => {
    it('allows a create when usage is below limit', () => {
      const result = claimQuota({ currentUsage: 5, limit: 10, requested: 1 });
      expect(result).toEqual({ allowed: true, newUsage: 6 });
    });

    it('allows a create when usage is 0 and limit is positive', () => {
      const result = claimQuota({ currentUsage: 0, limit: 100, requested: 1 });
      expect(result).toEqual({ allowed: true, newUsage: 1 });
    });

    it('allows creating multiple items when usage + requested <= limit', () => {
      const result = claimQuota({ currentUsage: 5, limit: 10, requested: 3 });
      expect(result).toEqual({ allowed: true, newUsage: 8 });
    });

    it('allows creating up to exactly the limit', () => {
      const result = claimQuota({ currentUsage: 9, limit: 10, requested: 1 });
      expect(result).toEqual({ allowed: true, newUsage: 10 });
    });
  });

  describe('create at/above limit → 403 (R15.4, R15.9)', () => {
    it('rejects a create when usage equals limit', () => {
      const result = claimQuota({ currentUsage: 10, limit: 10, requested: 1 });
      expect(result.allowed).toBe(false);
      if (!result.allowed) {
        expect(result.httpStatus).toBe(403);
        expect(result.error).toBeTruthy();
      }
    });

    it('rejects a create when usage exceeds limit (limit lowered)', () => {
      const result = claimQuota({ currentUsage: 15, limit: 10, requested: 1 });
      expect(result.allowed).toBe(false);
      if (!result.allowed) {
        expect(result.httpStatus).toBe(403);
      }
    });

    it('rejects when requested would push usage above limit', () => {
      const result = claimQuota({ currentUsage: 8, limit: 10, requested: 5 });
      expect(result.allowed).toBe(false);
      if (!result.allowed) {
        expect(result.httpStatus).toBe(403);
      }
    });

    it('error message is a non-empty string', () => {
      const result = claimQuota({ currentUsage: 50, limit: 50, requested: 1 });
      expect(result.allowed).toBe(false);
      if (!result.allowed) {
        expect(typeof result.error).toBe('string');
        expect(result.error.length).toBeGreaterThan(0);
      }
    });
  });

  describe('no plan (limit=0) always blocks creates (R15.11)', () => {
    it('rejects when limit is 0', () => {
      const result = claimQuota({ currentUsage: 0, limit: 0, requested: 1 });
      expect(result.allowed).toBe(false);
      if (!result.allowed) {
        expect(result.httpStatus).toBe(403);
      }
    });
  });

  describe('input normalization', () => {
    it('floors floating-point currentUsage', () => {
      const result = claimQuota({ currentUsage: 4.9, limit: 10, requested: 1 });
      expect(result).toEqual({ allowed: true, newUsage: 5 });
    });

    it('floors floating-point requested to at least 1', () => {
      const result = claimQuota({ currentUsage: 5, limit: 10, requested: 0.3 });
      expect(result).toEqual({ allowed: true, newUsage: 6 });
    });

    it('clamps negative currentUsage to 0', () => {
      const result = claimQuota({ currentUsage: -5, limit: 10, requested: 1 });
      expect(result).toEqual({ allowed: true, newUsage: 1 });
    });
  });
});

describe('releaseQuota', () => {
  it('decrements usage by specified amount', () => {
    const result = releaseQuota({ currentUsage: 10, released: 1 });
    expect(result).toEqual({ newUsage: 9 });
  });

  it('decrements usage by larger amount', () => {
    const result = releaseQuota({ currentUsage: 10, released: 3 });
    expect(result).toEqual({ newUsage: 7 });
  });

  it('floors usage at 0 — never goes negative', () => {
    const result = releaseQuota({ currentUsage: 2, released: 5 });
    expect(result).toEqual({ newUsage: 0 });
  });

  it('floors usage at 0 when usage is already 0', () => {
    const result = releaseQuota({ currentUsage: 0, released: 1 });
    expect(result).toEqual({ newUsage: 0 });
  });

  it('handles large releases gracefully', () => {
    const result = releaseQuota({ currentUsage: 5, released: 1000 });
    expect(result).toEqual({ newUsage: 0 });
  });

  it('handles 0 release (no change)', () => {
    const result = releaseQuota({ currentUsage: 5, released: 0 });
    expect(result).toEqual({ newUsage: 5 });
  });
});

describe('startNewWindow', () => {
  it('always returns 0 for a new window period', () => {
    expect(startNewWindow()).toBe(0);
  });
});

describe('isReadBlocked (R15.5)', () => {
  it('never blocks reads regardless of usage and limit', () => {
    expect(isReadBlocked(100, 10)).toBe(false);
  });

  it('never blocks reads when usage is at limit', () => {
    expect(isReadBlocked(50, 50)).toBe(false);
  });

  it('never blocks reads when usage exceeds limit', () => {
    expect(isReadBlocked(200, 100)).toBe(false);
  });

  it('never blocks reads when limit is 0', () => {
    expect(isReadBlocked(5, 0)).toBe(false);
  });

  it('never blocks reads when both are 0', () => {
    expect(isReadBlocked(0, 0)).toBe(false);
  });
});

describe('queryQuotaUsage (R15.6)', () => {
  it('returns limit and usage as non-negative integers', () => {
    const result = queryQuotaUsage(5, 10);
    expect(result).toEqual({ limit: 10, usage: 5 });
  });

  it('reports usage truthfully even when above limit (limit lowered)', () => {
    const result = queryQuotaUsage(15, 10);
    expect(result).toEqual({ limit: 10, usage: 15 });
  });

  it('returns 0 for negative inputs', () => {
    const result = queryQuotaUsage(-3, -5);
    expect(result).toEqual({ limit: 0, usage: 0 });
  });

  it('floors floating point values', () => {
    const result = queryQuotaUsage(5.7, 10.9);
    expect(result).toEqual({ limit: 10, usage: 5 });
  });

  it('returns limit and usage as integers', () => {
    const result = queryQuotaUsage(42, 100);
    expect(Number.isInteger(result.limit)).toBe(true);
    expect(Number.isInteger(result.usage)).toBe(true);
  });
});

describe('assessLimitReduction (R15.8 — lowering limit never deletes data)', () => {
  it('always retains data when limit is lowered below usage', () => {
    const result = assessLimitReduction(15, 10);
    expect(result.dataRetained).toBe(true);
    expect(result.createsBlocked).toBe(true);
  });

  it('always retains data when limit equals usage', () => {
    const result = assessLimitReduction(10, 10);
    expect(result.dataRetained).toBe(true);
    expect(result.createsBlocked).toBe(true);
  });

  it('does not block creates when usage is below new limit', () => {
    const result = assessLimitReduction(5, 10);
    expect(result.dataRetained).toBe(true);
    expect(result.createsBlocked).toBe(false);
  });

  it('never causes data deletion regardless of limit value', () => {
    const result = assessLimitReduction(1000, 0);
    expect(result.dataRetained).toBe(true);
    expect(result.createsBlocked).toBe(true);
  });
});

describe('simulateConcurrentClaims (R15.12)', () => {
  it('grants all claims when capacity is sufficient', () => {
    const result = simulateConcurrentClaims(0, 10, 5);
    expect(result).toEqual({ granted: 5, rejected: 0, finalUsage: 5 });
  });

  it('grants only up to the limit when claims exceed capacity', () => {
    const result = simulateConcurrentClaims(8, 10, 5);
    expect(result).toEqual({ granted: 2, rejected: 3, finalUsage: 10 });
  });

  it('rejects all claims when usage is already at limit', () => {
    const result = simulateConcurrentClaims(10, 10, 5);
    expect(result).toEqual({ granted: 0, rejected: 5, finalUsage: 10 });
  });

  it('rejects all claims when usage exceeds limit (limit lowered)', () => {
    const result = simulateConcurrentClaims(15, 10, 3);
    expect(result).toEqual({ granted: 0, rejected: 3, finalUsage: 15 });
  });

  it('ensures final usage never exceeds the limit', () => {
    const result = simulateConcurrentClaims(0, 10, 100);
    expect(result.finalUsage).toBeLessThanOrEqual(10);
    expect(result.granted).toBe(10);
    expect(result.rejected).toBe(90);
  });

  it('handles zero limit (no plan)', () => {
    const result = simulateConcurrentClaims(0, 0, 5);
    expect(result).toEqual({ granted: 0, rejected: 5, finalUsage: 0 });
  });

  it('handles zero claims', () => {
    const result = simulateConcurrentClaims(5, 10, 0);
    expect(result).toEqual({ granted: 0, rejected: 0, finalUsage: 5 });
  });
});
