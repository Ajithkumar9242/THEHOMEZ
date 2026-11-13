import { describe, expect, it, vi } from 'vitest';
import { CheckoutApiError, CheckoutClient } from '../api/checkout-client.js';

const response = (data: unknown, status = 201) => new Response(JSON.stringify({ success: true, data }), { status, headers: { 'content-type': 'application/json' } });

describe('CheckoutClient', () => {
  it('posts the request with an idempotency header and unwraps the backend response', async () => {
    const data = { session: { sessionId: 'session-1', status: 'PREPARED' }, idempotentReplay: false };
    const fetchWithAuth = vi.fn().mockResolvedValue(response(data));
    const client = new CheckoutClient({ fetchWithAuth });
    await expect(client.prepare({ addressId: 'address-1', expectedCartVersion: 5, validationSnapshotId: 'snapshot-1' }, 'stable-key')).resolves.toEqual(data);
    expect(fetchWithAuth).toHaveBeenCalledWith('/checkout/prepare', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ Accept: 'application/json', 'Content-Type': 'application/json', 'Idempotency-Key': 'stable-key' }),
      body: JSON.stringify({ addressId: 'address-1', expectedCartVersion: 5, validationSnapshotId: 'snapshot-1' }),
    }));
  });

  it('retains a generated key when the same logical request is retried after network failure', async () => {
    const fetchWithAuth = vi.fn().mockRejectedValueOnce(new TypeError('offline')).mockResolvedValue(response({ ok: true }));
    const client = new CheckoutClient({ fetchWithAuth });
    const key = client.createIdempotencyKey();
    await expect(client.prepare({ addressId: 'address-1' }, key)).rejects.toMatchObject({ code: 'NETWORK_ERROR', status: 0 });
    await client.prepare({ addressId: 'address-1' }, key);
    expect(fetchWithAuth.mock.calls.map((call) => (call[1]?.headers as Record<string, string>)['Idempotency-Key'])).toEqual([key, key]);
  });

  it('preserves backend error codes and statuses', async () => {
    const fetchWithAuth = vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ success: false, error: { code: 'CART_VERSION_CONFLICT', message: 'Cart changed.' } }), { status: 409, headers: { 'content-type': 'application/json' } })));
    const client = new CheckoutClient({ fetchWithAuth });
    const result = client.getSession('session-1');
    await expect(result).rejects.toBeInstanceOf(CheckoutApiError);
    await expect(result).rejects.toMatchObject({ code: 'CART_VERSION_CONFLICT', status: 409 });
  });

  it.each([
    [401, 'CUSTOMER_IDENTITY_REQUIRED'],
    [404, 'CHECKOUT_SESSION_NOT_FOUND'],
    [409, 'IDEMPOTENCY_KEY_PAYLOAD_MISMATCH'],
    [410, 'CHECKOUT_SESSION_EXPIRED'],
    [422, 'PRICE_DRIFT_UNACKNOWLEDGED'],
  ])('maps HTTP %i to the backend code', async (status, code) => {
    const fetchWithAuth = vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ success: false, error: { code, message: 'Rejected.' } }), { status, headers: { 'content-type': 'application/json' } })));
    const client = new CheckoutClient({ fetchWithAuth });
    await expect(client.getSession('session-1')).rejects.toMatchObject({ status, code, message: 'Rejected.' });
  });
});
