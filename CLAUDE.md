# CLAUDE.md — mySpark

AI operating file for this repository. Read this first, every session. Then read the files it points to before starting a task.

## What this project is

mySpark is a personal controller for the owner's Positive Grid **Spark GO** and **Spark LIVE** amplifiers over Bluetooth Low Energy (BLE). Near-term goal: a **working controller** that can read and change presets, effects, and parameters on those amps.

- **Not a Spark 2 project.** The owner has no Spark 2. The Spark 2 docs in `docs/` are reference only (ADR-0002).
- **Spark LIVE** — guitar channel speaks the **Spark 2 protocol**: every core operation verified on the owner's LIVE via SparklingTones (2026-09-28). Details: `knowledge/lessons-learned.md`.
- **Spark GO** — Spark 40-family protocol per soundshed (SOURCED, not yet tested).
- Plan: port SparklingTones' protocol/transport to TypeScript with attribution (ADR-0003).

- Targets: **Windows PC (web)** and **Android**, with the same functions on both — build once, run in both places.
- Delivery for Android (PWA via Web Bluetooth vs. Capacitor wrapper) is **undecided**. # TO CONFIRM: Android delivery — see ADR-0001.
- Stage: greenfield. The code in `src/` is a protocol/client skeleton, not yet tested against real hardware.
- Team: one person (owner) holds the developer, lead, and security-owner roles.

## Stack

- TypeScript 5.7, `strict: true`, target ES2022, `module`/`moduleResolution: NodeNext`
- npm; `tsx` for dev; `tsc` for build (`npm run build` → `dist/`)
- Tests: Vitest (to be added — see `planning/tasks.md`)
- Lint/format: ESLint + Prettier, default settings (to be added)
- Persistence: local JSON files for preset backups/exports. The amp remains the source of truth.

## Read before working

| File | What it governs |
|---|---|
| `ai/ai-security-baseline.md` | Non-negotiable prohibitions. Always in effect. |
| `ai/ai-team-charter.md` | What the AI may do, may not do, and what needs human approval |
| `docs/security.md` | Amp-safety rules, secrets, banned operations |
| `docs/architecture.md` | Stack, architecture, dependencies; links to protocol docs |
| `docs/coding-standards.md` | Style, naming, patterns |
| `docs/testing-standards.md` | Vitest, required tests |
| `docs/official-sources.md` | Which sources are authoritative, in priority order |
| `knowledge/approved-patterns.md` | Confirmed patterns |
| `knowledge/lessons-learned.md` | Known issues and pitfalls — read before touching `src/spark/` |
| `planning/tasks.md` | Approved work. Only work on what is here. |
| `planning/ideas.md` | Unapproved ideas. Suggestions go here, not into code. |
| `docs/decisions/` | Architecture Decision Records |

Protocol and architecture references: `docs/spark-interface-spec.md`, `docs/spark2-bt-protocol.md`, `docs/sources-used.md`.

## The rules that matter most

1. **The amp is the source of truth.** Local state and JSON files are caches/projections. A write is only successful after it is read back from the amp and confirmed.
2. **Never invent protocol details.** This is the owner's biggest concern. Every protocol claim (command bytes, offsets, encodings, GATT UUIDs, behaviors) must carry a verification status:
   - `VERIFIED-HW` — confirmed by the owner on their Spark GO or Spark LIVE (name which)
   - `SOURCED` — documented in SparklingTones (or another listed source), not yet hardware-verified — cite the source
   - `UNVERIFIED` — inferred, guessed, or placeholder
   Mark it in a code comment next to the constant, and in docs. If you don't know, say so and mark it `UNVERIFIED` — never present a guess as fact.
3. **Models differ.** Sources mix Spark 40, Mini, GO, 2, and LIVE. Always name the model a detail comes from, and never assume it carries over to the GO or LIVE without evidence. Detect the model at connect time; don't hardcode one model's slot count or ACK behavior.
4. **Human approval + hardware test required** for any code that changes live amp state or writes to saved preset slots.
5. **Firmware update and system-level commands are banned.** Never implement them.
6. **Source priority:** the owner's amps > SparklingTones > soundshed > other repos (ADR-0003). SparklingTones is proven on the owner's Spark LIVE; soundshed is the Spark GO reference.
7. New ideas go to `planning/ideas.md`. Work only on `planning/tasks.md` items.
8. When a change modifies an approved pattern or architecture decision, update the matching doc in the same change.

## Conventions (summary — full detail in `docs/coding-standards.md`)

- camelCase for variables/functions, PascalCase for types/interfaces/classes/enums
- Relative imports use `.js` suffixes (NodeNext)
- Named exports
- Hex literals lowercase (`0xf0`)

## Commands

```bash
npm install
npm run build     # tsc → dist/
npm run dev       # tsx watch src/index.ts
npm start         # node dist/index.js
```

## Session limits to remember

- The AI cannot reach the amp. All hardware verification is done by the owner.
- The AI starts every session with no memory of prior ones. If it isn't in this repo, the AI doesn't know it.
