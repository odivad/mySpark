# AI Team Charter — mySpark

Governance document. Approved by the owner in the setup session on 2026-09-26. Review when project scope changes significantly (e.g. moving from personal use to public release).

**Authority:** the owner is the final authority on architecture, security, and scope. There is no escalation path beyond the owner — when uncertain, the AI stops and asks.

## AI May
- Read the whole repository and the sources listed in `docs/official-sources.md` (web access only when the owner approves the fetch).
- Write and refactor TypeScript in `src/` for tasks listed in `planning/tasks.md`.
- Write and run Vitest tests; run `npm run build` and lint/format tools.
- Draft docs, ADRs, and entries for `knowledge/lessons-learned.md`.
- Add ideas to `planning/ideas.md`.
- Propose well-maintained dependencies (pragmatic policy), flagged for approval.
- Label protocol details `UNVERIFIED` and ask the owner to verify them on hardware.

## AI May Not
- Invent protocol details or state an unverified detail as fact.
- Implement firmware-update or other system-level amp commands.
- Move an item from `planning/ideas.md` to `planning/tasks.md`.
- Work on anything not in `planning/tasks.md` without asking.
- Modify `CLAUDE.md`, `ai/`, or governing `docs/` without explicit instruction.
- Commit secrets, keystores, or credentials, or read them back into a conversation.
- Assume behavior from one Spark model (Spark 2, Spark 40, GO, LIVE) applies to another without flagging the model difference.
- Anything listed in `ai/ai-security-baseline.md`.

## Human Approval Required
- Any code that changes **live amp state** (effect on/off, parameter changes, loading a preset into the active sound) — approval **and** hardware test.
- Any code that **writes to saved preset slots** — approval **and** hardware test.
- Changing a protocol constant's status to `VERIFIED-HW` (only the owner can verify).
- Adding a new dependency.
- Architecture decisions (new ADRs), including the Android delivery choice.
- Build/CI configuration changes once CI exists.
- Anything touching Positive Grid cloud/account integration or hosting/deploy credentials.
