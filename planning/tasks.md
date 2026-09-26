# Tasks — approved work

Only the owner moves items here from `ideas.md`. The AI works only on items in this list.

## Setup (confirmed in ground-truth session, 2026-09-26)

- [x] Add `.gitignore` covering `node_modules/`, `dist/`, `.env`, keystores (`*.jks`, `*.keystore`)
- [x] Add `.env.example` (variable names only)
- [x] Make the first commit, including the ground-truth files
- [ ] Add ESLint + Prettier with default settings; record config locations in `docs/coding-standards.md`
- [ ] Add Vitest; write unit tests for the frame codec
- [ ] Label every protocol constant in `src/spark/` with `VERIFIED-HW` / `SOURCED` / `UNVERIFIED` (see `knowledge/lessons-learned.md`)

## Goal: working controller

- [ ] Decide Android delivery (PWA vs. Capacitor) — ADR-0002
- [ ] Capture real frames from the owner's Spark 2 to use as verified test vectors
