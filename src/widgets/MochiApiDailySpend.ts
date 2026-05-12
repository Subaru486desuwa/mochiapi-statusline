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

export class MochiApiDailySpendWidget implements Widget {
    getDefaultColor(): string { return 'magenta'; }
    getDescription(): string { return 'MochiAPI today\'s spend (USD) from /api/user/dashboard/balance'; }
    getDisplayName(): string { return 'MochiAPI Daily Spend'; }
    getCategory(): string { return 'MochiAPI'; }

    getEditorDisplay(_item: WidgetItem): WidgetEditorDisplay {
        return { displayText: this.getDisplayName() };
    }

    render(item: WidgetItem, context: RenderContext, _settings: Settings): string | null {
        const labeled = !item.rawValue;

        if (context.isPreview) {
            return labeled ? 'Today: $0.247' : '$0.247';
        }

        const cfg = loadMochiConfig();
        if (!cfg) {
            return labeled ? 'Today: cfg?' : 'cfg?';
        }
        const cache = readCache();
        maybeRefreshInBackground(cfg, cache);
        const view = viewFromCache(cache, cfg);
        if (!view)
            return labeled ? 'Today: ...' : '...';

        const body = view.todayUsedUsd === null ? '?' : fmtUsd(view.todayUsedUsd);
        const decorated = view.stale ? `${body}*` : body;
        return labeled ? `Today: ${decorated}` : decorated;
    }

    supportsRawValue(): boolean { return true; }
    supportsColors(_item: WidgetItem): boolean { return true; }
}
