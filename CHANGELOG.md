# Changelog

All notable changes to **bun-memory** are documented in this file.

## [Unreleased]

## [2.0.0] - 2026-06-25

### Added
- `query()` — enumerate the target's committed memory regions as `MemoryBasicInformation[]` via a `VirtualQueryEx` walk.
- `f16` / `f16Array` — IEEE half-precision (binary16) scalar and typed-array accessors.
- 32-bit (WOW64) target detection at attach through `IsWow64Process2`, exposed as `is32Bit`, with width-correct pointer primitives on a 32-bit target — `uPtr`, `uPtrArray`, `follow`, `vTable`, and `vFunction` read 4-byte pointers zero-extended, so `LargeAddressAware` pointers above 2 GB survive. Engine containers (`tArray*` / `utlVector*`) stay 64-bit and `call()` still rejects a 32-bit target rather than running 64-bit shellcode against it.
- `Process` surfaces the snapshot's `cntThreads`, `pcPriClassBase`, `szExeFile`, and `th32ParentProcessID`, and makes `th32ProcessID` public.
- Integration test suites (`bun run test` and `bun run test:wow64`): a deterministic self-process harness covering 50+ cases (including `call()` argument marshaling and `close`/dispose idempotency), plus a gated live suite that proves the accessors against a spawned SysWOW64 (32-bit) target.
- `AI.md`, a one-page surface map of the ~90-method API.

### Changed
- **Renamed the `Memory` class to `Process`** (the default export; `export { Module, Process }`).
- **`Module` is now a lightweight data container** — its read/write methods were removed and its fields renamed to Win32 conventions (`modBaseAddr`, `modBaseSize`, `modEndAddr`, `szModule`, `szExePath`); the `modules` map is frozen after `refresh()`.
- Consolidated every Win32 symbol onto the published `@bun-win32/kernel32` binding, removing all local `dlopen` calls.
- Converted the class internals to `#private` fields.
- Combined the two-`ReadProcessMemory` header read into one across the `tArray` and `utlVector` accessors, inlined the `qAngle`/`rgb`/`rgba` reads, dropped a force-path allocation, reused a grow-on-demand haystack in `pattern()` and `indexOf()` (no per-call buffer allocation), and retyped the RPM/WPM byte-count out-param to `PSIZE_T`.
- Replaced Prettier with Biome for formatting, and stopped shipping `example/*.ts` in the published package.

### Removed
- `readAsync` — it was never genuinely asynchronous.

### Fixed
- Snapshot-failure detection: `CreateToolhelp32Snapshot` reports failure as an all-ones `u64`, not `-1n`, so the old `=== -1n` guards never fired and a failed snapshot surfaced as a mislabeled `Process32FirstW` / `Module32FirstW` error — both sites now compare against the correct value.
- `PROCESSENTRY32W` field offsets — the x64 layout pads `th32ProcessID` for 8-byte alignment, so `cntThreads`, `th32ParentProcessID`, and `pcPriClassBase` were each read one slot low and returned wrong values; they are now read at the correct offsets (`0x1c`, `0x20`, `0x24`).
- Constructor handle leak — if `refresh()` threw after `OpenProcess` succeeded, both the process and snapshot handles leaked; both are now closed before rethrowing.
- `close()` (and the `Symbol.dispose` / `Symbol.asyncDispose` paths) is idempotent through a `#closed` guard, so a recycled handle cannot be double-closed.
- `tArrayChar` / `tArrayWChar` writes now emit the trailing null terminator their header count includes; previously the count claimed a terminator that was never written, leaving stale bytes in the target's backing store.
- Hardened the `wideString` null-terminator scan.

## [1.2.1] - 2026-01-16

### Changed
- Inline `ReadProcessMemory` in the hot read paths and drop the `void` operators.
- `Preload()` Kernel32 before destructuring its functions, alphabetize the scratch-buffer properties, and use a boolean-return pattern for the RPM calls.

## [1.2.0] - 2026-01-16

### Added
- `vTable()` and `vFunction(index)` — resolve a virtual-table pointer and an indexed virtual function.
- `bits(address, startBit, bitCount)` — extract a bitfield from a `u32`.
- `vector2ArrayRaw` / `vector3ArrayRaw` / `vector4ArrayRaw` — `Float32Array` bulk reads for vector arrays.
- `from()` static factory and `readAsync()` for chunked large reads.

### Changed
- Chunk reads larger than 64 KiB instead of issuing one oversized `ReadProcessMemory`.

## [1.1.50] - 2026-01-12

### Changed
- Enable full strict mode (`noUncheckedIndexedAccess`) and resolve the resulting typed-array indexed-access violations.
- Add zero-length / empty-input short-circuits to `follow()`, `utlVectorU32` / `utlVectorU64` / `utlVectorRaw`, and the `tArrayRaw` write path.

## [1.1.49] - 2026-01-04

### Changed
- Short-circuit the `tArray` accessors on a zero count to skip the element read entirely.

## [1.1.47] - 2026-01-04

### Added
- `tArrayRaw` — read and write an Unreal `TArray` as an array of raw buffers.

## [1.1.46] - 2026-01-04

### Added
- `tArray` family — Unreal `TArray` (data @ `0x00`, count @ `0x08`) read/write for every numeric type (`tArrayU8`…`tArrayU64`, `tArrayI8`…`tArrayI64`, `tArrayF32` / `tArrayF64`), characters (`tArrayChar` / `tArrayWChar`), and pointers (`tArrayUPtr`).

## [1.1.45] - 2025-12-31

### Added
- `wideString` — fast UTF-16LE string read/write.

## [1.1.44] - 2025-12-08

### Fixed
- Compare process and module handles as `bigint`, and bump `bun-kernel32` to 1.0.9.

## [1.1.43] - 2025-12-04

### Added
- Public `alloc()`, `free()`, and `protection()` memory-management methods.

### Changed
- Migrate all Win32 FFI onto the `bun-kernel32` binding, replacing the local `dlopen` hand-roll.

## [1.1.42] - 2025-11-24

### Added
- `utlVectorRaw` and `utlVectorU64` for Source `CUtlVector` (count @ `0x00`, elements @ `0x08`).

## [1.1.40] - 2025-11-09

### Added
- `utlLinkedListU64` for Source `CUtlLinkedList`.

### Changed
- Rename `networkUtlVector` to `utlVectorU32`.

## [1.1.38] - 2025-10-12

### Added
- `force` parameter on the write methods — flip the page to `PAGE_EXECUTE_READWRITE` for the write, then restore the original protection, so read-only pages are writable.

### Changed
- Make `write()` public.

## [1.1.36] - 2025-10-11

### Added
- `string()` — UTF-8 string read/write.
- `call()` — execute a remote function inside the target via injected shellcode and `CreateRemoteThread`.

## [1.1.35] - 2025-10-06

### Added
- `all` parameter on `indexOf` and `pattern` to return every match instead of only the first.

## [1.1.29] - 2025-10-05

### Added
- `pattern()` — wildcard byte-pattern (AOB) scan supporting `**` and `??` wildcards.

## [1.1.25] - 2025-10-02

### Added
- `*Raw` accessors (`pointRaw`, `vector2Raw` / `vector3Raw` / `vector4Raw`, `qAngleRaw`, `quaternionRaw`, `rgbRaw`, `rgbaRaw`) that return a `Float32Array`.
- Disposables — `close()` plus `Symbol.dispose` / `Symbol.asyncDispose` for `using` cleanup.
- A Counter-Strike 2 benchmark and runnable example scripts.

### Changed
- Large performance pass across the read/write paths.

## [1.1.24] - 2025-09-30

### Changed
- Read scalars through a single TypedArray-backed scratch to avoid a second FFI hop.

## [1.1.21] - 2025-09-29

### Added
- `follow(address, offsets)` — resolve a pointer chain, returning `-1n` on a null link.

## [1.1.17] - 2025-09-28

### Added
- `buffer()` — read and write a raw `Buffer`.

## [1.1.15] - 2025-09-27

### Added
- `indexOf(needle, address, length)` — search a region for a `Buffer` or typed-array needle, returning `-1n` on no match.

## [1.1.14] - 2025-09-27

### Added
- `qAngle()` accessor and assorted utility reads.

## [1.1.13] - 2025-09-27

### Added
- `matrix3x3`, `matrix3x4`, and `matrix4x4` matrix accessors.

## [1.1.12] - 2025-09-25

### Changed
- Back bulk reads with `Uint8Array` for roughly a 10× throughput gain.

## [1.1.11] - 2025-09-23

### Added
- `networkUtlVector` (later renamed `utlVectorU32`).

## [1.1.3] - 2025-09-22

### Added
- `cString()` — null-terminated ASCII string read/write.

## [1.1.0] - 2025-09-21

### Changed
- Reshape the read/write API to mirror Bun's native method naming (`u32`, `f32`, …) and add the geometry accessor family: `vector2` / `vector3` / `vector4`, `quaternion`, and `viewMatrix`.

## [1.0.3] - 2025-09-14

### Added
- `writeVector3()`.

## [1.0.0] - 2025-09-14

### Added
- Initial release of the `Memory` class — attach to a process by name or PID, enumerate loaded modules, and read/write external process memory through user-provided scratch buffers for allocation-free access.
- Primitive scalar accessors, pointer-chain plumbing, and `VirtualQueryEx` / `VirtualProtectEx`-backed memory protection, with errors surfaced as `Win32Error` (`.code`, `.what`) via `FormatMessageW`.
