/**
 * Live 32-bit (WOW64) integration tests. Spawns SysWOW64\ping.exe (a 32-bit process on x64
 * Windows), allocates regions inside it, writes synthetic x86-layout structures (4-byte pointers),
 * and asserts the width-corrected accessors decode them. A wrong width reads the adjacent field or
 * sign-extends a LargeAddressAware pointer — both surface here as a mismatch, not a crash (RPM
 * returns a catchable ERROR_PARTIAL_COPY). Every pointer assertion doubles as a zero-extension trap
 * (a high-bit value like 0xCAFEF00D must come back zero-extended, never as 0xFFFFFFFF_CAFEF00D).
 *
 * The suite skips cleanly when a 32-bit target cannot be spawned. call() stays unsupported on 32-bit.
 *
 * Run: bun test example/wow64.integration.ts
 */
import { afterAll, describe, expect, test } from 'bun:test';
import { FFIType } from 'bun:ffi';

import Process from '../index.ts';

let child: Process | undefined;
let subprocess: ReturnType<typeof Bun.spawn> | undefined;

try {
  subprocess = Bun.spawn(['C:/Windows/SysWOW64/ping.exe', '-t', '127.0.0.1'], { stderr: 'ignore', stdin: 'ignore', stdout: 'ignore' });

  // The PID exists before the toolhelp snapshot can enumerate it; retry briefly.
  for (let attempt = 0; attempt < 40 && child === undefined; attempt++) {
    try {
      child = new Process(subprocess.pid);
    } catch {
      Bun.sleepSync(50);
    }
  }
} catch {
  child = undefined;
}

const wow64 = child !== undefined && child.is32Bit === true;

afterAll(() => {
  subprocess?.kill();
  child?.close();
});

// Lay a sub-4GB WOW64 address into a 4-byte little-endian pointer field.
const low = (address: bigint): number => Number(address & 0xffffffffn);

describe.skipIf(!wow64)('WOW64 (live 32-bit target)', () => {
  // Alloc >= 0x10 so a 16-byte header read never runs off a page edge.
  const remote = (bytes: Uint8Array): bigint => {
    const address = child!.alloc(Math.max(bytes.length, 0x10));
    child!.write(address, bytes);
    return address;
  };

  test('attaches as a 32-bit (WOW64) image', () => {
    expect(child!.is32Bit).toBe(true);
    expect(child!.szExeFile.toLowerCase()).toBe('ping.exe');
  });

  test('uPtr reads 4 bytes, zero-extended, without contaminating from the next field', () => {
    const buffer = new Uint8Array([0x0d, 0xf0, 0xfe, 0xca, 0x88, 0x77, 0x66, 0x55]);
    const region = remote(buffer);
    // An 8-byte read would return 0x55667788cafef00d; sign-extension would set the high dword.
    expect(child!.uPtr(region)).toBe(0xcafef00dn);
  });

  test('uPtr writes exactly 4 bytes (low dword), leaving the adjacent dword intact', () => {
    const region = remote(new Uint8Array([0x44, 0x33, 0x22, 0x11, 0xdd, 0xcc, 0xbb, 0xaa]));
    child!.uPtr(region, 0x80000001n);
    expect(child!.u32(region)).toBe(0x80000001);
    expect(child!.u32(region + 0x04n)).toBe(0xaabbccdd);
  });

  test('uPtrArray reads/writes a 4-byte stride and widens into a BigUint64Array', () => {
    const region = remote(new Uint8Array(0x10));
    child!.u32Array(region, new Uint32Array([0x00000001, 0x80000002, 0xffffffff, 0x12345678]));
    expect([...child!.uPtrArray(region, 3)]).toEqual([1n, 0x80000002n, 0xffffffffn]);

    child!.uPtrArray(region, new BigUint64Array([0xan, 0xbn, 0xcn]));
    expect([...child!.u32Array(region, 4)]).toEqual([0xa, 0xb, 0xc, 0x12345678]); // 4th dword untouched
  });

  test('follow resolves a chain through 4-byte links and detects null', () => {
    const leaf = remote(new Uint8Array(0x40));
    const node = remote(new Uint8Array(0x40));
    child!.uPtr(node + 0x10n, leaf);
    expect(child!.follow(node, [0x10n, 0x20n])).toBe(leaf + 0x20n);
    expect(child!.follow(node, [])).toBe(node);
    child!.uPtr(node + 0x10n, 0n);
    expect(child!.follow(node, [0x10n, 0x00n])).toBe(-1n);
  });

  test('vTable / vFunction read 4-byte vtable pointer and entries at a 4-byte stride', () => {
    const buffer = new Uint8Array(0x0c);
    new DataView(buffer.buffer).setUint32(0x00, 0x11111111, true);
    new DataView(buffer.buffer).setUint32(0x04, 0x22222222, true);
    new DataView(buffer.buffer).setUint32(0x08, 0x33333333, true);
    const vtable = remote(buffer);
    const object = remote(new Uint8Array([low(vtable) & 0xff, (low(vtable) >>> 8) & 0xff, (low(vtable) >>> 16) & 0xff, (low(vtable) >>> 24) & 0xff]));
    expect(child!.vTable(object)).toBe(vtable);
    expect(child!.vFunction(object, 0)).toBe(0x11111111n);
    expect(child!.vFunction(object, 2)).toBe(0x33333333n);
  });

  test('call() is rejected on 32-bit targets', () => {
    expect(() => child!.call(0n, { args: [], returns: FFIType.void } as const)).toThrow(/32-bit/);
  });
});

if (!wow64) {
  test.skip('SysWOW64 ping.exe unavailable — WOW64 integration skipped', () => {});
}
