import {
    afterEach,
    describe,
    expect,
    it,
    vi
} from 'vitest';

import { DEFAULT_SETTINGS } from '../../types/Settings';
import type { MochiApiCache } from '../../utils/mochiapi';
import * as mochiapi from '../../utils/mochiapi';
import { MochiApiSubscriptionBalanceWidget } from '../MochiApiSubscriptionBalance';

function baseCache(overrides: Partial<MochiApiCache>): MochiApiCache {
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

function renderWith(cache: MochiApiCache, version = 4): string | null {
    vi.spyOn(mochiapi, 'loadMochiConfig').mockReturnValue({
        baseUrl: 'https://mochiapi.com',
        token: 'sk-test',
        refreshIntervalSec: 30
    });
    vi.spyOn(mochiapi, 'maybeRefreshInBackground').mockImplementation(() => undefined);
    vi.spyOn(mochiapi, 'readCache').mockReturnValue(cache);

    return new MochiApiSubscriptionBalanceWidget().render(
        { id: 'sub', type: 'mochiapi-subscription-balance', rawValue: true },
        {},
        { ...DEFAULT_SETTINGS, version }
    );
}

describe('MochiApiSubscriptionBalanceWidget', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('preserves legacy subscription rendering while layout upgrade waits for the backend', () => {
        expect(renderWith(baseCache({ subscriptionTotalUsd: 100, subscriptionUsedUsd: 25, subscriptionUnlimited: false }), 3)).toBe('25%');
    });

    it('does not label a legacy unlimited plan as Claude', () => {
        const rendered = renderWith(baseCache({ subscriptionUnlimited: true }));
        expect(rendered).toBe('数据待升级');
    });

    it('does not label a legacy finite plan as Claude', () => {
        const resetAt = Math.floor(Date.now() / 1000) + ((5 * 24 + 12) * 3600) + 120;
        const rendered = renderWith(baseCache({
            subscriptionTotalUsd: 95,
            subscriptionUsedUsd: 4.117332, // round(4.117332 / 95 * 100) = 4
            subscriptionResetAt: resetAt,
            subscriptionUnlimited: false
        }));
        expect(rendered).toBe('数据待升级');
    });

    it('requires explicit Claude identity even without a reset time', () => {
        const rendered = renderWith(baseCache({
            subscriptionTotalUsd: 95,
            subscriptionUsedUsd: 47.5, // 50%
            subscriptionResetAt: 0,
            subscriptionUnlimited: false
        }));
        expect(rendered).toBe('数据待升级');
    });

    it('does not infer absent Claude subscription from legacy zero amounts', () => {
        const rendered = renderWith(baseCache({
            subscriptionTotalUsd: 0,
            subscriptionUsedUsd: 0,
            subscriptionUnlimited: false
        }));
        expect(rendered).toBe('数据待升级');
    });
});
