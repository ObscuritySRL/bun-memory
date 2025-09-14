# Memory (Bun + Win32)

High-performance Windows process memory utilities for [Bun](https://bun.sh) using `bun:ffi` and Kernel32 APIs.

## Requirements

- Bun runtime (uses `bun:ffi`).
- Windows 10/11 (uses `kernel32.dll`).

## Installation

```bash
bun add bun-memory
```

## Usage

### Basic example

```ts
import Memory from './Memory';

const memory = new Memory('strounter-cike.exe');

const clientDLL = memory.modules['client.dll'];

if (clientDLL === undefined) {
  // …
}

const { modBaseAddr: clientBaseAddr, modBaseSize: modBaseSize } = clientDLL;

// Write to your ammo…
const ammoOffset = 0xabcdefn;
memory.writeUInt32LE(clientBaseAddr + ammoOffset, 0x270f);

// Read your health…
const healthOffset = 0x123456n;
const healthValue = memory.readUInt32LE(clientBaseAddr + healthOffset);
console.log('You have %d health…', healthValue); // Your have 100 health…

// Find an offset by pattern…
const otherOffset = memory.findPattern('aa??bbccdd??ff', clientBaseAddr, clientBaseSize);
const otherValue = memory.readBoolean(otherOffset + 0x1234n);

memory.close();
```

### Reading with scratch buffers

Many read methods accept an optional `scratch` `Buffer` to avoid allocations:

```ts
const myScratch = Buffer.allocUnsafe(0xf000);
const myView = new BigUint64Array(myScratch.buffer, myScratch.byteOffset, 0xf000 / 0x08);

// …

while (true) {
  memory.readInto(myAddress, myScratch); // Updates myView with no new allocations…
}
```

```ts
const myScratch = Buffer.allocUnsafe(0x256);
const myValue = memory.readString(myAddress, myScratch);
```

### Notes

- Bun is required; this package relies on `bun:ffi`.
- Windows is the only supported platform.
