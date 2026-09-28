# Architecture — mySpark

Overview of how mySpark is built. Detailed protocol and state-model docs already exist and remain authoritative for their topics:

- `docs/spark2-bt-protocol.md` — Spark 2 system architecture, state model, read/write architecture, invariants
- `docs/spark-interface-spec.md` — GATT layout, framing, encoding, command model, write verification
- `docs/sources-used.md` — where that knowledge came from

Those docs are **SOURCED** (from SparklingTones and related projects), not hardware-verified. See `docs/official-sources.md` for authority order.

**Those docs describe the Spark 2, which is not a target (ADR-0002).** Their general architecture (amp as source of truth, write verification, live vs. saved state) still applies. Their byte-level details do not carry over to the GO or LIVE without evidence.

## Purpose

Personal controller for the owner's Positive Grid **Spark GO** and **Spark LIVE** over BLE: read and change presets, effects, and parameters, and back up presets to local JSON files.

## Target amps

| Model | Protocol knowledge | Status |
|---|---|---|
| Spark GO | Spark 40-family per soundshed: service `ffc0`, write `ffc1`, notify `ffc2`, 4 slots, `04` chunk ACKs, no live sync, writes sized by MTU | SOURCED (soundshed) — first target |
| Spark LIVE | No public docs. SparklingTones (Spark 2 app) reads it fully: BLE name `Spark LIVE BLE`, service `ffc0`, **8 slots (A1–A4, B1–B4)**, Spark 2-style get-preset and decoding | VERIFIED-HW (owner, via SparklingTones, 2026-09-28): read all slots, live buffer upload `0x7f`, preset switch, knob change `0x0104`, effect on/off `0x0115`, model change `0x0106`, slot write. **UNVERIFIED:** BPM/looper, power-cycle persistence, non-guitar channels |

The model is detected at connect time (BLE device name, then `02 11` get-amp-name if confirmed). Per-model behavior (slot count, ACK flow, write size) lives in a model profile, not in hardcoded constants.

## Platforms

- Windows PC — web app
- Android — same functions, same code: PWA in Chrome using Web Bluetooth (ADR-0004, accepted). Capacitor wrapper only if the Android test fails or Play Store is needed.
- Goal: build once, run in both places. Interfaces are similar across platforms.

## Stack

| Area | Choice | Status |
|---|---|---|
| Language | TypeScript 5.7, `strict` | in place |
| Module system | ES2022, NodeNext | in place |
| Package manager | npm | in place |
| Build | `tsc` → `dist/` | in place |
| Dev runner | `tsx` | in place |
| Tests | Vitest | planned |
| Lint / format | ESLint + Prettier (defaults) | planned |
| CI | GitHub Actions | later |
| UI framework | — | # TO CONFIRM |
| BLE access | Web Bluetooth (PC + Android) | ADR-0004 — Android verified 2026-09-28 |
| Persistence | Local JSON files (preset backups/exports) | planned |

## Layers (from `docs/spark2-bt-protocol.md`)

1. **Device** — the amp; holds live sound, saved slots, effect state. Source of truth.
2. **Transport** — BLE, fragmentation/reassembly, write-without-response on `0xFFC1`, notify on `0xFFC2` (SOURCED).
3. **State** — structured model of live preset, saved presets, effects, parameters (`src/spark/types.ts`).
4. **UI** — not built yet.

Current code:
- `src/spark/protocol.ts` — frame codec (`F0 01 … F7`). See lessons-learned: command values and packing are not yet correct/verified.
- `src/spark/types.ts` — state model types
- `src/spark/client.ts` — `SparkBtClient` over an abstract `SparkTransport`
- `src/index.ts` — demo entry point

## Architectural invariants

- The amp is the source of truth; local state and JSON files are projections/caches.
- Write success requires read-back verification.
- Live state and saved slots are separate concerns.
- Firmware/system commands are out of scope and banned.

## Approved dependencies

Runtime: none yet.
Dev: `typescript`, `tsx`, `@types/node`.
Approved to add: `vitest`, `eslint`, `prettier` (and their standard TypeScript plugins/configs).
Policy: pragmatic — well-maintained dependencies are acceptable, but every new one is flagged for owner approval first.

## Decisions

See `docs/decisions/`. Architecture authority: the owner. Process: AI drafts an ADR, owner approves.
