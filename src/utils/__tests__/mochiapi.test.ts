import {
    describe,
    expect,
    it,
    vi
} from 'vitest';

import type { MochiApiCache } from '../mochiapi';
import { viewFromCache } from '../mochiapi';

const cfg = {
    baseUrl: 'https://mochiapi.com',
    token: 'sk-test',
    refreshIntervalSec: 30
};

function cache(overrides: Partial<MochiApiCache>): MochiApiCache {
    return {
        fetchedAt: Date.now(),
        ok: true,
        accountQuotaUsd: null,
        accountUsedUsd: null,
        todayUsedUsd: null,
        tokenRemainUsd: null,
        tokenUnlimited: null,
        ...overrides
    };
}

describe('mochiapi cache view', () => {
    it('derives account balance from quota minus used', () => {
        const view = viewFromCache(cache({
            accountQuotaUsd: 9.999936,
            accountUsedUsd: 8.460298,
            todayUsedUsd: 0.02469
        }), cfg);

        expect(view?.balanceUsd).toBeCloseTo(1.539638);
        expect(view?.accountQuotaUsd).toBeCloseTo(9.999936);
        expect(view?.accountUsedUsd).toBeCloseTo(8.460298);
        expect(view?.todayUsedUsd).toBeCloseTo(0.02469);
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

    it('marks old cache data as stale', () => {
        vi.spyOn(Date, 'now').mockReturnValue(100000);
        const view = viewFromCache(cache({ fetchedAt: 30000, accountQuotaUsd: 1 }), cfg);

        expect(view?.stale).toBe(true);
        vi.restoreAllMocks();
    });
});
