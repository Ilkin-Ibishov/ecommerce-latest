import { describe, it, expect } from 'vitest';
import {
  getStoreFeed,
  validateMarkRead,
  type NotificationRecord,
  type NotificationTarget,
  type NotificationRead,
} from '../src/lib/notifications/feed';

// Feature: super-admin-platform
// Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.8

describe('getStoreFeed', () => {
  const storeA = 'store-a';
  const storeB = 'store-b';

  const notifications: NotificationRecord[] = [
    { id: 'n1', content: 'Hello Store A', created_at: '2024-01-01T10:00:00Z' },
    { id: 'n2', content: 'Hello Store B', created_at: '2024-01-01T11:00:00Z' },
    { id: 'n3', content: 'Broadcast', created_at: '2024-01-01T12:00:00Z' },
    { id: 'n4', content: 'Same time as n3', created_at: '2024-01-01T12:00:00Z' },
  ];

  const targets: NotificationTarget[] = [
    { notification_id: 'n1', store_id: storeA },
    { notification_id: 'n2', store_id: storeB },
    { notification_id: 'n3', store_id: storeA },
    { notification_id: 'n3', store_id: storeB },
    { notification_id: 'n4', store_id: storeA },
  ];

  const reads: NotificationRead[] = [
    { notification_id: 'n1', store_id: storeA },
  ];

  it('returns only notifications targeted at the given store (R7.1)', () => {
    const result = getStoreFeed({
      storeId: storeA,
      notifications,
      targets,
      reads,
    });

    const ids = result.items.map((i) => i.id);
    expect(ids).toContain('n1');
    expect(ids).toContain('n3');
    expect(ids).toContain('n4');
    expect(ids).not.toContain('n2');
  });

  it('excludes notifications for other stores (R7.1)', () => {
    const result = getStoreFeed({
      storeId: storeB,
      notifications,
      targets,
      reads,
    });

    const ids = result.items.map((i) => i.id);
    expect(ids).toContain('n2');
    expect(ids).toContain('n3');
    expect(ids).not.toContain('n1');
    expect(ids).not.toContain('n4');
  });

  it('exposes content, created_at, and read state for each item (R7.2)', () => {
    const result = getStoreFeed({
      storeId: storeA,
      notifications,
      targets,
      reads,
    });

    const n1Item = result.items.find((i) => i.id === 'n1');
    expect(n1Item).toBeDefined();
    expect(n1Item!.content).toBe('Hello Store A');
    expect(n1Item!.created_at).toBe('2024-01-01T10:00:00Z');
    expect(n1Item!.read).toBe(true);

    const n3Item = result.items.find((i) => i.id === 'n3');
    expect(n3Item).toBeDefined();
    expect(n3Item!.read).toBe(false);
  });

  it('returns unread_count >= 0 as count of items without reads (R7.5)', () => {
    const result = getStoreFeed({
      storeId: storeA,
      notifications,
      targets,
      reads,
    });

    // n1 is read, n3 and n4 are unread
    expect(result.unread_count).toBe(2);
  });

  it('returns empty list and unread_count 0 when no notifications targeted (R7.6)', () => {
    const result = getStoreFeed({
      storeId: 'store-nonexistent',
      notifications,
      targets,
      reads,
    });

    expect(result.items).toEqual([]);
    expect(result.unread_count).toBe(0);
  });

  it('orders by created_at DESC, then id DESC for tie-break (R7.8)', () => {
    const result = getStoreFeed({
      storeId: storeA,
      notifications,
      targets,
      reads,
    });

    const ids = result.items.map((i) => i.id);
    // n4 and n3 have same created_at (2024-01-01T12:00:00Z), n4 > n3 lexically → n4 first
    // Then n1 (2024-01-01T10:00:00Z)
    expect(ids).toEqual(['n4', 'n3', 'n1']);
  });

  it('handles all notifications being read → unread_count is 0', () => {
    const allRead: NotificationRead[] = [
      { notification_id: 'n1', store_id: storeA },
      { notification_id: 'n3', store_id: storeA },
      { notification_id: 'n4', store_id: storeA },
    ];

    const result = getStoreFeed({
      storeId: storeA,
      notifications,
      targets,
      reads: allRead,
    });

    expect(result.unread_count).toBe(0);
    expect(result.items.every((i) => i.read)).toBe(true);
  });
});

describe('validateMarkRead', () => {
  const storeA = 'store-a';
  const storeB = 'store-b';

  const notifications: NotificationRecord[] = [
    { id: 'n1', content: 'Hello', created_at: '2024-01-01T10:00:00Z' },
    { id: 'n2', content: 'World', created_at: '2024-01-01T11:00:00Z' },
  ];

  const targets: NotificationTarget[] = [
    { notification_id: 'n1', store_id: storeA },
    { notification_id: 'n2', store_id: storeB },
  ];

  it('returns success when notification exists and is targeted at the store (R7.3)', () => {
    const result = validateMarkRead({
      notificationId: 'n1',
      storeId: storeA,
      targets,
      notifications,
    });

    expect(result).toEqual({ success: true });
  });

  it('returns 404 when notification does not exist (R7.4)', () => {
    const result = validateMarkRead({
      notificationId: 'n-nonexistent',
      storeId: storeA,
      targets,
      notifications,
    });

    expect(result).toEqual({
      success: false,
      httpStatus: 404,
      error: 'Notification not found',
    });
  });

  it('returns 404 when notification exists but is not targeted at the store (foreign) (R7.4)', () => {
    const result = validateMarkRead({
      notificationId: 'n2',
      storeId: storeA, // n2 is targeted at storeB, not storeA
      targets,
      notifications,
    });

    expect(result).toEqual({
      success: false,
      httpStatus: 404,
      error: 'Notification not found',
    });
  });

  it('does not distinguish non-existent from foreign in error message (R7.4)', () => {
    const resultNonExistent = validateMarkRead({
      notificationId: 'n-nonexistent',
      storeId: storeA,
      targets,
      notifications,
    });

    const resultForeign = validateMarkRead({
      notificationId: 'n2',
      storeId: storeA,
      targets,
      notifications,
    });

    // Both produce the same error — no information leakage
    expect(resultNonExistent.success).toBe(false);
    expect(resultForeign.success).toBe(false);
    if (!resultNonExistent.success && !resultForeign.success) {
      expect(resultNonExistent.error).toBe(resultForeign.error);
    }
  });
});
