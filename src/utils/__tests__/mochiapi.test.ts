import {
    afterEach,
    describe,
    expect,
    it,
    vi
} from 'vitest';

import type { MochiApiCache } from '../mochiapi';
import {
    fetchBalance,
    viewFromCache
} from '../mochiapi';
import { __mochiApiSetupTest } from '../mochiapi-setup';

const cfg = {
    baseUrl: 'https://mochiapi.com',
    token: 'sk-test',
    refreshIntervalSec: 30
};

function cache(overrides: Partial<MochiApiCache>): MochiApiCache {
    return {
        fetchedAt: Date.now(),
        ok: true,
        directBalanceUsd: null,
        accountQuotaUsd: null,
        accountUsedUsd: null,
        todayUsedUsd: null,
        tokenRemainUsd: null,
        tokenUnlimited: null,
        ...overrides
    };
}

function requestUrl(input: string | URL | Request): string {
    if (typeof input === 'string')
        return input;
    if (input instanceof URL)
        return input.toString();
    return input.url;
}

describe('mochiapi cache view', () => {
    it('uses direct balance when the API returns one', () => {
        const view = viewFromCache(cache({
            directBalanceUsd: 9.254,
            accountQuotaUsd: 19.5,
            accountUsedUsd: 10.25,
            todayUsedUsd: 0.277
        }), cfg);

        expect(view?.balanceUsd).toBe(9.254);
        expect(view?.directBalance).toBe(true);
        expect(view?.todayUsedUsd).toBe(0.277);
    });

    it('derives account balance from quota minus used only as a fallback', () => {
        const view = viewFromCache(cache({
            accountQuotaUsd: 9.999936,
            accountUsedUsd: 8.460298,
            todayUsedUsd: 0.02469
        }), cfg);

        expect(view?.balanceUsd).toBeCloseTo(1.539638);
        expect(view?.accountQuotaUsd).toBeCloseTo(9.999936);
        expect(view?.accountUsedUsd).toBeCloseTo(8.460298);
        expect(view?.todayUsedUsd).toBeCloseTo(0.02469);
        expect(view?.directBalance).toBe(false);
        expect(view?.unlimited).toBe(false);
    });

    it('falls back to token_remain_quota_usd when the account balance is absent', () => {
        const view = viewFromCache(cache({ tokenRemainUsd: 1.54 }), cfg);

        expect(view?.balanceUsd).toBe(1.54);
        expect(view?.unlimited).toBe(false);
    });

    it('keeps token unlimited separate from account-balance unlimited', () => {
        const tokenUnlimited = viewFromCache(cache({ accountQuotaUsd: 9.999936, accountUsedUsd: 8.460298, tokenUnlimited: true }), cfg);

        expect(tokenUnlimited?.balanceUsd).toBeCloseTo(1.539638);
        expect(tokenUnlimited?.tokenUnlimited).toBe(true);
        expect(tokenUnlimited?.unlimited).toBe(false);
        expect(viewFromCache(cache({ accountQuotaUsd: 10000000 }), cfg)?.unlimited).toBe(true);
    });

    it('uses a direct balance even when account quota uses an unlimited sentinel', () => {
        const view = viewFromCache(cache({
            directBalanceUsd: 9.254,
            accountQuotaUsd: 10000000,
            tokenUnlimited: true
        }), cfg);

        expect(view?.balanceUsd).toBe(9.254);
        expect(view?.unlimited).toBe(true);
    });

    it('treats token-unlimited as account-unlimited when no account-level signal is available', () => {
        // Mochi's /api/usage/token/ does not surface account quota for unlimited tokens,
        // so falling back to the token-unlimited flag is the only way to render a balance.
        const view = viewFromCache(cache({ tokenUnlimited: true }), cfg);

        expect(view?.balanceUsd).toBeNull();
        expect(view?.unlimited).toBe(true);
        expect(view?.tokenUnlimited).toBe(true);
    });

    it('marks old cache data as stale', () => {
        vi.spyOn(Date, 'now').mockReturnValue(100000);
        const view = viewFromCache(cache({ fetchedAt: 30000, accountQuotaUsd: 1 }), cfg);

        expect(view?.stale).toBe(true);
        vi.restoreAllMocks();
    });
});

describe('mochiapi balance fetch', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('fetches direct balance from /api/usage/token/ before the dashboard fallback', async () => {
        const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
            success: true,
            data: {
                user_usd_available: 9.254,
                total_usd_available: 42,
                total_usd_used: 12.5,
                unlimited_quota: true
            }
        }), { status: 200 }));
        vi.spyOn(globalThis, 'fetch').mockImplementation(fetchMock);

        const result = await fetchBalance(cfg, null);

        expect(result.ok).toBe(true);
        expect(result.directBalanceUsd).toBe(9.254);
        expect(result.tokenRemainUsd).toBe(42);
        expect(result.tokenUnlimited).toBe(true);
        expect(result.tokenTotalUsedUsd).toBe(12.5);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock.mock.calls[0]?.[0]).toBe('https://mochiapi.com/api/usage/token/');
    });

    it('continues to /api/usage/token/ data even when dashboard would 404', async () => {
        const fetchMock = vi.fn((input: string | URL | Request) => {
            const url = requestUrl(input);
            if (url.endsWith('/api/usage/token/')) {
                return Promise.resolve(new Response(JSON.stringify({
                    data: {
                        user_usd_available: 7.125,
                        total_usd_available: 100
                    }
                }), { status: 200 }));
            }
            return Promise.resolve(new Response('{}', { status: 404 }));
        });
        vi.spyOn(globalThis, 'fetch').mockImplementation(fetchMock);

        const result = await fetchBalance(cfg, null);

        expect(result.ok).toBe(true);
        expect(result.directBalanceUsd).toBe(7.125);
        expect(fetchMock.mock.calls.map(call => requestUrl(call[0]))).toEqual([
            'https://mochiapi.com/api/usage/token/'
        ]);
    });

    it('continues to direct balance fallback after the dashboard returns 404', async () => {
        const fetchMock = vi.fn((input: string | URL | Request) => {
            const url = requestUrl(input);
            if (url.endsWith('/api/user/balance')) {
                return Promise.resolve(new Response(JSON.stringify({ data: { user_usd_available: 5.75 } }), { status: 200 }));
            }
            return Promise.resolve(new Response('{}', { status: url.endsWith('/api/usage/token/') ? 500 : 404 }));
        });
        vi.spyOn(globalThis, 'fetch').mockImplementation(fetchMock);

        const result = await fetchBalance(cfg, null);

        expect(result.ok).toBe(true);
        expect(result.directBalanceUsd).toBe(5.75);
        expect(fetchMock.mock.calls.map(call => requestUrl(call[0]))).toEqual([
            'https://mochiapi.com/api/usage/token/',
            'https://mochiapi.com/api/user/dashboard/balance',
            'https://mochiapi.com/v1/user/balance',
            'https://mochiapi.com/api/user/balance'
        ]);
    });

    it('treats 200 Unauthorized payloads as failed responses instead of a success cache', async () => {
        const fetchMock = vi.fn((_input: string | URL | Request) => Promise.resolve(new Response(JSON.stringify({
            success: false,
            message: 'Unauthorized, invalid access token'
        }), { status: 200 })));
        vi.spyOn(globalThis, 'fetch').mockImplementation(fetchMock);

        const result = await fetchBalance(cfg, null);

        expect(result.ok).toBe(false);
        expect(result.directBalanceUsd).toBeNull();
        expect(result.error).toContain('Unauthorized, invalid access token');
        expect(fetchMock.mock.calls.map(call => requestUrl(call[0]))).toEqual([
            'https://mochiapi.com/api/usage/token/',
            'https://mochiapi.com/api/user/dashboard/balance',
            'https://mochiapi.com/v1/user/balance',
            'https://mochiapi.com/api/user/balance',
            'https://mochiapi.com/api/user/self'
        ]);
    });

    it('maps newapi-style bare quota fields (total_used / total_available) to USD using QuotaPerUnit=500000', async () => {
        // Real mochi response shape for an unlimited token: bare quota units, no _usd suffix.
        vi.spyOn(globalThis, 'fetch').mockImplementation(vi.fn().mockResolvedValue(new Response(JSON.stringify({
            code: true,
            data: {
                expires_at: 0,
                model_limits: {},
                model_limits_enabled: false,
                name: 'max',
                object: 'token_usage',
                total_available: -5789614,
                total_granted: 0,
                total_used: 5789614,
                unlimited_quota: true
            },
            message: 'ok'
        }), { status: 200 })));

        const result = await fetchBalance(cfg, null);

        expect(result.ok).toBe(true);
        expect(result.tokenUnlimited).toBe(true);
        expect(result.tokenTotalUsedUsd).toBeCloseTo(11.579228);
        // total_granted / total_available are 0 / negative placeholders for unlimited tokens
        // and must not leak into account-level fields.
        expect(result.accountQuotaUsd).toBeNull();
        expect(result.tokenRemainUsd).toBeNull();
    });

    it('treats newapi bare quota fields as account/token signals when the token is limited', async () => {
        vi.spyOn(globalThis, 'fetch').mockImplementation(vi.fn().mockResolvedValue(new Response(JSON.stringify({
            data: {
                total_used: 250_000,
                total_granted: 1_000_000,
                total_available: 750_000,
                unlimited_quota: false
            }
        }), { status: 200 })));

        const result = await fetchBalance(cfg, null);

        expect(result.tokenUnlimited).toBe(false);
        expect(result.accountQuotaUsd).toBeCloseTo(2);
        expect(result.tokenRemainUsd).toBeCloseTo(1.5);
        expect(result.tokenTotalUsedUsd).toBeCloseTo(0.5);
    });

    it('falls back to account-level used diff when prev token baseline is null', async () => {
        vi.spyOn(Date, 'now').mockReturnValue(new Date('2026-05-22T08:30:00').getTime());
        // Simulates a prev cache that lost its token-level baseline (e.g. polluted by
        // an empty/dashboard fallback write) but still has account-level used.
        const previousCache = cache({
            fetchedAt: new Date('2026-05-22T07:00:00').getTime(),
            tokenTotalUsedUsd: null,
            tokenTotalUsedLocalDate: '2026-05-22',
            accountUsedUsd: 40.0
        });
        vi.spyOn(globalThis, 'fetch').mockImplementation(vi.fn().mockResolvedValue(new Response(JSON.stringify({
            data: {
                user_quota_usd: 129.78,
                user_used_quota_usd: 41.5,
                user_remain_quota_usd: 88.28,
                total_used: 9000000,
                unlimited_quota: true
            }
        }), { status: 200 })));

        const result = await fetchBalance(cfg, previousCache);

        expect(result.todayUsedUsd).toBeCloseTo(1.5);
        expect(result.accountUsedUsd).toBeCloseTo(41.5);
    });

    it('estimates today spend from same-day token cumulative spend', async () => {
        vi.spyOn(Date, 'now').mockReturnValue(new Date('2026-05-14T08:30:00').getTime());
        const previousCache = cache({
            fetchedAt: new Date('2026-05-14T07:00:00').getTime(),
            tokenTotalUsedUsd: 10.25,
            tokenTotalUsedLocalDate: '2026-05-14'
        });
        vi.spyOn(globalThis, 'fetch').mockImplementation(vi.fn().mockResolvedValue(new Response(JSON.stringify({
            data: {
                user_usd_available: 4,
                total_usd_used: 10.75
            }
        }), { status: 200 })));

        const result = await fetchBalance(cfg, previousCache);

        expect(result.todayUsedUsd).toBeCloseTo(0.5);
        expect(result.tokenTotalUsedLocalDate).toBe('2026-05-14');
    });
});

describe('mochiapi setup migration', () => {
    it('replaces old usage widgets with user balance, daily spend, and TPS', () => {
        const settings = {
            lines: [[
                { id: 'lbl-used', type: 'custom-text', customText: '时段用量' },
                { id: 'usage', type: 'session-usage' },
                { id: 'lbl-block', type: 'custom-text', customText: '时段' },
                { id: 'block', type: 'block-timer' },
                { id: 'lbl-reset', type: 'custom-text', customText: '重置' },
                { id: 'reset', type: 'reset-timer' },
                { id: 'lbl-weekly', type: 'custom-text', customText: '周用量' },
                { id: 'weekly', type: 'weekly-usage' }
            ]]
        };

        expect(__mochiApiSetupTest.migrateMochiBillingIntoExistingLines(settings)).toBe(true);

        const migrated = settings.lines[0] ?? [];
        expect(migrated.map(item => item.type)).toEqual([
            'custom-text',
            'mochiapi-balance',
            'custom-text',
            'mochiapi-daily-spend',
            'custom-text',
            'total-speed'
        ]);
        expect(migrated.map(item => item.customText).filter(Boolean)).toEqual([
            '用户余额',
            '今日消耗',
            'TPS'
        ]);
        expect(migrated.some(item => ['session-usage', 'block-timer', 'reset-timer', 'weekly-usage'].includes(item.type))).toBe(false);
        expect(migrated.some(item => typeof item.customText === 'string' && ['时段用量', '时段', '重置', '周用量'].includes(item.customText))).toBe(false);
    });
});
