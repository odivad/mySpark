# Official Sources — mySpark

## Authority order for protocol truth

Target amps: **Spark GO** and **Spark LIVE** (ADR-0002). Order set by the owner in ADR-0003 (2026-09-28).

1. **The owner's Spark GO and Spark LIVE** — hardware captures and tests. Beats every document. (`VERIFIED-HW`)
2. **SparklingTones** (MIT) — written for Spark 2; its protocol is **proven on the owner's Spark LIVE** (all core operations, 2026-09-28). Primary reference for the LIVE. Being ported (ADR-0003).
   - https://github.com/mazzrelaz/SparklingTones
   - https://mazzrelaz.github.io/SparklingTones/
   - Key files: `docs/protocollo-spark2.en.md`, `README.en.md`, `src/spark-protocol.js`, `src/spark-transport.js`, `test/fixtures/`
3. **Soundshed** — https://github.com/soundshed. Primary reference for the **Spark GO** (Spark 40-family).
   - `soundshed-app` (TypeScript, **MIT**) — desktop/web Spark controller. Spark 40/Mini supported; GO and Spark 2 "experimentally supported".
     - `docs/spark-amp-protocol.md` — full protocol write-up: block header, chunking, 7-bit encoding, MessagePack-like types, command table
     - `src/spork/src/devices/spark/` — BLE provider, message reader, command builder, FX catalog
     - `tools/spark-amp-simulator/` — protocol-level amp simulator with `spark-go` and `spark-2` profiles (TCP; BLE peripheral experimental)
   - `spork` (TypeScript, **no license** — read for reference only, do not copy code) — earlier comms library; `Bluetooth Captures/` has Spark Mini BLE captures
   - `spark-guide` (MIT) — user-facing guide, context only
4. **Other repos** — cross-checks only, never sole authority:
   - PGSparkLite — https://github.com/richtamblyn/PGSparkLite
   - sparkpal — https://github.com/jamesguitar3/sparkpal
   - Spark 40 modding notes — https://github.com/indatarec/Positive-Grid-Spark-40-modding (Spark 40)
   - Spark 2 modding notes — https://github.com/indatarec/Positive-Grid-Spark-2-modding (Spark 2)
   - Spark MIDI Bridge — https://github.com/madv1n/Spark-MIDI-Bridge

When sources disagree, the higher-ranked one wins. Record disagreements in `knowledge/lessons-learned.md`.

Full provenance notes: `docs/sources-used.md`.

## Caution

- Sources describe different models (Spark 40, Mini, GO, 2). Always note which. No public source describes the **Spark LIVE**; what we know about it comes from the owner's tests via SparklingTones (see `knowledge/lessons-learned.md`).
- The AI can read these sites only when the owner approves a web fetch. Otherwise it relies on what is in `docs/`.

## Platform documentation (authoritative for tooling)

- TypeScript — https://www.typescriptlang.org/docs/
- Node.js — https://nodejs.org/docs/latest/api/
- Vitest — https://vitest.dev/
- ESLint — https://eslint.org/docs/latest/
- Prettier — https://prettier.io/docs/
- Web Bluetooth — https://developer.mozilla.org/en-US/docs/Web/API/Web_Bluetooth_API and https://webbluetoothcg.github.io/web-bluetooth/
- # TO CONFIRM: Capacitor / BLE plugin docs, if Capacitor is chosen for Android.

## Internal wikis / sources to distrust

None stated.
