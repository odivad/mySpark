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
- **ToneCloud login features** (own presets, favorites, uploading) — needs PG credentials (`POST /auth`); needs a plan for handling the password and token safely in a PWA. Browsing is in `tasks.md`.
- **Hosting/deploy** for the web app — tokens identified in session; target not chosen.
- **MIDI control of the Spark LIVE** — the LIVE has 5-pin MIDI IN/OUT on the back (owner photo, 2026-09-28). A second control path besides BLE (e.g. preset change from a foot controller). Nothing known yet about what it accepts; would need its own sources and captures.
- **Measured level matching for AI suggestions** — the LIVE has USB-C audio (owner photo). With the amp as the PC's audio input, the app could measure output level while the owner plays and set Master so each suggestion comes out at the same loudness. Needs microphone/audio permission in the browser; nothing known yet about the LIVE's USB audio channels. Raised 2026-09-28 after level jumps between suggestions.
- **Other level targets** — the official app also reads `0x0233` targets `01`, `03`, `04`, `0e` (see lessons-learned 2026-09-28). A snoop log while moving CH2 VOL, CH3/4 VOL and MASTER LOW/MID/HIGH in the official app (if it has them) would identify them. (Guitar/Music/Master volume: found and built.)
