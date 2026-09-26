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

## 3. Privacy and compliance

- No personal data of other people is handled. No compliance regime (SOC 2, GDPR, etc.) applies to this personal project.
- If the project is ever released publicly, revisit this section. # TO CONFIRM when scope changes.

## 4. Dependencies

Pragmatic policy: well-maintained dependencies are acceptable. Every new dependency is flagged for owner approval. Flag known vulnerabilities, unmaintained packages, or packages requesting unusual permissions (especially BLE/native plugins).

## 5. Automated scanning

None yet. # TO CONFIRM: add `npm audit` and secret scanning when GitHub Actions is set up.
