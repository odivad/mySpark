# Lessons Learned

Write here after a bug, review, near-miss, or hardware test — before the next working session.

## 2026-09-26 — Ground-truth setup session

### `SparkCommand` values have no source — RESOLVED 2026-09-28 (replaced by the SparklingTones port, ADR-0003)
`src/spark/protocol.ts` defines `SparkCommand` values (`ReadState = 0x01`, `SetParameter = 0x10`, `SavePreset = 0x20`, …). Neither `docs/spark-interface-spec.md` nor `docs/spark2-bt-protocol.md` defines numeric command bytes — §9 of the spec lists command *families* only. These values are **UNVERIFIED placeholders**. Do not send them to the amp. Replace with `SOURCED` values from SparklingTones, then confirm on hardware.

### Codec skips 7/8-bit packing — RESOLVED 2026-09-28 (SparklingTones port)
`SparkFrameCodec.parseFrame` / `buildFrame` treat the payload as raw bytes and compute the XOR checksum over them. The spec (§4.1–4.2) says the payload is 7/8-bit packed and the checksum covers the *packed* bytes. The current codec will not interoperate with the amp as written.

### Spark 40 vs. Spark 2
Several reference sources describe the Spark 40. Details from them are not safe to assume for Spark 2. Tag the model when citing.

## 2026-09-28 — The target amp was wrong

The whole initial setup assumed a **Spark 2** because the starting docs came from SparklingTones (a Spark 2 project). The owner has a **Spark GO** and a **Spark LIVE** and no Spark 2. Caught two days in, before any hardware code was written. See ADR-0002.

Lesson: in the setup session, ask "which exact hardware do you own?" instead of inferring it from the docs already in the repo.

- Spark GO: Spark 40-family per soundshed (`ffc0`/`ffc1`/`ffc2`, 4 slots, `04` ACKs, no live sync). SOURCED.
- Spark LIVE: no public protocol docs found (soundshed, SparklingTones, GitHub search). UNVERIFIED — captures only.
- Soundshed contradicts itself on Spark 2: its protocol doc says primary service `ffc0` with `ffc8` secondary; its simulator's `spark-2` profile uses `ffc8`/`ffc9`/`ffca`. Irrelevant now, but a reminder that docs disagree.
- `SlotIndex` (0–7) in `src/spark/types.ts` came from the Spark 2 docs; Spark GO has 4 slots.
- The Spark 2 sections below (soundshed comparison) remain as reference, not as targets.

### Owner report: SparklingTones can read the Spark LIVE (2026-09-28)
The owner connected the SparklingTones web app (a Spark 2 app) to their **Spark LIVE** and it read the amp. First real evidence about the LIVE.

- SparklingTones' BLE filter is `services: [0xffc0]` only (no name check), so the LIVE **advertises service `0xFFC0`** — `VERIFIED-HW (owner, via SparklingTones)`.
- SparklingTones' read path (`0x0201` get preset, Spark 2 conventions: 25-byte writes, one seq per multi-chunk message, trailing `0x00`) worked on the LIVE → the LIVE likely speaks the Spark-family protocol, possibly Spark 2-style. **Likely, not proven** — # TO CONFIRM what exactly was read (see below).
- Writes from SparklingTones to the LIVE: **not tested**. Do not assume they work.
- SparklingTones (tested on real Spark 2 hardware) uses `ffc0`/`ffc1`/`ffc2` for Spark 2 — contradicting soundshed's simulator (`ffc8`). SparklingTones is the hardware-backed answer.
- SparklingTones is **MIT licensed** and is a PWA for Chrome on PC and Android — the same shape as mySpark's goal. Reusing its code with attribution is allowed.

**Confirmed by owner screenshots, 2026-09-28** — `VERIFIED-HW (owner, Spark LIVE, via SparklingTones)`:
- BLE device name: **`Spark LIVE BLE`**.
- **8 preset slots**, shown as banks **A1–A4, B1–B4** — same layout as Spark 2. SparklingTones log: `read 8 presets from the amp: 0 new, 8 updated`. All 8 preset names decoded correctly (e.g. "Rhythm Guitar Style Tone 1" A1, "my bass" B1, "Upright Bass" B2).
- So the Spark 2-style read path works on the LIVE: `0x0201` get-preset for all 8 slots, preset decoding, 7/8-bit unpacking, multi-chunk reassembly.
- No errors or disconnects during the read.
- The log also showed `my bass — B1` / `Rhythm Guitar Style Tone 1 — A1` after the read — likely current-preset change notifications. # TO CONFIRM: were presets switched on the amp while connected?
- Consequence: `SlotIndex` 0–7 is right for the LIVE; per-model slot counts are still needed for the GO (4, SOURCED).

### First write to the Spark LIVE: preset upload to the live buffer works (2026-09-28)
The owner pressed **Tweak** in SparklingTones on "Rhythm Guitar Style Tone 1" (A1). With the amp connected, Tweak (`apriEditor` in SparklingTones `index.html`) does:
1. `0x0101` multi-chunk preset upload to the **software buffer `[0x00, 0x7f]`** (Spark 2 style: 25-byte writes, one seq for all chunks)
2. `0x0138` switch to `0x7f`
3. ~400 ms wait, then read live state, and open the editor from the amp's answer

The editor opened with a fully decoded chain → all three steps succeeded. `VERIFIED-HW (owner, Spark LIVE, via SparklingTones)`:
- Live-buffer preset upload + switch + read-back work on the LIVE.
- The LIVE's guitar-channel preset format matches Spark 2: 7-block chain (Noise Gate, Comp/Wah, Drive, Amp, Modulation, Delay, Reverb), per-block on/off, model names (e.g. amp `ODS 50` — "Dumble ODS 50 HRM"), knob values (Gain 7.1, Bass 4.6, Middle 3.6, Treble 6.6, Master 6.2), tempo 120 bpm.
- **No saved slot was written.** The `0x7f` buffer is temporary.

# TO CONFIRM (owner): did the amp's LED blink after Tweak (SparklingTones says it blinks while playing the software buffer)?

### Knob changes work on the Spark LIVE (2026-09-28)
Owner turned knobs in the SparklingTones Tweak editor: **the changes reached the LIVE and sounded correct.** `VERIFIED-HW (owner, Spark LIVE, via SparklingTones)`.

Command used (SparklingTones `src/spark-protocol.js`, `changeParam`):
`cmd 0x01 sub 0x04` — data: prefixed-string effect name, param index byte, float 0.0–1.0, **trailing `0x00`** (Spark 2 rule: without it the amp ACKs but does nothing).
- SparklingTones uses `0x0104` for amp knobs too. Soundshed lists `0x0337` for amp knobs (Spark 40). On the LIVE, `0x0104` works for the amp block.
- These are live-state writes only: switching preset on the amp restores the saved version.

### Slot write attempted on the Spark LIVE (2026-09-28) — persistence NOT yet confirmed
Owner used SparklingTones **"Send to HW preset"**. SparklingTones `storePreset` (`src/spark-transport.js`):
1. `0x0101` multi-chunk upload addressed **directly to the slot** `[0x00, slot]` — not via `0x7f` + `0x0127` (`0x0127` save does not work on Spark 2)
2. 300 ms wait, `0x0138` to another slot, 300 ms, `0x0138` back — without this round trip the Spark 2 keeps reporting the old slot content
3. **No read-back verification** — ACK only. Per our rules, ACK ≠ executed.

Status: **slot write works** — owner re-read the amp and the change is in the slot (2026-09-28). `VERIFIED-HW (owner, Spark LIVE, via SparklingTones)`.
# TO CONFIRM (owner): survives power-off/on.

### Effect on/off and effect model change work on the Spark LIVE (2026-09-28)
Owner report — `VERIFIED-HW (owner, Spark LIVE, via SparklingTones)`:
- **Effect on/off** — `0x0115`: prefixed-string effect name, `c3`/`c2`, trailing `0x00`.
- **Effect model change** — `0x0106`: prefixed-string old name, prefixed-string new name, trailing `0x00`. Worked for the model(s) the owner chose; SparklingTones only offers models from its catalogue, and asking for a model the amp lacks can freeze a Spark 2 — keep that guard.

### Summary: SparklingTones' Spark 2 protocol works on the Spark LIVE guitar channel
As of 2026-09-28 every core operation has been exercised on the owner's LIVE through SparklingTones: read all 8 slots, read live state, upload to live buffer, switch preset, knob change, effect on/off, model change, slot write. The LIVE's guitar-channel control protocol is, in practice, the Spark 2 protocol as documented by SparklingTones.
Not yet exercised: BPM/looper (`0x0176`), power-cycle persistence of a slot write, and anything specific to the LIVE's other channels (mic/aux) — no source covers those.

Lesson for mySpark: our slot-write must read the slot back (`0x0201 [0x00, slot]`) and compare, per `knowledge/approved-patterns.md` §1 — SparklingTones skips this.

**Still untested on the LIVE:**
- Effect on/off (`0x0115`), BPM (`0x0176`).
- Changing a block's model — SparklingTones notes asking for a model the amp doesn't have can freeze a Spark 2. The LIVE's model list may differ.

### Protocol details are unverified overall
Nothing in `docs/` or `src/` has yet been confirmed on the owner's amp. Treat all protocol content as `SOURCED` at best until hardware captures exist.

## 2026-09-28 — First mySpark capture from the Spark LIVE (Windows PC, Chrome)

Capture: `captures/2026-09-28-live-first-capture.json` (mySpark `tools/capture`, read-only, ~20 s, no markers).

`VERIFIED-HW (owner, Spark LIVE, via mySpark capture page)`:
- **Chrome on the Windows PC connects to the LIVE** over Web Bluetooth. The first attempt did not pair; after power-cycling the amp / freeing it from the phone / widening the scan filter it connected. # TO CONFIRM (owner): which of those fixed it.
- **GATT layout as Web Bluetooth sees it:** service `0xffc0` only — `0xffc1` `writeWithoutResponse`, `0xffc2` `read` + `notify`. `0xffc8` was requested as an optional service and **is not present**, so soundshed's "Spark 2 secondary service `ffc8`" does not apply to the LIVE.
- **Amp → app messages use seq `0x40` upward**, incrementing per message (`0x40`, `0x41`, `0x42`) — matches SparklingTones' "above `0x3f` is the amp's range".
- **Our codec decodes the LIVE's own frames with valid checksums** (`parseMessage`, `unpack7bit8bit`, `xorChecksum`) — first direct hardware check of the receive path, not via SparklingTones.
- **The amp sends `0x0371` unprompted**, three times in 20 s (at +4 s, +7 s, +19 s). Unpacked data: `09 01 01 00 cd 41 86 00 18` (last byte `0x17` once). Meaning **UNVERIFIED — no source documents `0x0371`.** SparklingTones only notes the official app *queries* `0x0271` twice at startup (`docs/looper.md`). Only the last byte changed; do not guess what it is until a longer capture with markers shows what drives it.
- No other notifications arrived in that window (answered by the second capture below: panel changes *are* reported).

### Second capture: the LIVE reports panel changes unprompted (2026-09-28)
Capture: `captures/2026-09-28-live-capture-2.json`. The page was not reloaded, so the file also holds the first session (20:09–20:12); the new session starts 22:58. No markers.

`VERIFIED-HW (owner, Spark LIVE, via mySpark capture page)` — with no app request sent:
- **Preset switch on the amp → `0x0338`**, data `[0x00, slot]`: seen `02`, `03`, `04`, `03`. Same message and layout SparklingTones handles; `SparkTransport.trackState` already reads it. # TO CONFIRM (owner): which buttons were pressed, to tie slot numbers to A1–B4 on the LIVE.
- **Knob turned on the amp → `0x0337`**, data: prefixed-string model name, param index, float `0xca` value, trailing `0x00`. Seen for amp model `94MatchDCV2`, params 0, 3, 2, 1, sent roughly every 60–250 ms while turning. Same layout as SparklingTones' Spark 2 capture `KNOB_REVERB` and soundshed's Spark 40 `0x0337`. Knob-to-index mapping: see the third capture.
- **`0x031a`** once: data `91 00 03 c3`. Meaning **UNVERIFIED**, no source. (Third capture: it precedes the first knob message, see below.)
- **`0x0371` keeps coming every 3–15 s** for the whole connection. Data `09 01 01 00 cd 41 86 00 <17|18>`; 2 h 48 min later the middle field read `cd 41 8c`. So there are two changing fields: a uint16 (`0x4186` → `0x418c`) and a last byte flipping between 23 and 24. **Hypothesis only, UNVERIFIED:** status telemetry, e.g. battery voltage in mV (16774 ≈ a full 4-cell pack) and temperature in °C. Test before believing it: capture on battery vs. mains power, and after the amp warms up.

**LIVE panel controls** (owner photos, 2026-09-28), left to right:
- Power button with a green LED, then two status LEDs marked with **Bluetooth** and **Wi-Fi** icons.
- CH1 INPUT jack.
- **PRESET: a knob with "HOLD TO SAVE" above and "PRESS TO SWITCH" below**, beside four LEDs numbered 1–4. So presets are switched by pressing it, saved by holding it.
- Knobs GAIN, BASS, MID, TREBLE, GUITAR, MUSIC.

Presets and LEDs:
- **Four LEDs for eight slots.** The clearer photo shows **LED 2 lit red**. Under SparklingTones' Spark 2 convention (red = bank A, green = bank B; UNVERIFIED on the LIVE) that is A2 = slot 1. That photo is a reference picture, not tied to any capture, so it says nothing about which slot capture 3 switched to. (An earlier, blurrier photo was first misread as LED 3.)
- CH1 colours confirmed in capture 4: red = A, green = B (see below). # TO CONFIRM: with the live-test page open, a press moves the highlight to the slot the LEDs show.
- **"HOLD TO SAVE"**: saving from the panel changes a slot without the app. The amp, not our cache, is the source of truth. # TO CONFIRM: what (if anything) the amp sends over BLE on a panel save — capture it with a marker.

**LIVE back panel** (owner photo, 2026-09-28):
- **MASTER**: LOW, MID, HIGH, VOL knobs.
- **MIDI IN / OUT** (5-pin DIN). **OUTPUT** L/MONO and R jacks.
- **CH2 INPUT** (combo jack with PUSH latch) with **its own PRESET knob** ("HOLD TO SAVE" / "PRESS TO SWITCH"), four LEDs 1–4, and a VOL knob. In the photo **LED 1 is lit green**.
- **CH3/4 STEREO INPUT** (CH3/L, CH4/R) with a VOL knob.
- **PAIR** button, headphone jack, **USB-C AUDIO/DATA**, **CHARGE OUT** USB-C (5 V 1.5 A).

What this changes:
- **The LIVE has at least two preset systems: CH1 (front) and CH2 (back), each with 4 LEDs.** Everything verified so far (8 slots, `0x0201`, `0x0338`, the Spark 2 preset format) was on the guitar channel, CH1. How CH2 presets are addressed over BLE — or whether they are exposed at all — is **UNVERIFIED; no source covers it**.
- **Green does not necessarily mean "bank B".** CH2 shows green at LED 1, so colour may mark the channel, not the bank. The CH1 red/green = A/B assumption (from the Spark 2) is even less safe on the LIVE. # TO CONFIRM with the live-test page: press CH1 PRESET through all positions and note LED colour against the highlighted slot; then do the same for CH2 and see what (if anything) the amp sends.
- Answered by capture 4 (below): only MASTER VOL (`0x0333`) and the CH2 PRESET knob (`0x0338` bank `0x03`) send anything.

### Fourth capture: back panel (2026-09-28)
Capture: `captures/2026-09-28-live-capture-4-back-panel.json`. Markers added **before** each action this time. The owner's first pass over the MASTER knobs was actually turning CH2 VOL (their marker: "redo master. that was all ch 2 vol"); the second pass is the MASTER one.

`VERIFIED-HW (owner, Spark LIVE, via mySpark capture page)`:
- **Front (CH1) PRESET press → `0x0338 [0x00, 0x04]`**; the owner saw **CH1 LED 1 green**. Slot 4 = B1, so on CH1 **red = bank A (slots 0–3), green = bank B (slots 4–7)** — the Spark 2 convention holds on the LIVE's CH1 (one data point each colour: red LED 2 in the photo, green LED 1 here).
- **Back (CH2) PRESET press → `0x0338 [0x03, 0x00]`**; the owner saw **CH2 LED 1 red**. The first byte is **`0x03`, not `0x00`** — CH2 presets are announced on another "bank". Before the fix, `SparkTransport.trackState` took the last byte and would have recorded this as CH1 slot 0. **Fixed 2026-09-28:** `currentPreset` now only follows bank `0x00`; every switch is kept raw in `state.lastPresetSwitch`. CH2 has red and green too (photo showed green LED 1), so it likely has two banks of four as well — UNVERIFIED. How to *read* a CH2 preset (e.g. `0x0201 [0x03, n]`?) is **UNVERIFIED — do not send it without owner approval**; untested reads are low-risk but still unknown.
- **MASTER VOL → `0x0333`**, data `[0x09, float]` (values 0.42 → 0.53 while turning). **No source documents `0x0333`**; `0x09` may be an index for the master volume — UNVERIFIED.
- **Send nothing over BLE:** MASTER LOW, MID, HIGH; CH2 VOL; CH3/4 VOL (and, from capture 3, front GUITAR and MUSIC).

### Third capture: panel knobs mapped (2026-09-28)
Capture: `captures/2026-09-28-live-capture-3-mapping.json`, one marker per control. **The owner added each marker right after the action, not before** — the knob messages sit just before the marker naming them, and the first knob turned (Gain) precedes the first marker. Read captures that way; ask which convention was used next time.

`VERIFIED-HW (owner, Spark LIVE, via mySpark capture page)` — `0x0337` param index for the amp-block panel knobs (model `94MatchDCV2`):

| Panel knob | Param index |
|---|---|
| Gain | 0 |
| Treble | 1 |
| Mid | 2 |
| Bass | 3 |

- Matches SparklingTones (`src/spark-effetti.js:17`: "the knobs read Gain, Bass, Middle, Treble, Master, but the indices are Gain(0), Treble(1), Middle(2), Bass(3), Master(4)") and soundshed's amp-param table. Master (4) is not a panel knob on the LIVE.
- **Guitar volume and Music volume send nothing** over BLE — no message of any kind while they were turned. The app cannot see them.
- **One preset-button press → `0x0338 [0x00, 0x02]`.** # TO CONFIRM (owner): which preset the amp showed afterwards (slot 2 = A3 under the A1–A4/B1–B4 layout).
- **`0x031a` (`91 00 03 c3`) arrives right before the first `0x0337` of a connection** — seen twice, both times immediately ahead of the first knob message, not tied to a preset switch as first thought. Meaning still **UNVERIFIED**.
- **The amp's own seq wraps `0x7f` → `0x40`** (seen `…7e, 7f` then `40`). Amp range is `0x40`–`0x7f`. SparklingTones only says "above `0x3f`".

Consequence for the controller: it can keep its cache in sync by listening, instead of polling — apply `0x0338`/`0x0337` to the cached state, then confirm with a read (`0x0201`) when it matters.

## 2026-09-28 — mySpark's own SparkTransport reads the Spark LIVE

First hardware run of mySpark code (not SparklingTones): `tools/live-test/` in Chrome on the Windows PC, read-only. Owner report: **"looks fine"** — connect, identify, all slots and live state displayed as expected.

`VERIFIED-HW (owner, Spark LIVE, via mySpark tools/live-test)`:
- `SparkTransport.connect()` with the **service-only filter** (`0xffc0`, no name prefix) finds the LIVE on Windows. So the capture page's name-prefix fallback was not what fixed the first failed pairing — more likely power-cycling the amp or freeing it from the phone.
- `identify()` (`0x0211`, `0x0223`, `0x0210`), `readLibrary(8)` (`0x0201 [0x00, n]`), `readLiveState()` (`0x0201 [0x01, 0x00]`), 0x0301 reassembly and `parsePreset` work end to end.
- # TO CONFIRM (owner): did knob turns and preset presses update the page live? (Save a session JSON to confirm, and to give us real LIVE preset bytes as test vectors.)

Pitfall: `python -m http.server` must be started from the **repo root** for `tools/live-test/` (it imports `../../dist/`). An old server still running from `tools/capture/` on the same port gives a 404.

## 2026-09-26 — Soundshed protocol doc compared with our docs

Source: `soundshed/soundshed-app` `docs/spark-amp-protocol.md`. Everything below is **SOURCED (soundshed)**, not hardware-verified. Soundshed's Spark 2 support is experimental.

### Confirms our `SparkCommand` values are wrong
Soundshed's command bytes are cmd/sub pairs, e.g. GET preset `02 01`, knob change `01 04`, effect toggle `01 15`, switch preset `01 38`, store to slot `03 27`, amp knob `03 37`. None match our enum.

### Framing disagreement — must be settled by a hardware capture
- Our spec: `F0 01 <seq> <checksum> <cmd> <sub> <data> F7`.
- Soundshed: a 16-byte **block header** comes first — `01 fe 00 00 <dir> <size> 00×9`, with direction `53 fe` (to amp) / `41 ff` (from amp) — then the `F0 01 … F7` chunk.
- Soundshed hardcodes the seq/checksum bytes as `3a 15` and says the amp does not appear to validate them. Our spec says XOR checksum.
Record the answer here once the owner captures real Spark 2 frames.

### Spark 2 specifics (soundshed)
- 8 preset slots (matches our `SlotIndex` 0–7). Soundshed's `00`–`03` slot ranges are Spark 40.
- Cap each BLE write at **100 bytes** regardless of MTU.
- Preset upload is **chunk-acked**: wait for ACK `05 01` per chunk, `04 01` on the final chunk. All chunks share one sequence number.
- ~500 ms delay before the preset switch after upload, or the amp may discard the tone.
- Knob changes (`01 04`) produce **no ACK** — only a read-back can verify them.
- A second BLE service `0xFFC8` (`ffc9`/`ffca`) exists, described as **firmware and pedal control**. Firmware commands are banned (`docs/security.md`); do not write to this service without owner approval.
- Payload values use MessagePack-like types (`ca` + big-endian float32, `c2`/`c3` booleans, `a0+len` strings).

### Soundshed warns invalid settings can crash the amp
"Invalid settings may crash amp, requiring amp to be switched off and on again." Reinforces the approval + hardware-test rule for writes.

## 2026-09-28 — Positive Grid ToneCloud access

Source: soundshed-app `src/spork/src/devices/spark/sparkAPI.ts` (SOURCED), plus two read-only probes by the AI on 2026-09-28 (no credentials sent).

- Base URL: `https://api.positivegrid.com/v2`. **Unofficial, undocumented API** — Positive Grid can change or block it at any time.
- **Browsing needs no login:**
  - search: `GET /preset?page=1&page_size=N&preset_for=spark[&keyword=…]` → array of preset summaries
  - one preset: `GET /preset/{id}` → includes `preset_data`
  - by creator: `GET /user_create/{userId}?page=&page_size=&preset_for=spark`
- **CORS allows browser calls:** `Access-Control-Allow-Origin: *` (probed 2026-09-28). The PWA can call it directly; no proxy needed for browsing. (Soundshed's web build uses its own proxy `api-proxy.soundshed.com` — we must not route anything through a third-party proxy.)
- `preset_data` is a JSON string with the Spark preset shape: `sigpath` = 7 blocks `{dspId, active, params:[{index, value 0–1}]}`, plus `bpm`, `meta {id, name, version, description, icon}`, `loudness`, `extraGain`. `dspId` values (`bias.noisegate`, `ADClean`, `bias.reverb` …) are the amp's internal model names — same kind SparklingTones sends.
- **Login** (`POST /auth {username, password}` → JWT, sent as `Authorization: JWT <token>`) is only needed for account features (own presets, favorites). Not probed.
- # TO CONFIRM: other `preset_for` values (Spark 2 / LIVE / GO may have their own); whether ToneCloud "spark" presets use models the LIVE or GO don't have.

Risks:
- **Model mismatch can freeze the amp** (SparklingTones warning). Check every `dspId` against the target amp's known model list before sending.
- Use of an unofficial API may conflict with Positive Grid's terms. Personal use, low request rate, no bulk downloading or redistribution.
- PG credentials are a secret (`docs/security.md`): never stored in code, repo, or localStorage in plain text.

### No `.gitignore`
The repo had no `.gitignore` at setup time, so `node_modules/`, `dist/`, and any future `.env` were not excluded.
