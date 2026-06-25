/**
 * Live RocketLeague.exe integration tests: attach to the running game and read real
 * Unreal Engine 3 state (GNames / GObjects) through the library to prove the pointer-shaped
 * accessors — uPtr/u64, i32, wideString, follow, tArrayUPtr, vTable, vFunction — against a
 * real x64 target. A wrong offset, stride, or pointer width would read garbage or segfault,
 * so passing here is a hands-on proof on live engine memory (not a synthetic buffer).
 *
 * Offsets come from @rlsdk/epic-games (devDependency). They are hardcoded per game build; if
 * RocketLeague updates, `readArrayHeader` fails loudly (stale-offset signal) rather than
 * dereferencing wild pointers. The whole suite is skipped when the game is not running.
 *
 * Run: bun test example/rocket-league.integration.ts
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import { GNames, GObjects } from '@rlsdk/epic-games/offsets';
import { FNameEntry, Object_, TArray } from '@rlsdk/epic-games/offsets/Core';

import Process from '../index.ts';

const Executable = 'RocketLeague.exe';

let rocketLeague: Process | undefined;

try {
  rocketLeague = new Process(Executable);
} catch {
  rocketLeague = undefined;
}

const running = rocketLeague !== undefined;

afterAll(() => rocketLeague?.close());

// A valid Unreal TArray<T*> header: non-null data, 0 < count <= max, and a sane upper bound.
// A stale GNames/GObjects offset surfaces here instead of as a wild read downstream.
function readArrayHeader(process: Process, address: bigint, label: string): { count: number; data: bigint; max: number } {
  const data = process.u64(address + TArray.Data);
  const count = process.i32(address + TArray.Count);
  const max = process.i32(address + TArray.Max);

  if (data === 0n || count <= 0 || max < count || max > 5_000_000) {
    throw new Error(`${label} @ 0x${address.toString(16)} is not a valid TArray (data=0x${data.toString(16)} count=${count} max=${max}); @rlsdk/epic-games offsets may be stale for this build.`);
  }

  return { count, data, max };
}

// FName -> string. GNames is a TArray<FNameEntry*>; the name is an inline null-terminated
// wide-char array at FNameEntry.Name (proves u64 deref + wideString in one shot).
function readName(process: Process, namesData: bigint, index: number): string {
  const entry = process.u64(namesData + BigInt(index) * 0x08n);

  return entry === 0n ? '' : process.wideString(entry + FNameEntry.Name, 0x400);
}

const state: { firstIndex: number; firstObject: bigint; namesData: bigint; objects: BigUint64Array; objectsData: bigint } = {
  firstIndex: -1,
  firstObject: 0n,
  namesData: 0n,
  objects: new BigUint64Array(0),
  objectsData: 0n,
};

describe.skipIf(!running)(`${Executable} (live)`, () => {
  beforeAll(() => {
    const process = rocketLeague!;
    const base = process.modules[Executable]!.modBaseAddr;

    state.namesData = readArrayHeader(process, base + GNames, 'GNames').data;
    state.objectsData = readArrayHeader(process, base + GObjects, 'GObjects').data;

    // Library path: read the whole GObjects pointer array via tArrayUPtr.
    state.objects = process.tArrayUPtr(base + GObjects);

    for (let index = 0; index < state.objects.length; index++) {
      if (state.objects[index] !== 0n) {
        state.firstIndex = index;
        state.firstObject = state.objects[index]!;
        break;
      }
    }
  });

  test('attaches and enumerates the module as a native x64 image', () => {
    expect(rocketLeague!.szExeFile).toBe(Executable);
    expect(rocketLeague!.is32Bit).toBe(false);
    expect(rocketLeague!.modules[Executable]).toBeDefined();
  });

  test('GNames and GObjects decode as valid Unreal TArrays', () => {
    const base = rocketLeague!.modules[Executable]!.modBaseAddr;
    const names = readArrayHeader(rocketLeague!, base + GNames, 'GNames');
    const objects = readArrayHeader(rocketLeague!, base + GObjects, 'GObjects');

    expect(names.data).toBeGreaterThan(0n);
    expect(names.count).toBeLessThanOrEqual(names.max);
    expect(objects.data).toBeGreaterThan(0n);
    expect(objects.count).toBeLessThanOrEqual(objects.max);
  });

  test('FName 0 is "None" (engine-stable anchor; proves uPtr + wideString)', () => {
    // NAME_None == 0 and the first seeded property names are compile-time constants in UE3,
    // invariant across builds even as the live name/object counts drift.
    expect(readName(rocketLeague!, state.namesData, 0)).toBe('None');
    expect(readName(rocketLeague!, state.namesData, 1)).toBe('ByteProperty');
  });

  test('tArrayUPtr(GObjects) agrees with a manual u64 read and with follow()', () => {
    expect(state.firstIndex).toBeGreaterThanOrEqual(0);
    expect(state.firstObject).toBeGreaterThan(0n);

    // Manual element read off the same data pointer.
    expect(rocketLeague!.u64(state.objectsData + BigInt(state.firstIndex) * 0x08n)).toBe(state.firstObject);

    // follow(): GObjects header -> data pointer -> element[firstIndex]. Two derefs + final
    // offset must resolve to the same object the bulk tArray read produced.
    const base = rocketLeague!.modules[Executable]!.modBaseAddr;
    expect(rocketLeague!.follow(base + GObjects, [TArray.Data, BigInt(state.firstIndex) * 0x08n, 0x00n])).toBe(state.firstObject);
  });

  test('vTable and vFunction resolve into the module image', () => {
    const module = rocketLeague!.modules[Executable]!;
    const vtable = rocketLeague!.vTable(state.firstObject);
    const vfunction = rocketLeague!.vFunction(state.firstObject, 0);

    expect(vtable).toBeGreaterThanOrEqual(module.modBaseAddr);
    expect(vtable).toBeLessThan(module.modEndAddr);
    expect(vfunction).toBeGreaterThanOrEqual(module.modBaseAddr);
    expect(vfunction).toBeLessThan(module.modEndAddr);
  });

  test('UClass metaclass invariant holds across a sample (object.Class.Class is "Class")', () => {
    const process = rocketLeague!;
    let sampled = 0;
    let satisfied = 0;

    for (let index = 0; index < state.objects.length && sampled < 200; index++) {
      const object = state.objects[index]!;

      if (object === 0n) {
        continue;
      }

      sampled++;

      const klass = process.u64(object + Object_.Class);
      const metaclass = klass === 0n ? 0n : process.u64(klass + Object_.Class);

      if (metaclass !== 0n && readName(process, state.namesData, process.i32(metaclass + Object_.Name)) === 'Class') {
        satisfied++;
      }
    }

    expect(sampled).toBeGreaterThan(0);
    expect(satisfied).toBe(sampled);
  });
});

if (!running) {
  test.skip(`${Executable} is not running — live integration skipped`, () => {});
}
