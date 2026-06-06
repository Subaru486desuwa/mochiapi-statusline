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

function renderWith(cache: MochiApiCache): string | null {
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
        DEFAULT_SETTINGS
    );
}

describe('MochiApiSubscriptionBalanceWidget', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('renders ∞ for an unlimited subscription plan', () => {
        const rendered = renderWith(baseCache({ subscriptionUnlimited: true }));
        expect(rendered).toBe('∞');
    });

    it('renders used% with a reset countdown (MAX Pro weekly sample)', () => {
        const resetAt = Math.floor(Date.now() / 1000) + ((5 * 24 + 12) * 3600) + 120;
        const rendered = renderWith(baseCache({
            subscriptionTotalUsd: 95,
            subscriptionUsedUsd: 4.117332, // round(4.117332 / 95 * 100) = 4
            subscriptionResetAt: resetAt,
            subscriptionUnlimited: false
        }));
        expect(rendered).toBe('4% · 5d12h');
    });

    it('renders used% only when there is no reset time', () => {
        const rendered = renderWith(baseCache({
            subscriptionTotalUsd: 95,
            subscriptionUsedUsd: 47.5, // 50%
            subscriptionResetAt: 0,
            subscriptionUnlimited: false
        }));
        expect(rendered).toBe('50%');
    });

    it('renders - when there is no active subscription', () => {
        const rendered = renderWith(baseCache({
            subscriptionTotalUsd: 0,
            subscriptionUsedUsd: 0,
            subscriptionUnlimited: false
        }));
        expect(rendered).toBe('-');
    });
});
