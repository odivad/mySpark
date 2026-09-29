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

LED blink while playing the software buffer: confirmed on the LIVE, 2026-09-28 (mySpark write test, below).

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
  - **Update 2026-09-28:** SparklingTones' protocol doc (`docs/protocollo-spark2.en.md`, Spark 2) describes it: "`0x031a`, undocumented, emitted while the knobs move: decodes as `array[1] 0 <current preset> true`". Our `91 00 03 c3` = `array[1]`, `0`, `3`, `true`, and the current preset was slot 3 in capture 2. SOURCED (SparklingTones), consistent with the LIVE. The meaning of the `0` and `true` fields is still unknown.
- **The amp's own seq wraps `0x7f` → `0x40`** (seen `…7e, 7f` then `40`). Amp range is `0x40`–`0x7f`. SparklingTones only says "above `0x3f`".

Consequence for the controller: it can keep its cache in sync by listening, instead of polling — apply `0x0338`/`0x0337` to the cached state, then confirm with a read (`0x0201`) when it matters.

## 2026-09-28 — ToneCloud: older presets have no model list; unsupported ones hidden

- **95 of the top 100 "popular" presets have `preset_meta: null`** in search results (older presets, e.g. "Metallica", 2019). Their chain is only in the full preset. The first version read that as "0 blocks" and hid Try: a bug. Now they're shown and checked when loaded.
- Sampled after loading: 29 of the top 30 pass (7 blocks, all models on the Spark 2 list). The one failure, "Come As You Are - Nirvana", has a Cloner param stored as `false` instead of a number. Rejected; no value guessed.
- **Owner decision:** "just don't show unsupported tones". The list leaves out anything the search result rules out (unknown model, non-`in1` input, not 7 blocks). A preset that fails the check when loaded disappears from the list with a note, and nothing is sent.
- ToneCloud's `order` parameter: `popular` = sorted by likes (highest first), `latest`, `alphabet` (raw title, leading spaces first). `likes`/`downloads` are ignored. "Most downloaded" in the app re-sorts the popular results locally.

## 2026-09-28 — ToneCloud probe (for the app's ToneCloud panel)

Read-only probes, no credentials. SOURCED (ToneCloud, live API):
- `GET /v2/preset?page=&page_size=&preset_for=spark[&keyword=]` → JSON array; still `Access-Control-Allow-Origin: *`.
- Each item has `preset_meta.dspId` (the 7 model ids in chain order): the app flags unsafe presets **before** fetching them.
- `signal_chain_type` was `in1` for all 50 sampled: guitar input, 7-block chain. The app only offers `in1`, 7-block presets.
- `preset_for` = `sparklive`, `spark_live`, `spark2`, `sparkgo`, `spark_go` all return **no** presets; everything is under `spark`.
- `GET /v2/preset/{id}` → `preset_data` (JSON string): `meta {id, name, version, description, icon}`, `bpm`, `sigpath[] {type, dspId, active, params[{index, value}]}` → `cloudToPreset` maps it onto our `Preset`.
- Items include creator profiles (other people's names); the app neither shows nor stores them, and the test fixture has them removed.

## 2026-09-28 — Spark GO with the official app (HCI snoop log)

Bug report pulled with `adb bugreport` (`captures/raw/`, git-ignored). `VERIFIED-HW (owner, Spark GO, official app traffic)`:
- **On Android the official app talks to the GO over classic Bluetooth (RFCOMM), not BLE.** The log has no ATT traffic; the Spark frames ride in RFCOMM UIH frames on a dynamic L2CAP channel. `tools/snoop/decode-btsnoop.ts` now decodes RFCOMM too. mySpark still uses BLE: the GO answers over BLE as well (first-contact log above).
- **Same framing, same read commands, same preset format as the LIVE:** `0x0201 [0x00, n]` (the app pads to 7 bytes), `[0x01, 0x00]` for live; replies are 0x0301 chunks of 25 bytes with the `[total, index, size]` sub-header; presets have the **same 7-block chain** and model ids. The owner's four GO presets are bass tones on `GK800` (RB-800).
- **The GO sometimes stops a preset reply after 13 chunks, with the official app too.** The app then asks again ~3 s later and gets all 14–16 chunks. **mySpark now does the same:** `SparkTransport` retries a reply that stops partway (up to 2 extra attempts). This was the "A4 / live sound unreadable" problem. **Owner test after the fix: "it reads"** — all four GO slots and the live sound load in mySpark. `VERIFIED-HW (owner, Spark GO, via mySpark app)`.
- **Preset switch `0x0138 [0x00, n]` → ACK `0x0438`**, used 5 times by the app: same as the LIVE.
- **The official app wraps every message to the GO in the 16-byte block header** `01 fe 00 00 53 fe <total length> 00×9`, then the `F0 01 … F7` frame (the Spark 40 form soundshed documents). The snoop decoder had hidden it, since the assembler skips bytes before `F0`. **Without the header the GO still answers reads but ignored mySpark's preset switch** (owner test 2026-09-29: "not switching", read-back NOT verified). mySpark now always sends the header to the GO (`wrapBlock`, identical bytes). The LIVE doesn't need it (SparklingTones, Spark 2). **With the header, switching works:** slots 0 and 3 verified by read-back (owner log 2026-09-29). `VERIFIED-HW (owner, Spark GO, via mySpark app)`.
- **The GO reports Reverb's hidden on/off param (#7) in live state but not in the saved slot** ("expected 7 params, amp has 8" on "Upright Bass"). `presetDifferences` now compares params by index and **skips that hidden param entirely** (Noise Gate #2, Reverb #7): besides appearing on one side only, its value can disagree too. "Swell" had gate #2 = 0 in the slot but 1 in live state, with the gate on. The block's `enabled` flag, which is compared, is the real state. Everything else must still match.
- Name reply `0x0311` = "Spark GO". The app also sends the licence exchange `0x0170` / `0x0470` (not examined, by rule).
- **Tuner works on the GO from mySpark** (owner, 2026-09-29: "tuner works"): the LIVE's `0x0165` on/off, sent with the GO's block header, confirmed by `0x0265` read-back. `VERIFIED-HW (owner, Spark GO, via mySpark app)`.
- Not seen yet: knob changes, uploads (the official app plays ToneCloud presets on the GO fine, but that session wasn't logged: the snoop log had silently stopped; only an empty `btsnooz_hci.log` remained), levels on the GO. The GO stays **view-only** in mySpark until those are captured or owner-approved to try.

## 2026-09-29 — Spark GO preset upload (official app, snoop log)

`captures/raw/go5-btsnoop_hci.log` (RFCOMM). `VERIFIED-HW (owner, Spark GO, official app traffic)`:
- **Upload `0x0101` in 128-byte chunks** (3 chunks for a whole preset), sub-header `[total, index, size]`, **one seq for all chunks**, each message with the block header.
- **Target `[0x00, 0x03]`: straight into slot 3**, then `0x0138 [0x00, 0x03]` (ACK `0x0438`). No `0x7f` buffer seen.
- **ACKs reversed vs the Spark 2:** `0x0501` after each intermediate chunk, `0x0401` after the last. (`SparkTransport.writePreset` accepts either.)
- New: `0x0204 [prefixed string name, 0x00]` → `0x0304 [float]`: named settings. The app asked `SparkMini.PostComp` (0.35) and `SparkGO.ScenarioEQ` (0.0). Meaning UNVERIFIED; not used.
- Also seen: `0x0271` / `0x0272` → `0x0372 [c3 3c 00 1e]` (unknown, not used).
- **Resolved (owner, second log `go6`):** the slot-3 upload was the owner's **save to slot**. The first ToneCloud play wasn't logged (logging had stopped). A new **ToneCloud play went to `[0x00, 0x7f]`** (temporary buffer), then `0x0138 [0x00, 0x7f]`. So the GO has the same temporary buffer and save pattern as the LIVE; only chunk size (128), ACK order and the block header differ.
- mySpark now allows the GO: uploads to `0x7f` or slots 0–3 (128-byte chunks, 20-byte BLE writes) and switching to `0x7f`, enabling **Try** (AI, ToneCloud, My tones) and **Save to amp**. Needs an owner hardware test.

## 2026-09-28 — First contact with the Spark GO (mySpark app, reads only)

Owner's app log. `VERIFIED-HW (owner, Spark GO, via mySpark app)`:
- **BLE name `Spark GO BLE`.** Connects with the same service filter (`0xffc0`) and characteristics as the LIVE.
- **Answers** `0x0211` (name), `0x0223` (serial) and `0x0210` (current preset) promptly.
- **No answer** to `0x0233` (levels, three targets) or `0x021a` (channel presets): 2.5 s timeout each. The GO has no Guitar/Music/Master levels or second channel of that kind.
- **`0x0201 [0x00, n]` works for slots 0, 1, 2** (about 0.6 s each).
- **Slot 3 and the live state (`0x0201 [0x01, 0x00]`) arrived incomplete**: 13 good 0x0301 chunks with the request's seq, then nothing for 4 s. Probably the same preset (current = slot 3?). Cause unknown: pending a raw capture (tools/live-test session JSON).
- **Slots 4–7: a single 0x0301 chunk each**, then nothing. Consistent with the GO having **4 slots** (SOURCED soundshed); the single chunk is presumably its "no such slot" reply.
- App change: amp profiles by BLE name (`profileFor`). GO = 4 slots, no level or channel reads, **view-only** (controls disabled; the transport refuses writes too).

## 2026-09-28 — Built-in tuner, from the official app's traffic

From `captures/raw/btsnoop_hci.log.last` (official app on the owner's Spark LIVE, a tuner session on 2026-09-27). `VERIFIED-HW (owner, Spark LIVE, official app traffic)` unless marked:
- **On: `0x0165 [0xc3]`** → ACK `0x0465` → the amp streams **`0x0364 [note, 0xca float32]` about every 60 ms** (1,095 readings in ~70 s).
- **State: `0x0265` → `0x0365 [bool]`** (the app asks at connect; the reply was `c2` = off).
- **`note` = pitch class, C = 0 … B = 11**: the strings played gave 4, 9, 2, 7, 11, 4 = E A D G B E (standard tuning). **Float −1.0 = no signal.** Otherwise the value settles near **0.5 when in tune**.
- **UNVERIFIED:** off = `0x0165 [0xc2]` (not in the log; the app confirms it by reading `0x0265` back), and the scale 0–1 = −50…+50 cents (our reading of the data).
- App: **Tuner** button in the top bar, full-screen display with note, meter and cents. Closing (or Esc) turns the amp's tuner off and confirms. Needs an owner test: whether the amp mutes, whether off works, whether the cents scale feels right against another tuner.

## 2026-09-28 — The official Spark app's own data files (APK 4.6.2)

Owner request ("suck the spark.apk out and disassemble it"; "this is a personal app"). `com.positivegrid.spark` 4.6.2 (versionCode 10098) pulled from the owner's phone with `adb` into the git-ignored `captures/raw/apk/`. **No code was decompiled.** Everything below comes from plain JSON data files in the APK's `assets/`. Hard line kept: nothing about licence keys or unlocking paid content was looked at or used. The app is native Android (Kotlin/Java dex) plus native libraries; the protocol likely sits in `libpghw-lib.so` (not examined).

SOURCED (official app data, Spark app 4.6.2):
- **`assets/ModulePresets/<category>/<model>/data.json`**: the default block for every model, in ToneCloud's `{dspId, active, params[{index, value}]}` format. **`order.json`** per category: the official display names and order.
- **Reverb type values are NOT in display order.** Official list 01–09 and the value each default stores for param 6: Room Studio A 0.0, Chamber 0.2, Hall Natural 0.3, Plate Short 0.6, Hall Ambient 0.5, Plate Rich 0.7, Hall Medium 0.4, Plate Long 0.8, Room Studio B 0.1. SparklingTones had assumed 0, 0.1 … in display order, which gave wrong names; fixed in `catalog.ts` (`choiceValues`). The earlier "type 3.0 = Plate Short" readings were really **Hall Natural**.
- **Switches are stored as `true`/`false`**: UniVibe p1, SAB Driver p3, Cloner p1, the delays' BPM on Digital Delay / Echo Filt / Reverse / Multi Head. Others are stored as 0/1 integers (LA Comp p0, Vintage Delay p3, Echo Tape p4, Tremolator p2). The amp holds them as 0 / 1. So ToneCloud presets with `false` in a param are valid (fixed in `cloudToPreset`), and **Cloner's p1 is a switch, not "Depth"**.
- **App ids differ from what the amp reports** for some models, so the app renames when it talks to the amp: CH2 preamps `MicPreamp73` / `AcousticPreamp` / `BassPreamp` (amp: `Preamp73`, `ParaAcousticPreAmp`, `SansAmpBassDriver`), and Auto Wah `Vox846.Auto` (amp: `JH.Vox846`, per SparklingTones). This also confirms our inferred CH2 preamp name matches ("Acoustic Preamp", "Bass DI").
- Official display names: e.g. "MATCH DC", "Preamp 73", "J.H Tone City 100". The amp list order is by family, with the Hendrix amps placed among them.
- **Data files exist for models the app doesn't list** (not in any `order.json`): `AutoWah01`, `Leslie01`, `Qtron`, `BassOctaveEBS`, `DelayOla`, `AntiFeedback` (CH2), `MetalZoneMT2`, `TrebleBooster`. Not offered by mySpark.
- **CH2 (`ModulePresets-IN2`) chain slots:** Pedal1 (gate, comps, drives, wahs) → Preamp → Pedal2 (mods and delays, plus AntiFeedback) → Pedal3 (reverbs).
- Knob names are not in the assets (they're in code or resources): the names in `catalog.ts` remain SparklingTones'/Soundshed's, checked against the owner's screenshots where available.

## 2026-09-28 — Auto Wah is `JH.Vox846` too

Owner: "missing auto wah". SparklingTones (`src/spark-effetti.js`, Spark 2, two dedicated captures): Positive Grid's free **Auto Wah** (added 2026-09-02) and the Hendrix **J.H. Legendary Wah** are two entries in the official app but the **same model id `JH.Vox846`**, with 6 params. The difference is in the param values, not decoded. The picker now shows "J.H. Legendary Wah / Auto Wah".
- # TO DO (owner + AI): select Auto Wah in the official app on the LIVE, then read the live state from mySpark, to learn which param values make it "Auto". Then offer Auto Wah as its own choice that sets those values.

## 2026-09-28 — CH2 (mic / acoustic / bass) reads, from the official app's traffic

From the two snoop logs (`captures/raw/`, decoded; test vectors in `test/fixtures/live-captures.ts`). `VERIFIED-HW (owner, Spark LIVE, official app traffic)`:
- **`0x0201 [bank, n]`, which the official app pads to 32 bytes.** Banks: `0x00` CH1 slot, `0x01` CH1 live, **`0x03` CH2 slot, `0x04` CH2 live** (`BANK` in `protocol.ts`). mySpark reads CH2 in the padded form (`commands.getPresetAt`).
- **CH2 presets have 4 blocks** (vs CH1's 7), e.g. "Vocal - Lead": `MicComp → Preamp73 → BassEQ6 → bias.reverb`; "Bass - Overdriven Bass": `DistortionTS9 → SansAmpBassDriver → BassEQ6 → bias.reverb`. They parse and re-serialize byte for byte with the existing codec. The labels `Comp / Drive, Preamp, EQ / Mod, Reverb` are ours, descriptive of the models seen.
- **CH2-only model ids:** `MicComp`, `Comp76`, `VocalDrive`, `Preamp73`, `ParaAcousticPreAmp`, `SansAmpBassDriver`, `VocalChorus`, `VocalMellowReverb`, `VocalBrilliantReverb`. Matching `ParaAcousticPreAmp` to "Acoustic Preamp" and `SansAmpBassDriver` to "Bass DI" is our inference (UNVERIFIED).
- **`0x021a [0x92, 0x00, 0x01]` → `0x031a`** = fixarray of `[channel, preset, bool]` per channel, e.g. `92 00 03 c3 01 00 c2` = CH1 slot 3 (true), CH2 slot 0 (false). The bool turns true when a knob moves; "edited" is likely but UNVERIFIED. This also explains the unprompted `0x031a` in captures 2 and 3.
- **Not seen in either log:** switching a CH2 preset, uploading to CH2, or editing a CH2 knob. The app shows CH2 **view-only**. Next: a snoop log of the official app doing those on CH2.
- On CH1, the owner's slots have `GuitarEQ6` in the Modulation position: the Spark 2 "mod/EQ" slot works the same on the LIVE.

## 2026-09-28 — Owner decision: no warning for untried models in the picker

After every untried Spark 2 amp, pedal and Hendrix model they tried worked on the LIVE, the owner asked to "get rid of the not yet tried warning, just load the change". The model picker now switches to any model on the Spark 2 list without asking, and still verifies by read-back. Residual risk, accepted by the owner: a model the LIVE lacks could freeze it until power-off. The AI assistant is unchanged: it only uses models confirmed on this amp.

## 2026-09-28 — What the models are based on: Positive Grid's official list

Source: Positive Grid Help Center "Amp & Effect List" (article 8140276955917, updated 2026-09-27). The web page is behind a Cloudflare browser check; its text was read through the help centre's public Zendesk API (`/api/v2/help_center/en-us/articles/8140276955917.json`). SOURCED (official).
- **All 36 amps and the 12 Jimi Hendrix items list the gear they're inspired by.** Every amp matched SparklingTones' table.
- **The 51 effects are listed by Spark name only.** Six "inspired by" names (Clone Drive, Tube Drive, Black Op, Sustain Comp, Red Comp, Tremolator) come from Positive Grid's "Spark Effect List Rev20220827" PDF **as quoted by web search results**. The PDF itself (Scribd / device.report) couldn't be opened, so they're marked `realSource: 'secondary'` in `src/spark/catalog.ts`.
- **Correction:** when porting the catalogue, the AI had added "based on" names for five effects, guessed from their internal ids (Klon Centaur, Ibanez TS9, ProCo RAT, EHX Big Muff, Roland RE-201). That broke the "never invent" rule. Removed, or replaced by the secondary-source names where one exists.
- The same page says the **Jimi Hendrix pack stopped being sold on 30 April 2026**, lists **Auto Wah** among the Comp effects (SparklingTones: same id as `JH.Vox846`), and marks CH2-only items for the Spark LIVE: MIC Preamp 73, Acoustic Preamp, Bass DI, Comp 76, Mic Comp, Vocal Drive, Vocal Chorus, Vocal Echo, Vocal Mellow Reverb, Vocal Brilliant Reverb.
- # TO CONFIRM (owner): if you can open the Rev20220827 PDF, share it. It would confirm the six secondary names and fill in the rest.

## 2026-09-28 — Volume commands found in the official app's Bluetooth log

Source: Android HCI snoop log from the owner's phone (moto g power 5G 2023), official Spark app connected to the **Spark LIVE**. The owner moved **Guitar**, then **Music**, then **Master** from 0 to 100% (all three shown as 0–100% in the app). Decoded with `tools/snoop/decode-btsnoop.ts`. The Spark messages only are in `captures/2026-09-28-live-official-app-volumes.json`; the raw bug report and log stay in the git-ignored `captures/raw/` (they hold unrelated phone data).

`VERIFIED-HW (owner, Spark LIVE, official app traffic)`:
- **Set a level: `0x0133 [target, 0xca float32]`, no trailing `0x00`.** 175 writes during the three sweeps, values 0.0–1.0.
- **Targets in the order moved: `0x00` = Guitar, `0x05` = Music, `0x09` = Master.** `0x09` is also what the amp reports when the back-panel MASTER VOL knob turns (`0x0333 [0x09, float]`, capture 4).
- **No ACK** for `0x0133` (no `0x0433` in the log). Only a read proves it.
- **Read a level: `0x0233 [target]` → amp replies `0x0333 [0xca float32]`** (no target byte, same seq). The official app reads targets `05, 00, 01, 03, 04, 09, 0e` at connect (values then: 0.00, 0.25, 0.69, 0.41, 0.41, 0.53, 0.00).
- **Unknown targets `0x01`, `0x03`, `0x04`, `0x0e`: UNVERIFIED.** Candidates: CH2 VOL, CH3/4 VOL, MASTER LOW/MID/HIGH. Not used by mySpark.
- Other commands the official app used that no source documents: `0x019b`, `0x021a`, `0x022b`, `0x0272`–`0x0274`, `0x02a2`, `0x02a8`–`0x02aa`, plus the licence key `0x0170`. Not investigated.

mySpark's use (`commands.setVolume/getVolume`, `SparkTransport.changeVolume/readVolume/verifyVolume`, Guitar/Music/Master sliders with read-back): **owner report "vol sliders work"** — `VERIFIED-HW (owner, Spark LIVE, via mySpark app)`, 2026-09-28.

## 2026-09-28 — No volume command in SparklingTones

Owner asked for a guitar volume slider. Searched all of SparklingTones (latest commit is still `f25379d`): **no command for guitar, music or master volume.** Its protocol doc lists `0x0101 0x0104 0x0106 0x0115 0x0127 0x0138 0x0170 0x0175 0x0176 0x0201 0x022a 0x022f 0x0301 0x0315 0x031a 0x0337 0x0363 0x0376 0x0377 0x0401 0x0470`. The owner says the official Spark app *does* have a guitar volume control for the LIVE, so the next step is an Android HCI snoop log of the official app (instructions given 2026-09-28).

## 2026-09-28 — Model picker: untried Spark 2 models work on the LIVE

Owner test with the app's model picker: **"tried a few of the amps in not tried, all seemed to work, and other pedals. JH items worked fine too."** `VERIFIED-HW (owner, Spark LIVE, via mySpark app, 0x0106 + read-back)` for the models tried. Exactly which ones is recorded in the app's IndexedDB (`blocks:Spark LIVE BLE`), not here. None froze the amp.
- Evidence that the LIVE's guitar channel has the Spark 2 model list, but only for the models tried. Keep the warning for untried ones.
- **Hendrix (`JH.*`) models played from mySpark.** # TO CONFIRM (owner): had the official Spark app connected since the amp was last powered on? If not, the LIVE doesn't need the Spark 2's per-session unlock.
- `chrome://on-device-internals` on the owner's PC: **Device performance class: Medium**. That explains slow AI answers; the app now offers 2–4 suggestions per request (default 3) and reuses the primed system prompt.
- Owner asked for a master volume. The app now shows the tone's **Master** (amp param 4, settable via `0x0104`, verified) at the top of "Playing now", and the back-panel **MASTER VOL** knob read-only from `0x0333`. No command to *set* the panel master is known; none is guessed.

## 2026-09-28 — Owner owns the Jimi Hendrix pack

Owner statement: they have the Jimi Hendrix amps and pedals add-on. SparklingTones (Spark 2): `JH.*` models are silent after power-on until the official app unlocks them with a per-session licence key (`0x0170`) that other apps can't reproduce. **UNVERIFIED on the LIVE.** If a Hendrix model plays silent from mySpark, this is the first suspect. The model picker warns about it.

## 2026-09-28 — Tone editing and first AI suggestions (owner test)

- **Amp-block sliders (`0x0104`) and block on/off (`0x0115`) from the mySpark app work** — owner: "seem to work fine for the amp". `VERIFIED-HW (owner, Spark LIVE, via mySpark app)`. Other blocks are not editable yet (no verified knob map; catalogue not ported).
- **The on-device AI ran and produced suggestions** on the owner's PC (Chrome built-in model available).
- **Bug found:** suggestions start from the tone playing now and could not change the amp block's on/off, so after the owner had turned the amp block off, suggestions played with the amp off. Fixed: a suggestion always has the amp on.
- **Level jumps between suggestions** ("some very low and others very high"). The app can't hear the amp; the prompt now asks the AI to keep loudness near the current tone (guidance only). Measured levelling via the LIVE's USB-C audio is logged in `planning/ideas.md`.

## 2026-09-28 — App v1 works on the Spark LIVE

`web/` (ADR-0005) in Chrome on the Windows PC. Owner report: **"seems fine"** — connect with automatic read, preset list, tap-to-switch (`SparkTransport.switchPreset`, read-back verified), live chain view, backup. `VERIFIED-HW (owner, Spark LIVE, via mySpark app v1)` at that level of detail; no failures reported.

## 2026-09-28 — mySpark's first write: temporary-buffer load, verified by read-back

`tools/write-test/` in Chrome on the Windows PC. The owner read the 8 slots, picked one, and loaded it with `SparkTransport.loadPreset`. Owner report: **sounds right, page showed "✓ Verified", preset LED blinked.**

`VERIFIED-HW (owner, Spark LIVE, via mySpark tools/write-test)`:
- mySpark's own `0x0101` upload to `[0x00, 0x7f]` (one seq for all chunks, per-chunk ACK wait) + `0x0138` switch to `0x7f` works.
- **The read-back comparison passes on live state**: `0x0201 [0x01, 0x00]` returns the preset with uuid, name, version, description, icon, bpm and every block/param exactly as written (float32). The UNVERIFIED note in `src/spark/verify.ts` about metadata is resolved — no need to relax the check.
- **The PRESET LED blinks while the amp plays the temporary buffer** (resolves the earlier TO CONFIRM; SparklingTones reported the same on the Spark 2).
- **"Lower Gain by 1.0" was ticked** (owner): the verified preset was a *modified* copy of the slot (amp Gain −0.1 on the 0–1 scale), so the upload carried our change, not just the slot's own bytes.

Still not done by mySpark: slot writes (`storePreset`), `setBpm`, and single-knob / on-off / model writes.

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
