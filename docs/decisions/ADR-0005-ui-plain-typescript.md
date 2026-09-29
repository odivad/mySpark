# ADR-0005: App UI in plain TypeScript, no framework, no bundler

- Status: Accepted
- Date: 2026-09-28
- Decider: project owner ("let's go" to the recommendation, 2026-09-28)

## Context

The first mySpark write was verified on the Spark LIVE (see `knowledge/lessons-learned.md`), so the next step is the app itself. `docs/architecture.md` left the UI framework open, and ADR-0004 expected a bundler (e.g. Vite) to ship TypeScript to the browser.

The test pages (`tools/live-test/`, `tools/write-test/`) already show that `tsc` output runs in Chrome unchanged: ES2022 modules with `.js` import suffixes load natively.

Options:
1. **Plain TypeScript + DOM, compiled by `tsc`** — no new dependencies.
2. A small framework (Preact, Svelte) — tidier as the UI grows; adds dependencies and, for Svelte, a compiler/bundler.

## Decision

1. Build the app UI in **plain TypeScript with the DOM API**. No framework.
2. **No bundler.** `tsc -p tsconfig.app.json` compiles `src/` into `web/js/`; `web/` is the whole deployable app (HTML, CSS, manifest, service worker, icons, compiled JS). This supersedes ADR-0004's "a web bundler is needed".
3. `src/spark/` stays DOM-free (`tsconfig.json`, lib ES2022 only). Only `src/app/` gets DOM types (`tsconfig.app.json`).

## Consequences

- No new dependencies.
- UI code does its own rendering; keep it small and split pure logic (formatting, backup building) into DOM-free modules that Vitest can test.
- Revisit if the UI outgrows hand-written rendering (e.g. the full knob editor): adding a framework then is a new ADR and needs owner approval for the dependency.
