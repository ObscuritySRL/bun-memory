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

- [x] **fix(scan) — P0 hang/OOM:** `pattern()` (and latently `query()`) looped forever on any
  multi-region span. The `VirtualQueryEx` MBI buffer's backing store is relocated by Bun's GC between
  iterations, but the pointer was captured once (`mbi.ptr` / a cached `ptr(lpBufferBuffer)`), so after
  region 0 the syscall wrote to a stale address while the getters read the moved buffer — `lpAddress =
  base + size` froze. Re-pin `ptr(buffer)` per `VirtualQueryEx` call. Verified live (bun.exe 52-region
  span: indefinite hang → ~20 ms; `all` grew to ~11 GB → empty). Single-region scans were unaffected,
  which is why the 1-region integration test missed it; a self-process regression test now walks a
  3-region allocation (split via page protection, needle in the third region).
- [x] **perf(containers):** finished the `read.u64` migration (commit 3e42bb9) that the 13 `tArray*` and
  3 `utlVector*` x64 pointer decoders missed (`#Scratch16.u64[…]` view → `read.u64`, ~6.5 ns/decode,
  byte-identical, pinned by the container read-back tests).
- [x] **fix(attach):** read `GetLastError()` BEFORE `CloseHandle()` on the 4 attach/refresh failure paths
  (Process32FirstW / OpenProcess / IsWow64Process2 / Module32FirstW), so the thrown code is the real
  failure, not CloseHandle's leftover last-error (often 0). Regression test: denied `new Process(4)` (the
  System process) now surfaces `Win32Error{ what: 'OpenProcess', code: 5 }`.
- [x] **docs:** fixed a non-runnable README `BigUint64Array([1,2,3,4])` example (needs bigint literals) and
  an AI.md offset claim that wrongly bound CUtlVector's `count@0x00/elements@0x08` to `utlLinkedListU64`
  (it reads a custom RE'd header); added the omitted static `Process.from` to the surface map.
- [x] **style(types):** alphabetized the `BufferLike` union and the top-level type declarations in
  `types/Process.ts` (biome does not sort these; type-only, byte-identical).
- [x] **perf(protection):** `protection()` now uses the cached `#Scratch4.ptr` instead of the TypedArray
  view's recomputing `.ptr` getter (the lone site using the view getter) — one fewer `ptr()` call,
  byte-identical, consistent with every other accessor.

## Done — 2026-06-25 session

- [x] **feat(32-bit containers):** width-corrected the engine containers behind `is32Bit` (x64 path
  byte-identical, moved verbatim into the `else`). tArray\* (14 methods) read the x86 12-byte header via
  #Scratch12 (Data ptr@0x00 4B, ArrayNum@0x04) and write count at +0x04; tArrayUPtr widens 4-byte element
  pointers (zero-extended) and narrows on write. utlVectorRaw/U32/U64 read the x86 8-byte header via
  #Scratch8 (Size@0x00, Elements@0x04 4B), size write stays @0x00. Smaller scratches avoid an
  ERROR_PARTIAL_COPY over-read past the smaller x86 struct at a page edge. Proven live against a spawned
  SysWOW64 process (7 new wow64 tests incl. the page-boundary trap). utlLinkedListU64 + call() stay
  64-bit only (see remaining). Design huddle: assessor (11/11 live) + adversary, both vs primary sources.
- [x] **fix(extensions):** installed the missing `.ptr` getter on Float16Array (the extension advertised
  "all TypedArray types" but omitted it; BufferLike already includes it). Pinned by a test.
- [x] **fix(utlvector):** utlVectorU32/U64 now short-circuit to empty on a null elements pointer with a
  reported size, matching utlVectorRaw (was read(0n) → Win32Error). Two new tests.
- [x] **fix(tarray):** tArrayChar/tArrayWChar writes now emit the trailing null terminator their header
  count includes (it was counted but never written, leaving stale bytes in the target backing store; the
  library's own count-1 read masked it). Pinned by two new self-process write tests asserting the
  terminator byte/word.
- [x] **chore(footprint):** removed the game/offset-dependent examples — the CS2 benchmark.ts/trigger-bot.ts
  + the 15,126-line example/offsets/client_dll.json dump, and the rocket-league.integration.ts/
  benchmark-rocket-league.ts/rocket-league-chat.ts trio (+ the @rlsdk devDep). The committed gates are now
  the deterministic self-process harness + the spawned-SysWOW64 suite; RL stays verifiable live via the
  throwaway _live_rl.ts (run this session vs RocketLeague.exe — OK). Synced README/AI.md/package.json/
  CHANGELOG/prompts so no doc references a deleted file or script.

## Done — earlier sessions

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

## Done — older sessions

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
- [ ] write() force-path `finally` can mask the original WriteProcessMemory error if the protection-restore
  VirtualProtectEx ALSO fails (the finally's throw replaces the body's). Honesty-only — no handle/protection
  leak (restore is always attempted) and the GetLastError there is immediate (correct code). Not
  byte-identical to fix (rethrow the original while still surfacing a success-path restore failure) —
  deferred, same class as the call() finally masking above.

## CAPABILITY — remaining (panel B)

- [ ] **32-bit utlLinkedListU64.** HIGH-confidence NO-GO (was LOW). The shipped x64 layout is itself a
  reverse-engineered, non-canonical struct: the element pointer is read at 0x08 and capacity at 0x02, which
  do NOT match canonical Valve CUtlMemory (`m_pMemory@0x00`, `m_nAllocationCount@0x08`) — so there is no
  authoritative struct to narrow to x86, and guessing the x86 offsets would violate "no guessed layouts."
  CUtlLinkedList is a Source 2 / CS2 (x64-only) container, so no real 32-bit target exercises it. Node
  stride 0x10 does survive on x86 (8-aligned uint64), but that alone is insufficient. Keep x64-only.
- [ ] **32-bit call().** NO-GO — reasoning corrected: it is NOT untestable (the prior "needs a real 32-bit
  target to call into" objection is wrong). A self-contained x86 stub written into the spawned SysWOW64
  process proves the whole path with no export resolver — e.g. `8B 44 24 04 / 40 / C2 04 00`
  (`mov eax,[esp+4]; inc eax; ret 4`). The real blocker is that the public `CallSignature` carries no
  calling-convention selector: x64 Windows has one ABI, x86 has cdecl/stdcall/thiscall/fastcall that differ
  in stack cleanup and arg location, so an x86 emitter needs info the type doesn't carry — adding
  `convention?` is a public-API change requiring an explicit owner request. Also needs a separate x86 emitter
  and a `ret 4` thread-proc (x86 CreateRemoteThread passes one stack param). Low demand. Keep throwing on 32-bit.
- [ ] **region-safe indexOf — NO-GO as new surface** (reframed; the pattern() multi-region fix lands the
  real win). With pattern() fixed, `pattern(needle.toString('hex'), address, length, all)` IS region-safe
  exact-byte search with zero new surface — a pure-hex needle collapses to one anchor token, and pattern()
  already skips unmapped pages where indexOf throws ERROR_PARTIAL_COPY. Optional: document the composition in
  indexOf's JSDoc. The one true gap — a needle straddling two address-contiguous regions of differing
  protection — is record-only (near-zero demand; pattern() doesn't stitch either). If ever wanted, stitch in
  pattern()'s loop (carry needle.len-1 trailing bytes when next base == previous regionEnd), not a new method.
- [ ] `pointersTo` **— NO-GO as bespoke surface** (reframed). Composes directly on the fixed pattern():
  `pattern(targetHexLE, address, length, true)` + an aligned filter; width is `is32Bit ? 4-byte LE : 8-byte
  LE` (a ~2-line caller-side encode). The prerequisite was the pattern() fix, not a new region-safe indexOf.
  Revisit a dedicated method only if a measured batch/ergonomic win is shown against that composition on a
  real 32-bit target.

### Design-doubt — record-only (panel-B hypotheses; do NOT implement under harden)

- **indexOf() vs pattern() contract divergence.** indexOf() throws on an unmapped page anywhere in
  [address, length); its sibling pattern() is region-safe and skips uncommitted pages — same conceptual
  op, opposite failure semantics. Making indexOf region-safe is a behavior change (throw -> -1n/partial)
  so it would need its own gated slice; the zero-surface alternative is `pattern(needle.toString('hex'),
  …)` (see the region-safe-indexOf capability note). Otherwise document the divergence so callers know
  indexOf != pattern on unmapped pages.
- **tArrayRaw vs utlVectorRaw overload shapes disagree.** tArrayRaw discriminates its 2nd positional by
  type (`dataSize: number` read | `Buffer[]` write, stride inferred on write); utlVectorRaw makes
  `elementSize` a REQUIRED 2nd positional on both read and write, pushing the write value to slot 3 and
  breaking the universal `(address, value, force)` write shape. Reconciling is a breaking signature change
  -> record-only; preferred direction if ever done is to make utlVectorRaw infer the stride like tArrayRaw.
- **Four conventions for "a read needs extra info"** across the ~90 accessors: string/cString and tArrayRaw
  type-discriminate the 2nd positional; utlVectorRaw uses a required 2nd positional shared by read+write;
  indexOf/pattern use a trailing `length` + `all` flag; scalars/typed-arrays are uniformly
  `(address)` / `(address, value, force)`. indexOf/pattern's shape is justified (needle occupies slot 2);
  utlVectorRaw is the outlier to reconcile. Record-only.
- **KEEP decisions (evaluated, no change):** Win32Error already exposes numeric `.code` + `.what`
  (programmatically branchable; typed subclasses would be vanity) · `force` as a trailing boolean is correct
  for the zero-alloc hot path (an options object allocates per write) · `read(address, scratch): T` returning
  the same generic buffer is the right ergonomic (typed one-liners, zero cost for the reuse pattern) · the
  ~10 `as CallReturn<Signature>` casts in call() are unavoidable without a generic-overload redesign (runtime
  FFIType dispatch vs a compile-time conditional type) — they are the least-bad localization, not a no-cast
  violation to "fix."

### Considered and DECLINED (do not build)

- **Lazy self-replacing arch dispatch** (owner-suggested: on first call,
  `Object.defineProperty(this, 'uPtr', { value: is32Bit ? uPtr32 : uPtr64 })` to drop the per-call
  `if (this.is32Bit)` branch — the @bun-win32 lazy-load pattern). MEASURED no gain: the branch costs
  −0.2 ns/call vs a pre-bound fn (noise, actually marginally faster) and end-to-end uPtr read is 300 ns
  median both ways (write 2300 ns) — the RPM/WPM syscall swallows it 1500–10000×. @bun-win32 uses lazy
  bind to defer an *expensive* dlopen/symbol resolve; here the deferred "resource" is one readonly
  boolean read, so the analogy doesn't carry a cost worth deferring. Downsides: replacing an overloaded
  method via defineProperty needs a cast (AGENTS: NO casts), per-instance fn objects ×~22 methods, and
  self-replacing methods are harder to read than a one-line predicted branch. Owner may override; the
  number says it buys nothing.
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
