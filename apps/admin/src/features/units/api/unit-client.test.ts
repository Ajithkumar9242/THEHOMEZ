import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiRequest } from '../../../services/api-client.js';
import { unitClient } from './unit-client.js';

vi.mock('../../../services/api-client.js', () => ({
  apiRequest: vi.fn(),
}));

afterEach(() => vi.clearAllMocks());

describe('unit client', () => {
  it('requests active units by default without pagination or unsupported filters', async () => {
    vi.mocked(apiRequest).mockResolvedValue([]);
    const signal = new AbortController().signal;
    await unitClient.list({ signal });
    expect(apiRequest).toHaveBeenCalledWith('/units?activeOnly=true', {
      method: 'GET',
      signal,
    });
  });

  it('constructs the supported classification and include-inactive query', async () => {
    vi.mocked(apiRequest).mockResolvedValue([]);
    await unitClient.list({ classification: 'MASS', activeOnly: false });
    expect(apiRequest).toHaveBeenCalledWith('/units?classification=MASS&activeOnly=false', {
      method: 'GET',
      signal: undefined,
    });
  });

  it('looks up a unit by encoded code using GET only', async () => {
    vi.mocked(apiRequest).mockResolvedValue({ code: 'SQ_FT' });
    const signal = new AbortController().signal;
    await unitClient.getByCode('SQ_FT', { signal });
    expect(apiRequest).toHaveBeenCalledWith('/units/SQ_FT', { method: 'GET', signal });
    expect(
      vi
        .mocked(apiRequest)
        .mock.calls.every(
          ([path, init]) =>
            (path === '/units/SQ_FT' || path.startsWith('/units?')) && init?.method === 'GET',
        ),
    ).toBe(true);
  });
});
