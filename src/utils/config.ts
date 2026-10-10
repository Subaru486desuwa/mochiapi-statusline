import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
    CURRENT_VERSION,
    SettingsSchema,
    SettingsSchema_v1,
    type Settings
} from '../types/Settings';

import {
    migrateConfig,
    needsMigration
} from './migrations';
import { hasClaudeQuotaContract } from './mochiapi';
import { upgradeLegacyWidgetTypes } from './widget-type-aliases';

// Use fs.promises directly (always available in modern Node.js)
const readFile = fs.promises.readFile;
const writeFile = fs.promises.writeFile;
const mkdir = fs.promises.mkdir;

const DEFAULT_SETTINGS_PATH = path.join(os.homedir(), '.config', 'mochiapi-statusline', 'settings.json');
// Upstream ccstatusline location, migrated from on first load (see migrateLegacyConfigIfNeeded).
const LEGACY_SETTINGS_PATH = path.join(os.homedir(), '.config', 'ccstatusline', 'settings.json');

let settingsPath = DEFAULT_SETTINGS_PATH;

export function initConfigPath(filePath?: string): void {
    settingsPath = filePath ? path.resolve(filePath) : DEFAULT_SETTINGS_PATH;
}

export function getConfigPath(): string {
    return settingsPath;
}

export function isCustomConfigPath(): boolean {
    return settingsPath !== DEFAULT_SETTINGS_PATH;
}

interface SettingsPaths {
    configDir: string;
    settingsPath: string;
    settingsBackupPath: string;
}

function getSettingsPaths(): SettingsPaths {
    const configDir = path.dirname(settingsPath);
    const parsedPath = path.parse(settingsPath);
    const backupBaseName = parsedPath.ext
        ? `${parsedPath.name}.bak`
        : `${parsedPath.base}.bak`;

    return {
        configDir,
        settingsPath,
        settingsBackupPath: path.join(configDir, backupBaseName)
    };
}

async function writeSettingsJson(settings: unknown, paths: SettingsPaths): Promise<void> {
    await mkdir(paths.configDir, { recursive: true });
    await writeFile(paths.settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
}

async function persistMigration(settings: Settings, original: string, paths: SettingsPaths): Promise<boolean> {
    const lockPath = `${paths.settingsPath}.migration.lock`;
    let lock: fs.promises.FileHandle;
    try {
        lock = await fs.promises.open(lockPath, 'wx', 0o600);
    } catch (error) {
        if (!(error instanceof Error) || !('code' in error) || error.code !== 'EEXIST')
            throw error;
        const ownerText = await readFile(lockPath, 'utf8').catch(() => '');
        const owner = Number(ownerText);
        let abandoned = false;
        if (Number.isInteger(owner) && owner > 0) {
            try { process.kill(owner, 0); } catch (probeError) {
                abandoned = probeError instanceof Error && 'code' in probeError && probeError.code === 'ESRCH';
            }
        } else {
            const stat = await fs.promises.stat(lockPath);
            abandoned = Date.now() - stat.mtimeMs > 30_000;
        }
        if (!abandoned || await readFile(lockPath, 'utf8') !== ownerText)
            return false;
        await fs.promises.unlink(lockPath);
        return await persistMigration(settings, original, paths);
    }
    const temporary = `${paths.settingsPath}.${process.pid}.tmp`;
    try {
        await lock.writeFile(String(process.pid));
        if (await readFile(paths.settingsPath, 'utf8') !== original)
            return false;
        const backup = `${paths.settingsPath}.pre-v${CURRENT_VERSION}-${Date.now()}-${process.pid}.bak`;
        await writeFile(backup, original, { flag: 'wx', mode: 0o600 });
        await writeFile(temporary, JSON.stringify(settings, null, 2), { flag: 'wx', mode: 0o600 });
        await fs.promises.rename(temporary, paths.settingsPath);
        return true;
    } finally {
        await fs.promises.unlink(temporary).catch(() => undefined);
        await lock.close();
        await fs.promises.unlink(lockPath).catch(() => undefined);
    }
}

async function backupBadSettings(paths: SettingsPaths): Promise<void> {
    try {
        if (fs.existsSync(paths.settingsPath)) {
            const content = await readFile(paths.settingsPath, 'utf-8');
            await writeFile(paths.settingsBackupPath, content, 'utf-8');
            console.error(`Bad settings backed up to ${paths.settingsBackupPath}`);
        }
    } catch (error) {
        console.error('Failed to backup bad settings:', error);
    }
}

async function writeDefaultSettings(paths: SettingsPaths): Promise<Settings> {
    const defaults = SettingsSchema.parse({});
    const settingsWithVersion = {
        ...defaults,
        version: CURRENT_VERSION
    };

    try {
        await writeSettingsJson(settingsWithVersion, paths);
        console.error(`Default settings written to ${paths.settingsPath}`);
    } catch (error) {
        console.error('Failed to write default settings:', error);
    }

    return defaults;
}

async function recoverWithDefaults(paths: SettingsPaths): Promise<Settings> {
    await backupBadSettings(paths);
    return await writeDefaultSettings(paths);
}

async function migrateLegacyConfigIfNeeded(paths: SettingsPaths): Promise<void> {
    // One-time, non-destructive migration from the upstream ccstatusline config
    // location. Only when using the default path, the new settings file is
    // absent, and a legacy ~/.config/ccstatusline/settings.json exists: copy it
    // over. The legacy file is left in place as a backup.
    if (isCustomConfigPath())
        return;
    if (fs.existsSync(paths.settingsPath) || !fs.existsSync(LEGACY_SETTINGS_PATH))
        return;
    try {
        const legacy = await readFile(LEGACY_SETTINGS_PATH, 'utf-8');
        await mkdir(paths.configDir, { recursive: true });
        await writeFile(paths.settingsPath, legacy, 'utf-8');
        console.error(`Migrated settings from ${LEGACY_SETTINGS_PATH} to ${paths.settingsPath}`);
    } catch (error) {
        console.error('Failed to migrate legacy ccstatusline settings:', error);
    }
}

export async function loadSettings(): Promise<Settings> {
    const paths = getSettingsPaths();
    await migrateLegacyConfigIfNeeded(paths);

    try {
        // Check if settings file exists
        if (!fs.existsSync(paths.settingsPath))
            return await writeDefaultSettings(paths);

        const content = await readFile(paths.settingsPath, 'utf-8');
        let rawData: unknown;

        try {
            rawData = JSON.parse(content);
        } catch {
            // If we can't parse the JSON, backup and write defaults
            console.error('Failed to parse settings.json, backing up and using defaults');
            return await recoverWithDefaults(paths);
        }

        // Keep the working v3 layout until the current connection confirms support.
        const targetVersion = hasClaudeQuotaContract() ? CURRENT_VERSION : Math.min(3, CURRENT_VERSION);
        let migrated = false;
        // Check if this is a v1 config (no version field)
        const hasVersion = typeof rawData === 'object' && rawData !== null && 'version' in rawData;
        if (!hasVersion) {
            // Parse as v1 to validate before migration
            const v1Result = SettingsSchema_v1.safeParse(rawData);
            if (!v1Result.success) {
                console.error('Invalid v1 settings format:', v1Result.error);
                return await recoverWithDefaults(paths);
            }

            // Migrate v1 to current version and save the migrated settings back to disk
            rawData = migrateConfig(rawData, targetVersion);
            migrated = true;
        } else if (needsMigration(rawData, targetVersion)) {
            // Handle migrations for versioned configs (v2+) and save the migrated settings back to disk
            rawData = migrateConfig(rawData, targetVersion);
            migrated = true;
        }

        // At this point, data should be in current format with version field
        // Parse with main schema which will apply all defaults
        const result = SettingsSchema.safeParse(rawData);
        if (!result.success) {
            console.error('Failed to parse settings:', result.error);
            return await recoverWithDefaults(paths);
        }

        if (migrated) {
            let persisted = false;
            try {
                persisted = await persistMigration(result.data, content, paths);
            } catch {
                console.error('Layout migration could not be saved; original settings retained');
            }
            if (!persisted) {
                const retained = SettingsSchema.safeParse(JSON.parse(await readFile(paths.settingsPath, 'utf8')));
                if (retained.success)
                    return { ...retained.data, lines: upgradeLegacyWidgetTypes(retained.data.lines) };
            }
        }
        return {
            ...result.data,
            lines: upgradeLegacyWidgetTypes(result.data.lines)
        };
    } catch (error) {
        // Any other error, backup and write defaults
        console.error('Error loading settings:', error);
        return await recoverWithDefaults(paths);
    }
}

export async function saveSettings(settings: Settings): Promise<void> {
    const paths = getSettingsPaths();

    // Always include version when saving
    const settingsWithVersion = {
        ...settings,
        version: CURRENT_VERSION
    };

    await writeSettingsJson(settingsWithVersion, paths);

    // Sync widget hooks to Claude settings
    try {
        const { syncWidgetHooks } = await import('./hooks');
        await syncWidgetHooks(settings);
    } catch { /* ignore hook sync failures */ }
}
