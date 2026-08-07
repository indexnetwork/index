/** Config */
import { config } from 'dotenv';
config({ path: '.env.test', override: true });

import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';

// Stub the service so the controller's authorization boundary can be exercised
// without a database. We only care that staff-gated handlers refuse non-staff
// callers *before* any service work happens, and that listMine surfaces the
// server-computed capability.
const reviewRequest = mock(async () => ({ id: 'n1', title: 'X', status: 'pending', submittedAt: 'now' }));
const listPendingRequests = mock(async () => []);
const listMyRequests = mock(async () => []);

mock.module('../../services/network-request.service', () => ({
  networkRequestService: { reviewRequest, listPendingRequests, listMyRequests },
  NetworkRequestService: class {},
}));

import { NetworkRequestController } from '../network-request.controller';
import type { AuthenticatedUser } from '../../guards/auth.guard';

afterAll(() => mock.restore());

const staff = (): AuthenticatedUser => ({ id: 'u-staff', email: 'staff@index.network', name: 'Staff' });
const nonStaff = (): AuthenticatedUser => ({ id: 'u-normal', email: 'user@example.com', name: 'User' });

describe('NetworkRequestController authorization boundary', () => {
  const controller = new NetworkRequestController();

  beforeEach(() => {
    reviewRequest.mockClear();
    listPendingRequests.mockClear();
    listMyRequests.mockClear();
  });

  test('review is refused for non-staff before touching the service', async () => {
    const req = new Request('http://localhost/network-requests/n1/review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision: 'approve' }),
    });
    const res = await controller.review(req, nonStaff(), { id: 'n1' });
    expect(res.status).toBe(403);
    expect(reviewRequest).not.toHaveBeenCalled();
  });

  test('listPending is refused for non-staff before touching the service', async () => {
    const res = await controller.listPending(new Request('http://localhost/network-requests/pending'), nonStaff());
    expect(res.status).toBe(403);
    expect(listPendingRequests).not.toHaveBeenCalled();
  });

  test('staff may review and reach the service', async () => {
    const req = new Request('http://localhost/network-requests/n1/review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision: 'approve' }),
    });
    const res = await controller.review(req, staff(), { id: 'n1' });
    expect(res.status).toBe(200);
    expect(reviewRequest).toHaveBeenCalledTimes(1);
  });

  test('staff may list pending and reach the service', async () => {
    const res = await controller.listPending(new Request('http://localhost/network-requests/pending'), staff());
    expect(res.status).toBe(200);
    expect(listPendingRequests).toHaveBeenCalledTimes(1);
  });

  test('listMine returns canReview=true for staff', async () => {
    const res = await controller.listMine(new Request('http://localhost/network-requests'), staff());
    const data = (await res.json()) as { canReview: boolean };
    expect(res.status).toBe(200);
    expect(data.canReview).toBe(true);
  });

  test('listMine returns canReview=false for non-staff', async () => {
    const res = await controller.listMine(new Request('http://localhost/network-requests'), nonStaff());
    const data = (await res.json()) as { canReview: boolean };
    expect(res.status).toBe(200);
    expect(data.canReview).toBe(false);
  });
});
