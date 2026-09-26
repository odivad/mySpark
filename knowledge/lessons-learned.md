# Lessons Learned

Write here after a bug, review, near-miss, or hardware test — before the next working session.

## 2026-09-26 — Ground-truth setup session

### `SparkCommand` values have no source
`src/spark/protocol.ts` defines `SparkCommand` values (`ReadState = 0x01`, `SetParameter = 0x10`, `SavePreset = 0x20`, …). Neither `docs/spark-interface-spec.md` nor `docs/spark2-bt-protocol.md` defines numeric command bytes — §9 of the spec lists command *families* only. These values are **UNVERIFIED placeholders**. Do not send them to the amp. Replace with `SOURCED` values from SparklingTones, then confirm on hardware.

### Codec skips 7/8-bit packing
`SparkFrameCodec.parseFrame` / `buildFrame` treat the payload as raw bytes and compute the XOR checksum over them. The spec (§4.1–4.2) says the payload is 7/8-bit packed and the checksum covers the *packed* bytes. The current codec will not interoperate with the amp as written.

### Spark 40 vs. Spark 2
Several reference sources describe the Spark 40. Details from them are not safe to assume for Spark 2. Tag the model when citing.

### Protocol details are unverified overall
Nothing in `docs/` or `src/` has yet been confirmed on the owner's amp. Treat all protocol content as `SOURCED` at best until hardware captures exist.

### No `.gitignore`
The repo had no `.gitignore` at setup time, so `node_modules/`, `dist/`, and any future `.env` were not excluded.
