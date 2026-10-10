import type {
    WidgetItem,
    WidgetItemType
} from '../types/Widget';

export const LEGACY_WIDGET_TYPE_ALIASES: Record<string, WidgetItemType> = { 'git-pr': 'git-review' };

export function resolveLegacyWidgetType(type: WidgetItemType): WidgetItemType {
    return LEGACY_WIDGET_TYPE_ALIASES[type] ?? type;
}

export function upgradeLegacyWidgetTypes(lines: WidgetItem[][]): WidgetItem[][] {
    return lines.map(line => line.map((item) => {
        const resolved = resolveLegacyWidgetType(item.type);
        return resolved === item.type ? item : { ...item, type: resolved };
    }));
}
