# AI tone assistant: standard prompt and result format

The spec for the tone assistant in the app. The code that implements it is `src/app/tone-ai.ts`. Change the two together.

## Where the AI runs

- **The browser's built-in model**: Chrome's Prompt API (Gemini Nano, on-device). Edge offers the same API with its own model. Adapter: `src/app/browser-ai.ts`.
- **No API key and no network call.** The prompt and the answer stay on the PC.
- **Availability depends on the device.** It needs desktop Chrome or Edge with the built-in model, and enough graphics or system memory plus disk space for the model download. As far as we know it isn't available in Chrome for Android. The app checks at start and shows the status next to the panel title.
- **UNVERIFIED:** not yet run on the owner's PC.

## What a suggestion is

Each suggestion is a **standalone tone built from the request**. It isn't a variation of the tone playing now (owner decision, 2026-09-28). The AI chooses:

| Field | Allowed values | Notes |
|---|---|---|
| Model for every position | **Only models confirmed on this amp**: read from its slots or live sound, or switched to in the model picker and verified | A model brings the params it had on the amp. The prompt also lists the rest of the Spark range, with real names, marked "do NOT choose". |
| On/off for `noiseGate`, `compWah`, `drive`, `modulation`, `delay`, `reverb` | true / false | The amp block is **always on** (owner test 2026-09-28: inherited "amp off" gave silence). |
| Amp `gain`, `treble`, `middle`, `bass` | 0–10 (panel scale), rounded to 0.1 | Param indices 0/1/2/3, VERIFIED-HW on the Spark LIVE. |
| Name | Plain ASCII, at most 24 characters | Non-ASCII is stripped: the preset encoder writes one byte per character. |
| Description | Plain ASCII, at most 140 characters | Shown in the app only; not sent to the amp. |

**Taken from the amp's current state, as playback settings rather than tone:** master volume (so suggestions play at the owner's listening level), BPM (so delays keep time), and the preset's container fields (uuid, version, description, icon).

**Loudness:** the prompt asks the AI to aim for similar loudness across suggestions. That's guidance, not measurement: the app can't hear the amp. A measured fix is logged in `planning/ideas.md`.

**Model knowledge:** every model id is given with its Positive Grid name, the gear it's modelled on, and its family, from `src/spark/catalog.ts` (ported from SparklingTones/Soundshed). That includes the Jimi Hendrix pack, which the owner has. On the Spark 2, Hendrix models are silent until the official app unlocks them each power-on; UNVERIFIED on the LIVE.

## Standard prompt

Built by `buildPrompt(request, palette, count)`. The system prompt is fixed. The app processes it once and reuses it (`warmUp` and `clone()` in `src/app/browser-ai.ts`), so each request only processes the user message.

**System message:**

```
You are a guitar tone assistant for a Positive Grid Spark LIVE amplifier.
A tone is a fixed chain of seven positions, in this order: noiseGate, compWah, drive, amp, modulation, delay, reverb.
Each suggestion is a complete tone built from scratch for the request. For each one you choose:
- the model for every position, using ONLY the model ids listed for that position. Never invent a model id;
- which of noiseGate, compWah, drive, modulation, delay and reverb are on (the amp is always on);
- the amp knobs gain, treble, middle and bass, each from 0 to 10 like the knobs on the amp panel.
Use what you know about the Spark LIVE and the amps and effects it models to choose; the ids are the amp's internal names for them.
Do not set the master volume; it is not part of the answer.
All suggestions play at the same master volume, so aim for similar loudness across them: balance gain against drive and amp choice (for example use less amp gain with a drive on or a hot amp model, more with a clean one).
Give each suggestion a short name (at most 24 characters, plain ASCII) and a one-sentence description of how it should sound and why.
Make the suggestions meaningfully different takes on the request.
Answer with JSON only, matching the given schema. No other text.
```

**User message** (filled in per request):

```
Models you may choose, per position, as "id = name (inspired by, family)":
- noiseGate: bias.noisegate = Noise Gate
- compWah: <id> = <name>; …
  (also in the Spark range but not yet confirmed on this amp, do NOT choose: <name (real, family)>; …)
- drive: …
- amp: 94MatchDCV2 = Match DC (Matchless DC30, Clean); …
- modulation: …
- delay: …
- reverb: bias.reverb = Reverb

Request: <what the user typed, or "Suggest a few useful, different guitar tones.">

Give <count> suggestions.
```

`count` defaults to 4.

## Expected result format

JSON only. The browser model is given this JSON Schema as a response constraint (`suggestionSchema(palette, count)`), so the answer should already match it. The `enum` lists are filled from the models read from the amp.

```json
{
  "suggestions": [
    {
      "name": "Warm blues",
      "description": "Less gain and more middle for a round, vocal blues crunch.",
      "amp": { "gain": 3.5, "treble": 5, "middle": 7, "bass": 5 },
      "on": { "noiseGate": true, "compWah": false, "drive": true,
              "modulation": false, "delay": false, "reverb": true },
      "models": { "noiseGate": "bias.noisegate", "compWah": "…", "drive": "…",
                  "amp": "…", "modulation": "…", "delay": "…", "reverb": "bias.reverb" }
    }
  ]
}
```

- `suggestions`: 1 to `count` items.
- Every item needs `name`, `description`, `amp` (all four knobs), `on` (all six switchable positions) and `models` (all seven positions). No other keys.

## Checks before anything reaches the amp

The AI is never trusted. `checkSuggestion` re-checks every item, whether or not the schema was followed:

1. The answer must parse as JSON with a `suggestions` list. A ```` ```json ```` fence is tolerated, and nothing else.
2. Each position needs a model, and it must be one confirmed on this amp for that position. Otherwise the suggestion is **rejected**. Asking an amp for a model it lacks can freeze it until power-off (SparklingTones).
3. All four knob values must be numbers, and are clamped to 0–10. All six on/off values must be booleans. Otherwise the suggestion is rejected.
4. Name and description are reduced to ASCII and length-capped.
5. The resulting preset must pass `validatePreset` with the models read from this amp as the known-model list.

Rejected suggestions are shown with their reasons, and there's no Try button for them.

## Trying and saving

- **Try** plays the suggestion in the temporary buffer `0x7f` through `SparkTransport.loadPreset`: upload, switch, then read-back and compare. **No saved slot changes.** Pressing PRESET on the amp goes back to the saved sounds.
- **Save** stores the tone in **My tones**, an IndexedDB database in this browser on this device (`src/app/tone-db.ts`). **Apply** plays a saved tone the same way as Try, after checking its models against every model ever read from this amp (kept in the same database). **Export** downloads all saved tones as JSON.
