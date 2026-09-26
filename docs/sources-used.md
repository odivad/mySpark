# Sources used for the Spark Bluetooth reverse-engineering

This document lists the public sources that informed the Spark interface notes, protocol understanding, and memory-map model used in this project.

## 1) Primary source: SparklingTones

Main project:

- https://github.com/mazzrelaz/SparklingTones
- https://mazzrelaz.github.io/SparklingTones/

Why it matters:

- This is the main reverse-engineering project for the Spark 2 Bluetooth protocol.
- It contains the browser app, design notes, protocol documentation, and the overall state model used to understand how the amp is controlled over BLE.
- It is the most important reference for the project because it connects the protocol observations to a working app implementation.

Key reference files from the repo:

- README / README.en.md
- docs/protocollo-spark2.md
- docs/protocollo-spark2.en.md
- related docs in docs/
- captures and notes describing hardware verification

## 2) Protocol and device notes

The reverse-engineering work is explicitly documented in the SparklingTones repo in the protocol notes, including:

- Bluetooth GATT layout
- fragmentation and reassembly behavior
- checksum and 7/8-bit packing notes
- preset format structure
- effect and parameter model
- slot and bank mapping
- write verification rules
- payload and trailing-byte pitfalls

These notes are the basis for the project’s understanding of the live-state and preset-state memory model.

## 3) Related Spark projects consulted

These are secondary references used to compare device behavior and validate interface patterns.

### PGSparkLite

- https://github.com/richtamblyn/PGSparkLite
- Purpose: browser-based Positive Grid Spark interface reference
- Relevance: gives a second implementation model for Spark control and data access patterns

### sparkpal

- https://github.com/jamesguitar3/sparkpal
- Purpose: pedal / controller project for Spark via Bluetooth
- Relevance: confirms practical Spark amp control patterns and hardware-transport assumptions

### Positive Grid Spark 40 modding notes

- https://github.com/indatarec/Positive-Grid-Spark-40-modding
- Purpose: modding and protocol-adjacent documentation
- Relevance: useful for comparing older Spark 40 behavior with Spark 2 behavior and understanding version-specific differences

### Positive Grid Spark 2 modding notes

- https://github.com/indatarec/Positive-Grid-Spark-2-modding
- Purpose: Spark 2-specific modding references
- Relevance: helps distinguish Spark 2 behavior from Spark 40 assumptions and highlights the importance of hardware/model differences

### Spark MIDI bridge

- https://github.com/madv1n/Spark-MIDI-Bridge
- Purpose: MIDI bridge project for Spark amps
- Relevance: shows a different control layer built on top of the same device family and helps validate the general device-control approach

### Spark guide / general docs

- https://github.com/soundshed/spark-guide
- Purpose: general Spark usage and setup documentation
- Relevance: useful for understanding user-facing behavior and product context, but not the main protocol source

## 4) Search and discovery references

We also used GitHub repository search to surface related public implementations and community projects:

- https://github.com/search?q=positive+grid+spark&type=repositories

This was used to identify additional implementations and reference projects in the wider Spark ecosystem.

## 5) Source quality and use

The sources fall into three categories:

### A. Direct protocol references

- SparklingTones protocol docs
- captures and hardware-verified notes
- these are the key sources for the actual interface model

### B. Cross-checking implementations

- PGSparkLite
- sparkpal
- other Spark controller projects
- these help validate that the same device family is being controlled through a common pattern

### C. Contextual references

- Spark modding notes
- Spark guide docs
- these help understand hardware differences, platform history, and user expectations

## 6) Practical interpretation

The reverse-engineered model used in this project is based primarily on the SparklingTones work and is corroborated by related Spark control projects. The direct protocol and hardware notes are the strongest evidence, while the other repositories serve as secondary confirmation and comparison points.

## 7) Summary

The main sources used are:

1. SparklingTones repo and protocol docs
2. SparklingTones GitHub Pages app
3. related Spark control and modding repos
4. public GitHub search results for Spark-related projects

Together these sources define the working model for:

- BLE transport layout,
- device state model,
- preset and effect memory map,
- slot bank mapping,
- and write-verification discipline in the Spark interface.
