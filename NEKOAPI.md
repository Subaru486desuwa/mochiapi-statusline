# ccstatusline-nekoapi

Fork of [sirmalloc/ccstatusline](https://github.com/sirmalloc/ccstatusline) with a `NekoAPI Balance` widget for the [NekoAPI](https://nekoapi.cc) gateway.

## What changed vs upstream

- New widget type `nekoapi-balance` (display name "NekoAPI Balance", category "NekoAPI")
- New CLI flags:
  - `--nekoapi-setup`  interactive (or env-driven) config writer + connectivity probe
  - `--nekoapi-refresh`  one-shot cache refresh (used internally by the widget)
- New runtime files:
  - `src/utils/nekoapi.ts`  HTTP client + on-disk config/cache helpers
  - `src/utils/nekoapi-setup.ts`  CLI setup flow
  - `src/widgets/NekoApiBalance.ts`  widget render logic
- Package renamed to `ccstatusline-nekoapi`, binary `ccstatusline-nekoapi`

Everything else (widgets, TUI, layout, powerline, themes) is untouched and tracks upstream.

## Endpoints used

| Path | Returns | Notes |
|---|---|---|
| `GET ${baseUrl}/v1/dashboard/billing/subscription` | `{ hard_limit_usd, soft_limit_usd, access_until }` | unlimited tokens return `1e8` |
| `GET ${baseUrl}/v1/dashboard/billing/usage?start_date&end_date` | `{ total_usage }` (cent = USD × 100) | 30-day window by default |

Bearer auth (`Authorization: Bearer sk-...`). No cookies, no session.

## Install

```bash
npm install -g ccstatusline-nekoapi
```

## Configure

```bash
# Non-interactive (CI / one-liner from the nekoapi.cc web UI)
NEKOAPI_BASE_URL=https://nekoapi.cc NEKOAPI_TOKEN=sk-xxxx ccstatusline-nekoapi --nekoapi-setup

# Or interactive
ccstatusline-nekoapi --nekoapi-setup
```

Writes:
- Linux/macOS: `~/.config/ccstatusline-nekoapi/config.json`
- Windows: `%APPDATA%\ccstatusline-nekoapi\config.json`

Cache (refreshed in a detached subprocess every `refreshIntervalSec`, default 30s):
- Linux/macOS: `~/.cache/ccstatusline-nekoapi/balance.json`
- Windows: `%LOCALAPPDATA%\ccstatusline-nekoapi\cache\balance.json`

## Use in Claude Code

`~/.claude/settings.json`:

```json
{ "statusLine": { "type": "command", "command": "ccstatusline-nekoapi" } }
```

Run the TUI to add the widget to a line:

```bash
ccstatusline-nekoapi
# → pick a line → Add widget → search "NekoAPI"
```

## Widget options

`metadata.mode` (string):
- `combined` (default)  `$balance / $used`
- `balance`  remaining only
- `used`  consumed only
- `percent`  `used / total * 100`

Unlimited tokens (`hard_limit_usd ≥ 1e7`) show `∞` (`balance`/`percent` modes) or `∞ · $used` (`combined`).

A trailing `*` means the cached value is older than `2 × refreshIntervalSec` — usually the network or the upstream went away. The widget keeps rendering the last good number while the background refresher retries.

## Cross-platform notes

- Node ≥ 14 (matches upstream's `target=node14` build).
- macOS, Linux, Windows are all first-class. Path resolution branches on `os.platform()`.
- The refresher uses `child_process.spawn(detached:true, stdio:'ignore', ...).unref()`. Works on all three OSes; on Windows the spawned process attaches to the same console group but never writes to stdout.
