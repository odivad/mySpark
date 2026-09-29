# Security — mySpark

Security owner and final authority: the project owner (solo project). When uncertain, the AI stops and asks the owner.

The non-negotiable AI rules are in `ai/ai-security-baseline.md`. This file covers project-specific security.

## 1. Amp safety — highest risk

The main risk on this project is damaging the amp's state or the amp itself.

### Banned
- **Firmware update, factory reset, and other system-level commands.** Never implemented, never sent.

### Always requires owner approval + hardware test before acceptance
- Code that changes **live amp state**: effect on/off, parameter values, block/model changes, loading a preset into the active sound, BPM.
- Code that **writes to saved preset slots**.

### Rules for any state-changing code
- Follow the write pattern in `docs/spark-interface-spec.md` §10: read current state → serialize → send → read back → confirm.
- A transport ACK is not proof of execution.
- Handle the trailing `0x00` rule (§11) explicitly — silent failure risk.
- Commands built on `UNVERIFIED` protocol details must not be sent to the amp until the owner has reviewed them.

## 2. Secrets

Secrets this project will handle:

| Secret | Storage |
|---|---|
| Android signing keystore | Outside the repo, in a gitignored location. Path/password referenced via `.env`. # TO CONFIRM: keystore is a binary file — it cannot live inside `.env`; decide its location. |
| Positive Grid account / cloud credentials | Local `.env`, gitignored |
| Hosting / deploy tokens | Local `.env`, gitignored; GitHub Actions secrets once CI exists |

Rules:
- `.env`, keystores (`*.jks`, `*.keystore`), and signing configs are never committed.
- Commit a `.env.example` with variable names only, no values.
- Never hardcode, log, or echo a secret — including in tests and error messages.
- Positive Grid account integration is not currently a task. Any work touching it requires owner approval first.

## 2a. Tone assistant (AI)

- Uses the **browser's built-in on-device model** (Chrome Prompt API). No API key, no account, no network call: prompts and answers stay on the PC.
- AI output is untrusted input. Every suggestion goes through `checkSuggestion` (`src/app/tone-ai.ts`): models limited to those read from this amp, values type-checked and clamped, master volume excluded, `validatePreset` with known models. It is only ever played in the temporary buffer `0x7f`, never written to a slot. See `docs/ai-tone-assistant.md`.
- If a cloud AI service is ever considered instead, that means a secret (API key) and data leaving the device, so it needs a new decision by the owner first.

## 2c. ToneCloud

- Unofficial Positive Grid API, called directly from the browser (no proxy), without credentials or cookies. Only user-initiated searches and fetches; no bulk downloading or redistribution.
- A ToneCloud preset is untrusted input: `cloudToPreset` type-checks it, and it may only be tried or saved if every model is on the Spark 2 list or confirmed on the connected amp. It is only played in the temporary buffer `0x7f`.
- Creator profile data is not shown or stored.

## 2d. Writes per amp

- `writeAllowed` (`src/spark/transport.ts`) decides which write commands reach which amp: the **Spark LIVE** all; the **Spark GO** only the preset switch `0x0138 [0x00, n]` (owner approved 2026-09-28, after the official app's log showed it and the GO ACKing it) and the tuner on/off `0x0165` (owner asked 2026-09-29; the GO answers the tuner-state query, the on/off form is the LIVE's and is confirmed by read-back; owner confirmed it works), and whole-preset uploads `0x0101` whose target is the temporary buffer `0x7f` or slots 0–3, plus switching to `0x7f` (both seen from the official app on the GO, 2026-09-29); anything else none. Widening it for the GO needs captured evidence and owner approval.

## 2b. Model changes

- The model picker sends any model on the Spark 2 list (`src/spark/catalog.ts`) without a warning: **owner decision, 2026-09-28**, after every untried model they tried worked on the LIVE. Accepted residual risk: a model the amp lacks can freeze it until power-off (SparklingTones, Spark 2).
- AI suggestions and saved tones stay limited to models confirmed on the connected amp.

## 3. Privacy and compliance

- No personal data of other people is handled. No compliance regime (SOC 2, GDPR, etc.) applies to this personal project.
- If the project is ever released publicly, revisit this section. # TO CONFIRM when scope changes.

## 4. Dependencies

Pragmatic policy: well-maintained dependencies are acceptable. Every new dependency is flagged for owner approval. Flag known vulnerabilities, unmaintained packages, or packages requesting unusual permissions (especially BLE/native plugins).

## 5. Automated scanning

None yet. # TO CONFIRM: add `npm audit` and secret scanning when GitHub Actions is set up.
