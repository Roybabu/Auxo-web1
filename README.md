# Auxo Web

Offline-first retail/restaurant point-of-sale web app. A fresh web counterpart to the Auxo
Android app, built independently against the same business rules and backup format.

## Status

Early scaffolding. See `docs/` and the open stages in the project task list for current progress.

## Structure

- `apps/web` — the installable PWA (Vite + React + TypeScript).
- `packages/core` — framework-free business rules (tax, discounts, invoice numbers, loyalty,
  ledger/aging, permissions, stock movements). No browser APIs; storage, backup and printing sit
  behind interfaces this package defines but does not implement.

## Development

```sh
pnpm install
pnpm dev        # run the web app
pnpm typecheck  # type-check all packages
pnpm lint       # lint all packages
pnpm test       # run all tests
```

## Data and privacy

Everything runs locally in the browser. There is no server and no account system. Data is
stored in the browser's private origin-scoped storage (OPFS) and can be exported to an
encrypted backup file, compatible with the Android app's backup format, or a neutral JSON
export.

## Licence

GPL-3.0-or-later, same as the Android app. See [LICENSE](./LICENSE).
