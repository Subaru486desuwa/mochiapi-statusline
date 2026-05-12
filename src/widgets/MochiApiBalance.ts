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

type DisplayMode = 'balance' | 'used' | 'combined' | 'percent';

function fmtUsd(v: number): string {
    if (v >= 1000)
        return `$${v.toFixed(0)}`;
    if (v >= 10)
        return `$${v.toFixed(2)}`;
    return `$${v.toFixed(3)}`;
}

export class MochiApiBalanceWidget implements Widget {
    getDefaultColor(): string { return 'cyan'; }
    getDescription(): string { return 'MochiAPI token balance / usage from /v1/dashboard/billing/*'; }
    getDisplayName(): string { return 'MochiAPI Balance'; }
    getCategory(): string { return 'MochiAPI'; }

    getEditorDisplay(_item: WidgetItem): WidgetEditorDisplay {
        return { displayText: this.getDisplayName() };
    }

    render(item: WidgetItem, context: RenderContext, _settings: Settings): string | null {
        const mode = ((item.metadata?.mode as DisplayMode | undefined) ?? 'combined');
        const labeled = !item.rawValue;

        if (context.isPreview) {
            const stub = mode === 'balance' ? '$8.42'
                : mode === 'used' ? '$1.58'
                    : mode === 'percent' ? '15.8%'
                        : '$8.42 / $1.58';
            return labeled ? `Mochi: ${stub}` : stub;
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
        if (mode === 'used') {
            body = view.usedUsd === null ? '?' : fmtUsd(view.usedUsd);
        } else if (mode === 'balance') {
            body = view.unlimited ? '∞' : (view.balanceUsd === null ? '?' : fmtUsd(view.balanceUsd));
        } else if (mode === 'percent') {
            if (view.unlimited) {
                body = '∞';
            } else if (view.totalUsd && view.usedUsd !== null && view.totalUsd > 0) {
                body = `${(view.usedUsd / view.totalUsd * 100).toFixed(1)}%`;
            } else {
                body = '?';
            }
        } else if (view.unlimited) {
            body = view.usedUsd === null ? '∞' : `∞ · ${fmtUsd(view.usedUsd)}`;
        } else {
            const bal = view.balanceUsd === null ? '?' : fmtUsd(view.balanceUsd);
            const used = view.usedUsd === null ? '?' : fmtUsd(view.usedUsd);
            body = `${bal} / ${used}`;
        }

        const decorated = view.stale ? `${body}*` : body;
        return labeled ? `Mochi: ${decorated}` : decorated;
    }

    supportsRawValue(): boolean { return true; }
    supportsColors(_item: WidgetItem): boolean { return true; }
}
