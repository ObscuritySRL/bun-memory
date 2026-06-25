# TODO

Deferred capabilities, flagged limitations, and the hardening backlog for bun-memory.
Maintained alongside the code (see prompts/BUILD.md). `[x]` done this session; `[ ]` remaining.

## Flagged — upstream / release (never silent)

- [ ] **@bun-win32/core + kernel32 need republish.** The bun-win32 source now types every kernel32
  parameter with its real Microsoft type (committed there): `LPTHREAD_START_ROUTINE` is a per-function
  generic (`CreateThread<Pointer>` / `CreateRemoteThread[Ex]<bigint>`), and all 60 bare `: bigint` are
  retyped — `SIZE_T`/`ULONG_PTR` for sizes/counts; `LPVOID`/`LPCVOID`/`PVOID`<`bigint`> for by-value
  addresses (the core void-pointer aliases were made generic, default `Pointer`); `PSIZE_T | NULL` for
  the three `SIZE_T*` out-params. The bun-memory `node_modules` copy is locally patched to match, and
  `Process.ts` now passes `null` (not `0x00n`) for the RPM/WPM out-param — which REQUIRES the
  `PSIZE_T` retype. Republish core + kernel32 and bump the dep ranges so the patch can be dropped.

## Done this session

- [x] Update @bun-win32/* (kernel32 1.0.26, core 1.1.4).
- [x] Source CreateRemoteThread/WaitForSingleObject (Process) + FormatMessageW (Win32Error) from
  @bun-win32/kernel32; removed both manual dlopen blocks. Verified live (call() returns 0x1337).
- [x] @rlsdk/epic-games -> devDependencies; bun-user32 removed (dead). Sole runtime dep: kernel32.
- [x] Replace prettier with biome (bun-win32 config); `format` script; removed .prettierrc + 40 ignores.
- [x] prompts/BUILD.md: live RocketLeague.exe + RLSDK + test/benchmark mandate, < 4000 chars.
- [x] Self-process integration harness — `bun run test`, 41 tests (every accessor + follow/vtable/
  indexOf/pattern/tArray/utlVector/utlLinkedList/alloc/query/call/dispose).
- [x] Reliability: snapshot-failure sentinel (unsigned all-ones, not -1n); close handles on a
  refresh()-throw in the constructor; idempotent close() via #closed.
- [x] Dead code: delete ProcessEntry32W.ts, MBI.query() static, Region + NetworkUtlVector types.
- [x] f16()/f16Array() half-precision accessors.
- [x] perf: inline qAngle/rgb/rgba reads (cached .ptr + literal size); drop a force-path allocation;
  reuse a grow-on-demand #patternHaystack in pattern(); combine the two-RPM header read in ALL
  tArray* + utlVector* accessors (one fewer syscall per read; measured ~30-32% faster on small reads:
  tArrayU32 937->635 ns/op, utlVectorU32 941->660 ns/op).
- [x] Expand the integration gate to 49 tests / 108 assertions (full accessor surface round-trips).
- [x] docs: README Memory->Process / Uint64Array->BigUint64Array; Module JSDoc .module()->.modules[];
  remove 8 emoji comments + 3 musing @todos + a dead commented line.
- [x] ship: drop example/*.ts from files[] (examples need a game + offsets JSON that never shipped).
- [x] 32-bit detection: IsWow64Process2 once at attach -> `is32Bit`; call() rejects 32-bit targets.
- [x] AI.md surface map.

## HARDEN — remaining (behavior-identical)

- [ ] Scalar writers funnel through write() (re-ptr + BigInt). Inline WriteProcessMemory in the
  non-force branch. DECLINED for now: ~12 per-method edits (different scratch/size each, no clean
  replace_all), and the WriteProcessMemory syscall dominates so the ptr()+BigInt() saving is ~2-3%
  (u32 write ~1615 ns). Not worth the churn per AGENTS "profile first / minimal diff".
- [ ] call() outer `finally { this.free() }` can mask the in-flight error if free() throws. Low; the
  fix (swallow in finally) also hides a success-path free failure — needs care.
- [ ] wideString builds a Uint16Array over a pooled Buffer at scratch.byteOffset (throws on an odd
  offset; latent — allocUnsafe is currently 8-aligned). Scan via readUInt16LE instead.
- [ ] @param force missing on qAngle/qAngleArray/quaternionArray JSDoc (sibling consistency).
- [ ] CLAUDE.md still says class `Memory` / `structs/Memory.ts` / "no test commands" (now Process +
  `bun run test`/`format`). It is the user's instructions file — update carefully.
- [ ] Stale examples: benchmark.ts/trigger-bot.ts call `client.u64(offset)`, but "Simplify Module to a
  lightweight container" removed Module's read methods — they need `cs2.u64(module.modBaseAddr +
  offset)`. Unverifiable without cs2.exe (only RocketLeague is running). Untracked scratch benchmarks
  (benchmark-buffer-copy/-module-lookup/-regions) + rocket-league-chat.ts also have stale API.

## CAPABILITY — remaining (panel B)

- [ ] **32-bit width-correction.** Detection shipped; migrate the pointer-shaped reads behind
  `is32Bit`/pointerSize: u64/uPtr read 4 vs 8 bytes; follow/vFunction stride by pointer size; tArray
  count @0x04 vs 0x08; utlVector elements @0x04 vs 0x08; a 32-bit call() shellcode emitter. BLOCKED on
  a real 32-bit target — wrong width segfaults, and the goal mandates live proof. Traps: WOW64
  pointers can exceed 0x7fffffff; predicate is pProcessMachine==UNKNOWN => native (ARM64-safe).
- [ ] indexOf() region-safe (walk committed regions like pattern, overlap by needle.len-1) + `Module`
  overloads for indexOf/pattern. Additive; needs a design huddle (behavior change for indexOf).
- [ ] `pointersTo(target, address, length, all?)` pointer scan (inverse of follow). Additive; depends on
  the 32-bit pointer-width work for correctness on WOW64 targets.
- [ ] UtlLinkedList writer / generic UtlVector(elementSize) writer. Flag; build only on a concrete job.

### Considered and DECLINED (adversary-refuted — do not build)

- readMany/gather: Windows has no scatter-gather RPM; a spanning read transfers the gaps and a single
  unmapped page throws the whole batch (worse than N reads). read() already covers contiguous.
- struct() ReClass mapper: read() already collapses the syscall; the rest is decode sugar over the
  existing Scratch/DataView views = unrequested abstraction (AGENTS + memory note forbid).
- Removing the per-accessor @example JSDoc (largest token-economy target): conflicts with AGENTS
  ("Include a single runnable @example on public methods"). Kept the @example blocks.
