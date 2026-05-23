<div align="center">

# mochiapi-statusline

**Claude Code status line for [MochiAPI](https://mochiapi.com) users.**
One command to install. Account balance, today's spend, and model / context / git in your terminal.

[![npm version](https://img.shields.io/npm/v/mochiapi-statusline.svg)](https://www.npmjs.com/package/mochiapi-statusline)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js Version](https://img.shields.io/badge/node-%E2%89%A514-brightgreen.svg)](https://nodejs.org)

</div>

---

## Install

Requires **Node.js ≥ 14**. One command — installs the package, then runs the interactive setup:

```bash
npm install -g mochiapi-statusline && mochiapi-statusline --mochiapi-setup
```

Works in bash, zsh, fish, PowerShell 7+, and `cmd.exe`. The `&&` chains install → setup.

> **Windows PowerShell 5.1** (Windows 10 default) doesn't support `&&`. Run the two halves separately:
> ```powershell
> npm install -g mochiapi-statusline
> mochiapi-statusline --mochiapi-setup
> ```

Grab your token from <https://mochiapi.com/dashboard> first; the setup will paste it into the right place. `--mochiapi-setup` does four things:

1. Saves token + base URL → `~/.config/mochiapi-statusline/config.json` (or `%APPDATA%\mochiapi-statusline\config.json` on Windows)
2. Probes the balance endpoint to confirm the token works
3. Writes the recommended **Mochi 2-line Powerline layout** to `~/.config/ccstatusline/settings.json` (or appends a Mochi billing row to an existing layout)
4. Points Claude Code's `~/.claude/settings.json` `statusLine.command` at `mochiapi-statusline`

Open a fresh Claude Code session and the status line lights up.

> **Windows + Powerline:** the default layout uses Nerd Font glyphs as separators. Without a Nerd Font you'll see `?` boxes. Install one and set it as the terminal font:
>
> ```powershell
> winget install DEVCOM.JetBrainsMonoNerdFont
> ```

The pre-built `dist/ccstatusline.js` ships inside the npm tarball and the package declares no `prepare` / `postinstall` script — install drops the bundled binary straight in, no local build, no surprise scripts.

### Alternative install sources

Use these only if the npm registry is blocked, or if you want to track `main` HEAD ahead of a tagged release:

```bash
# Track main HEAD (rolling, no version pinning)
npm install -g github:Subaru486desuwa/mochiapi-statusline

# Pin to a specific git tag
npm install -g github:Subaru486desuwa/mochiapi-statusline#v0.1.0

# Tarball (smallest download, equivalent to github: shorthand)
npm install -g https://github.com/Subaru486desuwa/mochiapi-statusline/archive/refs/heads/main.tar.gz
```

## What the default layout shows

Two Powerline rows in Mochi colors:

- **Line 1** — `模型 / Sonnet 4.6 (1M context) / 上下文 / <tokens> / <branch> / <changes>` (branch + changes auto-hide outside a git repo)
- **Line 2** — `用户余额 / $1.540 / 今日消耗 / $0.277 / TPS / <t/s>` (MochiAPI account balance + today's spend + token output speed)

The `mochiapi-subscription` widget (`余额 $X.XX · 今日 $Y.YY · 订阅 $Z.ZZ/∞` all-in-one) is still available — just not in the default layout, since most MochiAPI relay users have `订阅 ∞` anyway. Add it manually from the TUI widget picker if you want it.

## MochiAPI widgets

Three widgets fed from the same cached `/api/user/dashboard/balance` response:

| Widget type | Renders | Default color |
|---|---|---|
| `mochiapi-balance` | Account remaining balance — `$X.XX` or `∞` for unlimited accounts | cyan |
| `mochiapi-daily-spend` | Today's spend — `$X.XX` | magenta |
| `mochiapi-subscription` | `余额 $X.XX · 今日 $Y.YY · 订阅 $Z.ZZ/∞` (not in default layout) | cyan |

A trailing `*` on a value means the cached number is older than `2 × refreshIntervalSec` (usually a transient upstream issue) — the widget keeps rendering the last good value while the background refresher retries. Cache is refreshed in a detached subprocess every `refreshIntervalSec` (default 30s).

## CLI

```bash
# rerun the interactive setup
mochiapi-statusline --mochiapi-setup

# non-interactive (CI / scripted)
MOCHIAPI_TOKEN=sk-xxxx MOCHIAPI_BASE_URL=https://mochiapi.com \
  mochiapi-statusline --mochiapi-setup

# only write the mochi config — don't touch ccstatusline / Claude Code settings
mochiapi-statusline --mochiapi-setup --skip-statusline --skip-claude-wire

# one-shot cache refresh (also runs in the background every 30s)
mochiapi-statusline --mochiapi-refresh

# launch the TUI to customize widgets / colors / layout / Powerline
mochiapi-statusline
```

## Upgrade / uninstall

```bash
# upgrade to the latest published version
npm install -g mochiapi-statusline@latest

# uninstall
npm uninstall -g mochiapi-statusline
```

## File locations

| | macOS / Linux | Windows |
|---|---|---|
| MochiAPI token + baseUrl | `~/.config/mochiapi-statusline/config.json` | `%APPDATA%\mochiapi-statusline\config.json` |
| Balance cache | `~/.cache/mochiapi-statusline/balance.json` | `%LOCALAPPDATA%\mochiapi-statusline\cache\balance.json` |
| Status line layout | `~/.config/ccstatusline/settings.json` | `%USERPROFILE%\.config\ccstatusline\settings.json` |
| Claude Code | `~/.claude/settings.json` | `%USERPROFILE%\.claude\settings.json` |

The token config and the layout config are **two different files**: edit the first to change auth, edit the second (or use the TUI) to change what's rendered.

## Troubleshooting

| Status line shows | Meaning | Fix |
|---|---|---|
| `Mochi: cfg?` | `config.json` not found | rerun `mochiapi-statusline --mochiapi-setup` |
| `Mochi: ...` | cache hasn't been populated yet | `mochiapi-statusline --mochiapi-refresh`, or wait 30 s |
| `$X.XX*` (trailing `*`) | cached value is stale | usually transient; the background refresher retries automatically |
| Separators show as `?` | terminal isn't using a Nerd Font | install a Nerd Font and set it as the terminal font |

Pipe a fake Claude Code payload to render once without launching Claude Code:

```bash
echo '{"session_id":"test","model":{"id":"claude-sonnet-4-6","display_name":"Sonnet 4.6 (1M context)"},"workspace":{"current_dir":".","project_dir":"."},"cost":{"total_cost_usd":0},"transcript_path":"/tmp/nonexistent","output_style":{"name":"default"}}' \
  | mochiapi-statusline
```

## Endpoint contract

| Path | Returns |
|---|---|
| `GET ${baseUrl}/api/user/dashboard/balance` | Account-level fields + today's spend (one request feeds all three widgets) |

Bearer auth (`Authorization: Bearer sk-...`). No cookies, no session.

Fields read from the response:

| API field | Used by |
|---|---|
| direct balance fields (`user_balance_usd`, `user_remain_quota_usd`, `balance_usd`, …) — when the API returns one | balance widget (preferred path) |
| `data.user_quota_usd` − `data.user_used_quota_usd` | balance widget (fallback when no direct field) |
| `data.today_used_quota_usd` | daily-spend widget |
| `data.token_remain_quota_usd` + `data.token_unlimited` | subscription widget |

## Acknowledgements

The underlying status-line engine is forked from [sirmalloc/ccstatusline](https://github.com/sirmalloc/ccstatusline) (MIT, © Matthew Breedlove). MochiAPI-specific additions only:

- `mochiapi-balance` / `mochiapi-daily-spend` / `mochiapi-subscription` widgets
- `--mochiapi-setup` / `--mochiapi-refresh` CLI flags
- One-shot setup wiring (config file + layout + Claude Code `statusLine.command`)

Everything else — TUI, themes, layout, Powerline rendering, the other ~20 widgets — is upstream code. For deep customization, the upstream README and TUI docs apply unchanged.

## License

MIT — see [LICENSE](LICENSE) and [NOTICE](NOTICE).
