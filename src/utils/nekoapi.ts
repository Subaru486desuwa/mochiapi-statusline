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

export interface NekoApiConfig {
    baseUrl: string;
    token: string;
    refreshIntervalSec: number;
}

export interface NekoApiCache {
    fetchedAt: number;
    ok: boolean;
    hardLimitUsd: number | null;
    softLimitUsd: number | null;
    totalUsageCent: number | null;
    accessUntil: number | null;
    error?: string;
}

const DEFAULT_BASE_URL = 'https://nekoapi.cc';
const DEFAULT_INTERVAL = 30;
const UNLIMITED_THRESHOLD = 1e7;

function getNekoConfigDir(): string {
    if (platform() === 'win32') {
        const appData = process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming');
        return join(appData, 'nekoapi-statusline');
    }
    const xdgConfig = process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config');
    return join(xdgConfig, 'nekoapi-statusline');
}

function getNekoCacheDir(): string {
    if (platform() === 'win32') {
        const localAppData = process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local');
        return join(localAppData, 'nekoapi-statusline', 'cache');
    }
    const xdgCache = process.env.XDG_CACHE_HOME ?? join(homedir(), '.cache');
    return join(xdgCache, 'nekoapi-statusline');
}

export const NEKO_CONFIG_PATH = join(getNekoConfigDir(), 'config.json');
export const NEKO_CACHE_PATH = join(getNekoCacheDir(), 'balance.json');

export function loadNekoConfig(): NekoApiConfig | null {
    if (!existsSync(NEKO_CONFIG_PATH))
        return null;
    try {
        const raw = JSON.parse(readFileSync(NEKO_CONFIG_PATH, 'utf8')) as Partial<NekoApiConfig>;
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

export function saveNekoConfig(cfg: NekoApiConfig): void {
    mkdirSync(dirname(NEKO_CONFIG_PATH), { recursive: true });
    writeFileSync(NEKO_CONFIG_PATH, JSON.stringify(cfg, null, 2));
}

export function readCache(): NekoApiCache | null {
    if (!existsSync(NEKO_CACHE_PATH))
        return null;
    try {
        return JSON.parse(readFileSync(NEKO_CACHE_PATH, 'utf8')) as NekoApiCache;
    } catch {
        return null;
    }
}

export function writeCache(cache: NekoApiCache): void {
    mkdirSync(dirname(NEKO_CACHE_PATH), { recursive: true });
    writeFileSync(NEKO_CACHE_PATH, JSON.stringify(cache));
}

function ymd(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
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

export async function fetchBalance(cfg: NekoApiConfig): Promise<NekoApiCache> {
    const now = Date.now();
    const today = new Date();
    const thirtyAgo = new Date(today.getTime() - 30 * 86_400_000);
    try {
        const [sub, use] = await Promise.all([
            httpGet(`${cfg.baseUrl}/v1/dashboard/billing/subscription`, cfg.token),
            httpGet(
                `${cfg.baseUrl}/v1/dashboard/billing/usage?start_date=${ymd(thirtyAgo)}&end_date=${ymd(today)}`,
                cfg.token
            )
        ]);
        const s = sub as { hard_limit_usd?: number; soft_limit_usd?: number; access_until?: number };
        const u = use as { total_usage?: number };
        return {
            fetchedAt: now,
            ok: true,
            hardLimitUsd: s.hard_limit_usd ?? null,
            softLimitUsd: s.soft_limit_usd ?? null,
            totalUsageCent: u.total_usage ?? null,
            accessUntil: s.access_until ?? null
        };
    } catch (e) {
        const prev = readCache();
        return {
            fetchedAt: now,
            ok: false,
            hardLimitUsd: prev?.hardLimitUsd ?? null,
            softLimitUsd: prev?.softLimitUsd ?? null,
            totalUsageCent: prev?.totalUsageCent ?? null,
            accessUntil: prev?.accessUntil ?? null,
            error: e instanceof Error ? e.message : String(e)
        };
    }
}

export function maybeRefreshInBackground(cfg: NekoApiConfig, cache: NekoApiCache | null): void {
    const stale = !cache || Date.now() - cache.fetchedAt > cfg.refreshIntervalSec * 1000;
    if (!stale)
        return;
    if (process.env.CCSL_NEKOAPI_REFRESHING === '1')
        return;
    const argv0 = process.execPath;
    const entry = process.argv[1];
    if (!entry)
        return;
    const child = spawn(argv0, [entry, '--nekoapi-refresh'], {
        detached: true,
        stdio: 'ignore',
        env: { ...process.env, CCSL_NEKOAPI_REFRESHING: '1' }
    });
    child.unref();
}

export interface NekoBalanceView {
    balanceUsd: number | null;
    usedUsd: number | null;
    totalUsd: number | null;
    unlimited: boolean;
    stale: boolean;
    error?: string;
}

export function viewFromCache(cache: NekoApiCache | null, cfg: NekoApiConfig | null): NekoBalanceView | null {
    if (!cache)
        return null;
    const hard = cache.hardLimitUsd;
    const usedCent = cache.totalUsageCent;
    const unlimited = hard !== null && hard >= UNLIMITED_THRESHOLD;
    const usedUsd = usedCent === null ? null : usedCent / 100;
    const totalUsd = unlimited ? null : hard;
    const balanceUsd = unlimited ? null : (hard !== null && usedUsd !== null ? hard - usedUsd : null);
    const stale = cfg !== null && Date.now() - cache.fetchedAt > cfg.refreshIntervalSec * 2000;
    return {
        balanceUsd,
        usedUsd,
        totalUsd,
        unlimited,
        stale,
        error: cache.ok ? undefined : cache.error
    };
}

export async function refreshCli(): Promise<void> {
    const cfg = loadNekoConfig();
    if (!cfg)
        return;
    const cache = await fetchBalance(cfg);
    writeCache(cache);
}
