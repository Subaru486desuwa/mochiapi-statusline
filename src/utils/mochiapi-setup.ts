import * as fs from 'fs';
import * as path from 'path';
import { createInterface } from 'readline/promises';

import {
    getClaudeSettingsPath,
    loadClaudeSettings,
    saveClaudeSettings
} from './claude-settings';
import { getConfigPath } from './config';
import {
    MOCHI_CONFIG_PATH,
    fetchBalance,
    loadMochiConfig,
    saveMochiConfig,
    writeCache
} from './mochiapi';

function readEnv(name: string): string | undefined {
    const v = process.env[name];
    return v?.trim() ? v.trim() : undefined;
}

const STATUSLINE_COMMAND = 'mochiapi-statusline';
const MOCHI_BALANCE_TYPE = 'mochiapi-balance';
const MOCHI_DAILY_TYPE = 'mochiapi-daily-spend';
const MOCHI_SUBSCRIPTION_TYPE = 'mochiapi-subscription';

const LABEL_FG = 'hex:111827';
const MODEL_BG = 'hex:7AA2F7';
const CONTEXT_BG = 'hex:414868';
const GIT_BG = 'hex:BB9AF7';
const CHANGES_BG = 'hex:F7768E';
const SPEED_BG = 'hex:7DCFFF';
const BALANCE_BG = 'hex:2AC3DE';
const SPEND_BG = 'hex:FF9E64';
const DARK_FG = 'hex:C0CAF5';

interface SetupOptions {
    skipStatusline?: boolean;
    skipClaudeWire?: boolean;
    keepStatuslineLayout?: boolean;
}

function parseFlags(argv: readonly string[]): SetupOptions {
    return {
        skipStatusline: argv.includes('--skip-statusline'),
        skipClaudeWire: argv.includes('--skip-claude-wire'),
        keepStatuslineLayout: argv.includes('--keep-statusline-layout')
    };
}

function buildRecommendedSettings(): unknown {
    return {
        version: 3,
        lines: [
            [
                { id: 'L1-lbl-model', type: 'custom-text', color: LABEL_FG, backgroundColor: MODEL_BG, bold: true, customText: '模型', merge: 'no-padding' },
                { id: 'L1-model', type: 'model', color: LABEL_FG, backgroundColor: MODEL_BG, bold: true, rawValue: true, metadata: { keepContext: 'true' } },
                { id: 'L1-lbl-ctx', type: 'custom-text', color: DARK_FG, backgroundColor: CONTEXT_BG, bold: true, customText: '上下文', merge: 'no-padding' },
                { id: 'L1-ctx', type: 'context-length', color: DARK_FG, backgroundColor: CONTEXT_BG, bold: true, rawValue: true },
                { id: 'L1-branch', type: 'git-branch', color: LABEL_FG, backgroundColor: GIT_BG, bold: true, rawValue: true, metadata: { hideNoGit: 'true' } },
                { id: 'L1-changes', type: 'git-changes', color: LABEL_FG, backgroundColor: CHANGES_BG, bold: true, rawValue: true, metadata: { hideNoGit: 'true' } }
            ],
            [
                { id: 'L2-lbl-balance', type: 'custom-text', color: LABEL_FG, backgroundColor: BALANCE_BG, bold: true, customText: '用户余额', merge: 'no-padding' },
                { id: 'L2-balance', type: MOCHI_BALANCE_TYPE, color: LABEL_FG, backgroundColor: BALANCE_BG, bold: true, rawValue: true },
                { id: 'L2-lbl-today', type: 'custom-text', color: LABEL_FG, backgroundColor: SPEND_BG, bold: true, customText: '今日消耗', merge: 'no-padding' },
                { id: 'L2-today', type: MOCHI_DAILY_TYPE, color: LABEL_FG, backgroundColor: SPEND_BG, bold: true, rawValue: true },
                { id: 'L2-lbl-sum', type: 'custom-text', color: LABEL_FG, backgroundColor: SPEED_BG, bold: true, customText: 'TPS', merge: 'no-padding' },
                { id: 'L2-sum', type: 'total-speed', color: LABEL_FG, backgroundColor: SPEED_BG, bold: true, rawValue: true }
            ],
            [
                { id: 'L3-lbl-mochi', type: 'custom-text', color: LABEL_FG, backgroundColor: BALANCE_BG, bold: true, customText: '订阅信息', merge: 'no-padding' },
                { id: 'L3-mochi', type: MOCHI_SUBSCRIPTION_TYPE, color: LABEL_FG, backgroundColor: BALANCE_BG, bold: true, rawValue: true }
            ]
        ],
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

interface MochiLineItem { id?: unknown; type?: unknown; [key: string]: unknown }
interface MochiSettings { lines?: unknown }

function makeMochiBillingItems(prefix: string): MochiLineItem[] {
    return [
        { id: `${prefix}-lbl-balance`, type: 'custom-text', color: LABEL_FG, backgroundColor: BALANCE_BG, bold: true, customText: '用户余额', merge: 'no-padding' },
        { id: `${prefix}-balance`, type: MOCHI_BALANCE_TYPE, color: LABEL_FG, backgroundColor: BALANCE_BG, bold: true, rawValue: true },
        { id: `${prefix}-lbl-today`, type: 'custom-text', color: LABEL_FG, backgroundColor: SPEND_BG, bold: true, customText: '今日消耗', merge: 'no-padding' },
        { id: `${prefix}-today`, type: MOCHI_DAILY_TYPE, color: LABEL_FG, backgroundColor: SPEND_BG, bold: true, rawValue: true }
    ];
}

function hasMochiSubscriptionWidget(settings: MochiSettings): boolean {
    if (!Array.isArray(settings.lines))
        return false;
    for (const line of settings.lines) {
        if (!Array.isArray(line))
            continue;
        for (const item of line as MochiLineItem[]) {
            if (item.type === MOCHI_SUBSCRIPTION_TYPE) {
                return true;
            }
        }
    }
    return false;
}

function isOldClaudeUsageItem(item: MochiLineItem): boolean {
    const type = item.type;
    const id = typeof item.id === 'string' ? item.id : '';
    return type === 'session-usage'
        || type === 'block-timer'
        || type === 'reset-timer'
        || type === 'weekly-usage'
        || id.includes('lbl-used')
        || id.includes('lbl-block')
        || id.includes('lbl-reset')
        || id.includes('lbl-weekly');
}

function migrateMochiBillingIntoExistingLines(existing: MochiSettings & { lines?: unknown[] }): boolean {
    if (!Array.isArray(existing.lines))
        existing.lines = [];

    for (let i = 0; i < existing.lines.length; i++) {
        const line = existing.lines[i];
        if (!Array.isArray(line))
            continue;

        const items = line as MochiLineItem[];
        if (!items.some(isOldClaudeUsageItem))
            continue;

        const kept = items.filter(item => !isOldClaudeUsageItem(item));
        existing.lines[i] = [
            ...makeMochiBillingItems(`L${i + 1}`),
            ...kept
        ];
        return true;
    }

    return false;
}

type StatuslineWriteResult = 'created' | 'replaced' | 'appended' | 'has-widget';

async function writeStatuslineSettings(opts: SetupOptions): Promise<{ result: StatuslineWriteResult; backupPath?: string }> {
    const settingsPath = getConfigPath();
    const dir = path.dirname(settingsPath);

    if (!fs.existsSync(settingsPath)) {
        await fs.promises.mkdir(dir, { recursive: true });
        const recommended = buildRecommendedSettings();
        await fs.promises.writeFile(settingsPath, JSON.stringify(recommended, null, 2), 'utf-8');
        return { result: 'created' };
    }

    // Default behavior: replace with recommended layout (with backup).
    // --keep-statusline-layout: only append the Mochi widget row if missing.
    if (!opts.keepStatuslineLayout) {
        const backupPath = `${settingsPath}.bak-${Date.now()}`;
        await fs.promises.copyFile(settingsPath, backupPath);
        const recommended = buildRecommendedSettings();
        await fs.promises.writeFile(settingsPath, JSON.stringify(recommended, null, 2), 'utf-8');
        return { result: 'replaced', backupPath };
    }

    let existing: MochiSettings & { lines?: unknown[] };
    try {
        existing = JSON.parse(await fs.promises.readFile(settingsPath, 'utf-8')) as MochiSettings & { lines?: unknown[] };
    } catch {
        const backupPath = `${settingsPath}.bak-${Date.now()}`;
        await fs.promises.copyFile(settingsPath, backupPath);
        console.warn(`Existing ${settingsPath} was unparseable; backed up to ${backupPath}.`);
        const recommended = buildRecommendedSettings();
        await fs.promises.writeFile(settingsPath, JSON.stringify(recommended, null, 2), 'utf-8');
        return { result: 'created', backupPath };
    }

    if (migrateMochiBillingIntoExistingLines(existing)) {
        await fs.promises.writeFile(settingsPath, JSON.stringify(existing, null, 2), 'utf-8');
        return { result: 'appended' };
    }

    if (hasMochiSubscriptionWidget(existing)) {
        return { result: 'has-widget' };
    }

    if (!Array.isArray(existing.lines))
        existing.lines = [];
    (existing.lines).push([
        { id: 'L3-lbl-mochi', type: 'custom-text', color: LABEL_FG, backgroundColor: BALANCE_BG, bold: true, customText: '订阅信息', merge: 'no-padding' },
        { id: 'L3-mochi', type: MOCHI_SUBSCRIPTION_TYPE, color: LABEL_FG, backgroundColor: BALANCE_BG, bold: true, rawValue: true }
    ]);
    await fs.promises.writeFile(settingsPath, JSON.stringify(existing, null, 2), 'utf-8');
    return { result: 'appended' };
}

async function wireClaudeStatusLine(): Promise<'wired' | 'already' | 'replaced'> {
    const settings = await loadClaudeSettings({ logErrors: false });
    const current = settings.statusLine?.command;
    if (current === STATUSLINE_COMMAND) {
        return 'already';
    }
    const wasSet = !!current;
    const next = {
        ...settings,
        statusLine: { type: 'command' as const, command: STATUSLINE_COMMAND, padding: 0 }
    };
    await saveClaudeSettings(next);
    return wasSet ? 'replaced' : 'wired';
}

export async function runMochiApiSetup(): Promise<void> {
    const opts = parseFlags(process.argv.slice(2));

    const envToken = readEnv('MOCHIAPI_TOKEN');
    const envBase = readEnv('MOCHIAPI_BASE_URL');
    const envInterval = readEnv('MOCHIAPI_REFRESH_SEC');

    const existing = loadMochiConfig();
    let token = envToken;
    let baseUrl = envBase ?? existing?.baseUrl ?? 'https://mochiapi.com';
    let refresh = envInterval ? Number(envInterval) : (existing?.refreshIntervalSec ?? 30);

    if (!token) {
        console.log('— MochiAPI statusline setup —');
        console.log('Paste your MochiAPI token from https://mochiapi.com/dashboard');
        const rl = createInterface({ input: process.stdin, output: process.stdout });
        try {
            const baseAns = await rl.question(`Base URL [${baseUrl}]: `);
            if (baseAns.trim())
                baseUrl = baseAns.trim();

            const tokenAns = await rl.question(existing?.token ? 'Token (enter to keep existing): ' : 'Token (sk-...): ');
            if (tokenAns.trim())
                token = tokenAns.trim();
            else if (existing?.token)
                token = existing.token;

            const intervalAns = await rl.question(`Refresh interval seconds [${refresh}]: `);
            if (intervalAns.trim()) {
                const parsed = Number(intervalAns.trim());
                if (Number.isFinite(parsed) && parsed > 0)
                    refresh = parsed;
            }
        } finally {
            rl.close();
        }
    }

    if (!token) {
        console.error('No token provided. Set MOCHIAPI_TOKEN or answer interactively.');
        process.exitCode = 1;
        return;
    }

    const cfg = { baseUrl: baseUrl.replace(/\/+$/, ''), token, refreshIntervalSec: refresh };
    saveMochiConfig(cfg);
    console.log(`✓ token config → ${MOCHI_CONFIG_PATH}`);

    const cache = await fetchBalance(cfg);
    writeCache(cache);
    if (cache.ok) {
        console.log(`✓ balance probe OK (balance=$${cache.accountQuotaUsd}, used=$${cache.accountUsedUsd}, today=$${cache.todayUsedUsd})`);
    } else {
        console.error(`✗ balance probe failed: ${cache.error}`);
        process.exitCode = 2;
    }

    if (!opts.skipStatusline) {
        try {
            const { result, backupPath } = await writeStatuslineSettings(opts);
            const ccPath = getConfigPath();
            if (result === 'created') {
                console.log(`✓ ccstatusline layout (mochi 3-line) → ${ccPath}`);
            } else if (result === 'replaced') {
                console.log(`✓ ccstatusline layout reset to mochi 3-line → ${ccPath}`);
                if (backupPath)
                    console.log(`  previous file backed up → ${backupPath}`);
            } else if (result === 'appended') {
                console.log(`✓ Mochi balance widget appended → ${ccPath}`);
            } else {
                console.log(`• ccstatusline settings.json already has the Mochi widget → ${ccPath}`);
            }
        } catch (err) {
            console.error(`✗ ccstatusline settings.json write failed: ${err instanceof Error ? err.message : String(err)}`);
        }
    }

    if (!opts.skipClaudeWire) {
        try {
            const result = await wireClaudeStatusLine();
            const cPath = getClaudeSettingsPath();
            if (result === 'wired')
                console.log(`✓ Claude Code statusLine wired → ${cPath}`);
            else if (result === 'replaced')
                console.log(`✓ Claude Code statusLine replaced with mochiapi-statusline → ${cPath}`);
            else
                console.log(`• Claude Code statusLine already points to mochiapi-statusline → ${cPath}`);
        } catch (err) {
            console.error(`✗ Claude Code settings.json patch failed: ${err instanceof Error ? err.message : String(err)}`);
        }
    }

    console.log('');
    console.log('Setup complete. Open a new Claude Code session to see the status line.');
}
