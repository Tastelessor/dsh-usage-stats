# dsh-token-usage

English | [中文](README.zh.md)

An external plugin for **DeepSeek Harness** (`dsh`): adds a **Token Usage** page to the
Web settings panel, showing line charts of token usage and estimated spend over the past
7 / 15 / 30 days, plus a per-model price table (per 1M tokens) with inline editing of
prices per currency (CNY / USD) **and per period (peak / off-peak)**.

Data comes from the `usage` field carried by `assistant/message` events in persisted
session logs — the plugin is a pure observer: it never touches the agent loop and never
reports anything to an external service.

## Features

- **Settings → Token Usage**: one-click range switch (7 / 15 / 30 days), token line charts (total / input / output / cache hit / cache write / reasoning), spend line charts (CNY and USD series), hover tooltips with exact values.
- **Summary cards**: total tokens, daily average, average cache hit rate, estimated spend (CNY and USD side by side).
- **Model price table**: per-model prices in **CNY and USD**, each split into **peak / off-peak** tiers, for every connected model (from the `ctx.llm` model catalog); ships the official 2026-08-17+ tiered defaults for `deepseek-v4-flash` and `deepseek-v4-pro`.
- **Price editing**: switch the table's currency *and* period (peak / off-peak), edit prices inline, hit "Save prices" to persist — stats refresh with the new prices instantly (no restart).
- **Time-of-day billing**: every call's spend is resolved from its own event timestamp — calls during Beijing peak hours (09:00–12:00, 14:00–18:00) are billed at the peak tier, all others at the off-peak tier.
- **Performance**:
  - Server side prunes session logs by file mtime, reads with bounded concurrency (8 by default), and caches responses for 30s — measured 69 sessions dropping from 12.8s to ~1s (hot cache <1ms).
  - The client prefetches all three windows in parallel at activation and keeps a 30s local cache — **range switches render instantly** (no loading flash, no extra requests).

## Screenshots

![Token usage page (charts + summary cards)](docs/screenshots/img-0.png)

![Token usage page (price table)](docs/screenshots/img-1.png)

## Install

This plugin installs directly into the **native Web profile** of DeepSeek Harness (`web`
is a built-in profile shipped with the distribution; `dsh web` is a hardcoded alias for
`--profile web`). Once installed, **no profile flag is needed at launch** — run
`pnpm dsh web` from the harness checkout and the plugin is loaded.

### npm (prebuilt, zero permissions)

```sh
dsh plugin --profile web add dsh-token-usage
```

### GitHub direct install (source + prepare self-build, allowlisted once)

```sh
dsh plugin --profile web add github:Tastelessor/dsh-token-usage#<commit-sha>
# If the first add fails, add the package key pnpm printed to the web
# profile's pnpm-workspace.yaml:
#   $DSH_HOME/profiles/web/pnpm-workspace.yaml
#   allowBuilds:
#     dsh-token-usage: true
# then re-add.
```

### Local path

```sh
dsh plugin --profile web add /path/to/dsh-token-usage
```

`dsh plugin add ./` uses a pnpm link and does **not** run `prepare` — run `pnpm build`
first, then add.

### Launch

```sh
pnpm dsh web        # from the DeepSeek Harness checkout; web is the built-in profile, no --profile
```

## Configuration (price table)

Override in the web profile's `cordis.patch.yml` (`$DSH_HOME/profiles/web/cordis.patch.yml`,
or via a `--patch` overlay); the two currencies are configured independently, each model
entry holds a `peak` / `offPeak` pair, and unset entries fall back to the built-in defaults:

```yaml
- patch:
    - id: dsh-token-usage
      config:
        currency: CNY        # preferred currency: CNY (default, ¥) / USD ($)
        models:
          deepseek-v4-flash:
            cny:             # CNY prices (¥ / 1M tokens)
              peak:          # Beijing 09:00–12:00, 14:00–18:00
                inputPerM: 3.0         # input, cache miss
                cacheReadPerM: 0.10    # input, cache hit
                outputPerM: 9.0       # output
                cacheWritePerM: 0      # not billed by the official v4 pricing
              offPeak:       # all other hours (half of peak)
                inputPerM: 1.5
                cacheReadPerM: 0.05
                outputPerM: 4.5
                cacheWritePerM: 0
            usd:             # USD prices ($ / 1M tokens)
              peak:
                inputPerM: 0.44
                cacheReadPerM: 0.014
                outputPerM: 1.32
                cacheWritePerM: 0
              offPeak:
                inputPerM: 0.22
                cacheReadPerM: 0.007
                outputPerM: 0.66
                cacheWritePerM: 0
```

> Legacy flat entries (a bare `inputPerM` / `cacheReadPerM` / `outputPerM` /
> `cacheWritePerM` block, as in pre-2026-08-17 configs) still parse and are treated as
> "the same price at all hours" — both tiers equal.
>
> The built-in defaults (`src/host/config.ts`) match the official prices below; the
> in-page "Save prices" button writes exactly the `models.<id>.cny|usd` shape shown here
> (both tiers) — no manual config editing needed.

### Official prices (verified against api-docs.deepseek.com, 2026-08-18)

DeepSeek bills time-of-day tiers since 2026-08-17: **peak hours are Beijing time
09:00–12:00 and 14:00–18:00; off-peak is half of peak** (¥ / $ per 1M tokens,
cache hit / miss / output):

| Model | Off-peak CNY | Peak CNY | Off-peak USD | Peak USD |
|---|---|---|---|---|
| deepseek-v4-flash | 0.05 / 1.5 / 4.5 | 0.10 / 3.0 / 9.0 | $0.007 / $0.22 / $0.66 | $0.014 / $0.44 / $1.32 |
| deepseek-v4-pro | 0.15 / 4.5 / 13.5 | 0.30 / 9.0 / 27.0 | $0.022 / $0.66 / $1.98 | $0.044 / $1.32 / $3.96 |

> Spend estimation resolves each usage event's own timestamp against these windows
> (Beijing time, UTC+8 — independent of the host's timezone), so peak-hour calls and
> off-peak calls land on their correct rates automatically.

> Implementation note: dsh's web settings API (`settings.mutate`) only exposes a
> hardcoded allowlist of host namespaces — external plugin namespaces are rejected
> (`settings-not-exposed`) — so price write-back goes through the plugin's own
> `POST /dsh-token-usage/prices` route, which calls `ctx.settings` in-process (exactly
> equivalent to hand-editing the config).

## Known limitations / disclaimer

- Amounts are **estimates** (built-in price table × the four real token buckets), not provider invoices; prices are subject to change — always check the official pricing page.
- Spend is estimated in CNY and USD simultaneously; the two currencies have independent price tables.
- A 30s response cache means an estimate around a peak-window boundary (09:00 / 12:00 / 14:00 / 18:00 Beijing time) can lag the tier switch by at most 30 seconds.
- `reasoningTokens` is a subset of output tokens and is never counted twice.
- Models with no price configured in either currency: tokens are still counted, spend is not, and the page shows "Not configured".
- Aggregation runs in the node half in memory with only a 30s short-lived cache; with very large data volumes the first load may still take a few seconds (subsequent range switches render instantly from the client's prefetch cache).

## Development

```sh
pnpm install     # install deps (peers are provided by the dsh profile at runtime)
pnpm test        # vitest, 72 tests
pnpm typecheck   # tsc --noEmit
pnpm build       # tsdown build into lib/
```

## License

[MIT](LICENSE)
