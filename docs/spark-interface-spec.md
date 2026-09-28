# Spark Bluetooth Interface Specification

> **Reference only — Spark 2.** This project targets the Spark GO and Spark LIVE, not the Spark 2 (see `docs/decisions/ADR-0002-target-amps.md`). General architecture ideas here still apply; byte-level details do not carry over without hardware evidence.

This document describes the Bluetooth interface implemented by a Spark-like client for the Positive Grid Spark 2 amplifier. It is written as an implementation guide for a device controller, not as a product-facing app spec.

## 1) Interface purpose

The amp exposes a BLE control surface that allows a client to:

- read the current amp state,
- read saved preset slots,
- read effect and parameter data,
- write preset changes,
- switch between live and saved states,
- and keep the client synchronized with the amp.

The core idea is simple: the amp is the authoritative state holder, and the client is a protocol implementation that mirrors and manipulates that state.

## 2) Transport contract

The Bluetooth interface is exposed through GATT characteristics:

- Service: `0xFFC0`
- Write characteristic: `0xFFC1`
- Notify characteristic: `0xFFC2`

### Transport rules

- `0xFFC1` is write-without-response only.
- The client must handle fragmented notifications.
- The client must treat ACKs as receipt signals, not as proof of execution.
- A write is only considered valid after a subsequent read or a verified device change.

This means the protocol distinguishes between:

- message delivery,
- command acceptance,
- real execution,
- and observable state change.

## 3) Message framing

The amp sends payloads in framed BLE notifications.

The effective wire format is:

```text
F0 01 <seq> <checksum> <cmd> <sub> <packed_data> F7
```

Meaning:

- `F0` = start delimiter
- `01` = protocol envelope marker in the observed stream
- `<seq>` = sequence value for the message / chunk
- `<checksum>` = XOR checksum over the packed payload bytes
- `<cmd>` = command group
- `<sub>` = subcommand or target selector
- `<packed_data>` = compressed field payload
- `F7` = end delimiter

A client must reassemble incoming notify fragments until a complete `F0 ... F7` frame is present.

## 4) Data encoding rules

### 4.1 7/8-bit packing

The packed data uses a compact 7-bit encoding scheme:

- every 7 real bytes are preceded by a `bits8` byte,
- that byte carries the high-order bits for the next 7 payload bytes,
- the scheme is LSB-first,
- and the reserved frame markers are avoided inside the packed data.

This allows the client to safely reassemble a message without ambiguously merging partial payloads.

### 4.2 Checksum

Checksum is an 8-bit XOR of the packed payload bytes only, excluding the framing bytes.

This is a lightweight integrity check used to confirm the payload survived the transport layer.

### 4.3 Float values

Parameter values are represented as normalized floating-point values in a device-defined encoding, typically as float32-like values in a normalized 0.0..1.0 domain for effect controls.

The client must decode those values into a software model before exposing them to the UI or library layer.

## 5) Device state model

The core abstraction implemented by the client is a modeled device state, not a raw byte stream.

```text
SparkDevice
  ├─ Live state / current sound
  │   ├─ active preset or staging buffer
  │   ├─ active effect chain
  │   ├─ enabled state of effects
  │   └─ normalized parameter values
  │
  ├─ Saved presets
  │   ├─ slot 0
  │   ├─ slot 1
  │   ├─ slot 2
  │   ├─ slot 3
  │   ├─ slot 4
  │   ├─ slot 5
  │   ├─ slot 6
  │   └─ slot 7
  │
  └─ Preset data model
      ├─ bank
      ├─ slot number
      ├─ UUID
      ├─ name
      ├─ version
      ├─ description
      ├─ icon
      ├─ BPM
      ├─ effect list
      ├─ parameter list
      └─ checksum
```

## 6) Preset memory map

The amp exposes presets as structured records. The client must model them as typed objects rather than unstructured blobs.

### Preset record

```text
PresetRecord
  1. bank
  2. slot number
  3. UUID
  4. name
  5. version
  6. description
  7. icon
  8. BPM
  9. effect list
 10. trailing values for saved presets
 11. checksum
```

### Effect record

```text
EffectRecord
  1. effect name or model identifier
  2. enabled flag
  3. parameter array
```

### Parameter record

```text
ParameterRecord
  1. parameter index
  2. invariant marker byte or token
  3. normalized float value
```

This is the logical memory map the app is reconstructing from the device.

## 7) Live state vs saved state

The most important state split is this:

```text
LIVE STATE
  - current sound currently being played
  - active preset / staging state
  - effect chain as heard now

SAVED STATE
  - hardware preset slots
  - banked content on device
  - library records managed by the client
```

These are distinct domains. A preset may be in a saved slot but not active. A live state may exist without being stored in a hardware slot. The client must never conflate the two.

## 8) Slot bank mapping

The device has eight logical slots, numbered 0 through 7.

The physical panel uses two-color LEDs and exposes them as banked slots:

```text
A1 = slot 0
A2 = slot 1
A3 = slot 2
A4 = slot 3
B1 = slot 4
B2 = slot 5
B3 = slot 6
B4 = slot 7
```

The client must map device slot numbers to the user-facing bank labels correctly or it will misrepresent the amp state.

## 9) Command model

The interface includes a set of command families for live device control:

- read current state / preset data
- select a preset
- load a preset into the active sound
- save a preset into a slot
- change an effect on/off state
- change a parameter value
- change block/model assignments
- update looper settings and BPM

The important principle is that command semantics depend on the target state:

- live state commands are not the same as saved-slot commands,
- effect state commands behave differently when an effect is disabled,
- and some writes require a trailing byte or they are silently ignored.

## 10) Write behavior and verification

Writes are not considered safe just because the transport accepted them.

The interface requires a verification step after every state-changing operation.

### Required write pattern

1. read current state
2. serialize the desired change
3. send the command
4. read back the relevant state
5. confirm the amp reflects the change

This is the implementation contract that prevents false success.

## 11) Special write rule: trailing `0x00`

Some commands require a trailing `0x00` byte in the logical payload.

Without it:

- the amp may still ACK,
- the client may observe a transport success,
- but the amp does not actually execute the change.

This is one of the highest-risk silent-failure conditions in the interface and must be handled explicitly in the serializer layer.

## 12) Application architecture

A Spark-like client should be structured as an interface implementation, with these major components:

```text
SparkClient
  ├─ BLETransport
  │   ├─ connect()
  │   ├─ subscribe()
  │   ├─ write()
  │   ├─ bufferFragments()
  │   └─ reassembleFrames()
  │
  ├─ ProtocolDecoder
  │   ├─ validateChecksum()
  │   ├─ unpackPayload()
  │   ├─ decodeCommand()
  │   └─ decodePresetState()
  │
  ├─ StateStore
  │   ├─ liveState
  │   ├─ presetSlots
  │   ├─ effectChain
  │   └─ metadata
  │
  └─ CommandLayer
      ├─ readPreset()
      ├─ savePreset()
      ├─ loadPreset()
      ├─ setParameter()
      ├─ toggleEffect()
      └─ verifyState()
```

This separation keeps the transport concerns, the device model, and the UI concerns isolated.

## 13) Key invariants

The implementation must preserve these invariants:

- the amp is the source of truth,
- the client is a projection of that state,
- live state and saved slots are separate concerns,
- effect and parameter data are structured objects,
- write success requires verification,
- the transport layer is not the same thing as the state layer.

## 14) Summary

The Spark interface is a stateful BLE control protocol for a digital amplifier. The app implementing it must model:

- live sound state,
- saved preset slots,
- effect chains,
- parameter arrays,
- and hardware bank mapping,

while being careful to distinguish protocol-level receipt from real amp execution.

The proper client architecture is therefore:

```text
BLE transport -> message parser -> state model -> command executor -> state verification
```

That is the foundation for any Spark-like interface or emulator.
