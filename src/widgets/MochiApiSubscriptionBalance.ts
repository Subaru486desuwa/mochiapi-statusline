import type { RenderContext } from '../types/RenderContext';
import type { Settings } from '../types/Settings';
import type {
    Widget,
    WidgetEditorDisplay,
    WidgetItem
} from '../types/Widget';
import {
    formatResetCountdown,
    loadMochiConfig,
    maybeRefreshInBackground,
    readCache,
    viewFromCache
} from '../utils/mochiapi';

export class MochiApiSubscriptionBalanceWidget implements Widget {
    getDefaultColor(): string { return 'green'; }
    getDescription(): string { return 'MochiAPI subscription usage (% used + reset countdown) from /api/usage/token/'; }
    getDisplayName(): string { return 'MochiAPI Subscription Usage'; }
    getCategory(): string { return 'MochiAPI'; }

    getEditorDisplay(_item: WidgetItem): WidgetEditorDisplay {
        return { displayText: this.getDisplayName() };
    }

    render(item: WidgetItem, context: RenderContext, _settings: Settings): string | null {
        const labeled = !item.rawValue;

        if (context.isPreview) {
            return labeled ? 'Sub: 67% · 5d12h' : '67% · 5d12h';
        }

        const cfg = loadMochiConfig();
        if (!cfg) {
            return labeled ? 'Sub: cfg?' : 'cfg?';
        }
        const cache = readCache();
        maybeRefreshInBackground(cfg, cache);
        const view = viewFromCache(cache, cfg);
        if (!view)
            return labeled ? 'Sub: ...' : '...';

        let body: string;
        if (view.subscriptionUnlimited) {
            body = '∞';
        } else if (view.hasSubscription && view.subscriptionUsedPct !== null) {
            const pct = `${view.subscriptionUsedPct}%`;
            body = view.subscriptionResetAt !== null
                ? `${pct} · ${formatResetCountdown(view.subscriptionResetAt)}`
                : pct;
        } else {
            body = '-';
        }

        const decorated = view.stale ? `${body}*` : body;
        return labeled ? `Sub: ${decorated}` : decorated;
    }

    supportsRawValue(): boolean { return true; }
    supportsColors(_item: WidgetItem): boolean { return true; }
}
