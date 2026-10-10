import type { RenderContext } from '../types/RenderContext';
import type { Settings } from '../types/Settings';
import type {
    CustomKeybind,
    Widget,
    WidgetEditorDisplay,
    WidgetItem
} from '../types/Widget';
import { formatClaudeQuota } from '../utils/claude-quota-display';
import {
    formatResetCountdown,
    loadMochiConfig,
    maybeRefreshInBackground,
    readCache,
    viewFromCache
} from '../utils/mochiapi';

export class MochiApiSubscriptionBalanceWidget implements Widget {
    getDefaultColor(): string { return 'green'; }
    getDescription(): string { return 'MochiAPI Claude plan daily and period remaining allowance'; }
    getDisplayName(): string { return 'MochiAPI Claude Quota'; }
    getCategory(): string { return 'MochiAPI'; }

    getEditorDisplay(item: WidgetItem): WidgetEditorDisplay {
        return { displayText: this.getDisplayName(), modifierText: item.metadata?.quotaDisplay === 'percent' ? '(已用百分比)' : '(剩余额度)' };
    }

    getCustomKeybinds(): CustomKeybind[] {
        return [{ key: 'p', label: '(p) 数值/百分比', action: 'toggle-quota-display' }];
    }

    handleEditorAction(action: string, item: WidgetItem): WidgetItem | null {
        if (action !== 'toggle-quota-display')
            return null;
        return { ...item, metadata: { ...item.metadata, quotaDisplay: item.metadata?.quotaDisplay === 'percent' ? 'amount' : 'percent' } };
    }

    render(item: WidgetItem, context: RenderContext, settings: Settings): string | null {
        const labeled = !item.rawValue;

        if (context.isPreview) {
            const preview = formatClaudeQuota({
                status: 'active', plans: [{
                    id: 1, totalUsd: 100, usedUsd: 20, remainingUsd: 80, unlimited: false,
                    dailyTotalUsd: 20, dailyUsedUsd: 12, dailyRemainingUsd: 8, dailyUnlimited: false,
                    dailyResetAt: 0, resetAt: 0, expiresAt: 0
                }]
            }, item);
            return labeled ? `Claude ${preview}` : preview;
        }

        const cfg = loadMochiConfig();
        if (!cfg) {
            return null;
        }
        const cache = readCache(cfg);
        maybeRefreshInBackground(cfg, cache);
        const view = viewFromCache(cache, cfg);
        if (!view)
            return labeled ? 'Claude ...' : '...';

        // Preserve the old display during a staged backend upgrade, without
        // claiming the legacy summary belongs to the Claude product line.
        if (settings.version < 4 && !cache?.claudeSubscription) {
            let legacy = '-';
            if (view.subscriptionUnlimited) {
                legacy = '∞';
            } else if (view.hasSubscription && view.subscriptionUsedPct !== null) {
                legacy = `${view.subscriptionUsedPct}%`;
                if (view.subscriptionResetAt !== null)
                    legacy += ` · ${formatResetCountdown(view.subscriptionResetAt)}`;
            }
            if (view.stale)
                legacy += '*';
            return labeled ? `旧订阅 ${legacy}` : legacy;
        }
        const body = formatClaudeQuota(cache?.claudeSubscription, item);

        const decorated = view.stale ? `${body}*` : body;
        return labeled ? `Claude ${decorated}` : decorated;
    }

    supportsRawValue(): boolean { return true; }
    supportsColors(_item: WidgetItem): boolean { return true; }
}
