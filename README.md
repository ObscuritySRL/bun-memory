# bun-memory

Blazing fast, high-performance Windows process memory manipulation for Bun.

## Overview

`bun-memory` provides fast, allocation-conscious tools for reading and writing memory in external Windows processes. Designed for Bun and Windows 10/11, it exposes a single class, `Memory`, with a clear, type-safe API for all common memory operations.

## Features

- Attach to processes by name or PID
- Read and write all primitive types, arrays, buffers, and common structures
- Efficient, allocation-free operations using user-provided buffers (scratches)
- Module enumeration and pointer chain resolution
- Typed helpers for vectors, matrices, colors, and more

## Requirements

- Bun runtime
- Windows 10 or later

## Installation

```sh
bun add bun-memory
```

## Quick Start

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

## Example: Efficient Buffer Reuse

```ts
const buffer = Buffer.allocUnsafe(256);
cs2.read(0x12345678n, buffer); // Fills buffer in-place
// …use buffer…
```

## Example: Pointer Chains

```ts
const address = cs2.follow(0x10000000n, [0x10n, 0x20n]);
```

## Example: Searching Memory

```ts
const needle = Buffer.from([0x48, 0x8b, 0x05]);
const address = cs2.indexOf(needle, 0x10000000n, 0x1000);
if (address !== -1n) {
  console.log(`Found at 0x${address.toString(16)}`);
}
```

```ts
const needle = new Uint32Array([0x01, 0x02, 0x03]);
const address = cs2.indexOf(needle, 0x10000000n, 0x1000);
if (address !== -1n) {
  console.log(`Found at 0x${address.toString(16)}`);
}
```

## Example: Typed Arrays

```ts
const array = cs2.f32Array(0x12345678n, 4); // Float32Array of length 4
cs2.i32Array(0x12345678n, new Int32Array([1, 2, 3, 4]));
```

## Example: Using Scratches (Recommended)

Scratches let you reuse buffers and typed arrays for repeated memory operations, avoiding unnecessary allocations and maximizing performance. This is the most efficient way to read or write large or frequent data.

```ts
const buffer = Buffer.allocUnsafe(256);
const array = new Uint64Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 8);

while (true) {
  cs2.read(0x10000000n, buffer); // Updates array & buffer without allocations
  for (const element of array) {
    // …use element…
  }
}
```

## Notes

- Pattern scanning is temporarily disabled.
- Windows only. Bun runtime required.

---

For real-world usage, see [example/trigger-bot.ts](example/trigger-bot.ts).
