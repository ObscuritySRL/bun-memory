# bun-memory

Blazing fast, high-performance Windows process memory manipulation for Bun.

## Overview

`bun-memory` provides fast, allocation-conscious tools for reading and writing memory in external Windows processes. Designed for Bun and Windows 10/11, it exposes a single class, `Memory`, with a clear, type-safe API for all common memory operations.

## Features

- Attach to processes by name or PID
- Efficient, allocation-free operations using user-provided buffers (scratches)
- Module enumeration and pointer chain resolution
- Pattern search with wildcards (`**` and `??`)
- Read and write all primitive types, arrays, buffers, and common structures
- Typed helpers for vectors, matrices, colors, and more

## Requirements

- Bun runtime
- Windows 10 or later

## Installation

```sh
bun add bun-memory
```

## Quick Start

❗ **Important**: [Example: Using Scratches (Recommended)](#example-using-scratches-recommended)

```ts
import Memory from 'bun-memory';

// Attach to a process by name
const cs2 = new Memory('cs2.exe');

// Read a float
const myFloat = cs2.f32(0x12345678n);

// Write an int
cs2.i32(0x12345678n, 42);

// Access loaded modules
const client = cs2.modules['client.dll'];

// Clean up
cs2.close();
```

## API Highlights

- `follow(address, offsets)` — Follow a pointer chain
- `read(address, scratch)` — Read memory into a scratch (no allocations)
- `write(address, scratch)` — Write a scratch to memory
- Module map: `memory.modules['client.dll']`
- Typed accessors: `bool`, `f32`, `i32`, `matrix4x4`, `u8`, `u64Array`, `vector3`, etc.

See the code and type definitions for full details. All methods are documented with concise examples.

## Example: Efficient Scratch Reuse

```ts
// Reuse buffers and arrays for fast, allocation-free memory operations
const buffer = Buffer.allocUnsafe(256);
void cs2.read(0x12345678n, buffer); // Fills buffer in-place
// …use buffer…
```

```ts
// Typed arrays work the same way
const array = new Float32Array(32);
void cs2.read(0x12345678n, array); // Fills array in-place
// …use buffer…
```

## Example: Pattern Search

```ts
// Find a byte pattern in memory (supports wildcards: ** and ??)
const needle = 'deadbeef';
// const needle = 'de**beef';
// const needle = 'de????ef';
const address = cs2.pattern(needle, 0x10000000n, 0x1000);
if (address !== -1n) {
  console.log(`Found at 0x${address.toString(16)}`);
}
```

## Example: Pointer Chains

```ts
// Follow a pointer chain to resolve nested addresses
const address = cs2.follow(0x10000000n, [0x10n, 0x20n]);
```

## Example: Searching Memory

```ts
// Search for a buffer or array in memory
const needle = Buffer.from([0x01, 0x02, 0x03]);
// const needle = new Uint8Array([0x01, 0x02, 0x03]);
// const needle = new Uint32Array([0x012345, 0x123456, 0x234567]);
// …etc…
const address = cs2.indexOf(needle, 0x10000000n, 0x1000);
if (address !== -1n) {
  console.log(`Found at 0x${address.toString(16)}`);
}
```

## Example: Typed Arrays

```ts
// Read or write arrays of numbers and structures
const array = cs2.f32Array(0x12345678n, 4); // Float32Array of length 4
// const array = cs2.u64Array(0x12345678n, 4);
// const array = cs2.vector3Array(0x12345678n, 4);
// …etc…
cs2.i32Array(0x12345678n, new Int32Array([1, 2, 3, 4]));
cs2.u64Array(0x12345678n, new BigUint64Array([1, 2, 3, 4]));
cs2.vector3Array(0x12345678n, [{ x: 1, y: 2, z: 3 }]);
```

## Example: Using Scratches (Recommended)

```ts
// Scratches let you reuse buffers and arrays for repeated memory operations
// This avoids allocations and maximizes performance
const array = new BigUint64Array(0xf000 / 0x08);

while (true) {
  cs2.read(0x10000000n, array); // Updates array without allocations
  for (const element of array) {
    // …use element…
  }
}
```

```ts
const buffer = Buffer.allocUnsafe(256);
const array = new Uint64Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 8);

while (true) {
  cs2.read(0x10000000n, buffer); // Updates both array & buffer without allocations
  for (const element of array) {
    // …use element…
  }
}
```

## Notes

- Windows only. Bun runtime required.

---

For real-world usage, see [example/trigger-bot.ts](example/trigger-bot.ts).
