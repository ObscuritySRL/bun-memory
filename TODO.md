# TODO

Deferred capabilities, flagged limitations, and the hardening backlog for bun-memory.
Maintained alongside the code (see prompts/BUILD.md). Checked items are done; unchecked remain.

## Flagged — upstream / release (never silent)

- [ ] **@bun-win32/kernel32 needs republish.** `CreateRemoteThread.lpStartAddress` was typed
  `FFIType.ptr`/`Pointer` but a remote thread's start routine is a remote address (`u64`/`bigint`).
  Fixed in bun-win32 source (commit) + the unused `COORD` import dropped; the bun-memory
  `node_modules` copy is locally patched. Republish kernel32 (≥1.0.27) and bump the dep range so
  the patch is no longer required. `CreateRemoteThreadEx` has the same `lpStartAddress: ptr` issue
  (unused here) — fix upstream too.

## User requests (this session)

- [x] Update `@bun-win32/*` packages (kernel32 1.0.26, core 1.1.4).
- [x] Source `CreateRemoteThread`/`WaitForSingleObject` (Process) + `FormatMessageW` (Win32Error)
  from `@bun-win32/kernel32`; remove both manual `dlopen` blocks.
- [x] Move example-only `@rlsdk/epic-games` to devDependencies.
- [x] Remove `bun-user32` entirely (DEAD: imported by nothing; trigger-bot uses its own dlopen).
- [x] Replace prettier with biome (config from D:\Projects\bun-win32). Removed `.prettierrc.json`,
  the 40 `// prettier-ignore` comments; `biome format --write`; added `format` script. Always biome-format new code.
- [x] Update prompts/BUILD.md: RocketLeague.exe running; RLSDK at D:\Projects\rlsdk\packages\epic-games
  (or `@rlsdk/epic-games` devDep); test + benchmark everything; prompt files < 4000 chars (now 3849).

## Tests / benchmarks (foundation)

- [ ] Self-process integration harness (`example/*.integration.ts`): alloc in-proc → read-back →
  assert for every accessor + follow/indexOf/vTable/tArray/utlVector/utlLinkedList/call. Verified
  smoke already passes (u32 R/W, Win32Error, call() returns 0x1337).
- [ ] Live RocketLeague.exe integration test using RLSDK offsets (real x64 target).
- [ ] Benchmarks vs current (median + p99 + allocs) for each perf slice — no "faster" without a #.

## HARDEN — behavior-identical (panel A)

Reliability (real bugs):
- [ ] Constructor leaks hProcess + hSnapshot if `refresh()` throws after OpenProcess — wrap in
  try/catch, CloseHandle both, rethrow. (Process.ts ~178-188)
- [ ] `hSnapshot === -1n` / `=== INVALID_HANDLE_VALUE` never fires: CreateToolhelp32Snapshot
  returns u64 all-ones `0xffff_ffff_ffff_ffffn`, not `-1n`. Fix both sites (ctor ~136, refresh ~690).
- [ ] `close()` not idempotent — add `#closed` guard (also called by Symbol.dispose/asyncDispose).
- [ ] call() outer `finally { this.free() }` can mask the in-flight error if free() throws — swallow.

Perf / allocs:
- [ ] `pattern()` reallocates a haystack Buffer per committed region — reuse a grow-on-demand
  `#patternHaystack`. (high, allocs)
- [ ] `qAngle`/`rgb`/`rgba` read via `this.read(addr, scratch.view)` — inline ReadProcessMemory with
  cached `.ptr` + literal bigint size like u32/vector3. (high, ns)
- [ ] Scalar writers funnel through `write()` (re-ptr + BigInt) — inline WriteProcessMemory in the
  non-force branch with cached `.ptr` + literal size. (med, ns)
- [ ] tArray*/utlVector* read the 16-byte header in two RPMs — read once into `#Scratch16`. (round-trips)
- [ ] `write()` force-path allocates two `Buffer.allocUnsafe(0x04)` — reuse `#Scratch4`. (low, allocs)
- [ ] `query()` per-region `Buffer.from` copy + new MBI — inherent to the array return; note only.

Dead code / dup (delete useless; keep+flag useful-unreachable):
- [ ] `structs/ProcessEntry32W.ts` — unused dup of the constructor's inlined walk. DELETE, or fold
  the constructor onto it (DRY redesign — decide).
- [ ] `MemoryBasicInformation.query()` static generator — dead dup of Process.query()/pattern(). DELETE,
  or fold Process.query() onto it.
- [ ] `NetworkUtlVector` type (+ phantom `networkUtlVector` JSDoc) — dead. DELETE.
- [ ] `Region` type — dead (query returns MemoryBasicInformation[]). DELETE.
- [ ] MBI getters AllocationBase/AllocationProtect/PartitionId/Protect/Type — unreachable but public
  via query() return. KEEP (flagged).

Segfault-safety (offsets verified CORRECT; residual):
- [ ] `wideString` builds Uint16Array over a pooled Buffer at scratch.byteOffset — throws on odd
  offset (latent; allocUnsafe currently 8-aligned). Scan via readUInt16LE instead.
- [ ] tArrayChar/tArrayWChar/typed tArray* size local allocs from an unvalidated remote u32 count —
  clamp/validate (trusted-target stance; low).

## CAPABILITY (panel B)

- [ ] **f16()/f16Array()** — SHIP. Scratch.f16 + BufferLike Float16Array already exist; mirror f32()
  exactly (#Scratch2.f16, 0x02n). Verified `Float16Array` works on Bun 1.4. No ptr-width risk.
- [ ] **32-bit/WOW64** — needs design huddle, phased. Detect-once in constructor via IsWow64Process2
  → readonly `#pointerSize: 4|8` (+ `is32Bit`). Then migrate u64/uPtr/follow/vFunction/tArray*(count
  @0x04 vs 0x08)/utlVector*(ptr@0x04 vs 0x08)/call() shellcode behind it. Traps: WOW64 pointers can be
  >0x7fffffff; predicate is pProcessMachine==IMAGE_FILE_MACHINE_UNKNOWN(0) ⇒ native (ARM64-safe);
  reading 8 bytes at a 32-bit count field overruns. call() must throw a clear error on 32-bit until a
  32-bit shellcode emitter exists.
- [ ] indexOf() region-safe (walk committed regions like pattern, overlap by needle.len-1) + `Module`
  overloads for indexOf/pattern. (assess)
- [ ] `pointersTo(target, address, length, all?)` pointer scan — inverse of follow(); ptr-width aware. (assess)
- [ ] UtlLinkedList writer / generic UtlVector(elementSize) writer — flag, don't build speculatively.

### Considered and DECLINED (adversary-refuted — do not build)

- readMany/gather: Windows has no scatter-gather RPM; a spanning read transfers the gaps and a single
  unmapped page throws the whole batch (worse than N reads). read() already covers contiguous.
- struct() ReClass mapper: read() already collapses the syscall; the rest is decode sugar over the
  existing Scratch/DataView views = unrequested abstraction (AGENTS + memory note forbid).

## DOCS-SYNC (after surface changes)

- [ ] README: `Memory`→`Process`, `new Uint64Array`→`BigUint64Array`, `memory.`→`cs2.`, add 64-bit-only caveat.
- [ ] CLAUDE.md: `Memory` class / `structs/Memory.ts` → `Process` / `structs/Process.ts`.
- [ ] Process.ts JSDoc: `using const`→`using`; add `@param force` to qAngle/qAngleArray/quaternionArray;
  note tArrayChar/tArrayWChar count includes the NUL.
- [ ] Module.ts JSDoc: `cs2.module('client.dll')`→`cs2.modules['client.dll']`.
- [ ] Token-economy (AI-digestion): collapse ~80 redundant scalar/array `@example` blocks to the class
  example + non-obvious methods; dedup the 68× `@param force`; delete 8× emoji comments + 3 musing
  `@todo`s + the dead commented CString line. (~30% of Process.ts, behavior-identical.)
- [ ] Create AI.md (surface map, mirroring @bun-win32/kernel32's AI.md).
- [ ] package.json files[]: examples ship without their offsets/*.json (dead on arrival) — drop
  `example/*.ts` from files[] (preferred) or ship offsets too.
- [ ] Fix stale examples (benchmark.ts `.module()`→`.modules[]`, benchmark-regions `.regions`/query
  args, benchmark-module-lookup `bun-kernel32`→`@bun-win32/kernel32`, unused vars) — or drop from files[].
