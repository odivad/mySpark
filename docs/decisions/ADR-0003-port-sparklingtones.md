# ADR-0003: Port SparklingTones' protocol layer into mySpark (TypeScript)

- Status: Accepted
- Date: 2026-09-28
- Decider: project owner

## Context

On 2026-09-28 the owner exercised SparklingTones (a Spark 2 web app, MIT licensed) against their **Spark LIVE**. Every core operation worked: read all 8 slots, read live state, upload to live buffer `0x7f`, preset switch, knob change, effect on/off, model change, and a slot write confirmed by re-read. See `knowledge/lessons-learned.md`.

mySpark's own `src/spark/` is a skeleton with placeholder command bytes and no 7/8-bit packing. SparklingTones' protocol and transport are hardware-tested on a Spark 2 and now on the owner's LIVE.

Options considered:
1. **Port SparklingTones' protocol + transport to TypeScript** in `src/`, with attribution — chosen.
2. Fork SparklingTones and add Spark GO support — rejected: JavaScript with Italian comments, not our stack or ground truth.
3. Use SparklingTones for the LIVE and limit mySpark to the GO — rejected: owner wants one app for both amps.

## Decision

1. Port `src/spark-protocol.js` and `src/spark-transport.js` (and the parts of `src/spark-effetti.js` needed for model names) into TypeScript under `src/spark/`, replacing the current placeholder codec and command enum.
2. **Attribution:** keep SparklingTones' MIT copyright notice and credit in a `THIRD_PARTY_NOTICES.md` and in the header of each ported file. Check SparklingTones' `NOTICE` file for any further attribution it asks for.
3. **Improve, don't just copy:**
   - Every slot or live-state write reads back and compares (SparklingTones' `storePreset` only waits for ACK).
   - Per-model profiles (Spark LIVE = Spark 2-style; Spark GO = Spark 40-style per soundshed), chosen at connect time from the BLE name.
   - Every protocol constant carries `VERIFIED-HW` / `SOURCED` / `UNVERIFIED`.
   - Unit tests (Vitest) for the codec, using SparklingTones' `test/fixtures/` and the owner's captures as vectors.
4. Source authority order becomes: **owner's amps > SparklingTones > soundshed > others**.

## Consequences

- The current `SparkCommand` enum and `SparkFrameCodec` are replaced.
- Spark GO support needs Spark 40-style framing (per-chunk sequence, `04` ACKs, 4 slots) — not covered by SparklingTones; soundshed is the reference.
- Android delivery decision moves to ADR-0004.
