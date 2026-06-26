/**
 * Self-process integration tests: allocate local memory, take its native address,
 * then read/write it back through the library via ReadProcessMemory/WriteProcessMemory
 * on the current process. This proves every offset / stride / pointer-width assumption
 * without a second process (a wrong offset would segfault or mismatch).
 *
 * Run: bun test example/self-process.integration.ts
 */
import { afterAll, describe, expect, test } from 'bun:test';
import { FFIType, ptr } from 'bun:ffi';

import Process from '../index.ts';

const self = new Process(process.pid);
const at = (view: Parameters<typeof ptr>[0]): bigint => BigInt(ptr(view));

afterAll(() => self.close());

describe('attach', () => {
  test('opens the current process and enumerates modules', () => {
    expect(self.th32ProcessID).toBe(process.pid);
    expect(Object.keys(self.modules).length).toBeGreaterThan(0);
    expect(self.is32Bit).toBe(false); // the test runner (bun.exe) is x64
  });

  test('reads PROCESSENTRY32W scalar fields at the correct x64 offsets', () => {
    // Pins the aligned layout (4-byte pad after th32ProcessID for ULONG_PTR th32DefaultHeapID):
    // cntThreads@0x1c, th32ParentProcessID@0x20, pcPriClassBase@0x24. A one-slot-low read would
    // surface cntThreads as th32ModuleID (≈0) and pcPriClassBase as the parent PID (≫31).
    expect(self.cntThreads).toBeGreaterThanOrEqual(1);
    expect(self.th32ParentProcessID).toBeGreaterThan(0);
    expect(self.pcPriClassBase).toBeGreaterThan(0);
    expect(self.pcPriClassBase).toBeLessThanOrEqual(31); // base priority is 1..31, never a PID
  });
});

describe('scalars', () => {
  test('bool', () => {
    const buffer = Buffer.alloc(4);
    buffer.writeUInt8(1, 0);
    expect(self.bool(at(buffer))).toBe(true);
    self.bool(at(buffer), false);
    expect(buffer.readUInt8(0)).toBe(0);
  });

  test('u8 / i8', () => {
    const buffer = Buffer.alloc(4);
    buffer.writeUInt8(0xab, 0);
    expect(self.u8(at(buffer))).toBe(0xab);
    expect(self.i8(at(buffer))).toBe(-85);
    self.u8(at(buffer), 0x12);
    expect(buffer.readUInt8(0)).toBe(0x12);
    self.i8(at(buffer), -5);
    expect(buffer.readInt8(0)).toBe(-5);
  });

  test('u16 / i16', () => {
    const buffer = Buffer.alloc(4);
    buffer.writeUInt16LE(0xbeef, 0);
    expect(self.u16(at(buffer))).toBe(0xbeef);
    expect(self.i16(at(buffer))).toBe(0xbeef - 0x10000);
    self.u16(at(buffer), 0x1234);
    expect(buffer.readUInt16LE(0)).toBe(0x1234);
  });

  test('u32 / i32', () => {
    const buffer = Buffer.alloc(4);
    buffer.writeUInt32LE(0xdeadbeef, 0);
    expect(self.u32(at(buffer))).toBe(0xdeadbeef);
    expect(self.i32(at(buffer))).toBe(-559038737);
    self.u32(at(buffer), 0x01020304);
    expect(buffer.readUInt32LE(0)).toBe(0x01020304);
  });

  test('u64 / i64', () => {
    const buffer = Buffer.alloc(8);
    buffer.writeBigUInt64LE(0x1122334455667788n, 0);
    expect(self.u64(at(buffer))).toBe(0x1122334455667788n);
    self.u64(at(buffer), 0xcafef00dn);
    expect(buffer.readBigUInt64LE(0)).toBe(0xcafef00dn);
    self.i64(at(buffer), -1n);
    expect(buffer.readBigInt64LE(0)).toBe(-1n);
  });

  test('f32 / f64', () => {
    const buffer = Buffer.alloc(8);
    buffer.writeFloatLE(1.5, 0);
    expect(self.f32(at(buffer))).toBe(1.5);
    self.f32(at(buffer), -2.25);
    expect(buffer.readFloatLE(0)).toBe(-2.25);
    buffer.writeDoubleLE(3.140625, 0);
    expect(self.f64(at(buffer))).toBe(3.140625);
    self.f64(at(buffer), -9.5);
    expect(buffer.readDoubleLE(0)).toBe(-9.5);
  });

  test('f16 (half precision)', () => {
    const buffer = new Float16Array([1.5]);
    expect(self.f16(at(buffer))).toBe(1.5);
    self.f16(at(buffer), -2.25);
    expect(buffer[0]).toBe(-2.25);
  });

  test('uPtr (pointer-sized) forwards to u64', () => {
    const buffer = Buffer.alloc(8);
    buffer.writeBigUInt64LE(0x7ff012340000n, 0);
    expect(self.uPtr(at(buffer))).toBe(0x7ff012340000n);
  });

  test('bits extracts a bitfield', () => {
    const buffer = Buffer.alloc(4);
    buffer.writeUInt32LE(0xabcd, 0);
    expect(self.bits(at(buffer), 0, 8)).toBe(0xcd);
    expect(self.bits(at(buffer), 8, 8)).toBe(0xab);
  });
});

describe('buffers and strings', () => {
  test('read/write Buffer', () => {
    const source = Buffer.from([1, 2, 3, 4, 5]);
    expect([...self.buffer(at(source), 5)]).toEqual([1, 2, 3, 4, 5]);
    const destination = Buffer.alloc(4);
    self.buffer(at(destination), Buffer.from([9, 8, 7, 6]));
    expect([...destination]).toEqual([9, 8, 7, 6]);
  });

  test('utf-8 string read/write', () => {
    const source = Buffer.alloc(16);
    source.write('hello\0', 0, 'utf8');
    expect(self.string(at(source), 16)).toBe('hello');
    const destination = Buffer.alloc(16);
    self.string(at(destination), 'world\0');
    expect(destination.toString('utf8', 0, 5)).toBe('world');
  });

  test('utf-16 wide string read/write', () => {
    const source = Buffer.alloc(32);
    source.write('hello\0', 0, 'utf16le');
    expect(self.wideString(at(source), 16)).toBe('hello');
    const destination = Buffer.alloc(16);
    self.wideString(at(destination), 'world');
    expect(destination.toString('utf16le', 0, 10)).toBe('world');
  });

  test('cString read', () => {
    const source = Buffer.alloc(16);
    source.write('hiya\0', 0, 'utf8');
    expect(self.cString(at(source), 16).toString()).toBe('hiya');
  });
});

describe('typed arrays', () => {
  test('f32Array read/write', () => {
    const source = new Float32Array([1.5, -2.25, 3.125, 4]);
    expect([...self.f32Array(at(source), 4)]).toEqual([1.5, -2.25, 3.125, 4]);
    const destination = new Float32Array(3);
    self.f32Array(at(destination), new Float32Array([9, 8, 7]));
    expect([...destination]).toEqual([9, 8, 7]);
  });

  test('f16Array read/write', () => {
    const source = new Float16Array([0.5, -1, 2, 4]);
    expect([...self.f16Array(at(source), 4)]).toEqual([0.5, -1, 2, 4]);
    const destination = new Float16Array(2);
    self.f16Array(at(destination), new Float16Array([1.5, -0.5]));
    expect([...destination]).toEqual([1.5, -0.5]);
  });

  test('Float16Array exposes the .ptr extension like every other view', () => {
    const view = new Float16Array([1.5, -0.5]);
    expect(view.ptr).toBe(ptr(view)); // getter installed; matches bun:ffi ptr()
  });

  test('u32Array read/write', () => {
    const source = new Uint32Array([10, 20, 30]);
    expect([...self.u32Array(at(source), 3)]).toEqual([10, 20, 30]);
    const destination = new Uint32Array(2);
    self.u32Array(at(destination), new Uint32Array([7, 8]));
    expect([...destination]).toEqual([7, 8]);
  });

  test('u64Array / uPtrArray read', () => {
    const source = new BigUint64Array([1n, 2n, 0xffffffffffn]);
    expect([...self.u64Array(at(source), 3)]).toEqual([1n, 2n, 0xffffffffffn]);
    expect([...self.uPtrArray(at(source), 3)]).toEqual([1n, 2n, 0xffffffffffn]);
  });

  test('i16Array / u8Array read', () => {
    const shorts = new Int16Array([-1, 2, -3]);
    expect([...self.i16Array(at(shorts), 3)]).toEqual([-1, 2, -3]);
    const bytes = new Uint8Array([255, 0, 128]);
    expect([...self.u8Array(at(bytes), 3)]).toEqual([255, 0, 128]);
  });
});

describe('vectors / matrices / colors', () => {
  test('point / vector2', () => {
    const buffer = Buffer.alloc(8);
    new Float32Array(buffer.buffer, buffer.byteOffset, 2).set([1, 2]);
    expect(self.point(at(buffer))).toEqual({ x: 1, y: 2 });
    self.vector2(at(buffer), { x: 3, y: 4 });
    expect([...new Float32Array(buffer.buffer, buffer.byteOffset, 2)]).toEqual([3, 4]);
  });

  test('vector3', () => {
    const buffer = Buffer.alloc(12);
    const view = new Float32Array(buffer.buffer, buffer.byteOffset, 3);
    view.set([1, 2, 3]);
    expect(self.vector3(at(buffer))).toEqual({ x: 1, y: 2, z: 3 });
    self.vector3(at(buffer), { x: 4, y: 5, z: 6 });
    expect([...view]).toEqual([4, 5, 6]);
  });

  test('quaternion / vector4 (w at index 3)', () => {
    const buffer = Buffer.alloc(16);
    const view = new Float32Array(buffer.buffer, buffer.byteOffset, 4);
    view.set([1, 2, 3, 4]); // x,y,z,w
    expect(self.quaternion(at(buffer))).toEqual({ x: 1, y: 2, z: 3, w: 4 });
    expect(self.vector4(at(buffer))).toEqual({ x: 1, y: 2, z: 3, w: 4 });
  });

  test('qAngle (pitch,yaw,roll order)', () => {
    const buffer = Buffer.alloc(12);
    const view = new Float32Array(buffer.buffer, buffer.byteOffset, 3);
    view.set([10, 20, 30]); // pitch, yaw, roll
    expect(self.qAngle(at(buffer))).toEqual({ pitch: 10, yaw: 20, roll: 30 });
    self.qAngle(at(buffer), { pitch: 1, yaw: 2, roll: 3 });
    expect([...view]).toEqual([1, 2, 3]);
  });

  test('matrix4x4 / viewMatrix', () => {
    const source = new Float32Array(16).map((_, index) => index);
    expect([...self.matrix4x4(at(source))]).toEqual([...source]);
    expect([...self.viewMatrix(at(source))]).toEqual([...source]);
  });

  test('rgb / rgba', () => {
    const buffer = Buffer.from([255, 128, 64, 32]);
    expect(self.rgb(at(buffer))).toEqual({ r: 255, g: 128, b: 64 });
    expect(self.rgba(at(buffer))).toEqual({ r: 255, g: 128, b: 64, a: 32 });
    self.rgb(at(buffer), { r: 1, g: 2, b: 3 });
    expect([buffer[0], buffer[1], buffer[2]]).toEqual([1, 2, 3]);
  });

  test('pointArray / vector3Array', () => {
    const points = new Float32Array([1, 2, 3, 4]);
    expect(self.pointArray(at(points), 2)).toEqual([
      { x: 1, y: 2 },
      { x: 3, y: 4 },
    ]);
    const vectors = new Float32Array([1, 2, 3, 4, 5, 6]);
    expect(self.vector3Array(at(vectors), 2)).toEqual([
      { x: 1, y: 2, z: 3 },
      { x: 4, y: 5, z: 6 },
    ]);
  });
});

describe('pointer machinery', () => {
  test('follow resolves a chain and detects null', () => {
    const leaf = Buffer.alloc(0x40);
    const node = Buffer.alloc(0x40);
    node.writeBigUInt64LE(at(leaf), 0x10);
    expect(self.follow(at(node), [0x10n, 0x20n])).toBe(at(leaf) + 0x20n);
    expect(self.follow(at(node), [])).toBe(at(node));
    node.writeBigUInt64LE(0n, 0x10);
    expect(self.follow(at(node), [0x10n, 0x00n])).toBe(-1n);
  });

  test('vTable / vFunction read through the vtable', () => {
    const vtable = Buffer.alloc(0x40);
    vtable.writeBigUInt64LE(0x1111n, 0x00);
    vtable.writeBigUInt64LE(0x2222n, 0x08);
    vtable.writeBigUInt64LE(0x3333n, 0x10);
    const object = Buffer.alloc(0x10);
    object.writeBigUInt64LE(at(vtable), 0x00);
    expect(self.vTable(at(object))).toBe(at(vtable));
    expect(self.vFunction(at(object), 0)).toBe(0x1111n);
    expect(self.vFunction(at(object), 2)).toBe(0x3333n);
  });

  test('indexOf finds first and all matches', () => {
    const haystack = Buffer.from('AA__needle__needle__');
    const needle = Buffer.from('needle');
    expect(self.indexOf(needle, at(haystack), haystack.length)).toBe(at(haystack) + 4n);
    expect(self.indexOf(needle, at(haystack), haystack.length, true)).toEqual([at(haystack) + 4n, at(haystack) + 12n]);
    // grow-on-demand reuse: a shorter follow-up scan must not match stale tail bytes from the
    // longer prior read (the 'needle' at offset 4 lies beyond the 4-byte window).
    expect(self.indexOf(needle, at(haystack), 4)).toBe(-1n);
  });

  test('pattern matches bytes and wildcards across a region', () => {
    const buffer = Buffer.alloc(0x100);
    buffer.set([0xde, 0xad, 0xbe, 0xef], 0x40);
    const address = at(buffer);
    expect(self.pattern('deadbeef', address, 0x100)).toBe(address + 0x40n);
    expect(self.pattern('dead??ef', address, 0x100)).toBe(address + 0x40n);
    expect(self.pattern('deadbeff', address, 0x100)).toBe(-1n);
    expect(self.pattern('deadbeef', address, 0x100, true)).toEqual([address + 0x40n]);
  });
});

describe('engine containers', () => {
  test('tArrayU32 read/write (data@0x00, count@0x08)', () => {
    const data = new Uint32Array([10, 20, 30]);
    const header = Buffer.alloc(0x10);
    header.writeBigUInt64LE(at(data), 0x00);
    header.writeUInt32LE(3, 0x08);
    expect([...self.tArrayU32(at(header))]).toEqual([10, 20, 30]);
    self.tArrayU32(at(header), new Uint32Array([7, 8]));
    expect(header.readUInt32LE(0x08)).toBe(2);
    expect([data[0], data[1]]).toEqual([7, 8]);
  });

  test('tArrayChar (count includes null terminator)', () => {
    const data = Buffer.alloc(16);
    data.write('hello', 0, 'utf8');
    const header = Buffer.alloc(0x10);
    header.writeBigUInt64LE(at(data), 0x00);
    header.writeUInt32LE(6, 0x08);
    expect(self.tArrayChar(at(header))).toBe('hello');
  });

  test('tArrayChar write sets count and emits the null terminator it counts', () => {
    const data = Buffer.alloc(16, 0xff); // pre-fill so a missing terminator is visible
    data.write('hello\0', 0, 'utf8');
    const header = Buffer.alloc(0x10);
    header.writeBigUInt64LE(at(data), 0x00);
    header.writeUInt32LE(6, 0x08);
    self.tArrayChar(at(header), 'hi');
    expect(header.readUInt32LE(0x08)).toBe(3); // 2 chars + null
    expect([...data.subarray(0, 3)]).toEqual([0x68, 0x69, 0x00]); // 'h', 'i', '\0'
    expect(self.tArrayChar(at(header))).toBe('hi');
  });

  test('tArrayF32 empty count returns empty array', () => {
    const header = Buffer.alloc(0x10);
    header.writeBigUInt64LE(at(Buffer.alloc(8)), 0x00);
    header.writeUInt32LE(0, 0x08);
    expect(self.tArrayF32(at(header)).length).toBe(0);
  });

  test('utlVectorU32 read/write (count@0x00, elements@0x08)', () => {
    const elements = new Uint32Array([100, 200, 300, 400]);
    const header = Buffer.alloc(0x10);
    header.writeUInt32LE(4, 0x00);
    header.writeBigUInt64LE(at(elements), 0x08);
    expect([...self.utlVectorU32(at(header))]).toEqual([100, 200, 300, 400]);
  });

  test('utlVectorRaw read', () => {
    const elements = new Uint8Array([1, 2, 3, 4, 5, 6]);
    const header = Buffer.alloc(0x10);
    header.writeUInt32LE(3, 0x00);
    header.writeBigUInt64LE(at(elements), 0x08);
    expect([...self.utlVectorRaw(at(header), 2)]).toEqual([1, 2, 3, 4, 5, 6]);
  });

  test('utlLinkedListU64 walks the linked indices', () => {
    const elements = Buffer.alloc(0x30); // capacity 3 * stride 0x10
    elements.writeBigUInt64LE(0xaaaan, 0x00);
    elements.writeUInt16LE(1, 0x0a); // elem0.next = 1
    elements.writeBigUInt64LE(0xbbbbn, 0x10);
    elements.writeUInt16LE(2, 0x1a); // elem1.next = 2
    elements.writeBigUInt64LE(0xccccn, 0x20);
    elements.writeUInt16LE(0xffff, 0x2a); // elem2.next = end
    const header = Buffer.alloc(0x18);
    header.writeUInt16LE(3, 0x02); // capacity
    header.writeBigUInt64LE(at(elements), 0x08); // elementsPtr
    header.writeUInt16LE(0, 0x10); // head index
    expect([...self.utlLinkedListU64(at(header))]).toEqual([0xaaaan, 0xbbbbn, 0xccccn]);
  });
});

describe('memory management', () => {
  test('alloc / write / read / protection / free', () => {
    const region = self.alloc(0x1000);
    expect(region).toBeGreaterThan(0n);
    self.u32(region, 0xfeedface);
    expect(self.u32(region)).toBe(0xfeedface);
    const previous = self.protection(region, 0x1000, 0x40 /* PAGE_EXECUTE_READWRITE */);
    expect(typeof previous).toBe('number');
    self.free(region);
  });

  test('forced write flips protection then restores', () => {
    const buffer = Buffer.alloc(4);
    self.u32(at(buffer), 0x12345678, true);
    expect(buffer.readUInt32LE(0)).toBe(0x12345678);
  });

  test('query enumerates regions', () => {
    const regions = self.query();
    expect(regions.length).toBeGreaterThan(0);
    expect(typeof regions[0]!.BaseAddress).toBe('bigint');
  });
});

describe('remote call', () => {
  test('call() executes a remote function (mov eax, 0x1337; ret)', () => {
    const fn = self.alloc(0x10, 0x40 /* PAGE_EXECUTE_READWRITE */);
    self.write(fn, Buffer.from([0xb8, 0x37, 0x13, 0x00, 0x00, 0xc3]));
    expect(self.call(fn, { args: [], returns: FFIType.u32 } as const)).toBe(0x1337);
    self.free(fn);
  });

  test('call() marshals an argument (mov eax, ecx; ret)', () => {
    const fn = self.alloc(0x10, 0x40 /* PAGE_EXECUTE_READWRITE */);
    self.write(fn, Buffer.from([0x8b, 0xc1, 0xc3])); // returns the first integer argument
    expect(self.call(fn, { args: [FFIType.u32], returns: FFIType.u32 } as const, 0x1234)).toBe(0x1234);
    self.free(fn);
  });
});

describe('reliability', () => {
  test('close() and dispose are idempotent (no double-close)', () => {
    const instance = new Process(process.pid);
    instance.close();
    expect(() => instance.close()).not.toThrow();
    expect(() => instance[Symbol.dispose]()).not.toThrow();
  });
});

describe('coverage: more typed arrays', () => {
  test('i8/u16/i32/i64/f64 arrays', () => {
    const i8 = new Int8Array([-1, 2, -3]);
    expect([...self.i8Array(at(i8), 3)]).toEqual([-1, 2, -3]);
    const u16 = new Uint16Array([1000, 2000, 3000]);
    expect([...self.u16Array(at(u16), 3)]).toEqual([1000, 2000, 3000]);
    const i32 = new Int32Array([-5, 6]);
    expect([...self.i32Array(at(i32), 2)]).toEqual([-5, 6]);
    const i64 = new BigInt64Array([-1n, 2n]);
    expect([...self.i64Array(at(i64), 2)]).toEqual([-1n, 2n]);
    const f64 = new Float64Array([1.5, -2.25]);
    expect([...self.f64Array(at(f64), 2)]).toEqual([1.5, -2.25]);
  });
});

describe('coverage: matrices and raw forms', () => {
  test('matrix3x3 / matrix3x4', () => {
    const m9 = new Float32Array(9).map((_, index) => index + 1);
    expect([...self.matrix3x3(at(m9))]).toEqual([...m9]);
    const m12 = new Float32Array(12).map((_, index) => index + 1);
    expect([...self.matrix3x4(at(m12))]).toEqual([...m12]);
  });

  test('vector3Raw / qAngleRaw / quaternionRaw / rgbRaw / rgbaRaw', () => {
    const v3 = new Float32Array([1, 2, 3]);
    expect([...self.vector3Raw(at(v3))]).toEqual([1, 2, 3]);
    expect([...self.qAngleRaw(at(v3))]).toEqual([1, 2, 3]);
    const v4 = new Float32Array([1, 2, 3, 4]);
    expect([...self.quaternionRaw(at(v4))]).toEqual([1, 2, 3, 4]);
    const rgba = Buffer.from([10, 20, 30, 40]);
    expect([...self.rgbRaw(at(rgba))]).toEqual([10, 20, 30]);
    expect([...self.rgbaRaw(at(rgba))]).toEqual([10, 20, 30, 40]);
  });

  test('vector3ArrayRaw + pointArray write', () => {
    const raw = new Float32Array([1, 2, 3, 4, 5, 6]);
    expect([...self.vector3ArrayRaw(at(raw), 2)]).toEqual([1, 2, 3, 4, 5, 6]);
    const destination = new Float32Array(4);
    self.pointArray(at(destination), [
      { x: 1, y: 2 },
      { x: 3, y: 4 },
    ]);
    expect([...destination]).toEqual([1, 2, 3, 4]);
  });
});

describe('coverage: more containers', () => {
  test('tArrayU64 / tArrayI32 / tArrayUPtr', () => {
    const u64 = new BigUint64Array([1n, 2n, 0xdeadn]);
    const u64Header = Buffer.alloc(0x10);
    u64Header.writeBigUInt64LE(at(u64), 0x00);
    u64Header.writeUInt32LE(3, 0x08);
    expect([...self.tArrayU64(at(u64Header))]).toEqual([1n, 2n, 0xdeadn]);
    expect([...self.tArrayUPtr(at(u64Header))]).toEqual([1n, 2n, 0xdeadn]);

    const i32 = new Int32Array([-1, 2, -3]);
    const i32Header = Buffer.alloc(0x10);
    i32Header.writeBigUInt64LE(at(i32), 0x00);
    i32Header.writeUInt32LE(3, 0x08);
    expect([...self.tArrayI32(at(i32Header))]).toEqual([-1, 2, -3]);
  });

  test('tArrayWChar (UTF-16, count includes null)', () => {
    const data = Buffer.alloc(16);
    data.write('hi', 0, 'utf16le');
    const header = Buffer.alloc(0x10);
    header.writeBigUInt64LE(at(data), 0x00);
    header.writeUInt32LE(3, 0x08); // 2 chars + null terminator
    expect(self.tArrayWChar(at(header))).toBe('hi');
  });

  test('tArrayWChar write sets count and emits the wide null terminator it counts', () => {
    const data = Buffer.alloc(16, 0xff); // pre-fill so a missing terminator is visible
    const header = Buffer.alloc(0x10);
    header.writeBigUInt64LE(at(data), 0x00);
    header.writeUInt32LE(6, 0x08);
    self.tArrayWChar(at(header), 'hi');
    expect(header.readUInt32LE(0x08)).toBe(3); // 2 chars + null
    expect(data.readUInt16LE(0x04)).toBe(0x0000); // wide terminator after 'h','i'
    expect(self.tArrayWChar(at(header))).toBe('hi');
  });

  test('tArrayRaw (array of fixed-size buffers)', () => {
    const data = Buffer.from([1, 2, 3, 4, 5, 6]);
    const header = Buffer.alloc(0x10);
    header.writeBigUInt64LE(at(data), 0x00);
    header.writeUInt32LE(3, 0x08);
    expect(self.tArrayRaw(at(header), 2).map((buffer) => [...buffer])).toEqual([
      [1, 2],
      [3, 4],
      [5, 6],
    ]);
  });

  test('utlVectorU64', () => {
    const elements = new BigUint64Array([10n, 20n, 30n]);
    const header = Buffer.alloc(0x10);
    header.writeUInt32LE(3, 0x00);
    header.writeBigUInt64LE(at(elements), 0x08);
    expect([...self.utlVectorU64(at(header))]).toEqual([10n, 20n, 30n]);
  });
});
