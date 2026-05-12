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
                { id: 'L1-lbl-model', type: 'custom-text', color: 'white', backgroundColor: 'bgBlue', bold: true, customText: '模型' },
                { id: 'L1-model', type: 'model', color: 'white', backgroundColor: 'bgBlue', bold: true, rawValue: true, metadata: { keepContext: 'true' } },
                { id: 'L1-lbl-ctx', type: 'custom-text', color: 'white', backgroundColor: 'bgBrightBlack', bold: true, customText: '上下文' },
                { id: 'L1-ctx', type: 'context-length', color: 'white', backgroundColor: 'bgBrightBlack', bold: true, rawValue: true },
                { id: 'L1-branch', type: 'git-branch', color: 'white', backgroundColor: 'bgMagenta', bold: true, rawValue: true, metadata: { hideNoGit: 'true' } },
                { id: 'L1-changes', type: 'git-changes', color: 'white', backgroundColor: 'bgRed', bold: true, rawValue: true, metadata: { hideNoGit: 'true' } }
            ],
            [
                { id: 'L2-lbl-used', type: 'custom-text', color: 'black', backgroundColor: 'bgGreen', bold: true, customText: '时段用量' },
                { id: 'L2-used', type: 'session-usage', color: 'black', backgroundColor: 'bgGreen', bold: true, rawValue: true },
                { id: 'L2-lbl-block', type: 'custom-text', color: 'white', backgroundColor: 'bgBrightBlack', bold: true, customText: '时段' },
                { id: 'L2-block', type: 'block-timer', color: 'white', backgroundColor: 'bgBrightBlack', bold: true, rawValue: true, metadata: { compact: 'true' } },
                { id: 'L2-lbl-reset', type: 'custom-text', color: 'black', backgroundColor: 'bgGreen', bold: true, customText: '重置' },
                { id: 'L2-reset', type: 'reset-timer', color: 'black', backgroundColor: 'bgGreen', bold: true, rawValue: true, metadata: { compact: 'true' } },
                { id: 'L2-lbl-weekly', type: 'custom-text', color: 'white', backgroundColor: 'bgMagenta', bold: true, customText: '周用量' },
                { id: 'L2-weekly', type: 'weekly-usage', color: 'white', backgroundColor: 'bgMagenta', bold: true, rawValue: true },
                { id: 'L2-lbl-sum', type: 'custom-text', color: 'white', backgroundColor: 'bgRed', bold: true, customText: 'TPS' },
                { id: 'L2-sum', type: 'total-speed', color: 'white', backgroundColor: 'bgRed', bold: true, rawValue: true }
            ],
            [
                { id: 'L3-lbl-mochi', type: 'custom-text', color: 'black', backgroundColor: 'bgCyan', bold: true, customText: 'Mochi' },
                { id: 'L3-mochi', type: MOCHI_BALANCE_TYPE, color: 'black', backgroundColor: 'bgCyan', bold: true, rawValue: true, metadata: { mode: 'combined' } }
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
            separators: ['', ''],
            separatorInvertBackground: [true, true],
            startCaps: ['', ''],
            endCaps: ['', ''],
            theme: 'dracula',
            autoAlign: false,
            continueThemeAcrossLines: false
        }
    };
}

interface MochiLineItem { id?: unknown; type?: unknown }
interface MochiSettings { lines?: unknown }

function hasMochiBalanceWidget(settings: MochiSettings): boolean {
    if (!Array.isArray(settings.lines))
        return false;
    for (const line of settings.lines) {
        if (!Array.isArray(line))
            continue;
        for (const item of line as MochiLineItem[]) {
            if (item.type === MOCHI_BALANCE_TYPE) {
                return true;
            }
        }
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

    if (hasMochiBalanceWidget(existing)) {
        return { result: 'has-widget' };
    }

    if (!Array.isArray(existing.lines))
        existing.lines = [];
    (existing.lines).push([
        { id: 'L3-lbl-mochi', type: 'custom-text', color: 'black', backgroundColor: 'bgCyan', bold: true, customText: 'Mochi' },
        { id: 'L3-mochi', type: MOCHI_BALANCE_TYPE, color: 'black', backgroundColor: 'bgCyan', bold: true, rawValue: true, metadata: { mode: 'combined' } }
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
        console.log(`✓ balance probe OK (hard_limit_usd=${cache.hardLimitUsd}, used_cent=${cache.totalUsageCent})`);
    } else {
        console.error(`✗ balance probe failed: ${cache.error}`);
        process.exitCode = 2;
    }

    if (!opts.skipStatusline) {
        try {
            const { result, backupPath } = await writeStatuslineSettings(opts);
            const ccPath = getConfigPath();
            if (result === 'created') {
                console.log(`✓ ccstatusline layout (dracula 3-line) → ${ccPath}`);
            } else if (result === 'replaced') {
                console.log(`✓ ccstatusline layout reset to dracula 3-line → ${ccPath}`);
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
