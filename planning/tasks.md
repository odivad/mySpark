# Tasks — approved work

Only the owner moves items here from `ideas.md`. The AI works only on items in this list.

## Setup (confirmed in ground-truth session, 2026-09-26)

- [x] Add `.gitignore` covering `node_modules/`, `dist/`, `.env`, keystores (`*.jks`, `*.keystore`)
- [x] Add `.env.example` (variable names only)
- [x] Make the first commit, including the ground-truth files
- [ ] Add ESLint + Prettier with default settings; record config locations in `docs/coding-standards.md`
- [x] Add Vitest; write unit tests for the frame codec (46 tests, ported from SparklingTones)
- [x] Label every protocol constant in `src/spark/` with `VERIFIED-HW` / `SOURCED` / `UNVERIFIED` (see `knowledge/lessons-learned.md`)

## Goal: working controller

- [x] Test SparklingTones in Chrome on the Android phone with the Spark LIVE → accept ADR-0004 (PWA)
- [ ] Capture real frames from the owner's **Spark GO** and **Spark LIVE** (read-only) to use as verified test vectors — LIVE: 3 captures in `captures/` (notifications, knob map); LIVE preset-read vectors and all of the GO still to do
- [ ] Make slot count per-model (`SlotIndex` 0–7 is VERIFIED-HW for Spark LIVE; Spark GO has 4 — SOURCED)

## Port SparklingTones (ADR-0003, approved 2026-09-28)

- [x] Add `THIRD_PARTY_NOTICES.md` with SparklingTones' MIT notice (check its `NOTICE` file)
- [x] Port `spark-protocol.js` → `src/spark/protocol.ts` (framing, 7/8-bit packing, msgpack-like types, commands); replace placeholder `SparkCommand` enum
- [x] Port `spark-transport.js` → `src/spark/transport.ts` (Web Bluetooth, 25-byte writes, chunking, reassembly, ACK wait) — 23 tests against `FakeAmp`; not yet run on hardware
- [ ] Codec unit tests from SparklingTones `test/fixtures/` (done) + owner's Spark LIVE captures (to do)
- [ ] Read-back verification after every live-state and slot write — done for `loadPreset` (VERIFIED-HW on the LIVE 2026-09-28), `storePreset`, `setBpm` (not yet hardware-tested); still to do for knob change (`0x0104`), effect on/off (`0x0115`), model change (`0x0106`)
- [ ] Model profiles: Spark LIVE (Spark 2-style), Spark GO (Spark 40-style, from soundshed)

## ToneCloud (requested by owner 2026-09-28)

- [ ] Browse/search Positive Grid ToneCloud from the app (no login; direct `GET https://api.positivegrid.com/v2/preset…`, see lessons-learned)
- [ ] Convert a ToneCloud `preset_data` into our preset model; check every `dspId` against the target amp's model list before sending
- [ ] Load a ToneCloud preset into the amp's live buffer `0x7f` (try before saving); saving to a slot follows the slot-write rules
- [ ] Save ToneCloud presets to the local library (JSON)

