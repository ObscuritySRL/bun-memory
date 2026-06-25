# TODO

Deferred capabilities, flagged limitations, and the hardening backlog for bun-memory.
Maintained alongside the code (see prompts/BUILD.md). `[x]` done; `[ ]` remaining.

## Flagged — upstream / release (never silent)

- [ ] **@bun-win32/core + kernel32 need republish.** The bun-win32 source now types every kernel32
  parameter with its real Microsoft type (committed there): `LPTHREAD_START_ROUTINE` is a per-function
  generic (`CreateThread<Pointer>` / `CreateRemoteThread[Ex]<bigint>`), and all 60 bare `: bigint` are
  retyped — `SIZE_T`/`ULONG_PTR` for sizes/counts; `LPVOID`/`LPCVOID`/`PVOID`<`bigint`> for by-value
  addresses (the core void-pointer aliases were made generic, default `Pointer`); `PSIZE_T | NULL` for
  the three `SIZE_T*` out-params. The bun-memory `node_modules` copy is locally patched to match, and
  `Process.ts` now passes `null` (not `0x00n`) for the RPM/WPM out-param — which REQUIRES the
  `PSIZE_T` retype. Republish core + kernel32 and bump the dep ranges so the patch can be dropped.

## Done — this session

- [x] **fix:** PROCESSENTRY32W field offsets — cntThreads/th32ParentProcessID/pcPriClassBase were each
  one DWORD too low (read th32ModuleID/cntThreads/parentPID respectively). Corrected to 0x1c/0x20/0x24;
  pinned by a self-process test (cntThreads>=1; pcPriClassBase in 1..31, never a PID).
- [x] **feat(32-bit primitives):** width-correct uPtr (r/w), uPtrArray (r/w), follow, vTable, vFunction
  behind `is32Bit` — 4-byte pointers zero-extended via the Uint32 view (LAA >2GB safe), low-dword writes,
  4-byte vtable/link strides, uPtrArray widened into its BigUint64Array. x64 path byte-identical (the
  else branch; benched at 300ns median == u64 control). Proven live vs a spawned SysWOW64 ping.exe
  (example/wow64.integration.ts, 7 tests, zero-extension + no-contamination traps).
- [x] **perf:** indexOf() reuses a grow-on-demand #indexOfHaystack (was Buffer.allocUnsafe(length)/call).
  64KB region: median 6500->3900ns (~40%), p99 15900->7900ns (~50%). Byte-identical (subarray bounds the
  scan; pinned by a stale-tail rescan assertion).
- [x] **test:** live RocketLeague.exe integration (example/rocket-league.integration.ts, `test:rocket-league`)
  asserting FName[0]==='None', the UClass metaclass loop, vTable/vFunction in-module, and follow/tArrayUPtr
  agreement; + a median/p99/alloc benchmark (example/benchmark-rocket-league.ts) showing the zero-alloc
  scalar path vs the bulk-alloc tArray result; + the rocket-league-chat.ts call() example.
- [x] **fix(examples):** benchmark.ts/trigger-bot.ts use cs2.modules[name] + cs2.u64(modBaseAddr+offset)
  (Module lost its read methods); removed the untracked scratch benches. tsc --noEmit back to 0.
- [x] **docs/refactor:** utlVectorRaw JSDoc completed; bits() range corrected to 1-31 (1<<32===1);
  invalid `using const` disposal examples fixed; Win32Error `private static` -> `static #`.

## Done — earlier sessions

- [x] @bun-win32/* update (kernel32 1.0.26, core 1.1.4); sourced CreateRemoteThread/WaitForSingleObject +
  FormatMessageW from kernel32 (no manual dlopen); @rlsdk/epic-games -> devDep; biome replaces prettier.
- [x] Self-process integration harness; snapshot-failure sentinel + idempotent close(); dead-code purge
  (ProcessEntry32W, MBI.query static, Region/NetworkUtlVector); f16/f16Array; pattern() #patternHaystack
  reuse; combined the two-RPM header read in all tArray*/utlVector* accessors; AI.md surface map.
- [x] 32-bit DETECTION: IsWow64Process2 once at attach -> `is32Bit`; call() rejects 32-bit targets.

## HARDEN — remaining (behavior-identical)

- [ ] Scalar writers funnel through write() (re-ptr + BigInt). Inline WriteProcessMemory in the non-force
  branch. DECLINED: ~12 per-method edits, and the WriteProcessMemory syscall dominates so the saving is
  ~2-3% (u32 write ~1615 ns). Not worth the churn per AGENTS "profile first / minimal diff".
- [ ] pattern() duplicates its token-match loop across the !all/all branches (~28 lines). Folding is
  behavior-identical but it is the hottest scan loop; deferred — needs the full pattern() coverage re-run
  to ship with confidence. Token-economy only (lines).
- [ ] call() outer `finally { this.free() }` can mask the in-flight error if free() throws (target exits
  mid-call -> CreateRemoteThread/WaitForSingleObject throws E1, then free() throws E2 which wins). NOT a
  leak (hThread always closed). Fix must rethrow the original while still surfacing a success-path free
  failure — not byte-identical, so deferred.

## CAPABILITY — remaining (panel B)

- [ ] **32-bit width-correction — engine containers (the locked recipe; primitives already shipped).**
  Gate each behind `is32Bit`, x64 path unchanged. Zero-extend every 4-byte pointer via the Uint32 view
  (`BigInt(u32)`); write the low dword (`Number(BigInt.asUintN(0x20, value))`). Read the x86 header into
  the 12-byte #Scratch12 (TArray) / 8-byte #Scratch8 (CUtlVector) rather than #Scratch16 to avoid a
  page-edge ERROR_PARTIAL_COPY past the smaller x86 struct.
  - tArray* (14 methods): UE3 TArray<T> is x86 {Data ptr@0x00(4B); int ArrayNum@0x04; int ArrayMax@0x08}
    (vs x64 Data@0x00(8B); ArrayNum@0x08). So dataPtr = BigInt(u32[0]); count = u32[1] (@0x04); write
    count via u32(address + 0x04n, len). Element-data widths are arch-independent for every method EXCEPT
    tArrayUPtr, whose elements are 4-byte pointers on x86 — read as Uint32Array(count) and widen into the
    BigUint64Array (do NOT touch tArrayU64/I64/F64 element strides).
  - utlVectorRaw/U32/U64: x86 {int Size@0x00; T* Elements@0x04(4B)} (vs x64 Elements@0x08 after pad). So
    count = u32[0] (@0x00, unchanged); elementsPtr = BigInt(u32[1]) (@0x04); count write stays @0x00.
  - Verify each live by writing synthetic x86-layout structures into a spawned SysWOW64 process and reading
    them back (extend example/wow64.integration.ts); benchmark x64 tArrayU32 unchanged.
- [ ] **32-bit utlLinkedListU64.** LOW confidence: CUtlLinkedList's x86 header (where the 4-byte m_pMemory
  lands; whether head/capacity shift) is a non-standard custom struct not derivable from canonical Source.
  Node stride stays 0x10 (uint64 value 8-aligned even on x86). CUtlLinkedList is a Source/CS2 (x64) container
  unlikely on a real 32-bit target — confirm the header offsets against a real 32-bit Source target before
  shipping; do not ship a guessed layout.
- [ ] **32-bit call().** Needs a separate x86 cdecl/stdcall shellcode emitter (the current emitter is x64
  System V-ish via mov-regs + ff d0). Keep call() throwing on 32-bit until built + proven live.
- [ ] **indexOf() region-safe** (walk committed regions like pattern(), stitching the seam by needle.len-1
  bytes between address-contiguous regions). Today indexOf throws ERROR_PARTIAL_COPY on any unmapped page
  mid-range (proven live); pattern() already survives. Prototyped 4/4 live (gap-survive, seam-straddle,
  all, no-match). Behavior change (region-safe default vs throw) -> own gated slice + exhaustive tests;
  subsumes nothing already shipped. Cost vs current single-region indexOf: ~+800ns/+1 VQE on the happy path.
- [ ] `pointersTo(target, address, length, all?)` pointer scan (inverse of follow) — composable as
  indexOf(targetAsLEbytes, address, length, all) + an aligned filter; value-add is is32Bit-aware needle
  width + alignment + inherited region-safety. Build only AFTER region-safe indexOf and with a 32-bit target.

### Considered and DECLINED (do not build)

- **force-path lpflOldProtect alloc reuse** (a dedicated #ScratchProtect for the forced-write old-protect
  out-param): forced writes are a rare path (read-only pages), the alloc is 4 bytes, and the per-frame
  protected-write loop is already served by `protection()` once + `write(force=false)`. Adding instance
  state for a negligible, non-hot saving violates AGENTS "profile first / don't optimize speculatively".
- **Scratch.dataView removal** (allocated per Scratch, read nowhere): Scratch is module-exported, so the
  lane rule keeps exported surface; record-only, do not delete.
- **refresh() do-while try/finally** (hSnapshot leak on a loop-body throw): the only throw is OOM in
  Buffer.allocUnsafe(0x438) (Module getters are total over the fixed buffer) — effectively unreachable.
- **Module overloads for indexOf/pattern** (scan a module by name): `pattern(needle, mod.modBaseAddr,
  mod.modBaseSize)` already does it; an overload is ~25 chars of sugar on an already-3-signature method.
- **readMany/gather:** Windows has no scatter-gather RPM; a spanning read transfers the gaps and one
  unmapped page throws the whole batch. read() already covers contiguous.
- **struct()/ReClass mapper:** read() already collapses the syscall; the rest is decode sugar over the
  existing Scratch/DataView views = unrequested abstraction.
- **Generic typed read(address, type) primitive** (collapse the ~90 accessors): a runtime tag switch +
  size lookup replaces the JIT-constant literal size, degrades the per-method return types, and breaks the
  public surface — refuted on perf + types + AGENTS.
- **Removing per-accessor @example JSDoc** (largest token target): AGENTS requires a runnable @example on
  public methods. Kept.
