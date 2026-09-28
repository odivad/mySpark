# Ideas — not yet approved

Everything new lands here first. Only the owner moves an item to `tasks.md`.

- **Transport abstraction as a standard** — all BLE access through `SparkTransport` so a Web Bluetooth transport and an Android transport share one core. Raised in session; not adopted as a standard yet. Relevant to "build once, run in both places."
- **Pure protocol codec as a standard** — framing, packing, checksum as pure functions with no I/O. Raised in session; not adopted.
- **Implement 7/8-bit packing/unpacking** in the codec per `docs/spark-interface-spec.md` §4.1.
- **Fragment reassembly** for notify characteristic `0xFFC2`.
- **Preset backup/export to local JSON files** (confirmed data store; feature not yet scheduled).
- **Use the soundshed Spark amp simulator for testing** (`soundshed-app/tools/spark-amp-simulator`, MIT) — has a `spark-2` profile over TCP, so the client can be tested without risking the real amp. BLE peripheral mode needs `@stoprocent/bleno` (new dependency — needs approval).
- **Reconcile our protocol docs with soundshed's** once real captures exist — see `knowledge/lessons-learned.md`.
- **GitHub Actions CI** — build, lint, test, `npm audit`, secret scanning.
- **UI framework choice** for the web/Android app.
- **ToneCloud login features** (own presets, favorites, uploading) — needs PG credentials (`POST /auth`); needs a plan for handling the password and token safely in a PWA. Browsing is in `tasks.md`.
- **Hosting/deploy** for the web app — tokens identified in session; target not chosen.
