import { spawn } from 'child_process';
import {
    existsSync,
    mkdirSync,
    readFileSync,
    writeFileSync
} from 'fs';
import {
    homedir,
    platform
} from 'os';
import {
    dirname,
    join
} from 'path';

export interface MochiApiConfig {
    baseUrl: string;
    token: string;
    refreshIntervalSec: number;
}

export interface MochiApiCache {
    fetchedAt: number;
    ok: boolean;
    /** Account total quota (USD) — data.user_quota_usd. */
    accountQuotaUsd: number | null;
    /** Account used (USD) — data.user_used_quota_usd. */
    accountUsedUsd: number | null;
    /** Today's spend (USD) — data.today_used_quota_usd. */
    todayUsedUsd: number | null;
    /** Current token remaining quota (USD) — data.token_remain_quota_usd. */
    tokenRemainUsd: number | null;
    /** Current token unlimited flag — data.token_unlimited. */
    tokenUnlimited: boolean | null;
    error?: string;
}

const DEFAULT_BASE_URL = 'https://mochiapi.com';
const DEFAULT_INTERVAL = 30;
const UNLIMITED_THRESHOLD = 1e7;

function getMochiConfigDir(): string {
    if (platform() === 'win32') {
        const appData = process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming');
        return join(appData, 'mochiapi-statusline');
    }
    const xdgConfig = process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config');
    return join(xdgConfig, 'mochiapi-statusline');
}

function getMochiCacheDir(): string {
    if (platform() === 'win32') {
        const localAppData = process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local');
        return join(localAppData, 'mochiapi-statusline', 'cache');
    }
    const xdgCache = process.env.XDG_CACHE_HOME ?? join(homedir(), '.cache');
    return join(xdgCache, 'mochiapi-statusline');
}

export const MOCHI_CONFIG_PATH = join(getMochiConfigDir(), 'config.json');
export const MOCHI_CACHE_PATH = join(getMochiCacheDir(), 'balance.json');

export function loadMochiConfig(): MochiApiConfig | null {
    if (!existsSync(MOCHI_CONFIG_PATH))
        return null;
    try {
        const raw = JSON.parse(readFileSync(MOCHI_CONFIG_PATH, 'utf8')) as Partial<MochiApiConfig>;
        if (!raw.token)
            return null;
        return {
            baseUrl: (raw.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, ''),
            token: raw.token,
            refreshIntervalSec: raw.refreshIntervalSec ?? DEFAULT_INTERVAL
        };
    } catch {
        return null;
    }
}

export function saveMochiConfig(cfg: MochiApiConfig): void {
    mkdirSync(dirname(MOCHI_CONFIG_PATH), { recursive: true });
    writeFileSync(MOCHI_CONFIG_PATH, JSON.stringify(cfg, null, 2));
}

export function readCache(): MochiApiCache | null {
    if (!existsSync(MOCHI_CACHE_PATH))
        return null;
    try {
        return JSON.parse(readFileSync(MOCHI_CACHE_PATH, 'utf8')) as MochiApiCache;
    } catch {
        return null;
    }
}

export function writeCache(cache: MochiApiCache): void {
    mkdirSync(dirname(MOCHI_CACHE_PATH), { recursive: true });
    writeFileSync(MOCHI_CACHE_PATH, JSON.stringify(cache));
}

async function httpGet(url: string, token: string, timeoutMs = 12000): Promise<unknown> {
    const ctrl = new AbortController();
    const t = setTimeout(() => { ctrl.abort(); }, timeoutMs);
    try {
        const res = await fetch(url, {
            headers: { Authorization: `Bearer ${token}` },
            signal: ctrl.signal
        });
        if (!res.ok)
            throw new Error(`HTTP ${res.status}`);
        return await res.json();
    } finally {
        clearTimeout(t);
    }
}

function toNum(v: unknown): number | null {
    if (typeof v === 'number' && Number.isFinite(v))
        return v;
    if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)))
        return Number(v);
    return null;
}

function toBool(v: unknown): boolean | null {
    if (typeof v === 'boolean')
        return v;
    return null;
}

export async function fetchBalance(cfg: MochiApiConfig): Promise<MochiApiCache> {
    const now = Date.now();
    try {
        const resp = await httpGet(`${cfg.baseUrl}/api/user/dashboard/balance`, cfg.token);
        const r = resp as {
            data?: {
                user_quota_usd?: unknown;
                user_used_quota_usd?: unknown;
                today_used_quota_usd?: unknown;
                token_remain_quota_usd?: unknown;
                token_unlimited?: unknown;
            };
        };
        const d = r.data;
        return {
            fetchedAt: now,
            ok: true,
            accountQuotaUsd: toNum(d?.user_quota_usd),
            accountUsedUsd: toNum(d?.user_used_quota_usd),
            todayUsedUsd: toNum(d?.today_used_quota_usd),
            tokenRemainUsd: toNum(d?.token_remain_quota_usd),
            tokenUnlimited: toBool(d?.token_unlimited)
        };
    } catch (e) {
        const prev = readCache();
        return {
            fetchedAt: now,
            ok: false,
            accountQuotaUsd: prev?.accountQuotaUsd ?? null,
            accountUsedUsd: prev?.accountUsedUsd ?? null,
            todayUsedUsd: prev?.todayUsedUsd ?? null,
            tokenRemainUsd: prev?.tokenRemainUsd ?? null,
            tokenUnlimited: prev?.tokenUnlimited ?? null,
            error: e instanceof Error ? e.message : String(e)
        };
    }
}

export function maybeRefreshInBackground(cfg: MochiApiConfig, cache: MochiApiCache | null): void {
    const stale = !cache || Date.now() - cache.fetchedAt > cfg.refreshIntervalSec * 1000;
    if (!stale)
        return;
    if (process.env.CCSL_MOCHIAPI_REFRESHING === '1')
        return;
    const argv0 = process.execPath;
    const entry = process.argv[1];
    if (!entry)
        return;
    const child = spawn(argv0, [entry, '--mochiapi-refresh'], {
        detached: true,
        stdio: 'ignore',
        env: { ...process.env, CCSL_MOCHIAPI_REFRESHING: '1' }
    });
    child.unref();
}

export interface MochiBalanceView {
    /** Account remaining balance (USD) = accountQuotaUsd − accountUsedUsd, when both are present. */
    balanceUsd: number | null;
    /** Today's spend (USD). */
    todayUsedUsd: number | null;
    /** Account is unlimited when the total quota is sentinel-large (≥ 1e7). */
    unlimited: boolean;
    stale: boolean;
    error?: string;
}

export function viewFromCache(cache: MochiApiCache | null, cfg: MochiApiConfig | null): MochiBalanceView | null {
    if (!cache)
        return null;

    const quota = cache.accountQuotaUsd;
    const used = cache.accountUsedUsd;
    const unlimited = typeof quota === 'number' && quota >= UNLIMITED_THRESHOLD;

    let balanceUsd: number | null = null;
    if (!unlimited && typeof quota === 'number' && typeof used === 'number') {
        balanceUsd = quota - used;
    }

    const stale = cfg !== null && Date.now() - cache.fetchedAt > cfg.refreshIntervalSec * 2000;

    return {
        balanceUsd,
        todayUsedUsd: cache.todayUsedUsd,
        unlimited,
        stale,
        error: cache.ok ? undefined : cache.error
    };
}

export async function refreshCli(): Promise<void> {
    const cfg = loadMochiConfig();
    if (!cfg)
        return;
    const cache = await fetchBalance(cfg);
    writeCache(cache);
}
