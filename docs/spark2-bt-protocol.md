# Spark 2 architecture notes

This document is intentionally limited to the architectural model of the Spark 2 system as reverse-engineered in the SparklingTones project. It focuses on the system structure, state model, and responsibilities, not on raw byte-level protocol details.

## 1) System overview

The app is effectively a browser-based controller and librarian for a Positive Grid Spark 2 amplifier over Bluetooth.

At a high level, the architecture has four major layers:

1. Device layer
   - The amp exposes a Bluetooth interface and maintains the active sound, preset slots, and effect state.
2. Transport layer
   - The app talks to the amp over BLE and must handle fragmentation, session state, and asynchronous message delivery.
3. State layer
   - The app rebuilds the current amp state as structured objects: active preset, library presets, effect chain, parameter values, and slot metadata.
4. UI layer
   - The UI presents preset browsing, live control, editing, and library management without requiring an underlying local database to be the source of truth.

The important architectural rule is that the amp remains the source of truth. Any browser-side library or editor state must be treated as a cache or projection of the real amp state.

## 2) Core architectural idea

The app is not a generic preset manager. It is a bidirectional state mirror of the amp.

It does three things continuously:

- read the real amp state,
- normalize that state into an internal model,
- write changes back to the amp with the right operation semantics.

This produces a clean separation between:

- device state
- local library state
- UI state
- command execution state

That separation is what makes the project work across live editing, preset reads, and saved-slot management.

## 3) Device-facing model

The amp exposes a set of logical state domains:

- live current sound / active preset
- saved preset slots
- effect chain and block models
- effect enable state
- numeric parameter values
- preset metadata such as name, UUID, version, BPM, and notes

The app treats these as part of one coherent model even though they originate from different BLE operations and different device lifecycles.

## 4) Preset memory model

The world the app works in is best understood as two parallel spaces:

### A) Live state

This is the sound currently being played by the amp.

It is conceptually distinct from a saved slot and may be represented as a transient software buffer or an active session state before being committed to a hardware slot.

### B) Hardware preset slots

The amp has a banked preset map, organized into slots.

From an app perspective, the logical memory map is:

```text
Live state / current sound
  -> active sound in the amp
  -> possible software buffer / staging state

Saved preset slots
  -> slot 0..7
  -> A1..A4 / B1..B4 mapping
  -> presets stored and recalled by the amp
```

This distinction is critical because the app must never confuse a transient live buffer with a stored preset.

## 5) Library and browser-side storage

The app also keeps a user library in the browser, separate from the amp’s slots.

This library stores:

- preset records
- names and labels
- categories / grouping metadata
- notes and family tags
- user-managed metadata
- imported/exported backup content

This is a personal collection layer, not the amp's own internal bank.

The architecture is therefore:

```text
Amp hardware state
  -> normalized app state
  -> user library records
  -> UI presentation
```

The library is a persistent organizational layer around the amp state, not a replacement for it.

## 6) Effect and parameter model

Each preset consists of a chain of blocks/effects, each with its own:

- model name / type
- enabled or disabled state
- parameter array
- normalized parameter values

A preset is not just a single parameter blob; it is a structured object graph:

```text
Preset
  -> metadata
  -> effect chain
      -> block model
      -> block state
      -> parameter list
```

This structure is what allows the editor to operate on an effect while the amp is still playing, because the app is editing a representation of the current chain rather than a detached static JSON-only model.

## 7) Read/write architecture

The app uses a predictable lifecycle for device communication:

1. Read from the amp
2. Parse and normalize
3. Update UI and local model
4. User changes a preset or parameter
5. Serialize the change
6. Write to the amp
7. Re-read or confirm from the amp

This read-then-write-then-verify pattern is a design requirement, not an optimization.

The reason is simple: the amp is the truth source, and the app must confirm that its own change was actually applied before it claims success.

## 8) Session and transport design

The Bluetooth layer must manage:

- fragmented reception
- stateful message reassembly
- out-of-order or incomplete payload handling
- retry-safe writes
- confirmation paths that distinguish ACK from execution

From a software architecture standpoint, the transport layer is deliberately isolated from the library model so the higher-level app can stay stable even when the device behavior is timing-sensitive or inconsistent.

## 9) UI architecture

The UI is divided into two conceptual experiences:

### Live view

This is a quick action surface for playing and switching presets while the amp is in use.

It is optimized for speed and direct interaction, not deep metadata management.

### Library view

This is the catalog and editing surface.

It stores, filters, tags, names, and organizes presets so users can manage collections beyond the amp’s limited immediate bank.

These are different views over the same underlying model, which is a strong architectural choice because it avoids duplicating state across modes.

## 10) Architectural invariants

The project depends on a few invariants:

- the amp is authoritative
- live state and stored slots are distinct
- library data is a user-managed extension layer
- effects and presets are structured objects, not flat blobs
- verification after writes is mandatory
- the UI is a projection of the real device state, not the source of truth

## 11) Practical system map

A simplified internal map looks like this:

```text
[Browser app]
  |
  +--> UI layer
  |      - Live view
  |      - Library view
  |      - editor
  |
  +--> State model
  |      - active preset
  |      - saved slot map
  |      - effect list
  |      - parameter objects
  |
  +--> Transport adapter
         - BLE session
         - fragment handling
         - command dispatch
         - read/write validation

[Positive Grid Spark 2]
  -> active sound state
  -> hardware preset slots
  -> effect chain
  -> parameter values
```

## 12) Summary

The architecture is a classic device-controller model:

- the amp owns the real state,
- the browser app mirrors and manipulates it,
- the library is a user-organized layer on top,
- and the UI is just the presentation layer on top of that model.

The essential design idea is not “we know the protocol”; it is “we model the amp as a structured state machine and keep the UI, library, and transport layers aligned around that model.”
