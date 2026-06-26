HARDEN bun-memory @ D:\Projects\bun-memory — zero-alloc Win10+ process-mem R/W lib for Bun. ADD NOTHING: make EXISTS faster/leaner/safer/clearer at ZERO behavior change — every public method return/throw/signature BYTE-IDENTICAL. Pure TS, Bun FFI, NO build (main=index.ts). Win32 via @bun-win32/kernel32 (local dlopen only where already present; NEVER new surface). Claude AUTHORED all→presume ns/bytes/lines/clarity/safety on table. You=end user. Fable5+ultracode.

BAR: ship IFF (1) behavior IDENTICAL (diff before/after; ANY change=bug) (2) MOVES a measured axis (ns/bytes/allocs/lines/round-trips/err-recovery) (3) proven LIVE+regression-gated. No speculative rewrite; no "cleaner" w/o a #. BYTE-ID=default NOT design-proof: beatable shape→Design-Doubt (record-only), never polish worse.

SELF-IMPROVE (sharpen MACHINE not only product): wrote code+gates→presume an axis unhardened AND machine blunter. Stronger measure/gate/NEW LANE catching a defect-class old lanes miss=HARDEN win (byte-id diffs ship free). Even THIS prompt in scope. PUSH mandatory, FINDING not; converged=EARNED; coasting=failure.

DOCS-SYNC: after ANY tweak→SYNC to code+counts: README · JSDoc(@example) · package.json(scripts/files/deps) · AI.md · TODO.md · CHANGELOG.md · prompts/BUILD.md · prompts/HARDEN.md.

PANEL=parallel lanes, 1 ultracode expert/axis. FIRST ACTION ∀ turn: spawn ALL finders @once, HANDS-ON (read+MEASURE live+diff, never memory). LANES:
• Perf: hot-path allocs (indexOf/pattern/query/refresh/forced-write)·BigInt(byteLength)+ptr() churn·redundant RPM·lost Scratch reuse.
• AI-Digestion: errors→next step; JSDoc @example exact+runnable; smallest faithful output; CONSISTENT overload shapes.
• Token-Economy: model-paid tokens (3690-line accessor boilerplate, JSDoc, AI.md); cut keep meaning+behavior; prove byte Δ.
• Design-Doubt (record-only): method APPROACH/default/contract beatable? shape=HYPOTHESIS→record-for-BUILD/owner; NEVER implement (byte-id rules lane). DOUBT mandatory.
• Reliability: ∀ handle/snapshot freed in finally (ctor refresh()-throw leak!); denied/not-found honest (NOT raw GetLastError); no throw escapes loop; idempotent close; bounded loops.
• Segfault-Safety: offsets/strides/struct-sizes correct; .ptr never cached stale; struct@call-site; wrong offset SEGFAULTS→prove via self-process integration (alloc in-proc→read-back→assert); CLOSE ∀ handle.
• Code-Hygiene: NO casts; #private; full-word names; tsc strict; biome-clean; alphabetized.
• Dead-Code&Dup: by USEFULNESS+REACHABILITY not call-count. zero-ref→(a)useless→DELETE (b)useful-unreachable→KEEP+TODO.md (c)public/exported→KEEP. PE32W/MBI.query() unused→assess. DUP→fold onto existing; NO new abstraction.
• Ship-Footprint: files[]/deps (declared-unimported|undeclared-used)→ example-only deps in runtime deps!
• Doc-Fidelity: README/JSDoc exact (README "Memory"→Process drift!); counts; ZERO drift code↔docs.
• Test-Integrity: existing tests truly verify (not tautology), close ∀ handle; FIRST harness=BUILD (record, NEVER add surface here).

LOOP (parallel): finder→REAL win→(a) FIXER e2e (preserve behavior+LIVE+gate+commit&push 1 slice) (b) note (c) fresh same-lane finder. CLEAN-w-evidence→lane STOPS; fixer overlaps next finder.

RESOLUTION: COMPLETE iff in ONE turn EVERY lane CLEAN-w-evidence AND tsc --noEmit=0 AND smoke/integration green→STOP. Else self-loop; NEVER stop while ANY lane finds. Convergence w/o a fix valid.

LAW (AGENTS.md): surgical diffs; NO casts ever (fix types); #private; full-word names; alphabetize; tsc0 ∀ change. ABSOLUTE: NO new surface/capability — hardening ONLY. SHIP=commit&push ∀ slice (Conventional Commits 1/win); owner releases (no publish).

ANCHOR (re-verify HEAD): Process(~90 methods)+Module+Scratch+Win32Error+MBI; dep @bun-win32/kernel32; tsc0+biome; 2 suites green (self-process gate + wow64 spawn). FIRST ACTION: spawn ALL finders NOW.
