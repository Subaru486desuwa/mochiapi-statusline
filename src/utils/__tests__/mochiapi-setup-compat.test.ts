import * as fs from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
    expect,
    it,
    vi
} from 'vitest';

import { initConfigPath } from '../config';
import * as mochiapi from '../mochiapi';
import { runMochiApiSetup } from '../mochiapi-setup';

it('setup preserves the existing layout when the backend only has legacy usage fields', async () => {
    const dir = fs.mkdtempSync(join(tmpdir(), 'mochi-setup-compat-'));
    const file = join(dir, 'settings.json');
    const original = JSON.stringify({ version: 3, lines: [[{ id: 'original', type: 'model' }]] });
    fs.writeFileSync(file, original);
    const argv = process.argv;
    process.argv = ['bun', 'test', '--skip-claude-wire'];
    vi.stubEnv('MOCHIAPI_TOKEN', 'setup-regression-only');
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(mochiapi, 'loadSavedMochiConfig').mockReturnValue(null);
    vi.spyOn(mochiapi, 'saveMochiConfig').mockImplementation(() => undefined);
    vi.spyOn(mochiapi, 'writeCache').mockImplementation(() => undefined);
    vi.spyOn(mochiapi, 'fetchBalance').mockResolvedValue({
        fetchedAt: Date.now(), ok: true, claudeSubscription: null,
        subscriptionTotalUsd: 100, subscriptionUsedUsd: 25,
        directBalanceUsd: 12, accountQuotaUsd: 20, accountUsedUsd: 8,
        todayUsedUsd: null, tokenRemainUsd: null, tokenUnlimited: true
    });
    initConfigPath(file);
    try {
        await runMochiApiSetup();
        expect(fs.readFileSync(file, 'utf8')).toBe(original);
        expect(fs.readdirSync(dir)).toEqual(['settings.json']);
    } finally {
        process.argv = argv; initConfigPath();
        vi.restoreAllMocks(); vi.unstubAllEnvs();
        fs.rmSync(dir, { recursive: true, force: true });
    }
});
