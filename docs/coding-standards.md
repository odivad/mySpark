# Coding Standards — mySpark

## Tooling

- **Type checking:** `tsc` with `strict: true` (in place).
- **Style checker:** ESLint, default recommended TypeScript config. # TO CONFIRM: not yet installed — config file location will be recorded here when added.
- **Formatter:** Prettier, default settings. # TO CONFIRM: not yet installed.

## Keep the existing style

Confirmed in the setup session: follow the style already in `src/`.

- camelCase for variables, functions, methods, properties (`nextSequence`, `requestState`)
- PascalCase for types, interfaces, classes, enums (`SparkFrame`, `SparkBtClient`, `SparkCommand`)
- Domain types prefixed with `Spark` (`SparkPreset`, `SparkEffect`)
- Named exports; no default exports
- Relative imports use the `.js` suffix (required by NodeNext)
- Hex literals lowercase with `0x` prefix (`0xf0`, `0xf7`)
- Files in lowercase (`protocol.ts`, `client.ts`, `types.ts`) under `src/spark/`
- `readonly` for fields that don't change after construction

## Protocol code: verification status labels

Every protocol constant or behavior in code gets a comment with its status:

```ts
// SOURCED: SparklingTones docs/protocollo-spark2.en.md — start delimiter
static readonly START = 0xf0;

// UNVERIFIED: placeholder value, not from any source
ReadState = 0x01,
```

Statuses: `VERIFIED-HW` (owner confirmed on their Spark GO or Spark LIVE — name which), `SOURCED` (cite source), `UNVERIFIED`. Only the owner may mark something `VERIFIED-HW`.

## Patterns

- **Amp is the source of truth** — see `knowledge/approved-patterns.md`.

## Error handling

Current code throws `Error` with a descriptive message including hex values (e.g. `Checksum mismatch: expected 0x.., got 0x..`). # TO CONFIRM: no standard logging pattern yet.

## Banned patterns

- Firmware/system-level amp commands (see `docs/security.md`).
- Hardcoded secrets anywhere, including tests.
