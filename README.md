# mySpark

A personal controller for Positive Grid **Spark LIVE** and **Spark GO** amps over Bluetooth, planned as one installable web app for Windows PC and Android (Chrome, Web Bluetooth). See `docs/decisions/` for the decisions and `CLAUDE.md` for the project rules.

## Status

- `src/spark/protocol.ts` — the Spark protocol (framing, 7/8-bit packing, preset format, commands), ported from [SparklingTones](https://github.com/mazzrelaz/SparklingTones). Verified on the owner's Spark LIVE via SparklingTones.
- Bluetooth transport and UI: not yet built.
- `tools/capture/` — read-only BLE capture page for recording what an amp sends.

## Develop

```bash
npm install
npm test         # Vitest
npm run build    # tsc → dist/
```

Capture page: serve `tools/capture/` on localhost (e.g. `python -m http.server 8765`) and open it in Chrome or Edge.

## Credits

Protocol code and test captures from SparklingTones (MIT). See `THIRD_PARTY_NOTICES.md`.
