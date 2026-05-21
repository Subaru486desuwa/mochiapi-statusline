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

export class MochiApiBalanceWidget implements Widget {
    getDefaultColor(): string { return 'cyan'; }
    getDescription(): string { return 'MochiAPI account balance from /api/usage/token/'; }
    getDisplayName(): string { return 'MochiAPI Balance'; }
    getCategory(): string { return 'MochiAPI'; }

    getEditorDisplay(_item: WidgetItem): WidgetEditorDisplay {
        return { displayText: this.getDisplayName() };
    }

    render(_item: WidgetItem, context: RenderContext, _settings: Settings): string | null {
        const labeled = !_item.rawValue;

        if (context.isPreview) {
            return labeled ? 'Mochi: $8.42' : '$8.42';
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

        let body: string;
        if (view.balanceUsd !== null) {
            body = fmtUsd(view.balanceUsd);
        } else if (view.unlimited) {
            body = '∞';
        } else {
            body = '?';
        }

        const decorated = view.stale ? `${body}*` : body;
        return labeled ? `Mochi: ${decorated}` : decorated;
    }

    supportsRawValue(): boolean { return true; }
    supportsColors(_item: WidgetItem): boolean { return true; }
}
