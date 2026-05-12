# mochiapi-statusline

Fork of [sirmalloc/ccstatusline](https://github.com/sirmalloc/ccstatusline) with a `MochiAPI Balance` widget for the [MochiAPI](https://mochiapi.com) gateway.

## What changed vs upstream

- New widget type `mochiapi-balance` (display name "MochiAPI Balance", category "MochiAPI")
- New CLI flags:
  - `--mochiapi-setup`  interactive (or env-driven) config writer + connectivity probe
  - `--mochiapi-refresh`  one-shot cache refresh (used internally by the widget)
- New runtime files:
  - `src/utils/mochiapi.ts`  HTTP client + on-disk config/cache helpers
  - `src/utils/mochiapi-setup.ts`  CLI setup flow
  - `src/widgets/MochiApiBalance.ts`  widget render logic
- Package renamed to `mochiapi-statusline`, binary `mochiapi-statusline`

Everything else (widgets, TUI, layout, powerline, themes) is untouched and tracks upstream.

## Endpoints used

| Path | Returns | Notes |
|---|---|---|
| `GET ${baseUrl}/v1/dashboard/billing/subscription` | `{ hard_limit_usd, soft_limit_usd, access_until }` | unlimited tokens return `1e8` |
| `GET ${baseUrl}/v1/dashboard/billing/usage?start_date&end_date` | `{ total_usage }` (cent = USD × 100) | 30-day window by default |

Bearer auth (`Authorization: Bearer sk-...`). No cookies, no session.

## Install

Requires **Node.js ≥ 14**. Not on npm yet — install from a GitHub source tarball:

```bash
npm install -g https://github.com/Subaru486desuwa/mochiapi-statusline/archive/refs/heads/main.tar.gz
```

The pre-built `dist/ccstatusline.js` is committed in the repo, so the tarball install drops the binary straight in — no build step runs on your machine.

> ℹ️ Avoid `npm install -g github:Subaru486desuwa/mochiapi-statusline`. npm's git-URL install path strips files outside `package.json#files` during its prepare step and ends up with a broken symlink. The tarball URL above is the reliable form.

### macOS / Linux

```bash
# 1. install
npm install -g https://github.com/Subaru486desuwa/mochiapi-statusline/archive/refs/heads/main.tar.gz

# 2. configure (replace sk-xxxx with your MochiAPI token)
MOCHIAPI_BASE_URL=https://mochiapi.com MOCHIAPI_TOKEN=sk-xxxx mochiapi-statusline --mochiapi-setup

# 3. wire it into Claude Code
mkdir -p ~/.claude
# If ~/.claude/settings.json already exists, edit it to add the statusLine field;
# otherwise just create it:
cat > ~/.claude/settings.json <<'JSON'
{ "statusLine": { "type": "command", "command": "mochiapi-statusline" } }
JSON

# 4. (optional) open the TUI to add the widget to a status line
mochiapi-statusline
# → pick a line → Add widget → search "MochiAPI" → choose display mode
```

### Windows (PowerShell)

> **Prerequisite for the powerline look.** The recommended layout below uses Nerd Font glyphs (``, ``) as Powerline separators. Without a Nerd Font, your terminal renders them as `?` boxes. Install one (`winget install DEVCOM.JetBrainsMonoNerdFont`) and set it as the font face in Windows Terminal / your terminal of choice. See [docs/WINDOWS.md § Powerline Font Support](docs/WINDOWS.md#powerline-font-support) for the full font setup.

```powershell
# 1. make sure Node.js ≥ 14 is installed (https://nodejs.org → LTS works)
node --version

# 2. install (run PowerShell as Administrator or use --prefix to avoid permission issues)
npm install -g https://github.com/Subaru486desuwa/mochiapi-statusline/archive/refs/heads/main.tar.gz

# 3. configure
$env:MOCHIAPI_BASE_URL = "https://mochiapi.com"
$env:MOCHIAPI_TOKEN    = "sk-xxxx"
mochiapi-statusline --mochiapi-setup

# 4. wire it into Claude Code (%USERPROFILE%\.claude\settings.json)
$claudeDir = "$env:USERPROFILE\.claude"
New-Item -ItemType Directory -Path $claudeDir -Force | Out-Null
$cfg = "$claudeDir\settings.json"
if (Test-Path $cfg) {
    # merge into existing settings.json
    $j = Get-Content $cfg -Raw | ConvertFrom-Json
    $j | Add-Member -Force -NotePropertyName statusLine -NotePropertyValue (@{ type="command"; command="mochiapi-statusline" })
    $j | ConvertTo-Json -Depth 10 | Set-Content $cfg -Encoding UTF8
} else {
    '{ "statusLine": { "type": "command", "command": "mochiapi-statusline" } }' | Set-Content $cfg -Encoding UTF8
}

# 5. (optional) open the TUI to customize widgets
mochiapi-statusline
```

### Where files live

| | macOS / Linux | Windows |
|---|---|---|
| Config | `~/.config/mochiapi-statusline/config.json` | `%APPDATA%\mochiapi-statusline\config.json` |
| Balance cache | `~/.cache/mochiapi-statusline/balance.json` | `%LOCALAPPDATA%\mochiapi-statusline\cache\balance.json` |
| Claude Code settings | `~/.claude/settings.json` | `%USERPROFILE%\.claude\settings.json` |

Cache is refreshed in a detached subprocess every `refreshIntervalSec` (default 30s).

### Upgrade / uninstall

```bash
# upgrade — rerun the install command to pull latest main
npm install -g https://github.com/Subaru486desuwa/mochiapi-statusline/archive/refs/heads/main.tar.gz

# uninstall
npm uninstall -g mochiapi-statusline
```

### Verifying the install

```bash
mochiapi-statusline --mochiapi-refresh
# (no output on success; check the cache file)

# pipe a fake Claude Code payload to see a rendered status line
echo '{"hook_event_name":"Status","model":{"id":"claude-opus-4-7[1m]","display_name":"Opus 4.7"},"transcript_path":"/tmp/fake.jsonl","cwd":".","workspace":{"current_dir":".","project_dir":".","added_dirs":[]},"version":"2.1.80","output_style":{"name":"default"}}' | mochiapi-statusline
```

If you see `Mochi: cfg?` the config file isn't found — re-run `--mochiapi-setup`. If you see `Mochi: ...` it means the cache hasn't been populated yet — run `mochiapi-statusline --mochiapi-refresh` once, or wait 30s for the background refresher.

## Widget options

`metadata.mode` (string):
- `combined` (default)  `$balance / $used`
- `balance`  remaining only
- `used`  consumed only
- `percent`  `used / total * 100`

Unlimited tokens (`hard_limit_usd ≥ 1e7`) show `∞` (`balance`/`percent` modes) or `∞ · $used` (`combined`).

A trailing `*` means the cached value is older than `2 × refreshIntervalSec` — usually the network or the upstream went away. The widget keeps rendering the last good number while the background refresher retries.

## Recommended layout (dracula powerline + MochiAPI)

The "screenshot" layout from the README — three lines, dracula colors, MochiAPI balance on its own row. Drop this into your ccstatusline settings file (path below).

| OS | Path |
|---|---|
| macOS / Linux | `~/.config/ccstatusline/settings.json` |
| Windows | `%USERPROFILE%\.config\ccstatusline\settings.json` |

> ℹ️ This is the upstream ccstatusline TUI's settings file (not the MochiAPI token config in `~/.config/mochiapi-statusline/`). They're separate.

The layout:
- **Line 1**: `模型 / Opus 4.7 (1M context) / 上下文 / <tokens> / <branch> / <changes>`
- **Line 2**: `时段用量 / 5.0% / 时段 / 3h41m / 重置 / 1h18m / 周用量 / 12.0% / TPS / <t/s>`
- **Line 3**: `Mochi / ∞ · $1.172` (MochiAPI Balance widget, combined mode)

<details>
<summary>Full <code>settings.json</code></summary>

```json
{
  "version": 3,
  "lines": [
    [
      { "id": "L1-lbl-model", "type": "custom-text", "color": "white", "backgroundColor": "bgBlue", "bold": true, "customText": "模型" },
      { "id": "L1-model", "type": "model", "color": "white", "backgroundColor": "bgBlue", "bold": true, "rawValue": true },
      { "id": "L1-lbl-ctx", "type": "custom-text", "color": "white", "backgroundColor": "bgBrightBlack", "bold": true, "customText": "上下文" },
      { "id": "L1-ctx", "type": "context-length", "color": "white", "backgroundColor": "bgBrightBlack", "bold": true, "rawValue": true },
      { "id": "L1-branch", "type": "git-branch", "color": "white", "backgroundColor": "bgMagenta", "bold": true, "rawValue": true },
      { "id": "L1-changes", "type": "git-changes", "color": "white", "backgroundColor": "bgRed", "bold": true, "rawValue": true }
    ],
    [
      { "id": "L2-lbl-used", "type": "custom-text", "color": "black", "backgroundColor": "bgGreen", "bold": true, "customText": "时段用量" },
      { "id": "L2-used", "type": "session-usage", "color": "black", "backgroundColor": "bgGreen", "bold": true, "rawValue": true },
      { "id": "L2-lbl-block", "type": "custom-text", "color": "white", "backgroundColor": "bgBrightBlack", "bold": true, "customText": "时段" },
      { "id": "L2-block", "type": "block-timer", "color": "white", "backgroundColor": "bgBrightBlack", "bold": true, "rawValue": true, "metadata": { "compact": "true" } },
      { "id": "L2-lbl-reset", "type": "custom-text", "color": "black", "backgroundColor": "bgGreen", "bold": true, "customText": "重置" },
      { "id": "L2-reset", "type": "reset-timer", "color": "black", "backgroundColor": "bgGreen", "bold": true, "rawValue": true, "metadata": { "compact": "true" } },
      { "id": "L2-lbl-weekly", "type": "custom-text", "color": "white", "backgroundColor": "bgMagenta", "bold": true, "customText": "周用量" },
      { "id": "L2-weekly", "type": "weekly-usage", "color": "white", "backgroundColor": "bgMagenta", "bold": true, "rawValue": true },
      { "id": "L2-lbl-sum", "type": "custom-text", "color": "white", "backgroundColor": "bgRed", "bold": true, "customText": "TPS" },
      { "id": "L2-sum", "type": "total-speed", "color": "white", "backgroundColor": "bgRed", "bold": true, "rawValue": true }
    ],
    [
      { "id": "L3-lbl-mochi", "type": "custom-text", "color": "black", "backgroundColor": "bgCyan", "bold": true, "customText": "Mochi" },
      { "id": "L3-mochi", "type": "mochiapi-balance", "color": "black", "backgroundColor": "bgCyan", "bold": true, "rawValue": true, "metadata": { "mode": "combined" } }
    ]
  ],
  "flexMode": "full",
  "compactThreshold": 60,
  "colorLevel": 2,
  "defaultPadding": " ",
  "inheritSeparatorColors": false,
  "globalBold": false,
  "minimalistMode": false,
  "powerline": {
    "enabled": true,
    "separators": ["", ""],
    "separatorInvertBackground": [true, true],
    "startCaps": ["", ""],
    "endCaps": ["", ""],
    "theme": "dracula",
    "autoAlign": false,
    "continueThemeAcrossLines": false
  }
}
```

</details>

After saving, smoke-test it without launching Claude Code:

```bash
# macOS / Linux
echo '{"session_id":"test","model":{"id":"claude-opus-4-7","display_name":"Opus 4.7 (1M context)"},"workspace":{"current_dir":".","project_dir":"."},"cost":{"total_cost_usd":1.172},"transcript_path":"/tmp/nonexistent","output_style":{"name":"default"}}' | mochiapi-statusline
```

```powershell
# Windows PowerShell
'{"session_id":"test","model":{"id":"claude-opus-4-7","display_name":"Opus 4.7 (1M context)"},"workspace":{"current_dir":".","project_dir":"."},"cost":{"total_cost_usd":1.172},"transcript_path":"NUL","output_style":{"name":"default"}}' | mochiapi-statusline
```

You should see three Powerline-styled rows in dracula colors. If separators show as `?` your terminal isn't using a Nerd Font — fix that first.

## Cross-platform notes

- Node ≥ 14 (matches upstream's `target=node14` build).
- macOS, Linux, Windows are all first-class. Path resolution branches on `os.platform()`.
- The refresher uses `child_process.spawn(detached:true, stdio:'ignore', ...).unref()`. Works on all three OSes; on Windows the spawned process attaches to the same console group but never writes to stdout.
