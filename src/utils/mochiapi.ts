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
    /** Account balance from /api/user/dashboard/balance (data.user_quota_usd). */
    userQuotaUsd: number | null;
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

export async function fetchBalance(cfg: MochiApiConfig): Promise<MochiApiCache> {
    const now = Date.now();
    try {
        const resp = await httpGet(`${cfg.baseUrl}/api/user/dashboard/balance`, cfg.token);
        const r = resp as { data?: { user_quota_usd?: unknown } };
        const raw = r.data?.user_quota_usd;
        const userQuotaUsd = typeof raw === 'number' && Number.isFinite(raw)
            ? raw
            : (typeof raw === 'string' && Number.isFinite(Number(raw)) ? Number(raw) : null);
        return { fetchedAt: now, ok: true, userQuotaUsd };
    } catch (e) {
        const prev = readCache();
        return {
            fetchedAt: now,
            ok: false,
            userQuotaUsd: prev?.userQuotaUsd ?? null,
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
    balanceUsd: number | null;
    unlimited: boolean;
    stale: boolean;
    error?: string;
}

export function viewFromCache(cache: MochiApiCache | null, cfg: MochiApiConfig | null): MochiBalanceView | null {
    if (!cache)
        return null;

    let balanceUsd: number | null = null;
    let unlimited = false;

    const q = cache.userQuotaUsd;
    if (typeof q === 'number') {
        if (q >= UNLIMITED_THRESHOLD) {
            unlimited = true;
        } else {
            balanceUsd = q;
        }
    }

    const stale = cfg !== null && Date.now() - cache.fetchedAt > cfg.refreshIntervalSec * 2000;

    return {
        balanceUsd,
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
