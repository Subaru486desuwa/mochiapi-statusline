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

## Install (one-shot)

Requires **Node.js ≥ 14**. Two commands total — install the package, then run the setup.

> **Windows prerequisite for the powerline look:** The default layout uses Nerd Font glyphs (``, ``) as Powerline separators. Without a Nerd Font, your terminal renders them as `?` boxes. Install one (`winget install DEVCOM.JetBrainsMonoNerdFont`) and set it as the font face in Windows Terminal / your terminal of choice. See [docs/WINDOWS.md § Powerline Font Support](docs/WINDOWS.md#powerline-font-support).

### macOS / Linux / Windows (PowerShell)

```bash
# 1. install (same command on all three OSes)
npm install -g github:Subaru486desuwa/mochiapi-statusline

# 2. interactive setup — paste your MochiAPI token when prompted
mochiapi-statusline --mochiapi-setup
```

Grab your token from <https://mochiapi.com/dashboard> first; the setup will paste it into the right place. By default `--mochiapi-setup` will:

1. Save your token + base URL to `~/.config/mochiapi-statusline/config.json` (or `%APPDATA%\mochiapi-statusline\config.json` on Windows)
2. Probe the balance endpoint to confirm the token works
3. Write the recommended **dracula three-line powerline layout** to `~/.config/ccstatusline/settings.json` (or merge a Mochi balance row into an existing one)
4. Point Claude Code's `~/.claude/settings.json` `statusLine.command` at `mochiapi-statusline`

Open a fresh Claude Code session and the status line should light up.

The pre-built `dist/ccstatusline.js` is committed in the repo and the package declares no `prepare` script, so neither install path triggers a local build — the bundled binary drops straight in.

> ℹ️ **Alternative form:** `npm install -g https://github.com/Subaru486desuwa/mochiapi-statusline/archive/refs/heads/main.tar.gz`. Equivalent — tarball is a smaller download, github: shorthand clones the repo.

### Non-interactive / scripted

Set both env vars before running setup:

```bash
MOCHIAPI_TOKEN=sk-xxxx MOCHIAPI_BASE_URL=https://mochiapi.com mochiapi-statusline --mochiapi-setup
```

### Skip parts of the auto-setup

```bash
mochiapi-statusline --mochiapi-setup --skip-statusline    # don't touch ~/.config/ccstatusline/settings.json
mochiapi-statusline --mochiapi-setup --skip-claude-wire   # don't touch ~/.claude/settings.json
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
npm install -g github:Subaru486desuwa/mochiapi-statusline

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
- `balance` (default)  remaining only — `$X`, or `∞` for unlimited tokens
- `used`  consumed only — `$X used`
- `combined`  both sides — `$X left · $Y used`, or `∞ · $Y used` for unlimited
- `percent`  `used / total * 100`

> ℹ️ The dashboard API today exposes the **token's** hard limit and 30-day usage, not the user's **account balance**. Unlimited tokens (`hard_limit_usd ≥ 1e7`) therefore show `∞` in the balance/percent modes. When the dashboard exposes a real account-level balance endpoint, this widget will switch to showing that — until then, `balance` is the closest "remaining" signal we have.

A trailing `*` means the cached value is older than `2 × refreshIntervalSec` — usually the network or the upstream went away. The widget keeps rendering the last good number while the background refresher retries.

## What the default layout looks like

The dracula three-line layout that `--mochiapi-setup` writes to `~/.config/ccstatusline/settings.json`:

- **Line 1**: `模型 / Sonnet 4.6 (1M context) / 上下文 / <tokens> / <branch> / <changes>` — branch+changes auto-hide outside a git repo (`hideNoGit` flag); the model name keeps its `(1M context)` suffix (`keepContext` flag, fork-only).
- **Line 2**: `时段用量 / 5.0% / 时段 / 3h41m / 重置 / 1h18m / 周用量 / 12.0% / TPS / <t/s>`
- **Line 3**: `用户余额 / ∞` (unlimited token) or `用户余额 / $5.86` (limited) — MochiAPI Balance widget in `balance` mode.

To customize, launch the TUI: `mochiapi-statusline`. To inspect or hand-edit the JSON, look at `~/.config/ccstatusline/settings.json` (macOS / Linux) or `%USERPROFILE%\.config\ccstatusline\settings.json` (Windows). That file is the upstream ccstatusline TUI's settings — distinct from `~/.config/mochiapi-statusline/config.json` which holds your token.

### Smoke test without launching Claude Code

```bash
# macOS / Linux
echo '{"session_id":"test","model":{"id":"claude-sonnet-4-6","display_name":"Sonnet 4.6 (1M context)"},"workspace":{"current_dir":".","project_dir":"."},"cost":{"total_cost_usd":0},"transcript_path":"/tmp/nonexistent","output_style":{"name":"default"}}' | mochiapi-statusline
```

```powershell
# Windows PowerShell
'{"session_id":"test","model":{"id":"claude-sonnet-4-6","display_name":"Sonnet 4.6 (1M context)"},"workspace":{"current_dir":".","project_dir":"."},"cost":{"total_cost_usd":0},"transcript_path":"NUL","output_style":{"name":"default"}}' | mochiapi-statusline
```

Three Powerline-styled rows in dracula colors. If separators show as `?` your terminal isn't using a Nerd Font — fix that first.

## Cross-platform notes

- Node ≥ 14 (matches upstream's `target=node14` build).
- macOS, Linux, Windows are all first-class. Path resolution branches on `os.platform()`.
- The refresher uses `child_process.spawn(detached:true, stdio:'ignore', ...).unref()`. Works on all three OSes; on Windows the spawned process attaches to the same console group but never writes to stdout.
