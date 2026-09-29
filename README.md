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

**Development:** `npm run dev` rebuilds on every change, serves the app on `http://localhost:8767/`, and reloads open pages (or offers a Reload button while the amp is connected, since a reload disconnects it).

**Layout preview without an amp:** copy a backup made with *Back up all presets* to `web/demo-backup.json` (gitignored) and open the app on localhost with `?demo`.

**The app:** run `npm run build`, serve the repo root (`python -m http.server 8766`), and open `http://localhost:8766/web/` in Chrome or Edge. `web/` is the whole installable app (ADR-0005).

Read test page (read-only, uses `SparkTransport`): run `npm run build`, then serve the **repo root** (`python -m http.server 8765`) and open `http://localhost:8765/tools/live-test/` in Chrome or Edge.

## Credits

Protocol code and test captures from SparklingTones (MIT). See `THIRD_PARTY_NOTICES.md`.
