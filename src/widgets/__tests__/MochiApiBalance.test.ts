import {
    afterEach,
    describe,
    expect,
    it,
    vi
} from 'vitest';

import { DEFAULT_SETTINGS } from '../../types/Settings';
import * as mochiapi from '../../utils/mochiapi';
import { MochiApiBalanceWidget } from '../MochiApiBalance';

describe('MochiApiBalanceWidget', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('renders the remaining account balance from the cache', () => {
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
            todayUsedUsd: 0.02469,
            tokenRemainUsd: 1.539638,
            tokenUnlimited: true
        });
        vi.spyOn(mochiapi, 'maybeRefreshInBackground').mockImplementation(() => undefined);

        const rendered = new MochiApiBalanceWidget().render(
            { id: 'mochi', type: 'mochiapi-balance', rawValue: true },
            {},
            DEFAULT_SETTINGS
        );

        expect(rendered).toBe('$1.540');
    });

    it('prefers direct account balance fields when available', () => {
        vi.spyOn(mochiapi, 'loadMochiConfig').mockReturnValue({
            baseUrl: 'https://mochiapi.com',
            token: 'sk-test',
            refreshIntervalSec: 30
        });
        vi.spyOn(mochiapi, 'readCache').mockReturnValue({
            fetchedAt: Date.now(),
            ok: true,
            directBalanceUsd: 9.254,
            accountQuotaUsd: 19.5,
            accountUsedUsd: 10.25,
            todayUsedUsd: 0.277,
            tokenRemainUsd: null,
            tokenUnlimited: false
        });
        vi.spyOn(mochiapi, 'maybeRefreshInBackground').mockImplementation(() => undefined);

        const rendered = new MochiApiBalanceWidget().render(
            { id: 'mochi', type: 'mochiapi-balance', rawValue: true },
            {},
            DEFAULT_SETTINGS
        );

        expect(rendered).toBe('$9.254');
    });

    it('keeps the labeled preview compact', () => {
        const rendered = new MochiApiBalanceWidget().render(
            { id: 'mochi', type: 'mochiapi-balance' },
            { isPreview: true },
            DEFAULT_SETTINGS
        );

        expect(rendered).toBe('Mochi: $8.42');
    });
});
