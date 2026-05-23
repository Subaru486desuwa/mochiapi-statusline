# AGENTS.md

Guidance for Claude Code / Cursor / other AI agents working in this repo.

## Project overview

`mochiapi-statusline` is a Claude Code status line forked from [sirmalloc/ccstatusline](https://github.com/sirmalloc/ccstatusline) with a [MochiAPI](https://mochiapi.com) account-balance widget and a one-shot setup CLI.

Two runtime modes:
1. **Piped** — Claude Code pipes a JSON status payload on stdin; the binary renders a status line on stdout.
2. **Interactive** — without piped input, launches a React / Ink TUI for editing widgets, colors, layout, and Powerline separators.

## Dev commands

```bash
bun install
bun run start                     # interactive TUI
bun run example                   # render a sample payload
bun run build                     # → dist/ccstatusline.js (Node 14+ target)
bun test                          # vitest
bun run lint                      # tsc --noEmit + eslint, no auto-fix
bun run lint:fix                  # eslint with --fix
```

Always use Bun (`bun <file>`, `bun install`, `bun run <script>`) instead of node / npm / ts-node. Bun loads `.env` natively — don't add `dotenv`.

## MochiAPI-specific surface

Intentionally small. Touch these when working on Mochi features; everything else under `src/` is upstream code.

- `src/widgets/MochiApiBalance.ts` — `mochiapi-balance` widget
- `src/widgets/MochiApiDailySpend.ts` — `mochiapi-daily-spend` widget
- `src/widgets/MochiApiSubscription.ts` — `mochiapi-subscription` widget
- `src/utils/mochiapi.ts` — HTTP client + on-disk config/cache, response field parsing
- `src/utils/mochiapi-setup.ts` — `--mochiapi-setup` / `--mochiapi-refresh` CLI flows

## Build process

```
bun build src/ccstatusline.ts → dist/ccstatusline.js (Node 14+ target)
scripts/replace-version.ts    → substitutes __PACKAGE_VERSION__ from package.json
```

`dist/` **is committed** so `npm install -g github:Subaru486desuwa/mochiapi-statusline` works without a local build. No `prepare` / `postinstall` script is declared.

## Patches

- **ink@6.2.0 backspace fix** (`patches/ink@6.2.0.patch`) — ink treats `\x7f` (macOS backspace) as delete; the patch maps it to backspace. Applied automatically by `bun install` via `patchedDependencies` in `package.json`.

## Lint rules

- Never disable an ESLint rule with `// eslint-disable-*` comments.
- Always run checks via `bun run lint`. Never invoke `npx eslint`, `eslint`, `tsx`, `bun tsc`, or other direct variants — the wrapper picks the right config + TypeScript version.

## Testing

Vitest via Bun. Tests live next to code under `src/**/__tests__/`. Run `bun test` or `bun test --watch`.
