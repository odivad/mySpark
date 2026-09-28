# Testing Standards — mySpark

## Framework

**Vitest 5.** Run with `npm test`. Tests live in `test/`, fixtures in `test/fixtures/` (each file states its source and verification status).

## Required tests

- **Mandatory:** unit tests for any change to the protocol codec — framing (`F0 01 … F7`), 7/8-bit packing/unpacking, checksum, trailing-`0x00` handling, fragment reassembly.
- Other tests: encouraged, not mandatory.
- **No coverage target.**

## Test data rules

- Test vectors should come from real captures from the owner's amp (`VERIFIED-HW`) or from SparklingTones documentation (`SOURCED`, cite it). Label each fixture with its status.
- Tests built on `UNVERIFIED` vectors prove only that the code matches our assumption, not that it matches the amp. Mark them as such.
- No secrets or account data in fixtures.

## Hardware testing

Automated tests cannot prove amp behavior. Any change to live-state or saved-slot writes also needs a **manual hardware test by the owner** (see `docs/security.md`). Record the outcome in `knowledge/lessons-learned.md` when it teaches something.

## Established helpers

None yet. # TO CONFIRM: add a shared fake `SparkTransport` for client tests when tests are introduced.
