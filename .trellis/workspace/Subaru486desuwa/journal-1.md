# Journal - Subaru486desuwa (Part 1)

> AI development session journal
> Started: 2026-06-06

---



## Session 1: MochiAPI subscription widget + rebrand to MochiAPI Statusline (0.2.0)

**Date**: 2026-06-06
**Task**: MochiAPI subscription widget + rebrand to MochiAPI Statusline (0.2.0)
**Branch**: `main`

### Summary

Added a user-selectable MochiAPI subscription-usage widget (percent used + reset countdown) backed by new /api/usage/token/ subscription_* fields; extended MochiApiCache/viewFromCache parsing + a shared countdown formatter, and switched the summary widget's subscription segment to the same format. Made [订阅, 钱包余额, 今日消耗] the default --mochiapi-setup layout. Then fully de-branded the inherited ccstatusline naming to 'MochiAPI Statusline': TUI/CLI strings, in-TUI installer commands + GitHub URL (fixed a bug where it wired the upstream package), config dir ~/.config/ccstatusline -> mochiapi-statusline with a non-destructive fallback migration, cache dirs + managed-hook tag (legacy tag still cleaned), and entry/artifact rename (src/mochiapi-statusline.ts, dist/mochiapi-statusline.js); tests/docs/cSpell updated in lockstep, upstream attribution kept. Released 0.1.3 -> 0.1.4 -> 0.2.0 to npm + GitHub main. lint clean; 1294 tests pass (1 known proxy-env false positive).

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `d3b1754` | (see git log) |
| `8db8325` | (see git log) |
| `50fe496` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete
