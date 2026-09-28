# ADR-0002: Target amps are Spark GO and Spark LIVE, not Spark 2

- Status: Accepted
- Date: 2026-09-28
- Decider: project owner
- Amends: ADR-0001 (context and goal)
- Updated by: ADR-0003 — the Spark LIVE turned out to speak the Spark 2 protocol (proven via SparklingTones on 2026-09-28), so points 2–3 below are outdated: the LIVE is now the better-understood amp.

## Context

ADR-0001 and the initial docs assumed a Positive Grid **Spark 2**, because the reverse-engineering notes in `docs/` came from SparklingTones, a Spark 2 project. The owner does not have a Spark 2. The owner's amps are a **Spark GO** and a **Spark LIVE**.

## Decision

1. mySpark targets the owner's **Spark GO** and **Spark LIVE**. Spark 2 is out of scope.
2. **Spark GO first.** It is the better-documented model: soundshed describes it as Spark 40-family (service `ffc0`, write `ffc1`, notify `ffc2`, 4 preset slots, `04` chunk ACKs, no live sync) — all `SOURCED (soundshed)`, not yet hardware-verified.
3. **Spark LIVE is unknown.** No public protocol documentation was found (checked soundshed, SparklingTones, GitHub search on 2026-09-28). Nothing about its protocol may be assumed; it is learned from the owner's captures only.
4. The existing Spark 2 docs (`docs/spark-interface-spec.md`, `docs/spark2-bt-protocol.md`) stay as **Spark 2 reference material**, not as the spec for this project. General ideas (amp is source of truth, write verification) still apply; byte-level details do not carry over without evidence.
5. Code must handle **per-model differences** (slot count, ACK behavior, write size). Model is detected at connect time, not assumed.

## Consequences

- `SlotIndex` in `src/spark/types.ts` is `0–7` (Spark 2). Spark GO has 4 slots (SOURCED). Spark LIVE slot count unknown.
- The source authority order (amp > SparklingTones > others) was revisited in ADR-0003.
- First hardware work: capture frames from **both** amps with a read-only tool.

## Open

- Android delivery (PWA vs. Capacitor) → ADR-0004.
