# Tasks — approved work

Only the owner moves items here from `ideas.md`. The AI works only on items in this list.

## Setup (confirmed in ground-truth session, 2026-09-26)

- [x] Add `.gitignore` covering `node_modules/`, `dist/`, `.env`, keystores (`*.jks`, `*.keystore`)
- [x] Add `.env.example` (variable names only)
- [x] Make the first commit, including the ground-truth files
- [ ] Add ESLint + Prettier with default settings; record config locations in `docs/coding-standards.md`
- [ ] Add Vitest; write unit tests for the frame codec
- [ ] Label every protocol constant in `src/spark/` with `VERIFIED-HW` / `SOURCED` / `UNVERIFIED` (see `knowledge/lessons-learned.md`)

## Goal: working controller

- [ ] Decide Android delivery (PWA vs. Capacitor) — ADR-0004
- [ ] Capture real frames from the owner's **Spark GO** and **Spark LIVE** (read-only) to use as verified test vectors
- [ ] Make slot count per-model (`SlotIndex` 0–7 is VERIFIED-HW for Spark LIVE; Spark GO has 4 — SOURCED)

## Port SparklingTones (ADR-0003, approved 2026-09-28)

- [ ] Add `THIRD_PARTY_NOTICES.md` with SparklingTones' MIT notice (check its `NOTICE` file)
- [ ] Port `spark-protocol.js` → `src/spark/protocol.ts` (framing, 7/8-bit packing, msgpack-like types, commands); replace placeholder `SparkCommand` enum
- [ ] Port `spark-transport.js` → `src/spark/transport.ts` (Web Bluetooth, 25-byte writes, chunking, reassembly, ACK wait)
- [ ] Codec unit tests from SparklingTones `test/fixtures/` + owner captures
- [ ] Read-back verification after every live-state and slot write
- [ ] Model profiles: Spark LIVE (Spark 2-style), Spark GO (Spark 40-style, from soundshed)
