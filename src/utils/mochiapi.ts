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
    /** Direct account remaining balance (USD), when returned by the API. */
    directBalanceUsd: number | null;
    /** Account quota/top-up total (USD) — data.user_quota_usd. */
    accountQuotaUsd: number | null;
    /** Account used (USD) — data.user_used_quota_usd. */
    accountUsedUsd: number | null;
    /** Today's spend (USD) — data.today_used_quota_usd. */
    todayUsedUsd: number | null;
    /** Current token remaining quota (USD) — data.token_remain_quota_usd. */
    tokenRemainUsd: number | null;
    /** Current token unlimited flag — data.token_unlimited. */
    tokenUnlimited: boolean | null;
    /** Current token cumulative spend (USD), when returned by /api/usage/token/. */
    tokenTotalUsedUsd?: number | null;
    /** Local date associated with tokenTotalUsedUsd, used as the daily-spend baseline. */
    tokenTotalUsedLocalDate?: string | null;
    /** Subscription total quota this period (USD) — data.subscription_total_usd. */
    subscriptionTotalUsd?: number | null;
    /** Subscription used this period (USD) — data.subscription_used_usd. */
    subscriptionUsedUsd?: number | null;
    /** Subscription reset/expiry (unix seconds; 0 = no countdown) — data.subscription_reset_at. */
    subscriptionResetAt?: number | null;
    /** Subscription unlimited-plan flag — data.subscription_unlimited. */
    subscriptionUnlimited?: boolean | null;
    error?: string;
}

const DEFAULT_BASE_URL = 'https://mochiapi.com';
const DEFAULT_INTERVAL = 30;
const UNLIMITED_THRESHOLD = 1e7;
const NEWAPI_QUOTA_PER_USD = 500_000;

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
        const body = await res.json();
        assertBusinessSuccess(body);
        return body;
    } finally {
        clearTimeout(t);
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function businessFailureMessage(value: Record<string, unknown>): string | null {
    if (value.success === false || value.ok === false || value.code === false) {
        return typeof value.message === 'string'
            ? value.message
            : (typeof value.error === 'string' ? value.error : 'API response marked unsuccessful');
    }
    return null;
}

function assertBusinessSuccess(resp: unknown): void {
    if (!isRecord(resp))
        return;

    const rootFailure = businessFailureMessage(resp);
    if (rootFailure)
        throw new Error(rootFailure);

    if (isRecord(resp.data)) {
        const dataFailure = businessFailureMessage(resp.data);
        if (dataFailure)
            throw new Error(dataFailure);
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
    if (typeof v === 'string') {
        if (v.toLowerCase() === 'true')
            return true;
        if (v.toLowerCase() === 'false')
            return false;
    }
    return null;
}

function firstNum(...values: unknown[]): number | null {
    for (const value of values) {
        const parsed = toNum(value);
        if (parsed !== null)
            return parsed;
    }
    return null;
}

function dataObject(resp: unknown): Record<string, unknown> {
    if (!isRecord(resp))
        return {};
    const data = resp.data;
    if (isRecord(data))
        return data;
    return resp;
}

function localDateKey(now = Date.now()): string {
    const d = new Date(now);
    const y = d.getFullYear();
    const m = `${d.getMonth() + 1}`.padStart(2, '0');
    const day = `${d.getDate()}`.padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function estimateTodayUsedUsd(
    currentTokenUsd: number | null,
    prev: MochiApiCache | null,
    todayKey: string,
    currentAccountUsedUsd: number | null = null
): number | null {
    if (!prev)
        return null;

    const prevDate = prev.tokenTotalUsedLocalDate ?? localDateKey(prev.fetchedAt);
    if (prevDate !== todayKey)
        return null;

    // Preferred: token-level cumulative diff (per-token granularity).
    if (currentTokenUsd !== null && typeof prev.tokenTotalUsedUsd === 'number')
        return Math.max(0, currentTokenUsd - prev.tokenTotalUsedUsd);

    // Fallback: account-level cumulative diff. Survives a prev cache whose
    // token baseline got nulled out by an empty/dashboard fallback write.
    if (currentAccountUsedUsd !== null && typeof prev.accountUsedUsd === 'number')
        return Math.max(0, currentAccountUsedUsd - prev.accountUsedUsd);

    return null;
}

function emptyCache(now: number, ok: boolean): MochiApiCache {
    return {
        fetchedAt: now,
        ok,
        directBalanceUsd: null,
        accountQuotaUsd: null,
        accountUsedUsd: null,
        todayUsedUsd: null,
        tokenRemainUsd: null,
        tokenUnlimited: null,
        tokenTotalUsedUsd: null,
        tokenTotalUsedLocalDate: null
    };
}

function quotaToUsd(quota: number | null): number | null {
    return quota === null ? null : quota / NEWAPI_QUOTA_PER_USD;
}

function cacheFromTokenUsage(resp: unknown, now: number, prev: MochiApiCache | null): MochiApiCache {
    const d = dataObject(resp);
    const tokenUnlimited = toBool(d.unlimited_quota) ?? toBool(d.token_unlimited);

    const totalUsedQuotaUsd = quotaToUsd(toNum(d.total_used));
    const totalGrantedQuotaUsd = quotaToUsd(toNum(d.total_granted));
    const totalAvailableQuotaUsd = quotaToUsd(toNum(d.total_available));

    const totalUsedUsd = firstNum(
        d.total_usd_used,
        d.token_total_usd_used,
        d.total_used_usd
    ) ?? totalUsedQuotaUsd;
    const accountUsedUsdForEstimate = firstNum(
        d.user_used_quota_usd,
        d.user_usd_used
    );
    const todayKey = localDateKey(now);
    const todayUsedUsd = firstNum(
        d.today_used_quota_usd,
        d.today_usd_used,
        d.today_used_usd
    ) ?? estimateTodayUsedUsd(totalUsedUsd, prev, todayKey, accountUsedUsdForEstimate);

    // total_granted / total_available collapse to 0 / negative placeholders when the token
    // is unlimited (mochi backend behaviour). Only treat them as account-derived numbers
    // for limited tokens, where they actually reflect remaining account quota.
    const limitedTokenQuotaFallback = tokenUnlimited === true ? null : totalGrantedQuotaUsd;
    const limitedTokenRemainFallback = tokenUnlimited === true ? null : totalAvailableQuotaUsd;

    return {
        fetchedAt: now,
        ok: true,
        directBalanceUsd: firstNum(
            d.user_usd_available,
            d.user_available_usd,
            d.user_balance_usd,
            d.user_remain_quota_usd,
            d.user_remaining_quota_usd,
            d.remain_balance,
            d.remaining_balance,
            d.balance_usd,
            d.balance
        ),
        accountQuotaUsd: firstNum(
            d.user_quota_usd,
            d.user_total_quota_usd
        ) ?? limitedTokenQuotaFallback,
        accountUsedUsd: firstNum(
            d.user_used_quota_usd,
            d.user_usd_used
        ),
        todayUsedUsd,
        tokenRemainUsd: firstNum(
            d.total_usd_available,
            d.token_remain_quota_usd,
            d.token_remaining_quota_usd,
            d.token_available_usd
        ) ?? limitedTokenRemainFallback,
        tokenUnlimited,
        tokenTotalUsedUsd: totalUsedUsd,
        tokenTotalUsedLocalDate: totalUsedUsd === null ? null : todayKey,
        subscriptionTotalUsd: firstNum(d.subscription_total_usd),
        subscriptionUsedUsd: firstNum(d.subscription_used_usd),
        subscriptionResetAt: toNum(d.subscription_reset_at),
        subscriptionUnlimited: toBool(d.subscription_unlimited)
    };
}

async function cacheFromDashboard(cfg: MochiApiConfig, resp: unknown, now: number): Promise<MochiApiCache> {
    const d = dataObject(resp);
    const directBalanceUsd = firstNum(
        d.user_balance_usd,
        d.user_remain_quota_usd,
        d.user_remaining_quota_usd,
        d.user_usd_available,
        d.user_quota_usd,
        d.remain_balance,
        d.remaining_balance,
        d.balance_usd,
        d.balance
    ) ?? await fetchDirectBalance(cfg);
    const totalUsedUsd = firstNum(
        d.total_usd_used,
        d.token_total_usd_used,
        d.total_used_usd
    );

    return {
        fetchedAt: now,
        ok: true,
        directBalanceUsd,
        accountQuotaUsd: toNum(d.user_quota_usd),
        accountUsedUsd: toNum(d.user_used_quota_usd),
        todayUsedUsd: toNum(d.today_used_quota_usd),
        tokenRemainUsd: toNum(d.token_remain_quota_usd),
        tokenUnlimited: toBool(d.token_unlimited),
        tokenTotalUsedUsd: totalUsedUsd,
        tokenTotalUsedLocalDate: totalUsedUsd === null ? null : localDateKey(now),
        subscriptionTotalUsd: firstNum(d.subscription_total_usd),
        subscriptionUsedUsd: firstNum(d.subscription_used_usd),
        subscriptionResetAt: toNum(d.subscription_reset_at),
        subscriptionUnlimited: toBool(d.subscription_unlimited)
    };
}

async function fetchDirectBalance(cfg: MochiApiConfig): Promise<number | null> {
    const candidates = [
        '/v1/user/balance',
        '/api/user/balance',
        '/api/user/self'
    ];

    for (const path of candidates) {
        try {
            const d = dataObject(await httpGet(`${cfg.baseUrl}${path}`, cfg.token, 5000));
            const balance = firstNum(
                d.user_usd_available,
                d.user_available_usd,
                d.user_balance_usd,
                d.user_remain_quota_usd,
                d.user_remaining_quota_usd,
                d.remain_balance,
                d.remaining_balance,
                d.balance_usd,
                d.balance
            );
            if (balance !== null)
                return balance;
        } catch {
            // Optional compatibility endpoints are best-effort only.
        }
    }
    return null;
}

export async function fetchBalance(cfg: MochiApiConfig, previousCache?: MochiApiCache | null): Promise<MochiApiCache> {
    const now = Date.now();
    const prev = previousCache === undefined ? readCache() : previousCache;
    const errors: string[] = [];

    try {
        const resp = await httpGet(`${cfg.baseUrl}/api/usage/token/`, cfg.token);
        return cacheFromTokenUsage(resp, now, prev);
    } catch (e) {
        errors.push(`/api/usage/token/: ${e instanceof Error ? e.message : String(e)}`);
    }

    try {
        const resp = await httpGet(`${cfg.baseUrl}/api/user/dashboard/balance`, cfg.token);
        return await cacheFromDashboard(cfg, resp, now);
    } catch (e) {
        errors.push(`/api/user/dashboard/balance: ${e instanceof Error ? e.message : String(e)}`);
    }

    const directBalanceUsd = await fetchDirectBalance(cfg);
    if (directBalanceUsd !== null) {
        return {
            ...emptyCache(now, true),
            directBalanceUsd
        };
    }

    return {
        fetchedAt: now,
        ok: false,
        directBalanceUsd: prev?.directBalanceUsd ?? null,
        accountQuotaUsd: prev?.accountQuotaUsd ?? null,
        accountUsedUsd: prev?.accountUsedUsd ?? null,
        todayUsedUsd: prev?.todayUsedUsd ?? null,
        tokenRemainUsd: prev?.tokenRemainUsd ?? null,
        tokenUnlimited: prev?.tokenUnlimited ?? null,
        tokenTotalUsedUsd: prev?.tokenTotalUsedUsd ?? null,
        tokenTotalUsedLocalDate: prev?.tokenTotalUsedLocalDate ?? null,
        subscriptionTotalUsd: prev?.subscriptionTotalUsd ?? null,
        subscriptionUsedUsd: prev?.subscriptionUsedUsd ?? null,
        subscriptionResetAt: prev?.subscriptionResetAt ?? null,
        subscriptionUnlimited: prev?.subscriptionUnlimited ?? null,
        error: errors.join('; ') || 'MochiAPI balance fetch failed'
    };
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
    /** Account remaining balance (USD). */
    balanceUsd: number | null;
    /** Whether balanceUsd came from a direct balance field/endpoint. */
    directBalance: boolean;
    /** Direct account remaining balance (USD), when returned by the API. */
    directBalanceUsd: number | null;
    /** Account quota/top-up total (USD). */
    accountQuotaUsd: number | null;
    /** Account used (USD). */
    accountUsedUsd: number | null;
    /** Current token remaining quota (USD). */
    tokenRemainUsd: number | null;
    /** Current token unlimited flag. */
    tokenUnlimited: boolean | null;
    /** Today's spend (USD). */
    todayUsedUsd: number | null;
    /** Subscription percent used (0–100), null when no active subscription. */
    subscriptionUsedPct: number | null;
    /** Subscription reset/expiry (unix seconds), null when none / 0. */
    subscriptionResetAt: number | null;
    /** Subscription is an unlimited plan. */
    subscriptionUnlimited: boolean;
    /** An active subscription with a positive total quota exists. */
    hasSubscription: boolean;
    /** Account balance is unlimited when the account quota/top-up total is sentinel-large (≥ 1e7). */
    unlimited: boolean;
    stale: boolean;
    error?: string;
}

export function viewFromCache(cache: MochiApiCache | null, cfg: MochiApiConfig | null): MochiBalanceView | null {
    if (!cache)
        return null;

    const quota = cache.accountQuotaUsd;
    const used = cache.accountUsedUsd;
    const tokenRemain = cache.tokenRemainUsd;
    const accountSentinelUnlimited = typeof quota === 'number' && quota >= UNLIMITED_THRESHOLD;
    const hasAccountSignal
        = typeof quota === 'number'
            || typeof used === 'number'
            || typeof cache.directBalanceUsd === 'number';
    // Mochi's /api/usage/token/ does not expose any account-level USD figure when the
    // token is unlimited, so an unlimited token is the only signal we have to fall back
    // on. Limited tokens still keep account/token balance separate (see tests).
    const tokenFallbackUnlimited = !hasAccountSignal && cache.tokenUnlimited === true;
    const unlimited = accountSentinelUnlimited || tokenFallbackUnlimited;

    let balanceUsd: number | null = null;
    if (typeof cache.directBalanceUsd === 'number') {
        balanceUsd = cache.directBalanceUsd;
    } else if (!unlimited && typeof quota === 'number' && typeof used === 'number') {
        balanceUsd = Math.max(0, quota - used);
    } else if (!unlimited) {
        balanceUsd = typeof quota === 'number'
            ? quota
            : tokenRemain;
    }

    const subscriptionUnlimited = cache.subscriptionUnlimited === true;
    const subTotal = typeof cache.subscriptionTotalUsd === 'number' ? cache.subscriptionTotalUsd : null;
    const subUsed = typeof cache.subscriptionUsedUsd === 'number' ? cache.subscriptionUsedUsd : null;
    const hasSubscription = !subscriptionUnlimited && subTotal !== null && subTotal > 0;
    const subscriptionUsedPct = hasSubscription && subUsed !== null
        ? Math.min(100, Math.max(0, Math.round((subUsed / subTotal) * 100)))
        : null;
    const subscriptionResetAt = typeof cache.subscriptionResetAt === 'number' && cache.subscriptionResetAt > 0
        ? cache.subscriptionResetAt
        : null;

    const stale = cfg !== null && Date.now() - cache.fetchedAt > cfg.refreshIntervalSec * 2000;

    return {
        balanceUsd,
        directBalance: typeof cache.directBalanceUsd === 'number',
        directBalanceUsd: cache.directBalanceUsd,
        accountQuotaUsd: cache.accountQuotaUsd,
        accountUsedUsd: cache.accountUsedUsd,
        tokenRemainUsd: cache.tokenRemainUsd,
        tokenUnlimited: cache.tokenUnlimited,
        todayUsedUsd: cache.todayUsedUsd,
        subscriptionUsedPct,
        subscriptionResetAt,
        subscriptionUnlimited,
        hasSubscription,
        unlimited,
        stale,
        error: cache.ok ? undefined : cache.error
    };
}

/** Compact countdown to a unix-seconds deadline: `5d12h`, `5d`, `12h`, `<1h`, or `0h` once past. */
export function formatResetCountdown(resetAtSec: number, nowMs: number = Date.now()): string {
    const remainMs = resetAtSec * 1000 - nowMs;
    if (remainMs <= 0)
        return '0h';
    const totalHours = Math.floor(remainMs / 3_600_000);
    const days = Math.floor(totalHours / 24);
    const hours = totalHours % 24;
    if (days >= 1)
        return hours > 0 ? `${days}d${hours}h` : `${days}d`;
    if (totalHours >= 1)
        return `${totalHours}h`;
    return '<1h';
}

export async function refreshCli(): Promise<void> {
    const cfg = loadMochiConfig();
    if (!cfg)
        return;
    const cache = await fetchBalance(cfg);
    writeCache(cache);
}
