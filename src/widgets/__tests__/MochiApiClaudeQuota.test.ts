import {
    afterEach,
    describe,
    expect,
    it,
    vi
} from 'vitest';

import { DEFAULT_SETTINGS } from '../../types/Settings';
import type {
    ClaudeQuotaSummary,
    MochiApiCache
} from '../../utils/mochiapi';
import * as api from '../../utils/mochiapi';
import { MochiApiSubscriptionBalanceWidget } from '../MochiApiSubscriptionBalance';

function render(summary?: ClaudeQuotaSummary, percent = false): string | null {
    vi.spyOn(api, 'loadMochiConfig').mockReturnValue({ baseUrl: 'https://mochiapi.com', token: 'sk-test', refreshIntervalSec: 30 });
    vi.spyOn(api, 'maybeRefreshInBackground').mockImplementation(() => undefined);
    const cache: MochiApiCache = { fetchedAt: Date.now(), ok: true, directBalanceUsd: 8, accountQuotaUsd: null, accountUsedUsd: null, todayUsedUsd: null, tokenRemainUsd: null, tokenUnlimited: true, claudeSubscription: summary };
    vi.spyOn(api, 'readCache').mockReturnValue(cache);
    return new MochiApiSubscriptionBalanceWidget().render({ id: 'quota', type: 'mochiapi-subscription-balance', rawValue: true, metadata: { quotaDisplay: percent ? 'percent' : 'amount' } }, {}, DEFAULT_SETTINGS);
}
const quota: ClaudeQuotaSummary = { status: 'active', plans: [{ id: 1, totalUsd: 100, usedUsd: 20, remainingUsd: 80, unlimited: false, dailyTotalUsd: 20, dailyUsedUsd: 12, dailyRemainingUsd: 8, dailyUnlimited: false, dailyResetAt: 0, resetAt: 0, expiresAt: 0 }] };
afterEach(() => vi.restoreAllMocks());
describe('Claude-only quota display', () => {
    it('previews the selected percentage mode in the settings UI', () => {
        const rendered = new MochiApiSubscriptionBalanceWidget().render(
            { id: 'preview', type: 'mochiapi-subscription-balance', metadata: { quotaDisplay: 'percent' } },
            { isPreview: true }, DEFAULT_SETTINGS
        );
        expect(rendered).toBe('Claude 日已用 60% · 总已用 20%');
    });

    it('defaults to independently labelled remaining amounts', () => { expect(render(quota)).toBe('日余 $8/$20 · 总余 $80/$100'); });
    it('offers explicitly labelled used percentages', () => { expect(render(quota, true)).toBe('日已用 60% · 总已用 20%'); });
    it('does not mistake a missing contract for no subscription', () => { expect(render()).toBe('数据待升级'); });
    it('distinguishes an absent Claude subscription', () => { expect(render({ status: 'none', plans: [] })).toBe('未订阅'); });
    it('retains a finite daily limit with an unlimited period', () => {
        const plan = quota.plans[0];
        if (!plan)
            throw new Error('Missing quota fixture');
        expect(render({ status: 'active', plans: [{ ...plan, unlimited: true, totalUsd: 0, remainingUsd: 0 }] })).toBe('日余 $8/$20 · 总余 ∞');
    });
});
