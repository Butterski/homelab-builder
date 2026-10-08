import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchServices } from './use-services';

describe('fetchServices', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('asks for the signed-in or local catalog even without a token', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ data: [{ id: 'private-service', name: 'Private Service' }] }),
    });

    const services = await fetchServices();

    expect(services).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/my-services$/),
      expect.objectContaining({
        headers: expect.not.objectContaining({ Authorization: expect.any(String) }),
      }),
    );
  });

  it('falls back to the public catalog when the caller is not signed in', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({ error: 'Authorization header required', code: 'unauthorized' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ data: [{ id: 'public-service', name: 'Public Service' }] }),
      });

    const services = await fetchServices();

    expect(services[0].id).toBe('public-service');
    expect(fetchMock).toHaveBeenNthCalledWith(1, expect.stringMatching(/\/api\/my-services$/), expect.anything());
    expect(fetchMock).toHaveBeenNthCalledWith(2, expect.stringMatching(/\/api\/services$/), expect.anything());
  });
});
