# ADR-0004: Deliver as one installable web app (PWA) for PC and Android

- Status: **Accepted** (2026-09-28) — Android test passed: SparklingTones in Chrome on the owner's Android phone connected to the Spark LIVE
- Date: 2026-09-28
- Decider: project owner

## Context

The owner's requirement: mySpark must run on a **Windows PC (web is fine)** and on **Android**, with the same functions.

Options:
1. **PWA using Web Bluetooth** — one web app. Chrome/Edge on the PC; Chrome on Android, installed to the home screen. No app store.
2. **Capacitor wrapper** — the same web code inside a native Android shell with a native BLE plugin. Needed only for Play Store distribution or things Web Bluetooth can't do.

Evidence for option 1: SparklingTones is exactly this kind of PWA, and the owner has already used it from Chrome on the PC to control the Spark LIVE (2026-09-28).

## Decision

Build mySpark as a **PWA using Web Bluetooth**, one codebase for both platforms. Keep the BLE code behind the transport layer so a Capacitor/native transport can be added later without touching the protocol code.

## Acceptance test

Owner opens SparklingTones (https://mazzrelaz.github.io/SparklingTones/) in **Chrome on the Android phone**, connects to the Spark LIVE, and reads the presets. If that works, Web Bluetooth works on that phone with that amp → Accepted.

## Known limits of Web Bluetooth (from platform docs; to confirm on the owner's phone)

- Chrome or Edge only (not Firefox). Android: Chrome. iOS is not supported — not a target.
- Must be served over **https** (or localhost). Hosting: GitHub Pages from the public repo — # TO CONFIRM.
- Connecting needs a tap on a Connect button and the device picker, each session.
- Android needs Bluetooth on and Chrome allowed "Nearby devices" (and on older Android, Location).
- The connection may drop when the screen locks or the app is backgrounded.

## Consequences

- A web bundler is needed to ship the TypeScript to the browser (e.g. Vite) — new dependency, needs owner approval.
- PWA pieces needed: web manifest, service worker for offline use, icons.
- Capacitor stays an option; revisit if the Android test fails, or if the Play Store or background connection becomes a requirement.
