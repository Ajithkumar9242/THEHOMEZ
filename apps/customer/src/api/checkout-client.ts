import type {
  IApiErrorDetail,
  IApiErrorResponse,
  IApiResponse,
  IPrepareCheckoutRequestDto,
  IPrepareCheckoutResponseDto,
  ICheckoutSessionDto,
} from '@thehomez/shared-types';
import type { AuthorizedFetchFn } from './address-client.js';

export class CheckoutApiError extends Error {
  constructor(
    message: string,
    public readonly code = 'CHECKOUT_API_ERROR',
    public readonly status = 500,
    public readonly details?: IApiErrorDetail[],
  ) {
    super(message);
    this.name = 'CheckoutApiError';
  }
}

export interface CheckoutClientOptions {
  basePath?: string;
  fetchWithAuth: AuthorizedFetchFn;
}

/** Uses the authenticated fetch wrapper for cookie restoration, bearer tokens and 401 retry. */
export class CheckoutClient {
  private readonly basePath: string;
  private readonly fetchWithAuth: AuthorizedFetchFn;

  constructor(options: CheckoutClientOptions) {
    this.basePath = (options.basePath ?? '/checkout').replace(/\/+$/, '');
    this.fetchWithAuth = options.fetchWithAuth;
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    let response: Response;
    try {
      response = await this.fetchWithAuth(`${this.basePath}${path}`, {
        ...init,
        headers: { Accept: 'application/json', ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...init.headers },
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') throw error;
      throw new CheckoutApiError('Unable to connect to checkout. Your request can be retried safely.', 'NETWORK_ERROR', 0);
    }
    let payload: unknown = null;
    if ((response.headers?.get('content-type') ?? '').includes('application/json')) {
      try { payload = await response.json(); } catch { payload = null; }
    }
    if (!response.ok) {
      const apiError = (payload as IApiErrorResponse | null)?.error;
      throw new CheckoutApiError(
        apiError?.message ?? (response.status === 401 ? 'Your session has expired. Sign in to continue.' : `Checkout request failed (${response.status}).`),
        apiError?.code ?? `HTTP_${response.status}`,
        response.status,
        Array.isArray(apiError?.details) ? apiError.details : undefined,
      );
    }
    const envelope = payload as IApiResponse<T> | null;
    return envelope && envelope.success ? envelope.data : payload as T;
  }

  /** One key belongs to one logical payload; retain it when retrying a network failure. */
  createIdempotencyKey(): string {
    if (!globalThis.crypto?.randomUUID) throw new CheckoutApiError('Secure checkout retry keys are unavailable in this browser.', 'CRYPTO_UNAVAILABLE', 0);
    return globalThis.crypto.randomUUID();
  }

  prepare(dto: IPrepareCheckoutRequestDto, idempotencyKey: string): Promise<IPrepareCheckoutResponseDto> {
    return this.request<IPrepareCheckoutResponseDto>('/prepare', {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify(dto),
    });
  }

  getSession(sessionId: string): Promise<ICheckoutSessionDto> {
    return this.request<ICheckoutSessionDto>(`/sessions/${encodeURIComponent(sessionId)}`, { method: 'GET' });
  }
}
