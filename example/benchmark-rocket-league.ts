/**
 * Hot-accessor benchmark against live RocketLeague.exe. Reports median + p99 ns/op (the syscall
 * path dominates, so the tail matters) and a transient heap delta per op (b/op) so the zero-alloc
 * scalar path can be told apart from the bulk tArray read that allocates its result.
 *
 * Each row reads real Unreal Engine state through a stable address (GObjects/GNames header and the
 * first live UObject), so the numbers reflect the same ReadProcessMemory path production code hits.
 *
 * Offsets come from @rlsdk/epic-games (devDependency); requires the game to be running.
 *
 * Run: bun ./example/benchmark-rocket-league.ts
 */
import { GObjects } from '@rlsdk/epic-games/offsets';
import { TArray } from '@rlsdk/epic-games/offsets/Core';

import Process from '../index.ts';

const Executable = 'RocketLeague.exe';

const rocketLeague = new Process(Executable);

try {
  const base = rocketLeague.modules[Executable]!.modBaseAddr;
  const objectsHeader = base + GObjects;
  const objectsData = rocketLeague.u64(objectsHeader + TArray.Data);
  const objectsCount = rocketLeague.i32(objectsHeader + TArray.Count);

  let firstObject = 0n;

  for (let index = 0; index < objectsCount; index++) {
    const candidate = rocketLeague.u64(objectsData + BigInt(index) * 0x08n);

    if (candidate !== 0n) {
      firstObject = candidate;
      break;
    }
  }

  const readScratch = new BigUint64Array(0x40); // 64 pointers — one entity-list-sized bulk read

  // fn returns its result so the alloc pass can retain it and measure backing-store growth.
  const benchmarks: { fn: () => unknown; name: string; ops: number }[] = [
    { fn: () => rocketLeague.u32(objectsHeader + TArray.Count), name: 'u32', ops: 500_000 },
    { fn: () => rocketLeague.u64(objectsHeader + TArray.Data), name: 'u64', ops: 500_000 },
    { fn: () => rocketLeague.f32(objectsHeader + TArray.Data), name: 'f32', ops: 500_000 },
    { fn: () => rocketLeague.read(objectsData, readScratch), name: 'read[64×u64]', ops: 500_000 },
    { fn: () => rocketLeague.follow(objectsHeader, [TArray.Data, 0x00n]), name: 'follow[2-hop]', ops: 500_000 },
    { fn: () => rocketLeague.vFunction(firstObject, 0), name: 'vFunction', ops: 500_000 },
    { fn: () => rocketLeague.tArrayUPtr(objectsHeader), name: `tArrayUPtr[${objectsCount}]`, ops: 3_000 },
  ];

  const rounds = 101; // odd → clean median

  function percentile(sorted: number[], fraction: number): number {
    return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))]!;
  }

  console.log(`Attached to ${Executable} (pid ${rocketLeague.th32ProcessID}); GObjects count ${objectsCount}.\n`);
  console.log('accessor                 median ns/op    p99 ns/op   alloc b/op');
  console.log('────────────────────────────────────────────────────────────────');

  for (const { fn, name, ops } of benchmarks) {
    const iterations = Math.ceil(ops / rounds);

    // Warm the JIT and the read path.
    for (let index = 0; index < iterations; index++) {
      fn();
    }

    const samples = new Array<number>(rounds);

    for (let round = 0; round < rounds; round++) {
      const start = Bun.nanoseconds();

      for (let index = 0; index < iterations; index++) {
        fn();
      }

      samples[round] = (Bun.nanoseconds() - start) / iterations;
    }

    samples.sort((a, b) => a - b);

    // Allocation per call: retain every result in a preallocated sink (so the array itself
    // does not grow during measurement), then read the `external` delta — typed-array backing
    // stores live there. A scalar/`read` row reuses a buffer and reports 0; tArrayUPtr reports
    // its fresh result buffer (count × 8 bytes).
    const sink = new Array<unknown>(iterations).fill(null);

    Bun.gc(true);
    const externalBefore = process.memoryUsage().external;

    for (let index = 0; index < iterations; index++) {
      sink[index] = fn();
    }

    Bun.gc(true);
    const bytesPerOp = Math.max(0, (process.memoryUsage().external - externalBefore) / iterations);

    if (sink.length < 0) {
      console.log(sink); // keep `sink` live through the measurement; never executes
    }

    console.log(`${name.padEnd(24)} ${percentile(samples, 0.5).toFixed(1).padStart(12)} ${percentile(samples, 0.99).toFixed(1).padStart(12)} ${Math.round(bytesPerOp).toLocaleString().padStart(12)}`);
  }
} finally {
  rocketLeague.close();
}
