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

    it('renders balance, today spend, and unlimited subscription separately', () => {
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
            accountUsedUsd: 8.460298,
            todayUsedUsd: 0.2766,
            tokenRemainUsd: 1.539638,
            tokenUnlimited: true
        });
        vi.spyOn(mochiapi, 'maybeRefreshInBackground').mockImplementation(() => undefined);

        const rendered = new MochiApiSubscriptionWidget().render(
            { id: 'sub', type: 'mochiapi-subscription', rawValue: true },
            {},
            DEFAULT_SETTINGS
        );

        expect(rendered).toBe('余额 $1.540 · 今日 $0.277 · 订阅 ∞');
    });
});
