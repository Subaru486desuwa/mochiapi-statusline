import type { RenderContext } from '../types/RenderContext';
import type { Settings } from '../types/Settings';
import type {
    Widget,
    WidgetEditorDisplay,
    WidgetItem
} from '../types/Widget';
import {
    loadMochiConfig,
    maybeRefreshInBackground,
    readCache,
    viewFromCache
} from '../utils/mochiapi';

function fmtUsd(v: number): string {
    if (v >= 1000)
        return `$${v.toFixed(0)}`;
    if (v >= 10)
        return `$${v.toFixed(2)}`;
    return `$${v.toFixed(3)}`;
}

export class MochiApiSubscriptionWidget implements Widget {
    getDefaultColor(): string { return 'cyan'; }
    getDescription(): string { return 'MochiAPI billing summary: balance, today spend, and token subscription status'; }
    getDisplayName(): string { return 'MochiAPI Subscription'; }
    getCategory(): string { return 'MochiAPI'; }

    getEditorDisplay(_item: WidgetItem): WidgetEditorDisplay {
        return { displayText: this.getDisplayName() };
    }

    render(item: WidgetItem, context: RenderContext, _settings: Settings): string | null {
        const labeled = !item.rawValue;

        if (context.isPreview) {
            const preview = '余额 $1.54 · 今日 $0.277 · 订阅 ∞';
            return labeled ? `Mochi: ${preview}` : preview;
        }

        const cfg = loadMochiConfig();
        if (!cfg) {
            return labeled ? 'Mochi: cfg?' : 'cfg?';
        }

        const cache = readCache();
        maybeRefreshInBackground(cfg, cache);
        const view = viewFromCache(cache, cfg);
        if (!view)
            return labeled ? 'Mochi: ...' : '...';

        const balance = view.unlimited
            ? '∞'
            : (view.balanceUsd === null ? '?' : fmtUsd(view.balanceUsd));
        const today = view.todayUsedUsd === null ? '?' : fmtUsd(view.todayUsedUsd);
        const subscription = view.tokenUnlimited === true
            ? '∞'
            : (view.tokenRemainUsd === null ? '?' : fmtUsd(view.tokenRemainUsd));

        const body = `余额 ${balance} · 今日 ${today} · 订阅 ${subscription}`;
        const decorated = view.stale ? `${body}*` : body;
        return labeled ? `Mochi: ${decorated}` : decorated;
    }

    supportsRawValue(): boolean { return true; }
    supportsColors(_item: WidgetItem): boolean { return true; }
}
