import {
    afterEach,
    describe,
    expect,
    it,
    vi
} from 'vitest';

import { DEFAULT_SETTINGS } from '../../types/Settings';
import * as mochiapi from '../../utils/mochiapi';
import { MochiApiSubscriptionWidget } from '../MochiApiSubscription';

describe('MochiApiSubscriptionWidget', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('renders balance, today spend, and subscription usage% with countdown', () => {
        const resetAt = Math.floor(Date.now() / 1000) + ((5 * 24 + 12) * 3600) + 120;
        vi.spyOn(mochiapi, 'loadMochiConfig').mockReturnValue({
            baseUrl: 'https://mochiapi.com',
            token: 'sk-test',
            refreshIntervalSec: 30
        });
        vi.spyOn(mochiapi, 'readCache').mockReturnValue({
            fetchedAt: Date.now(),
            ok: true,
            directBalanceUsd: null,
            accountQuotaUsd: 9.999936,
            accountUsedUsd: 8.460298, // balance = 1.539638 → $1.540
            todayUsedUsd: 0.2766, // → $0.277
            tokenRemainUsd: 1.539638,
            tokenUnlimited: true,
            subscriptionTotalUsd: 95,
            subscriptionUsedUsd: 4.117332, // → 4%
            subscriptionResetAt: resetAt,
            subscriptionUnlimited: false
        });
        vi.spyOn(mochiapi, 'maybeRefreshInBackground').mockImplementation(() => undefined);

        const rendered = new MochiApiSubscriptionWidget().render(
            { id: 'sub', type: 'mochiapi-subscription', rawValue: true },
            {},
            DEFAULT_SETTINGS
        );

        expect(rendered).toBe('余额 $1.540 · 今日 $0.277 · 订阅 4% · 5d12h');
    });

    it('shows ∞ for an unlimited subscription without replacing the user balance', () => {
        vi.spyOn(mochiapi, 'loadMochiConfig').mockReturnValue({
            baseUrl: 'https://mochiapi.com',
            token: 'sk-test',
            refreshIntervalSec: 30
        });
        vi.spyOn(mochiapi, 'readCache').mockReturnValue({
            fetchedAt: Date.now(),
            ok: true,
            directBalanceUsd: 9.254,
            accountQuotaUsd: 10000000,
            accountUsedUsd: null,
            todayUsedUsd: 0.2766,
            tokenRemainUsd: 1.539638,
            tokenUnlimited: true,
            subscriptionUnlimited: true
        });
        vi.spyOn(mochiapi, 'maybeRefreshInBackground').mockImplementation(() => undefined);

        const rendered = new MochiApiSubscriptionWidget().render(
            { id: 'sub', type: 'mochiapi-subscription', rawValue: true },
            {},
            DEFAULT_SETTINGS
        );

        expect(rendered).toBe('余额 $9.254 · 今日 $0.277 · 订阅 ∞');
    });

    it('shows - when the account has no active subscription', () => {
        vi.spyOn(mochiapi, 'loadMochiConfig').mockReturnValue({
            baseUrl: 'https://mochiapi.com',
            token: 'sk-test',
            refreshIntervalSec: 30
        });
        vi.spyOn(mochiapi, 'readCache').mockReturnValue({
            fetchedAt: Date.now(),
            ok: true,
            directBalanceUsd: 9.254,
            accountQuotaUsd: null,
            accountUsedUsd: null,
            todayUsedUsd: 0.2766,
            tokenRemainUsd: null,
            tokenUnlimited: false,
            subscriptionTotalUsd: 0,
            subscriptionUnlimited: false
        });
        vi.spyOn(mochiapi, 'maybeRefreshInBackground').mockImplementation(() => undefined);

        const rendered = new MochiApiSubscriptionWidget().render(
            { id: 'sub', type: 'mochiapi-subscription', rawValue: true },
            {},
            DEFAULT_SETTINGS
        );

        expect(rendered).toBe('余额 $9.254 · 今日 $0.277 · 订阅 -');
    });
});
