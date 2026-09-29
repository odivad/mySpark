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

- [x] Browse/search Positive Grid ToneCloud from the app (no login; direct `GET https://api.positivegrid.com/v2/preset…`, see lessons-learned) — `src/app/tonecloud.ts`, ToneCloud panel; needs owner check
- [x] Convert a ToneCloud `preset_data` into our preset model; check every `dspId` against the target amp's model list before sending (Spark 2 list + models confirmed on the amp)
- [x] Load a ToneCloud preset into the amp's live buffer `0x7f` (Try, verified by read-back); saving to a slot follows the slot-write rules (not built)
- [x] Save ToneCloud presets to the local library (My tones, IndexedDB; Export as JSON)

## App v1 (approved by owner 2026-09-28; ADR-0005)

- [x] `web/` PWA shell: page, styles, manifest, service worker, icons; `tsconfig.app.json` compiles `src/` → `web/js/`
- [x] Connect; on connect read name/serial, all 8 slots and live state
- [x] Preset list A1–B4 with the current CH1 slot highlighted, following `0x0338` from the amp
- [x] Tap a preset to switch (`0x0138`), verified by reading live state back and comparing with the slot — owner tested 2026-09-28
- [x] Live chain view (7 blocks, model, on/off, params 0–10), updated from `0x0337`; amp-block knob names only (VERIFIED-HW)
- [x] Back up all 8 presets to a local JSON file
- [x] Tone editing (owner request 2026-09-28): amp-block knobs (Gain/Treble/Middle/Bass/Master) via `0x0104` and block on/off via `0x0115`, each verified by reading live state back — owner tested 2026-09-28
- [ ] Later: port SparklingTones' effect catalogue (`spark-effetti.js`) for model/knob names, discrete params and the known-model safety list, then editing for the other blocks; slot save (backup exists now); hosting for Android (https)

## Tone assistant and My tones (owner request 2026-09-28; spec `docs/ai-tone-assistant.md`)

- [x] Standard prompt and JSON result format, with checks (`src/app/tone-ai.ts`, 10 tests)
- [x] On-device AI through the browser's built-in model (Chrome Prompt API) — no API key, nothing leaves the PC
- [x] Suggestions as a list; **Try** plays one in the temporary buffer `0x7f`, verified by read-back
- [x] **Save** to My tones (IndexedDB in the browser); Apply, Delete, Export; "Save to My tones" for the tone playing now
- [ ] Owner test: built-in AI available on the owner's PC; suggestions sensible; Try verified
- [x] Suggestions are standalone tones from the request, not variations of the current tone (owner, 2026-09-28)
- [x] Effect catalogue ported (`src/spark/catalog.ts`); every model with real names in the prompt; knob names shown for all blocks
- [x] Model picker per block: any Spark 2 model, verified by read-back and remembered per amp (`0x0106`); owner tested 2026-09-28 and chose to drop the untried-model warning
- [x] AI speed: fixed instructions processed once and reused; timer shown
- [x] Guitar / Music / Master level sliders (`0x0133`, read-back via `0x0233`), found in the official app's snoop log — owner tested 2026-09-28
- [x] `tools/snoop/decode-btsnoop.ts`: decodes Android HCI snoop logs into Spark messages
- [x] AI instrument toggle: electric / bass / acoustic (owner request 2026-09-28)
- [x] CH1 / CH2 toggle; CH2 view-only (slots `0x03 n`, live `0x04 00`, current via `0x021a`) — needs owner check
- [ ] CH2 switching and editing: needs a snoop log of the official app switching a CH2 preset, changing a CH2 knob and a CH2 model

## Look and layout (owner brief 2026-09-28)

- [x] Amp panel + pedalboard look (black/gold, colour-coded pedals, LED footswitches), sliders only, amp above the chain with an "AMP" tap in the signal line, system light/dark, PC first
- [x] Top bar with Guitar/Music/Master; presets column with red/green LEDs; tabs Tone · AI · ToneCloud · My tones · Log; toast messages
- [x] Reverb type as a dropdown of the 9 types (param 6 of `bias.reverb`, positions 0, 0.1 … 0.8); verified by read-back — # TO CONFIRM (owner): the type names match what you hear (order from SparklingTones)
- [x] Sliders on all named pedal knobs (`0x0104` + read-back), except switch/selector knobs and the hidden on/off param; filled slider tracks — needs owner hardware test (amp knobs verified; other effects via SparklingTones' use of the same command)
- [x] Official app data (APK 4.6.2 assets): corrected reverb type values, switch params, true/false switches in ToneCloud presets; amp knob 5 labelled Volume
- [ ] Switch toggles (LA Comp Limit/Compress, UniVibe Chorus/Vibrato, SAB HP/LP, Cloner): which label is 0 and which is 1 — one check on the amp
- [x] Built-in tuner (owner request 2026-09-28): `0x0165` on/off with `0x0265` read-back, `0x0364` readings; Tuner button + display — needs owner hardware test
- [x] Playing highlight on AI / ToneCloud / My tones cards (owner request)

