import type { RenderContext } from '../types/RenderContext';
import type { Settings } from '../types/Settings';
import type {
    Widget,
    WidgetEditorDisplay,
    WidgetItem
} from '../types/Widget';

import { isMetadataFlagEnabled } from './shared/metadata';

const KEEP_CONTEXT_KEY = 'keepContext';

export class ModelWidget implements Widget {
    getDefaultColor(): string { return 'cyan'; }
    getDescription(): string { return 'Displays the Claude model name (e.g., Claude 3.5 Sonnet)'; }
    getDisplayName(): string { return 'Model'; }
    getCategory(): string { return 'Core'; }
    getEditorDisplay(item: WidgetItem): WidgetEditorDisplay {
        return { displayText: this.getDisplayName() };
    }

    render(item: WidgetItem, context: RenderContext, settings: Settings): string | null {
        const keepContext = isMetadataFlagEnabled(item, KEEP_CONTEXT_KEY);

        if (context.isPreview) {
            const preview = keepContext ? 'Claude (1M context)' : 'Claude';
            return item.rawValue ? preview : `Model: ${preview}`;
        }

        const model = context.data?.model;
        const modelDisplayName = typeof model === 'string'
            ? model
            : (model?.display_name ?? model?.id);

        if (modelDisplayName) {
            const name = keepContext ? modelDisplayName : modelDisplayName.replace(/\s*\(.*\)$/, '');
            return item.rawValue ? name : `Model: ${name}`;
        }
        return null;
    }

    supportsRawValue(): boolean { return true; }
    supportsColors(item: WidgetItem): boolean { return true; }
}
