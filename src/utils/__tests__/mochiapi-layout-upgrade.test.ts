import * as childProcess from 'child_process';
import * as fs from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi
} from 'vitest';

import {
    initConfigPath,
    loadSettings
} from '../config';
import * as mochiapi from '../mochiapi';

describe('automatic Mochi layout upgrade', () => {
    let cacheDirectory: string;
    const cfg = { baseUrl: 'https://mochiapi.com', token: 'regression-only', refreshIntervalSec: 30 };
    function readyCache(): mochiapi.MochiApiCache {
        return {
            connectionId: mochiapi.mochiConnectionId(cfg),
            fetchedAt: Date.now(), ok: true, claudeSubscription: { status: 'none', plans: [] },
            directBalanceUsd: null, accountQuotaUsd: null, accountUsedUsd: null,
            todayUsedUsd: null, tokenRemainUsd: null, tokenUnlimited: null
        };
    }
    beforeEach(() => {
        cacheDirectory = fs.mkdtempSync(join(tmpdir(), 'mochi-capability-cache-'));
        vi.stubEnv('XDG_CACHE_HOME', cacheDirectory);
        vi.stubEnv('ANTHROPIC_BASE_URL', cfg.baseUrl);
        vi.stubEnv('ANTHROPIC_AUTH_TOKEN', cfg.token);
        vi.stubEnv('CCSL_MOCHIAPI_REFRESHING', '1');
        mochiapi.writeCache(readyCache());
    });
    afterEach(() => {
        vi.restoreAllMocks(); vi.unstubAllEnvs();
        fs.rmSync(cacheDirectory, { recursive: true, force: true });
    });

    it('leaves the v3 layout byte-for-byte until this connection supports Claude quota', async () => {
        const dir = fs.mkdtempSync(join(tmpdir(), 'mochi-legacy-api-'));
        const file = join(dir, 'settings.json');
        const original = JSON.stringify({ version: 3, lines: [[{ id: 'old', type: 'mochiapi-subscription-balance' }]] });
        fs.writeFileSync(file, original);
        mochiapi.writeCache({ ...readyCache(), claudeSubscription: null });
        initConfigPath(file);
        try {
            const settings = await loadSettings();
            expect(settings.version).toBe(3);
            expect(settings.lines[0]?.[0]?.id).toBe('old');
            expect(fs.readFileSync(file, 'utf8')).toBe(original);
            expect(fs.readdirSync(dir)).toEqual(['settings.json']);
        } finally { initConfigPath(); fs.rmSync(dir, { recursive: true, force: true }); }
    });
    it('starts one capability refresh even when the old layout has no Mochi widgets', async () => {
        fs.rmSync(cacheDirectory, { recursive: true, force: true });
        vi.stubEnv('CCSL_MOCHIAPI_REFRESHING', '0');
        const child = new childProcess.ChildProcess();
        vi.spyOn(child, 'unref').mockImplementation(() => undefined);
        const spawned = vi.spyOn(childProcess, 'spawn').mockReturnValue(child);
        const dir = fs.mkdtempSync(join(tmpdir(), 'mochi-cold-capability-'));
        const file = join(dir, 'settings.json');
        fs.writeFileSync(file, JSON.stringify({ version: 3, lines: [[{ id: 'old', type: 'model' }]] }));
        initConfigPath(file);
        try {
            expect((await loadSettings()).version).toBe(3);
            expect((await loadSettings()).version).toBe(3);
            expect(spawned).toHaveBeenCalledTimes(1);
            expect(spawned.mock.calls[0]?.[1]).toContain('--mochiapi-refresh');
            mochiapi.writeCache(readyCache());
            expect((await loadSettings()).version).toBe(4);
        } finally { initConfigPath(); fs.rmSync(dir, { recursive: true, force: true }); }
    });

    it('does not upgrade from stale capability evidence or another token cache', () => {
        mochiapi.writeCache({ ...readyCache(), fetchedAt: Date.now() - 120_000 });
        expect(mochiapi.hasClaudeQuotaContract()).toBe(false);
        mochiapi.writeCache(readyCache());
        vi.stubEnv('ANTHROPIC_AUTH_TOKEN', 'different-regression-token');
        expect(mochiapi.hasClaudeQuotaContract()).toBe(false);
    });

    it('keeps rendering the old layout when its backup cannot be written', async () => {
        const dir = fs.mkdtempSync(join(tmpdir(), 'mochi-backup-failure-'));
        const file = join(dir, 'settings.json');
        const original = JSON.stringify({ version: 3, lines: [[{ id: 'old', type: 'model' }]] });
        fs.writeFileSync(file, original);
        const timestamp = Date.now();
        vi.spyOn(Date, 'now').mockReturnValue(timestamp);
        fs.mkdirSync(`${file}.pre-v4-${timestamp}-${process.pid}.bak`);
        initConfigPath(file);
        try {
            const settings = await loadSettings();
            expect(settings.version).toBe(3);
            expect(settings.lines[0]?.[0]?.id).toBe('old');
            expect(fs.readFileSync(file, 'utf8')).toBe(original);
        } finally { initConfigPath(); fs.rmSync(dir, { recursive: true, force: true }); }
    });

    it('recovers a migration lock left by an exited process', async () => {
        const dir = fs.mkdtempSync(join(tmpdir(), 'mochi-abandoned-'));
        const file = join(dir, 'settings.json');
        fs.writeFileSync(file, JSON.stringify({ version: 3, lines: [] }));
        fs.writeFileSync(`${file}.migration.lock`, '2147483647');
        initConfigPath(file);
        try {
            const settings = await loadSettings();
            expect(settings.version).toBe(4);
            const saved: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
            expect(saved).toMatchObject({ version: 4 });
            expect(fs.existsSync(`${file}.migration.lock`)).toBe(false);
        } finally {
            initConfigPath();
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    it('backs up the exact v3 file and upgrades once to wallet plus Claude quota', async () => {
        const dir = fs.mkdtempSync(join(tmpdir(), 'mochi-upgrade-'));
        const file = join(dir, 'settings.json');
        const original = JSON.stringify({ version: 3, lines: [[{ id: 'old', type: 'weekly-usage' }]] });
        fs.writeFileSync(file, original);
        initConfigPath(file);
        try {
            const settings = await loadSettings();
            expect(settings.version).toBe(4);
            expect(settings.lines.flat().map(w => w.type)).toContain('mochiapi-balance');
            expect(settings.lines.flat().map(w => w.type)).toContain('mochiapi-subscription-balance');
            expect(settings.lines.flat().map(w => w.type)).not.toContain('weekly-usage');
            const backups = fs.readdirSync(dir).filter(n => n.includes('.pre-v4-'));
            expect(backups).toHaveLength(1);
            const backup = backups[0];
            if (!backup)
                throw new Error('Missing migration backup');
            expect(fs.readFileSync(join(dir, backup), 'utf8')).toBe(original);
            await loadSettings();
            expect(fs.readdirSync(dir).filter(n => n.includes('.pre-v4-'))).toHaveLength(1);
        } finally { initConfigPath(); fs.rmSync(dir, { recursive: true, force: true }); }
    });
});
