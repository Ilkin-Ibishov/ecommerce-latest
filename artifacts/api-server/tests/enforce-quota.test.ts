import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

/**
 * Unit tests for enforceQuota middleware and quota-io helpers.
 *
 * Feature: super-admin-platform
 * Requirements: 15.1, 15.2, 15.3, 15.4, 15.6, 15.7, 15.9, 15.11
 */

// Mock the quota-io module for middleware isolation testing
vi.mock('../src/lib/store-hooks/quota-io', () => ({
  fetchQuotaLimits: vi.fn(),
  countLiveUsage: vi.fn(),
  resetQuotaLimitsCache: vi.fn(),
}));

import { enforceQuota } from '../src/middlewares/enforceQuota';
import { fetchQuotaLimits, countLiveUsage } from '../src/lib/store-hooks/quota-io';

const mockedFetchQuotaLimits = vi.mocked(fetchQuotaLimits);
const mockedCountLiveUsage = vi.mocked(countLiveUsage);

function mockReq(): Request {
  return {} as Request;
}

function mockRes(): Response {
  const res: Partial<Response> = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res as Response;
}

function mockNext(): NextFunction {
  return vi.fn();
}

describe('enforceQuota middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // The middleware short-circuits (calls next()) when PLATFORM_QUOTA_URL is not set.
    // Set it so quota enforcement is actually exercised.
    process.env.PLATFORM_QUOTA_URL = 'http://mock-control-plane/quota';
  });

  afterEach(() => {
    delete process.env.PLATFORM_QUOTA_URL;
    vi.restoreAllMocks();
  });

  it('calls next() when usage is below limit (R15.3)', async () => {
    mockedFetchQuotaLimits.mockResolvedValue({ products: 100 });
    mockedCountLiveUsage.mockResolvedValue(50);

    const middleware = enforceQuota('products');
    const req = mockReq();
    const res = mockRes();
    const next = mockNext();

    await middleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('rejects with 403 when usage equals limit (R15.4, R15.9)', async () => {
    mockedFetchQuotaLimits.mockResolvedValue({ products: 50 });
    mockedCountLiveUsage.mockResolvedValue(50);

    const middleware = enforceQuota('products');
    const req = mockReq();
    const res = mockRes();
    const next = mockNext();

    await middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.any(String) }),
    );
  });

  it('rejects with 403 when usage exceeds limit (R15.9)', async () => {
    mockedFetchQuotaLimits.mockResolvedValue({ products: 10 });
    mockedCountLiveUsage.mockResolvedValue(15);

    const middleware = enforceQuota('products');
    const req = mockReq();
    const res = mockRes();
    const next = mockNext();

    await middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('rejects with 403 when no plan assigned (limits null → 0) (R15.11)', async () => {
    mockedFetchQuotaLimits.mockResolvedValue(null);
    mockedCountLiveUsage.mockResolvedValue(0);

    const middleware = enforceQuota('products');
    const req = mockReq();
    const res = mockRes();
    const next = mockNext();

    await middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('rejects with 403 when resource is not defined in plan (R15.11)', async () => {
    mockedFetchQuotaLimits.mockResolvedValue({ orders_monthly: 500 });
    mockedCountLiveUsage.mockResolvedValue(0);

    const middleware = enforceQuota('products');
    const req = mockReq();
    const res = mockRes();
    const next = mockNext();

    await middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('allows the request when usage is 0 and limit is positive', async () => {
    mockedFetchQuotaLimits.mockResolvedValue({ products: 100 });
    mockedCountLiveUsage.mockResolvedValue(0);

    const middleware = enforceQuota('products');
    const req = mockReq();
    const res = mockRes();
    const next = mockNext();

    await middleware(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  it('allows through on unexpected error (fail-open for availability)', async () => {
    mockedFetchQuotaLimits.mockRejectedValue(new Error('network error'));

    const middleware = enforceQuota('products');
    const req = mockReq();
    const res = mockRes();
    const next = mockNext();

    await middleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('respects the requested parameter for multiple items', async () => {
    mockedFetchQuotaLimits.mockResolvedValue({ products: 10 });
    mockedCountLiveUsage.mockResolvedValue(8);

    // Requesting 3 items: 8 + 3 = 11 > 10 → reject
    const middleware = enforceQuota('products', 3);
    const req = mockReq();
    const res = mockRes();
    const next = mockNext();

    await middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('allows when requested fits exactly within remaining capacity', async () => {
    mockedFetchQuotaLimits.mockResolvedValue({ products: 10 });
    mockedCountLiveUsage.mockResolvedValue(8);

    // Requesting 2 items: 8 + 2 = 10 <= 10 → allow
    const middleware = enforceQuota('products', 2);
    const req = mockReq();
    const res = mockRes();
    const next = mockNext();

    await middleware(req, res, next);

    expect(next).toHaveBeenCalled();
  });
});
