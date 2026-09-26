# Approved Patterns

Patterns confirmed by the owner. Changing one requires updating this file in the same change.

## 1. The amp is the source of truth

- Local state (`SparkDeviceState`) and local JSON preset files are caches/projections of the amp.
- A state-changing operation succeeds only after it is read back from the amp and confirmed (spec §10: read → serialize → send → read back → confirm).
- A BLE ACK means "received," not "executed."
- On conflict between local state and the amp, the amp wins.

## 2. Keep the existing style

Follow the conventions already in `src/` — see `docs/coding-standards.md` for the list (camelCase/PascalCase, `Spark` prefix, named exports, `.js` import suffixes, lowercase hex).

## 3. Verification-status labels on protocol details

Every protocol constant or claim carries `VERIFIED-HW`, `SOURCED` (with citation), or `UNVERIFIED`. Added in session as the guardrail for the owner's top concern: invented protocol details.

---

Considered but **not** adopted as standards (see `planning/ideas.md`): transport abstraction, pure protocol codec.
