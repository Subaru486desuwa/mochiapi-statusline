import { createInterface } from 'readline/promises';

import {
    NEKO_CONFIG_PATH,
    fetchBalance,
    loadNekoConfig,
    saveNekoConfig,
    writeCache
} from './nekoapi';

function readEnv(name: string): string | undefined {
    const v = process.env[name];
    return v?.trim() ? v.trim() : undefined;
}

export async function runNekoApiSetup(): Promise<void> {
    const envToken = readEnv('NEKOAPI_TOKEN');
    const envBase = readEnv('NEKOAPI_BASE_URL');
    const envInterval = readEnv('NEKOAPI_REFRESH_SEC');

    let token = envToken;
    let baseUrl = envBase ?? 'https://nekoapi.cc';
    let refresh = envInterval ? Number(envInterval) : 30;

    if (!token) {
        const existing = loadNekoConfig();
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
        console.error('No token provided. Set NEKOAPI_TOKEN or answer interactively.');
        process.exitCode = 1;
        return;
    }

    const cfg = { baseUrl: baseUrl.replace(/\/+$/, ''), token, refreshIntervalSec: refresh };
    saveNekoConfig(cfg);
    console.log(`Saved config to ${NEKO_CONFIG_PATH}`);

    const cache = await fetchBalance(cfg);
    writeCache(cache);
    if (cache.ok) {
        console.log(`Probe OK: hard_limit_usd=${cache.hardLimitUsd} total_usage_cent=${cache.totalUsageCent}`);
    } else {
        console.error(`Probe failed: ${cache.error}`);
        process.exitCode = 2;
    }
}
