import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from './api';

describe('shared service API', () => {
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

    it('uses the signed-in/local service endpoint even without a token', async () => {
        fetchMock.mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => ({ data: [{ id: 'private-service', name: 'Private Service' }] }),
        });

        const result = await api.getServices();

        expect(result.data).toHaveLength(1);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock).toHaveBeenCalledWith(
            expect.stringMatching(/\/api\/my-services$/),
            expect.objectContaining({
                headers: expect.not.objectContaining({
                    Authorization: expect.any(String),
                }),
            }),
        );
    });

    it('falls back to the public service catalog when the user endpoint is unauthorized', async () => {
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

        const result = await api.getServices();

        expect(result.data[0].id).toBe('public-service');
        expect(fetchMock).toHaveBeenNthCalledWith(1, expect.stringMatching(/\/api\/my-services$/), expect.anything());
        expect(fetchMock).toHaveBeenNthCalledWith(2, expect.stringMatching(/\/api\/services$/), expect.anything());
    });
});
