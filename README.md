# bun-memory

High-performance Windows process memory utilities for [Bun](https://bun.sh) using `bun:ffi` and
Win32 APIs.

## Features

- Built for Bun runtime and Windows 10/11
- Efficient buffer management for high-speed operations
- Pattern scanning for offsets \*
- Read and write memory of Windows processes

\* — Feature temporarily disabled

## Requirements

- **Bun** (uses `bun:ffi`)
- **Windows 10/11** (uses `kernel32.dll`)

## Installation

```bash
bun add bun-memory
```

## Usage

See [example/trigger-bot.ts](example/trigger-bot.ts) for a real-world example for Counter-Strike 2.

### Basic Example

```ts
import Memory from 'bun-memory';

// Attach to process by name…
const memory = new Memory('cs2.exe');
// …or PID…
const memory = new Memory(1_234);

// Access loaded modules…
const modules = memory.modules;

const client = modules['client.dll'];

console.log(`Base address: 0x${client.base.toString(16)}`);
console.log(`Size: ${client.size} bytes`);

// Read a 32-bit integer…
const value = memory.i32(client.base + 0x12345678n);

// Write a float…
memory.f32(client.base + 0x12345678n, 3.14159);

// Clean up…
memory.close();
```

### API — Typed Reads / Writes

A `Memory` instance exposes typed helpers for reading and writing process memory. Pairs indicate
scalar and array variants; entries without a pair are scalar-only or array-only.

- bool
- cString
- f32 / f32Array
- f64 / f64Array
- i16 / i16Array
- i32 / i32Array
- i64 / i64Array
- i8 / i8Array
- matrix3x3
- matrix3x4
- matrix4x4
- networkUtlVector
- qAngle / qAngleArray
- quaternion / quaternionArray
- u16 / u16Array
- u32 / u32Array
- u64 / u64Array
- u8 / u8Array
- vector2 / vector2Array
- vector3 / vector3Array
- vector4 / vector4Array

### Efficient Reads / Writes Using Scratches

There are many ways to use `scratch`es. Scratches are great for avoiding allocation costs by reusing
a preexisting array, buffer, string, etc.

```ts
const handles = new Uint32Array(0x100);

while (true) {
  try {
    memory.read(myAddress, handles); // Updated handles, no allocations…

    // Do something with your handles…
    for (const handle of handles) {
      // …
    }
  } finally {
    continue;
  }
}
```

```ts
const buffer = Buffer.allocUnsafe(0xf000); // Use buffer as a scratch…
const pointers = new BigUint64Array(scratchBuffer.buffer, scratchBuffer.byteOffset, 0xf000 / 8);

while (true) {
  try {
    memory.read(myAddress, buffer); // Updates buffer and pointers, no allocations…

    // Do something with your pointers…
    for (const pointer of pointers) {
      // Read a 32 length string at pointer…
      const myString = memory.cString(pointer, 32).toString();

      // …
    }
  } finally {
    continue;
  }
}
```

### Searching Memory

#### `findPattern`

Pattern scanning is temporarily disabled but will return shortly.

#### `indexOf`

Find the first occurrence of a byte sequence within a memory range and return the absolute address (`bigint`) of the first match, or `-1n` when not found. Accepts any Scratch-compatible input (`Buffer`, `TypedArray`, `DataView`, `ArrayBuffer`, or `SharedArrayBuffer`). No region or protection checking is performed; ensure the range is readable before calling.

```ts
// Attach…
const memory = new Memory('cs2.exe');

// Get the loaded client.dll…
const client = cs2.modules['client.dll'];

// Choose any Scratch type for the needle (bytes are matched exactly as laid out in memory).
const needle = Buffer.from([0x48, 0x8b, 0x05, 0x00, 0x00, 0x00, 0x00]);
// const needle = new Uint8Array([0x48, 0x8B, 0x05, 0x00, 0x00, 0x00, 0x00]);
// const needle = new Uint32Array([0xDEADBEEF, 0x11223344]);
// const needle = new DataView(Uint8Array.from([0xde, 0xad, 0xbe, 0xef]).buffer);

// Search client.dll for the byte sequence…
const addeess = memory.indexOf(needle, client.base, client.size);

if (address !== -1n) {
  console.log(`Found at 0x${address.toString(16)}`);
}
```

## Notes

- Only works with Bun and Windows.
