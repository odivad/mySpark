# ADR-0001: Initial project setup and ground truth

- Status: Accepted
- Date: 2026-09-26
- Decider: project owner

## Context

mySpark is a personal BLE controller for a Positive Grid Spark 2. The repo had a TypeScript skeleton and reverse-engineering notes but no governance, tests, or tooling. The owner ran the *Repo of Truth* setup session (The AI Teammate, ch. 15) to establish ground truth for AI-assisted development.

## Decisions

1. **AI:** Claude only, via the Claude Code VS Code extension. Operating file: `CLAUDE.md`.
2. **Goal:** a working controller for the owner's amp.
3. **Platforms:** Windows PC (web) and Android, same functions, built once.
4. **Language/stack:** TypeScript (strict), npm, NodeNext modules — keep as is.
5. **Source of truth:** the amp. Source authority order: amp > SparklingTones > other repos.
6. **Protocol honesty:** every protocol detail labelled `VERIFIED-HW` / `SOURCED` / `UNVERIFIED`.
7. **Amp safety:** firmware/system commands banned. Live-state changes and saved-slot writes require owner approval + hardware test.
8. **Testing:** Vitest; unit tests mandatory for codec changes; no coverage target.
9. **Tooling:** ESLint + Prettier with defaults.
10. **Persistence:** local JSON files for preset backups.
11. **Secrets:** local gitignored `.env`; keystore outside the repo.
12. **Dependencies:** pragmatic; each new one approved by the owner.
13. **CI:** none now; GitHub Actions later.
14. **Design docs:** ADRs in `docs/decisions/`; existing `docs/` protocol files remain the architecture source.

## Open

- **Android delivery:** PWA via Web Bluetooth (one codebase, Chrome on Android, no store) vs. Capacitor wrapper (native BLE plugin, Play Store possible). Undecided → ADR-0002.
- UI framework — undecided.

## Alternatives considered

- Other AI models / a mix → rejected; Claude only.
- Zero-dependency policy → rejected in favor of pragmatic.
- Transport-abstraction and pure-codec patterns as standards → not adopted now; kept in `planning/ideas.md`.

## Note

Solo project: all roles (developer, lead, security owner) held by one person. The book recommends a second reviewer for the output when available.
