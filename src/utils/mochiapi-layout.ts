import type { WidgetItem } from '../types/Widget';

const LABEL_FG = 'hex:111827';
const MODEL_BG = 'hex:7AA2F7';
const CONTEXT_BG = 'hex:414868';
const GIT_BG = 'hex:BB9AF7';
const CHANGES_BG = 'hex:F7768E';
const SPEED_BG = 'hex:7DCFFF';
const BALANCE_BG = 'hex:2AC3DE';
const SPEND_BG = 'hex:FF9E64';

const DARK_FG = 'hex:C0CAF5';

export function makeMochiLayout(version: number) {
    const lines: WidgetItem[][] = [
        [
            { id: 'L1-lbl-model', type: 'custom-text', color: LABEL_FG, backgroundColor: MODEL_BG, bold: true, customText: '模型', merge: 'no-padding' },
            { id: 'L1-model', type: 'model', color: LABEL_FG, backgroundColor: MODEL_BG, bold: true, rawValue: true, metadata: { keepContext: 'true' } },
            { id: 'L1-lbl-ctx', type: 'custom-text', color: DARK_FG, backgroundColor: CONTEXT_BG, bold: true, customText: '上下文', merge: 'no-padding' },
            { id: 'L1-ctx', type: 'context-length', color: DARK_FG, backgroundColor: CONTEXT_BG, bold: true, rawValue: true },
            { id: 'L1-branch', type: 'git-branch', color: LABEL_FG, backgroundColor: GIT_BG, bold: true, rawValue: true, metadata: { hideNoGit: 'true' } },
            { id: 'L1-changes', type: 'git-changes', color: LABEL_FG, backgroundColor: CHANGES_BG, bold: true, rawValue: true, metadata: { hideNoGit: 'true' } }
        ],
        [
            { id: 'L2-balance', type: 'mochiapi-balance', color: LABEL_FG, backgroundColor: BALANCE_BG, bold: true },
            { id: 'L2-today', type: 'mochiapi-daily-spend', color: LABEL_FG, backgroundColor: SPEND_BG, bold: true }
        ],
        [{ id: 'L3-claude', type: 'mochiapi-subscription-balance', color: LABEL_FG, backgroundColor: SPEED_BG, bold: true, metadata: { quotaDisplay: 'amount' } }]
    ];
    return {
        version,
        lines,
        flexMode: 'full',
        compactThreshold: 60,
        colorLevel: 2,
        defaultPadding: ' ',
        inheritSeparatorColors: false,
        globalBold: false,
        minimalistMode: false,
        powerline: {
            enabled: true,
            separators: ['\uE0B0'],
            separatorInvertBackground: [false],
            startCaps: ['\uE0B6'],
            endCaps: ['\uE0B4'],
            theme: 'custom',
            autoAlign: false,
            continueThemeAcrossLines: false
        }
    };
}
