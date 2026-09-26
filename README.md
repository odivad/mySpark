# Spark BLE Interface in TypeScript

This project is a lightweight TypeScript scaffold based on the reverse-engineered Spark amp BLE architecture described in the documentation files in the `docs/` folder.

## What is included

- typed device state models for presets, effects, and parameters
- protocol framing helpers for the Spark-style `F0 01 ... F7` envelope
- a client abstraction for write and read operations
- a demo entrypoint that shows how to model a Spark-like controller

## Notes

This is intentionally a protocol/client skeleton, not a production implementation against a real amp. The docs in `docs/` are still the primary source of truth for the architecture and memory model.

## Run it

```bash
npm install
npm run build
node dist/index.js
```
