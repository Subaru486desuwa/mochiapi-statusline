import { createInterface } from 'readline/promises';

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

export async function runMochiApiSetup(): Promise<void> {
    const envToken = readEnv('MOCHIAPI_TOKEN');
    const envBase = readEnv('MOCHIAPI_BASE_URL');
    const envInterval = readEnv('MOCHIAPI_REFRESH_SEC');

    let token = envToken;
    let baseUrl = envBase ?? 'https://mochiapi.cc';
    let refresh = envInterval ? Number(envInterval) : 30;

    if (!token) {
        const existing = loadMochiConfig();
        const rl = createInterface({ input: process.stdin, output: process.stdout });
        try {
            const baseAns = await rl.question(`Base URL [${existing?.baseUrl ?? baseUrl}]: `);
            if (baseAns.trim())
                baseUrl = baseAns.trim();
            else if (existing?.baseUrl)
                baseUrl = existing.baseUrl;

            const tokenAns = await rl.question(existing?.token ? 'Token (enter to keep existing): ' : 'Token (sk-...): ');
            if (tokenAns.trim())
                token = tokenAns.trim();
            else if (existing?.token)
                token = existing.token;

            const intervalAns = await rl.question(`Refresh interval seconds [${existing?.refreshIntervalSec ?? refresh}]: `);
            if (intervalAns.trim())
                refresh = Number(intervalAns.trim()) || refresh;
            else if (existing?.refreshIntervalSec)
                refresh = existing.refreshIntervalSec;
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
    console.log(`Saved config to ${MOCHI_CONFIG_PATH}`);

    const cache = await fetchBalance(cfg);
    writeCache(cache);
    if (cache.ok) {
        console.log(`Probe OK: hard_limit_usd=${cache.hardLimitUsd} total_usage_cent=${cache.totalUsageCent}`);
    } else {
        console.error(`Probe failed: ${cache.error}`);
        process.exitCode = 2;
    }
}
