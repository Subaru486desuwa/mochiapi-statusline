import {
    mkdtempSync,
    rmSync
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi
} from 'vitest';

let directory: string;
beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'mochi-link-'));
    vi.stubEnv('XDG_CONFIG_HOME', directory);
    vi.stubEnv('XDG_CACHE_HOME', directory);
    vi.stubEnv('ANTHROPIC_BASE_URL', 'https://api.mochiapi.com/v1');
    vi.stubEnv('ANTHROPIC_AUTH_TOKEN', 'sk-connection-a');
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    vi.resetModules();
});
afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    rmSync(directory, { recursive: true, force: true });
});

describe('current Mochi connection', () => {
    it('reports unavailable quota after fetch failure rather than requesting an upgrade', async () => {
        const api = await import('../mochiapi');
        vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(new Response('', { status: 503 }))));
        const config = api.loadMochiConfig();
        if (!config)
            throw new Error('Missing synthetic connection');
        const result = await api.fetchBalance(config, null);
        expect(result.ok).toBe(false);
        expect(result.claudeSubscription).toEqual({ status: 'unavailable', plans: [] });
    });

    it('follows a paired Claude connection and never combines a foreign URL with a saved token', async () => {
        const api = await import('../mochiapi');
        api.saveMochiConfig({ baseUrl: 'https://mochiapi.com', token: 'sk-old-account', refreshIntervalSec: 30 });
        expect(api.loadMochiConfig()).toMatchObject({ baseUrl: 'https://api.mochiapi.com', token: 'sk-connection-a' });
        vi.stubEnv('ANTHROPIC_BASE_URL', 'https://other.example');
        expect(api.loadMochiConfig()).toBeNull();
    });
    it('does not expose a previous connection cache after switching tokens', async () => {
        const api = await import('../mochiapi');
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { user_remain_quota_usd: 12 } }), { status: 200 })));
        const config = api.loadMochiConfig();
        expect(config).not.toBeNull();
        if (!config)
            return;
        api.writeCache(await api.fetchBalance(config));
        expect(api.readCache()?.directBalanceUsd).toBe(12);
        vi.stubEnv('ANTHROPIC_AUTH_TOKEN', 'sk-connection-b');
        expect(api.readCache()).toBeNull();
        vi.unstubAllGlobals();
    });
});
