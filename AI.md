# AI Guide for bun-memory

How to use this package. Surface map for fast digestion — read this before grepping Process.ts.

## Shape

One class, `Process` (default export; also `export { Module, Process }`), plus `export type` for the
`Call*` generics. Pure TypeScript, `bun:ffi`, no build step (`main: index.ts`). Windows 10+, Bun >= 1.1.
The only runtime dependency is `@bun-win32/kernel32`. All Win32 symbols come from that package — there
are no local `dlopen` calls.

```ts
import Process from 'bun-memory';

using cs2 = new Process('cs2.exe'); // by name or PID; disposes on scope exit
const health = cs2.u32(0x12345678n);
cs2.f32(0x12345678n, 1.5);
const client = cs2.modules['client.dll']; // Module: modBaseAddr, modBaseSize, modEndAddr, szModule, szExePath
```

## Conventions

- **Addresses are `bigint`.** Reads return values; writes take a value and return `this` (chainable).
  Every read/write overload is `method(address)` (read) or `method(address, value, force?)` (write).
- **`force?: boolean`** on writes flips page protection to PAGE_EXECUTE_READWRITE for the write, then
  restores it — use it to write read-only pages.
- **Scratch reuse is the default.** Scalar/vector/color/matrix accessors read into a per-instance
  `Scratch` (cached `.ptr`, no per-call allocation). For zero-alloc bulk reads, pass your own buffer to
  `read(address, scratch)` / the typed-array accessors in a loop.
- **32-bit (WOW64) is supported for reads/writes.** Architecture is detected once at attach via
  IsWow64Process2 and exposed as `is32Bit`. The pointer primitives (`uPtr`, `uPtrArray`, `follow`,
  `vTable`, `vFunction`) and the engine containers (`tArray*`, `utlVectorRaw`/`utlVectorU32`/
  `utlVectorU64`) are width-corrected for 32-bit targets (x86 `TArray` `{Data@0x00 4B; ArrayNum@0x04}`,
  x86 `CUtlVector` `{Size@0x00; Elements@0x04 4B}`), with the x64 path byte-identical. `utlLinkedListU64`
  and `call()` remain 64-bit only. See TODO.md.
- **Errors** are `Win32Error` (`.code`, `.what`) with a FormatMessageW message. `follow()` returns
  `-1n` on a null link; search methods return `-1n` / `[]` on no match.

## Method families (≈90 methods)

- **Scalars:** `bool` `i8` `u8` `i16` `u16` `i32` `u32` `i64` `u64` `uPtr` `f16` `f32` `f64`; plus `bits`
  (extract a bitfield from a u32).
- **Typed arrays:** the `*Array` form of each scalar (`u32Array`, `f32Array`, `i64Array`, `uPtrArray`, …)
  read N elements or write a typed array.
- **Raw bytes / strings:** `buffer` (Buffer), `cString` (CString), `string` (UTF-8), `wideString`
  (UTF-16LE).
- **Geometry:** `point`/`pointArray`/`pointRaw`, `vector2`/`vector3`/`vector4` (+ `*Array`, `*ArrayRaw`,
  `*Raw`), `qAngle`, `quaternion`, `matrix3x3`/`matrix3x4`/`matrix4x4`, `viewMatrix`. Object forms return
  `{x,y,...}`; `*Raw` forms return a `Float32Array`.
- **Colors:** `rgb`/`rgbRaw`, `rgba`/`rgbaRaw`.
- **Engine containers:** `tArray*` (Unreal TArray: data@0x00, count@0x08 — `tArrayU8…U64`, `…I8…I64`,
  `tArrayF32/F64`, `tArrayChar`/`tArrayWChar`, `tArrayRaw`, `tArrayUPtr`), `utlVectorRaw`/`utlVectorU32`/
  `utlVectorU64` and `utlLinkedListU64` (Source CUtlVector/CUtlLinkedList: count@0x00, elements@0x08).
- **Pointers / search:** `follow(address, offsets[])`, `vTable`/`vFunction`, `indexOf(needle, address,
  length, all?)`, `pattern(needle, address, length, all?)` (hex with `**`/`??` wildcards).
- **Process / memory:** `alloc`, `free`, `protection`, `read`, `write`, `query` (region list), `refresh`
  (re-enumerate modules), `call` (execute a remote function via injected shellcode + CreateRemoteThread),
  `close` (idempotent), `Symbol.dispose`/`Symbol.asyncDispose`.

## Where to look

| Need                          | Read                              |
| ----------------------------- | --------------------------------- |
| A method's signature/example  | `structs/Process.ts` (JSDoc)      |
| Types (vectors, Call*, etc.)  | `types/Process.ts`                |
| Struct views                  | `structs/Module.ts`, `MemoryBasicInformation.ts`, `Scratch.ts`, `Win32Error.ts` |
| The `.ptr` buffer extension   | `runtime/extensions.ts`           |
| Runnable usage                | `example/self-process.integration.ts` (the deterministic gate, `bun run test`) |
| Live-target proof             | `example/wow64.integration.ts` (`bun run test:wow64`) — spawns a live SysWOW64 process |
| Backlog / deferred caps       | `TODO.md`                         |
