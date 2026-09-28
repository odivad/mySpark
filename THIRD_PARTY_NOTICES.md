# Third-party notices

mySpark includes code and data derived from the projects below. None of them is affiliated with or endorses mySpark. mySpark has no relationship with Positive Grid Inc.

## SparklingTones — MIT License

https://github.com/mazzrelaz/SparklingTones — ported from commit `f25379d` (2026-09-24).

Ported to TypeScript (translated comments, renamed identifiers, same behavior):

- `src/spark-protocol.js` → `src/spark/protocol.ts`
- `test/protocol-test.html` and `test/fixtures/preset0.js` → `test/protocol.test.ts` and `test/fixtures/sparklingtones.ts` (real Spark 2 captures)

```
MIT License

Copyright (c) 2026 Massimo Togni

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

SparklingTones' own `NOTICE` credits:

- **Soundshed** (MIT, https://github.com/soundshed/soundshed-app, Copyright (c) Soundshed contributors) — effect and knob display names, from `src/spork/src/devices/spark/sparkFxCatalog.ts`. Applies to mySpark if/when the effect catalogue (`spark-effetti.js`) is ported.
- **paulhamsh/Spark** (Apache 2.0, https://github.com/paulhamsh/Spark) — used by SparklingTones as reference for the message format. SparklingTones' code is written from scratch; comments citing `SparkIO.ino` lines are kept in our port as references.

## Soundshed — MIT License

https://github.com/soundshed/soundshed-app — used as a protocol reference (docs, Spark GO/40 behavior). No code copied yet. Add the notice here when any is.
