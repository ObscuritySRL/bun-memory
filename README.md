# bun-memory

High-performance Windows process memory utilities for [Bun](https://bun.sh) using `bun:ffi` and Win32 APIs.

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

### Basic Example

```ts
import Memory from 'bun-memory';

// Attach to process by name…
const memory = new Memory('notepad.exe');
// …or PID
const memory = new Memory(1234);

// Access loaded modules
const modules = memory.modules;
const mainModule = modules['notepad.exe'];
console.log(`Base address: 0x${mainModule.modBaseAddr.toString(16)}`);
console.log(`Size: ${mainModule.modBaseSize} bytes`);

// Read a 32-bit integer
const value = memory.i32(0x12345678n);

// Write a float
memory.f32(0x12345678n, 3.14159);

// Clean up
memory.close();
```

### Pattern Scanning

```ts
const offset = memory.findPattern('aa??bbccdd??ff', mainModule.modBaseAddr, mainModule.modBaseSize);
const value = memory.bool(offset + 0x1234n);
memory.close();
```

### Efficient Buffer Reads

```ts
const scratch = Buffer.allocUnsafe(0xf000);
const view = new BigUint64Array(scratch.buffer, scratch.byteOffset, 0xf000 / 8);

while (true) {
  memory.read(myAddress, scratch); // Updates scratch and view, no allocations
}
```

```ts
const scratch = Buffer.allocUnsafe(0x100);
memory.read(myAddress, scratch);
```

## Notes

- Only works with Bun and Windows.
