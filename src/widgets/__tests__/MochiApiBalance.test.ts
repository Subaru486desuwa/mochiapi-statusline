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

    it('renders the direct account balance from the cache', () => {
        vi.spyOn(mochiapi, 'loadMochiConfig').mockReturnValue({
            baseUrl: 'https://mochiapi.com',
            token: 'sk-test',
            refreshIntervalSec: 30
        });
        vi.spyOn(mochiapi, 'readCache').mockReturnValue({
            fetchedAt: Date.now(),
            ok: true,
            accountQuotaUsd: 9.999936,
            accountUsedUsd: 8.460298,
            todayUsedUsd: 0.02469,
            tokenRemainUsd: 1.539638,
            tokenUnlimited: false
        });
        vi.spyOn(mochiapi, 'maybeRefreshInBackground').mockImplementation(() => undefined);

        const rendered = new MochiApiBalanceWidget().render(
            { id: 'mochi', type: 'mochiapi-balance', rawValue: true },
            {},
            DEFAULT_SETTINGS
        );

        expect(rendered).toBe('$10.000');
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
