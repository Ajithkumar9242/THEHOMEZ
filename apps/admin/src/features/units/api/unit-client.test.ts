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

  it('supports search query parameter in list', async () => {
    vi.mocked(apiRequest).mockResolvedValue([]);
    await unitClient.list({ search: 'YARD', activeOnly: true });
    expect(apiRequest).toHaveBeenCalledWith('/units?activeOnly=true&search=YARD', {
      method: 'GET',
      signal: undefined,
    });
  });

  it('posts payload to /units on create', async () => {
    const payload = {
      code: 'YARD',
      name: 'Cubic Yard',
      symbol: 'yd3',
      singularLabel: 'Yard',
      pluralLabel: 'Yards',
      classification: 'VOLUME' as const,
      isDiscrete: false,
      allowedMaxPrecision: 2,
    };
    vi.mocked(apiRequest).mockResolvedValue({ ...payload, id: 'u1', isActive: true, isSystem: false, createdAt: '', updatedAt: '' });
    await unitClient.create(payload);
    expect(apiRequest).toHaveBeenCalledWith('/units', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  });

  it('patches /units/:code on update', async () => {
    const payload = { name: 'Updated Yard' };
    vi.mocked(apiRequest).mockResolvedValue({ code: 'YARD', name: 'Updated Yard' });
    await unitClient.update('YARD', payload);
    expect(apiRequest).toHaveBeenCalledWith('/units/YARD', {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  });

  it('calls updateStatus to toggle unit active status', async () => {
    vi.mocked(apiRequest).mockResolvedValue({ code: 'YARD', isActive: false });
    await unitClient.updateStatus('YARD', false);
    expect(apiRequest).toHaveBeenCalledWith('/units/YARD', {
      method: 'PATCH',
      body: JSON.stringify({ isActive: false }),
    });
  });

  it('calls /units/conversions on listConversions', async () => {
    vi.mocked(apiRequest).mockResolvedValue([]);
    await unitClient.listConversions();
    expect(apiRequest).toHaveBeenCalledWith('/units/conversions', {
      method: 'GET',
      signal: undefined,
    });
  });
});
