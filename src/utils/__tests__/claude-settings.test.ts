import * as childProcess from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    afterAll,
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi
} from 'vitest';

import { DEFAULT_SETTINGS } from '../../types/Settings';
import {
    MOCHIAPI_STATUSLINE_COMMANDS,
    getClaudeCodeVersion,
    getClaudeJsonPath,
    getClaudeSettingsPath,
    getExistingStatusLine,
    getRefreshInterval,
    getVoiceConfig,
    installStatusLine,
    isClaudeCodeVersionAtLeast,
    isInstalled,
    isKnownCommand,
    loadClaudeSettings,
    resolveSelfStatuslineCommand,
    saveClaudeSettings,
    setRefreshInterval,
    uninstallStatusLine
} from '../claude-settings';
import { initConfigPath } from '../config';

const ORIGINAL_CLAUDE_CONFIG_DIR = process.env.CLAUDE_CONFIG_DIR;
let testClaudeConfigDir = '';

function readInstalledCommand(): string {
    const settingsPath = getClaudeSettingsPath();
    const content = fs.readFileSync(settingsPath, 'utf-8');
    const data = JSON.parse(content) as { statusLine?: { command?: string } };
    return data.statusLine?.command ?? '';
}

function readInstalledRefreshInterval(): number | undefined {
    const settingsPath = getClaudeSettingsPath();
    const content = fs.readFileSync(settingsPath, 'utf-8');
    const data = JSON.parse(content) as { statusLine?: { refreshInterval?: number } };
    return data.statusLine?.refreshInterval;
}

function writeRawClaudeSettings(content: string): void {
    const settingsPath = getClaudeSettingsPath();
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(settingsPath, content, 'utf-8');
}

beforeEach(() => {
    testClaudeConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mochiapi-statusline-claude-settings-'));
    process.env.CLAUDE_CONFIG_DIR = testClaudeConfigDir;
    initConfigPath();
});

afterEach(() => {
    initConfigPath();
    if (testClaudeConfigDir) {
        fs.rmSync(testClaudeConfigDir, { recursive: true, force: true });
    }
});

afterAll(() => {
    if (ORIGINAL_CLAUDE_CONFIG_DIR === undefined) {
        delete process.env.CLAUDE_CONFIG_DIR;
    } else {
        process.env.CLAUDE_CONFIG_DIR = ORIGINAL_CLAUDE_CONFIG_DIR;
    }
});

describe('isKnownCommand', () => {
    it('should match exact NPM command', () => {
        expect(isKnownCommand(MOCHIAPI_STATUSLINE_COMMANDS.NPM)).toBe(true);
    });

    it('should match exact BUNX command', () => {
        expect(isKnownCommand(MOCHIAPI_STATUSLINE_COMMANDS.BUNX)).toBe(true);
    });

    it('should match exact SELF_MANAGED command', () => {
        expect(isKnownCommand(MOCHIAPI_STATUSLINE_COMMANDS.SELF_MANAGED)).toBe(true);
    });

    it('should match NPM command with --config and simple path', () => {
        expect(isKnownCommand(`${MOCHIAPI_STATUSLINE_COMMANDS.NPM} --config /tmp/settings.json`)).toBe(true);
    });

    it('should match BUNX command with --config and quoted path with spaces', () => {
        expect(isKnownCommand(`${MOCHIAPI_STATUSLINE_COMMANDS.BUNX} --config '/my path/settings.json'`)).toBe(true);
    });

    it('should match command with --config and quoted path with parens', () => {
        expect(isKnownCommand(`${MOCHIAPI_STATUSLINE_COMMANDS.NPM} --config '/my(path)/settings.json'`)).toBe(true);
    });

    it('should match command with --config and double-quoted Windows path', () => {
        expect(isKnownCommand(`${MOCHIAPI_STATUSLINE_COMMANDS.NPM} --config "C:\\Users\\Alice\\My Settings\\settings.json"`)).toBe(true);
    });

    it('should not match unknown commands', () => {
        expect(isKnownCommand('some-other-command')).toBe(false);
    });

    it('should not match empty string', () => {
        expect(isKnownCommand('')).toBe(false);
    });

    it('should not match partial prefix', () => {
        expect(isKnownCommand('npx -y ccstatusline')).toBe(false);
    });

    it('should not match prefix that is a substring', () => {
        expect(isKnownCommand('npx -y mochiapi-statusline@latestFOO')).toBe(false);
    });

    it('should match command containing mochiapi-statusline.ts', () => {
        expect(isKnownCommand('bun run /home/user/ccstatusline/src/mochiapi-statusline.ts')).toBe(true);
    });

    it('should match command containing a quoted mochiapi-statusline.ts path', () => {
        expect(isKnownCommand('bun run "/Users/Jane Doe/ccstatusline/src/mochiapi-statusline.ts"')).toBe(true);
    });

    it('should match absolute node + dist/mochiapi-statusline.js command', () => {
        expect(isKnownCommand('/usr/local/bin/node /usr/local/lib/node_modules/mochiapi-statusline/dist/mochiapi-statusline.js')).toBe(true);
    });

    it('should match quoted Windows absolute-path command', () => {
        expect(isKnownCommand('"C:\\Program Files\\nodejs\\node.exe" "C:\\Users\\slh\\AppData\\Roaming\\npm\\node_modules\\mochiapi-statusline\\dist\\mochiapi-statusline.js"')).toBe(true);
    });

    it('should match an absolute path to the bare binary', () => {
        expect(isKnownCommand('/usr/local/bin/mochiapi-statusline')).toBe(true);
    });
});

describe('resolveSelfStatuslineCommand', () => {
    function makeScript(...segments: string[]): string {
        const scriptPath = path.join(testClaudeConfigDir, ...segments);
        fs.mkdirSync(path.dirname(scriptPath), { recursive: true });
        fs.writeFileSync(scriptPath, '', 'utf-8');
        return scriptPath;
    }

    // Mirrors the implementation's platform quoting so resolution-focused tests stay
    // green when the temp dir itself contains spaces (e.g. Windows user profiles).
    function q(filePath: string): string {
        if (process.platform === 'win32') {
            return /[\s&()<>|^"]/.test(filePath) ? `"${filePath.replace(/"/g, '""')}"` : filePath;
        }
        return /[\s()[\];&#|'"\\$`]/.test(filePath) ? `'${filePath.replace(/'/g, '\'\\\'\'')}'` : filePath;
    }

    it('should build an absolute execPath + script command', () => {
        const scriptPath = makeScript('dist', 'mochiapi-statusline.js');
        expect(resolveSelfStatuslineCommand(scriptPath, '/usr/bin/node')).toBe(`/usr/bin/node ${q(path.resolve(scriptPath))}`);
    });

    it('should quote script paths containing spaces', () => {
        const scriptPath = makeScript('My Apps', 'mochiapi-statusline.js');
        const command = resolveSelfStatuslineCommand(scriptPath, '/usr/bin/node');
        const quoteChar = process.platform === 'win32' ? '"' : '\'';
        expect(command.startsWith('/usr/bin/node ')).toBe(true);
        expect(command.slice('/usr/bin/node '.length).startsWith(quoteChar)).toBe(true);
        expect(command).toContain('My Apps');
    });

    it('should quote an execPath containing spaces', () => {
        const scriptPath = makeScript('dist', 'mochiapi-statusline.js');
        const execPath = '/opt/my node/bin/node';
        const quotedExec = process.platform === 'win32' ? `"${execPath}"` : `'${execPath}'`;
        expect(resolveSelfStatuslineCommand(scriptPath, execPath)).toBe(`${quotedExec} ${q(path.resolve(scriptPath))}`);
    });

    it.skipIf(process.platform === 'win32')('should resolve extension-less bin symlinks to the real script path', () => {
        const scriptPath = makeScript('lib', 'mochiapi-statusline.js');
        const linkPath = path.join(testClaudeConfigDir, 'mochiapi-statusline');
        fs.symlinkSync(scriptPath, linkPath);
        const resolved = fs.realpathSync(scriptPath);
        expect(resolveSelfStatuslineCommand(linkPath, '/usr/bin/node')).toBe(`/usr/bin/node ${q(resolved)}`);
    });

    it.skipIf(process.platform === 'win32')('should keep version-stable directory symlinks unresolved for direct script paths', () => {
        // Models nvm-windows-style junctions: realpathing them would pin the command
        // to a versioned directory that breaks on the next node version switch.
        makeScript('versions', 'v20.19.0', 'dist', 'mochiapi-statusline.js');
        const linkDir = path.join(testClaudeConfigDir, 'current');
        fs.symlinkSync(path.join(testClaudeConfigDir, 'versions', 'v20.19.0'), linkDir);
        const viaLink = path.join(linkDir, 'dist', 'mochiapi-statusline.js');
        expect(resolveSelfStatuslineCommand(viaLink, '/usr/bin/node')).toBe(`/usr/bin/node ${q(viaLink)}`);
    });

    it('should fall back to the bare command when the script arg is empty', () => {
        expect(resolveSelfStatuslineCommand('', '/usr/bin/node')).toBe(MOCHIAPI_STATUSLINE_COMMANDS.SELF_MANAGED);
    });

    it('should fall back to the bare command when the script does not exist', () => {
        const missing = path.join(testClaudeConfigDir, 'nope', 'mochiapi-statusline.js');
        expect(resolveSelfStatuslineCommand(missing, '/usr/bin/node')).toBe(MOCHIAPI_STATUSLINE_COMMANDS.SELF_MANAGED);
    });

    it('should fall back to the bare command for transient npx cache paths', () => {
        const scriptPath = makeScript('_npx', 'abc123', 'node_modules', '.bin', 'mochiapi-statusline');
        expect(resolveSelfStatuslineCommand(scriptPath, '/usr/bin/node')).toBe(MOCHIAPI_STATUSLINE_COMMANDS.SELF_MANAGED);
    });

    it('should fall back to the bare command for transient bunx cache paths', () => {
        const scriptPath = makeScript('bunx-501-mochiapi-statusline@latest', 'node_modules', '.bin', 'mochiapi-statusline');
        expect(resolveSelfStatuslineCommand(scriptPath, '/usr/bin/node')).toBe(MOCHIAPI_STATUSLINE_COMMANDS.SELF_MANAGED);
    });

    it('should fall back to the bare command for transient pnpm dlx cache paths', () => {
        const scriptPath = makeScript('pnpm', 'dlx', 'abc123', 'node_modules', 'mochiapi-statusline', 'dist', 'mochiapi-statusline.js');
        expect(resolveSelfStatuslineCommand(scriptPath, '/usr/bin/node')).toBe(MOCHIAPI_STATUSLINE_COMMANDS.SELF_MANAGED);
    });

    it('should fall back to the bare command for transient yarn dlx temp paths', () => {
        const scriptPath = makeScript('xfs-1a2b3c', 'dlx-9999', 'node_modules', 'mochiapi-statusline', 'dist', 'mochiapi-statusline.js');
        expect(resolveSelfStatuslineCommand(scriptPath, '/usr/bin/node')).toBe(MOCHIAPI_STATUSLINE_COMMANDS.SELF_MANAGED);
    });
});

describe('Claude config paths', () => {
    it('should resolve .claude.json inside CLAUDE_CONFIG_DIR when configured', () => {
        expect(getClaudeJsonPath()).toBe(path.join(testClaudeConfigDir, '.claude.json'));
    });

    it('should resolve .claude.json beside the default Claude config dir when CLAUDE_CONFIG_DIR is unset', () => {
        delete process.env.CLAUDE_CONFIG_DIR;

        expect(getClaudeJsonPath()).toBe(path.join(os.homedir(), '.claude.json'));
    });

    it('should use default .claude.json path when CLAUDE_CONFIG_DIR points to a file', () => {
        const invalidConfigDir = path.join(testClaudeConfigDir, 'not-a-dir');
        fs.writeFileSync(invalidConfigDir, 'not a directory', 'utf-8');
        process.env.CLAUDE_CONFIG_DIR = invalidConfigDir;

        expect(getClaudeJsonPath()).toBe(path.join(os.homedir(), '.claude.json'));
    });
});

describe('buildCommand via installStatusLine', () => {
    it('should use base command when no custom config path', async () => {
        initConfigPath();
        await installStatusLine(false);
        expect(readInstalledCommand()).toBe(MOCHIAPI_STATUSLINE_COMMANDS.NPM);
    });

    it('should append --config with simple path (no quoting needed)', async () => {
        initConfigPath('/tmp/settings.json');
        await installStatusLine(false);
        expect(readInstalledCommand()).toBe(`${MOCHIAPI_STATUSLINE_COMMANDS.NPM} --config /tmp/settings.json`);
    });

    it('should quote path with spaces', async () => {
        initConfigPath('/my path/settings.json');
        await installStatusLine(false);
        expect(readInstalledCommand()).toBe(`${MOCHIAPI_STATUSLINE_COMMANDS.NPM} --config '/my path/settings.json'`);
    });

    it('should quote path with parentheses', async () => {
        initConfigPath('/my(path)/settings.json');
        await installStatusLine(false);
        expect(readInstalledCommand()).toBe(`${MOCHIAPI_STATUSLINE_COMMANDS.NPM} --config '/my(path)/settings.json'`);
    });

    it('should escape embedded single quotes in path', async () => {
        initConfigPath('/my\'path/settings.json');
        await installStatusLine(false);
        expect(readInstalledCommand()).toBe(`${MOCHIAPI_STATUSLINE_COMMANDS.NPM} --config '/my'\\''path/settings.json'`);
    });

    it('should use bunx command when useBunx is true', async () => {
        initConfigPath('/my path/settings.json');
        await installStatusLine(true);
        expect(readInstalledCommand()).toBe(`${MOCHIAPI_STATUSLINE_COMMANDS.BUNX} --config '/my path/settings.json'`);
    });

    it('should sync hooks on install when settings include hook-enabled widgets', async () => {
        const configPath = path.join(testClaudeConfigDir, 'mochiapi-statusline-settings.json');
        initConfigPath(configPath);
        const settingsWithSkills = {
            ...DEFAULT_SETTINGS,
            lines: [[{ id: 'skills-1', type: 'skills' }], [], []]
        };
        fs.writeFileSync(configPath, JSON.stringify(settingsWithSkills, null, 2), 'utf-8');

        await installStatusLine(false);

        const installedCommand = `${MOCHIAPI_STATUSLINE_COMMANDS.NPM} --config ${configPath}`;
        const claudeSettings = await loadClaudeSettings();
        expect(claudeSettings.statusLine?.command).toBe(installedCommand);
        const hooks = (claudeSettings.hooks ?? {}) as Record<string, unknown[]>;
        expect(hooks.PreToolUse).toEqual([
            {
                _tag: 'mochiapi-statusline-managed',
                matcher: 'Skill',
                hooks: [{ type: 'command', command: `${installedCommand} --hook` }]
            }
        ]);
        expect(hooks.UserPromptSubmit).toEqual([
            {
                _tag: 'mochiapi-statusline-managed',
                hooks: [{ type: 'command', command: `${installedCommand} --hook` }]
            }
        ]);
    });
});

describe('installStatusLine refreshInterval', () => {
    it('should set refreshInterval to 10 when version is supported', async () => {
        initConfigPath();
        await installStatusLine(false, true);
        expect(readInstalledRefreshInterval()).toBe(10);
    });

    it('should not set refreshInterval when version is unsupported', async () => {
        initConfigPath();
        await installStatusLine(false, false);
        expect(readInstalledRefreshInterval()).toBeUndefined();
    });

    it('should preserve existing refreshInterval on re-install', async () => {
        writeRawClaudeSettings(JSON.stringify({
            statusLine: {
                type: 'command',
                command: MOCHIAPI_STATUSLINE_COMMANDS.NPM,
                padding: 0,
                refreshInterval: 5
            }
        }));
        await installStatusLine(false, true);
        expect(readInstalledRefreshInterval()).toBe(5);
    });
});

describe('refreshInterval', () => {
    it('getRefreshInterval should return null when no settings exist', async () => {
        await expect(getRefreshInterval()).resolves.toBeNull();
    });

    it('getRefreshInterval should return null when statusLine has no refreshInterval', async () => {
        await saveClaudeSettings({
            statusLine: {
                type: 'command',
                command: MOCHIAPI_STATUSLINE_COMMANDS.NPM,
                padding: 0
            }
        });
        await expect(getRefreshInterval()).resolves.toBeNull();
    });

    it('getRefreshInterval should return the configured value', async () => {
        await saveClaudeSettings({
            statusLine: {
                type: 'command',
                command: MOCHIAPI_STATUSLINE_COMMANDS.NPM,
                padding: 0,
                refreshInterval: 5
            }
        });
        await expect(getRefreshInterval()).resolves.toBe(5);
    });

    it('setRefreshInterval should set the value on existing statusLine', async () => {
        await saveClaudeSettings({
            statusLine: {
                type: 'command',
                command: MOCHIAPI_STATUSLINE_COMMANDS.NPM,
                padding: 0
            }
        });

        await setRefreshInterval(15);

        const settings = await loadClaudeSettings();
        expect(settings.statusLine?.refreshInterval).toBe(15);
    });

    it('setRefreshInterval with null should remove refreshInterval', async () => {
        await saveClaudeSettings({
            statusLine: {
                type: 'command',
                command: MOCHIAPI_STATUSLINE_COMMANDS.NPM,
                padding: 0,
                refreshInterval: 10
            }
        });

        await setRefreshInterval(null);

        const settings = await loadClaudeSettings();
        expect(settings.statusLine?.refreshInterval).toBeUndefined();
    });

    it('setRefreshInterval should do nothing when no statusLine exists', async () => {
        await saveClaudeSettings({});

        await setRefreshInterval(10);

        const settings = await loadClaudeSettings();
        expect(settings.statusLine).toBeUndefined();
    });
});

describe('backup and error handling behavior', () => {
    it('saveClaudeSettings should create .bak backup before overwrite', async () => {
        writeRawClaudeSettings(JSON.stringify({
            statusLine: {
                type: 'command',
                command: 'preexisting-command',
                padding: 1
            }
        }));

        await saveClaudeSettings({
            statusLine: {
                type: 'command',
                command: MOCHIAPI_STATUSLINE_COMMANDS.NPM,
                padding: 0
            }
        });

        const settingsPath = getClaudeSettingsPath();
        const saved = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) as { statusLine?: { command?: string } };
        expect(saved.statusLine?.command).toBe(MOCHIAPI_STATUSLINE_COMMANDS.NPM);
        expect(fs.existsSync(`${settingsPath}.bak`)).toBe(true);

        const backup = JSON.parse(fs.readFileSync(`${settingsPath}.bak`, 'utf-8')) as { statusLine?: { command?: string } };
        expect(backup.statusLine?.command).toBe('preexisting-command');
    });

    it('installStatusLine should create .orig backup before updating settings', async () => {
        writeRawClaudeSettings(JSON.stringify({
            statusLine: {
                type: 'command',
                command: 'old-command',
                padding: 1
            }
        }));

        await installStatusLine(false);

        const settingsPath = getClaudeSettingsPath();
        expect(fs.existsSync(`${settingsPath}.orig`)).toBe(true);

        const orig = JSON.parse(fs.readFileSync(`${settingsPath}.orig`, 'utf-8')) as { statusLine?: { command?: string } };
        expect(orig.statusLine?.command).toBe('old-command');
    });

    it('loadClaudeSettings should return empty object when settings file is missing', async () => {
        await expect(loadClaudeSettings()).resolves.toEqual({});
    });

    it('loadClaudeSettings should log and throw when settings file is invalid JSON', async () => {
        writeRawClaudeSettings('{ invalid json');
        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        try {
            await expect(loadClaudeSettings()).rejects.toThrow();
            expect(consoleErrorSpy).toHaveBeenCalledWith(
                'Failed to load Claude settings:',
                expect.anything()
            );
        } finally {
            consoleErrorSpy.mockRestore();
        }
    });

    it('isInstalled should return false when settings cannot be loaded', async () => {
        writeRawClaudeSettings('{ invalid json');
        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        try {
            await expect(isInstalled()).resolves.toBe(false);
            expect(consoleErrorSpy).not.toHaveBeenCalled();
        } finally {
            consoleErrorSpy.mockRestore();
        }
    });

    it('installStatusLine should warn and recover when existing settings are invalid', async () => {
        writeRawClaudeSettings('{ invalid json');
        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        try {
            await installStatusLine(false);

            const settingsPath = getClaudeSettingsPath();
            const installed = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) as { statusLine?: { command?: string; padding?: number } };
            expect(installed.statusLine?.command).toBe(MOCHIAPI_STATUSLINE_COMMANDS.NPM);
            expect(installed.statusLine?.padding).toBe(0);
            expect(fs.existsSync(`${settingsPath}.orig`)).toBe(true);
            expect(fs.readFileSync(`${settingsPath}.orig`, 'utf-8')).toBe('{ invalid json');

            expect(consoleErrorSpy).toHaveBeenCalledWith(
                `Warning: Could not read existing Claude settings. A backup exists at ${settingsPath}.orig.`
            );
        } finally {
            consoleErrorSpy.mockRestore();
        }
    });

    it('uninstallStatusLine should warn and return without modifying invalid settings', async () => {
        writeRawClaudeSettings('{ invalid json');
        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        try {
            await uninstallStatusLine();

            const settingsPath = getClaudeSettingsPath();
            expect(fs.readFileSync(settingsPath, 'utf-8')).toBe('{ invalid json');
            expect(fs.existsSync(`${settingsPath}.bak`)).toBe(false);
            expect(consoleErrorSpy).toHaveBeenCalledWith(
                'Warning: Could not read existing Claude settings.'
            );
        } finally {
            consoleErrorSpy.mockRestore();
        }
    });

    it('uninstallStatusLine should remove all managed hooks', async () => {
        writeRawClaudeSettings(JSON.stringify({
            statusLine: {
                type: 'command',
                command: MOCHIAPI_STATUSLINE_COMMANDS.NPM,
                padding: 0
            },
            hooks: {
                PreToolUse: [
                    {
                        _tag: 'mochiapi-statusline-managed',
                        matcher: 'Skill',
                        hooks: [{ type: 'command', command: `${MOCHIAPI_STATUSLINE_COMMANDS.NPM} --hook` }]
                    },
                    {
                        matcher: 'Other',
                        hooks: [{ type: 'command', command: 'keep-me' }]
                    }
                ],
                UserPromptSubmit: [
                    {
                        _tag: 'mochiapi-statusline-managed',
                        hooks: [{ type: 'command', command: `${MOCHIAPI_STATUSLINE_COMMANDS.NPM} --hook` }]
                    }
                ]
            }
        }));

        await uninstallStatusLine();

        const settingsPath = getClaudeSettingsPath();
        const updated = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) as {
            statusLine?: unknown;
            hooks?: Record<string, unknown[]>;
        };
        expect(updated.statusLine).toBeUndefined();
        expect(updated.hooks).toEqual({
            PreToolUse: [
                {
                    matcher: 'Other',
                    hooks: [{ type: 'command', command: 'keep-me' }]
                }
            ]
        });
    });

    it('getExistingStatusLine should return null when settings cannot be loaded', async () => {
        writeRawClaudeSettings('{ invalid json');
        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        try {
            await expect(getExistingStatusLine()).resolves.toBeNull();
            expect(consoleErrorSpy).not.toHaveBeenCalled();
        } finally {
            consoleErrorSpy.mockRestore();
        }
    });

    it('isInstalled should accept known commands with --config and undefined padding', async () => {
        await saveClaudeSettings({
            statusLine: {
                type: 'command',
                command: `${MOCHIAPI_STATUSLINE_COMMANDS.NPM} --config /tmp/settings.json`
            }
        });

        await expect(isInstalled()).resolves.toBe(true);
    });

    it('isInstalled should accept quoted local development commands when padding is undefined', async () => {
        await saveClaudeSettings({
            statusLine: {
                type: 'command',
                command: 'bun run "/Users/Jane Doe/ccstatusline/src/mochiapi-statusline.ts"'
            }
        });

        await expect(isInstalled()).resolves.toBe(true);
    });
});

describe('getClaudeCodeVersion', () => {
    it('should parse version from claude --version output', () => {
        vi.spyOn(childProcess, 'execSync').mockReturnValue('2.1.97 (Claude Code)\n');
        expect(getClaudeCodeVersion()).toBe('2.1.97');
    });

    it('should parse version without suffix text', () => {
        vi.spyOn(childProcess, 'execSync').mockReturnValue('3.0.0\n');
        expect(getClaudeCodeVersion()).toBe('3.0.0');
    });

    it('should return null when claude is not installed', () => {
        vi.spyOn(childProcess, 'execSync').mockImplementation(() => { throw new Error('not found'); });
        expect(getClaudeCodeVersion()).toBeNull();
    });

    it('should return null for unexpected output', () => {
        vi.spyOn(childProcess, 'execSync').mockReturnValue('unknown output');
        expect(getClaudeCodeVersion()).toBeNull();
    });
});

describe('isClaudeCodeVersionAtLeast', () => {
    it('should return true when version equals minimum', () => {
        vi.spyOn(childProcess, 'execSync').mockReturnValue('2.1.97 (Claude Code)\n');
        expect(isClaudeCodeVersionAtLeast('2.1.97')).toBe(true);
    });

    it('should return true when patch is higher', () => {
        vi.spyOn(childProcess, 'execSync').mockReturnValue('2.1.100 (Claude Code)\n');
        expect(isClaudeCodeVersionAtLeast('2.1.97')).toBe(true);
    });

    it('should return true when minor is higher', () => {
        vi.spyOn(childProcess, 'execSync').mockReturnValue('2.2.0 (Claude Code)\n');
        expect(isClaudeCodeVersionAtLeast('2.1.97')).toBe(true);
    });

    it('should return true when major is higher', () => {
        vi.spyOn(childProcess, 'execSync').mockReturnValue('3.0.0 (Claude Code)\n');
        expect(isClaudeCodeVersionAtLeast('2.1.97')).toBe(true);
    });

    it('should return false when version is lower', () => {
        vi.spyOn(childProcess, 'execSync').mockReturnValue('2.1.96 (Claude Code)\n');
        expect(isClaudeCodeVersionAtLeast('2.1.97')).toBe(false);
    });

    it('should return false when minor is lower', () => {
        vi.spyOn(childProcess, 'execSync').mockReturnValue('2.0.100 (Claude Code)\n');
        expect(isClaudeCodeVersionAtLeast('2.1.97')).toBe(false);
    });

    it('should return false when claude is not installed', () => {
        vi.spyOn(childProcess, 'execSync').mockImplementation(() => { throw new Error('not found'); });
        expect(isClaudeCodeVersionAtLeast('2.1.97')).toBe(false);
    });
});

describe('getVoiceConfig', () => {
    let testProjectDir = '';

    function writeRawUserLocalSettings(content: string): void {
        const settingsPath = path.join(testClaudeConfigDir, 'settings.local.json');
        fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
        fs.writeFileSync(settingsPath, content, 'utf-8');
    }

    function writeRawProjectSettings(content: string): void {
        const settingsPath = path.join(testProjectDir, '.claude', 'settings.json');
        fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
        fs.writeFileSync(settingsPath, content, 'utf-8');
    }

    function writeRawProjectLocalSettings(content: string): void {
        const settingsPath = path.join(testProjectDir, '.claude', 'settings.local.json');
        fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
        fs.writeFileSync(settingsPath, content, 'utf-8');
    }

    beforeEach(() => {
        testProjectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mochiapi-statusline-voice-project-'));
    });

    afterEach(() => {
        if (testProjectDir) {
            fs.rmSync(testProjectDir, { recursive: true, force: true });
        }
    });

    describe('user-global layer only', () => {
        it('returns null when no candidate file exists', () => {
            expect(getVoiceConfig(testProjectDir)).toBeNull();
        });

        it('returns { enabled: false } when settings.json has no voice field', () => {
            writeRawClaudeSettings(JSON.stringify({ effortLevel: 'high' }));
            expect(getVoiceConfig(testProjectDir)).toEqual({ enabled: false });
        });

        it('returns { enabled: true } when voice.enabled is true', () => {
            writeRawClaudeSettings(JSON.stringify({ voice: { enabled: true, mode: 'hold' } }));
            expect(getVoiceConfig(testProjectDir)).toEqual({ enabled: true });
        });

        it('returns { enabled: false } when voice.enabled is false', () => {
            writeRawClaudeSettings(JSON.stringify({ voice: { enabled: false, mode: 'hold' } }));
            expect(getVoiceConfig(testProjectDir)).toEqual({ enabled: false });
        });

        it('returns { enabled: false } when voice.enabled is missing but voice exists', () => {
            writeRawClaudeSettings(JSON.stringify({ voice: { mode: 'hold' } }));
            expect(getVoiceConfig(testProjectDir)).toEqual({ enabled: false });
        });

        it('treats malformed JSON as "no override"', () => {
            // Malformed file is silently skipped; with no other layers, no override is found
            // and we fall back to the Claude Code default of `enabled: false`. The file's mere
            // existence still flips the overall result away from `null`.
            writeRawClaudeSettings('{ this is not json');
            expect(getVoiceConfig(testProjectDir)).toEqual({ enabled: false });
        });

        it('treats unexpected voice shape as "no override"', () => {
            // voice is a string instead of an object — Zod schema fails, no override extracted.
            writeRawClaudeSettings(JSON.stringify({ voice: 'enabled' }));
            expect(getVoiceConfig(testProjectDir)).toEqual({ enabled: false });
        });

        it('respects CLAUDE_CONFIG_DIR env var', () => {
            writeRawClaudeSettings(JSON.stringify({ voice: { enabled: true } }));
            expect(getClaudeSettingsPath().startsWith(testClaudeConfigDir)).toBe(true);
            expect(getVoiceConfig(testProjectDir)).toEqual({ enabled: true });
        });
    });

    describe('layer precedence', () => {
        it('user-local overrides user-global', () => {
            writeRawClaudeSettings(JSON.stringify({ voice: { enabled: true } }));
            writeRawUserLocalSettings(JSON.stringify({ voice: { enabled: false } }));
            expect(getVoiceConfig(testProjectDir)).toEqual({ enabled: false });
        });

        it('project overrides user-local', () => {
            writeRawClaudeSettings(JSON.stringify({ voice: { enabled: false } }));
            writeRawUserLocalSettings(JSON.stringify({ voice: { enabled: false } }));
            writeRawProjectSettings(JSON.stringify({ voice: { enabled: true } }));
            expect(getVoiceConfig(testProjectDir)).toEqual({ enabled: true });
        });

        it('project-local overrides project', () => {
            writeRawProjectSettings(JSON.stringify({ voice: { enabled: true } }));
            writeRawProjectLocalSettings(JSON.stringify({ voice: { enabled: false } }));
            expect(getVoiceConfig(testProjectDir)).toEqual({ enabled: false });
        });

        it('layer without voice.enabled does not override a lower layer', () => {
            // user-global sets enabled:true, project layer has voice but no `enabled` field
            // → project should NOT clobber the user-global value.
            writeRawClaudeSettings(JSON.stringify({ voice: { enabled: true } }));
            writeRawProjectSettings(JSON.stringify({ voice: { mode: 'hold' } }));
            expect(getVoiceConfig(testProjectDir)).toEqual({ enabled: true });
        });

        it('malformed higher-priority layer does not clobber a lower layer', () => {
            writeRawClaudeSettings(JSON.stringify({ voice: { enabled: true } }));
            writeRawProjectLocalSettings('{ corrupt');
            expect(getVoiceConfig(testProjectDir)).toEqual({ enabled: true });
        });

        it('returns { enabled: false } when only project layer exists with voice but no enabled', () => {
            writeRawProjectSettings(JSON.stringify({ voice: { mode: 'hold' } }));
            expect(getVoiceConfig(testProjectDir)).toEqual({ enabled: false });
        });

        it('returns null when no candidate file exists in any layer', () => {
            // testProjectDir is freshly created and empty, testClaudeConfigDir too
            expect(getVoiceConfig(testProjectDir)).toBeNull();
        });

        it('full stack: project-local wins over all three lower layers', () => {
            writeRawClaudeSettings(JSON.stringify({ voice: { enabled: true } }));
            writeRawUserLocalSettings(JSON.stringify({ voice: { enabled: false } }));
            writeRawProjectSettings(JSON.stringify({ voice: { enabled: true } }));
            writeRawProjectLocalSettings(JSON.stringify({ voice: { enabled: false } }));
            expect(getVoiceConfig(testProjectDir)).toEqual({ enabled: false });
        });

        it('falls through layers without voice.enabled until it finds a defined value', () => {
            // user-global defines enabled:true; the three higher-priority layers exist but
            // contribute nothing usable (no voice field, only mode, or unrelated keys).
            writeRawClaudeSettings(JSON.stringify({ voice: { enabled: true } }));
            writeRawUserLocalSettings(JSON.stringify({ effortLevel: 'high' }));
            writeRawProjectSettings(JSON.stringify({ voice: { mode: 'hold' } }));
            writeRawProjectLocalSettings(JSON.stringify({ effortLevel: 'low' }));
            expect(getVoiceConfig(testProjectDir)).toEqual({ enabled: true });
        });
    });
});
