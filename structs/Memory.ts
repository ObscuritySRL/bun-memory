/**
 * Windows process memory utilities for Bun using `bun:ffi` and Win32 APIs.
 *
 * This module exposes a {@link Memory} class that can attach to a running process by name
 * and perform high-performance reads and writes directly against the target process'
 * virtual address space. It wraps selected Kernel32 functions via FFI and provides
 * strongly-typed helpers for common primitives and patterns.
 *
 * @remarks
 * - Requires Windows (uses `kernel32.dll`).
 * - Runs under Bun (uses `bun:ffi`).
 * - Use with appropriate privileges; many operations require administrator rights.
 */

import { dlopen, FFIType } from 'bun:ffi';

import Win32Error from './Win32Error';

/**
 * Minimal Kernel32 FFI surface used by this module.
 */

const { symbols: Kernel32 } = dlopen('kernel32.dll', {
  CloseHandle: { args: [FFIType.u64], returns: FFIType.bool },
  CreateToolhelp32Snapshot: { args: [FFIType.u32, FFIType.u32], returns: FFIType.u64 },
  GetLastError: { returns: FFIType.u32 },
  Module32FirstW: { args: [FFIType.u64, FFIType.ptr], returns: FFIType.bool },
  Module32NextW: { args: [FFIType.u64, FFIType.ptr], returns: FFIType.bool },
  OpenProcess: { args: [FFIType.u32, FFIType.bool, FFIType.u32], returns: FFIType.u64 },
  Process32FirstW: { args: [FFIType.u64, FFIType.ptr], returns: FFIType.bool },
  Process32NextW: { args: [FFIType.u64, FFIType.ptr], returns: FFIType.bool },
  ReadProcessMemory: { args: [FFIType.u64, FFIType.u64, FFIType.ptr, FFIType.u64, FFIType.ptr], returns: FFIType.bool },
  VirtualProtectEx: { args: [FFIType.u64, FFIType.u64, FFIType.u64, FFIType.u32, FFIType.ptr], returns: FFIType.bool },
  VirtualQueryEx: { args: [FFIType.u64, FFIType.u64, FFIType.ptr, FFIType.u64], returns: FFIType.u64 },
  WriteProcessMemory: { args: [FFIType.u64, FFIType.u64, FFIType.ptr, FFIType.u64, FFIType.ptr], returns: FFIType.bool },
});

/**
 * Loaded module metadata captured via Toolhelp APIs.
 */

type Module = {
  modBaseAddr: bigint;
  modBaseSize: number;
  szModule: string;
};

/**
 * Three-dimensional vector laid out as three 32‑bit floats (x, y, z).
 */

type Vector3 = {
  x: number;
  y: number;
  z: number;
};

/**
 * Memory region information derived from `MEMORY_BASIC_INFORMATION`.
 */

type Region = {
  base: bigint;
  protect: number;
  size: bigint;
  state: number;
  type: number;
};

/**
 * Attaches to a Windows process and provides safe, typed memory accessors.
 *
 * @example
 * ```ts
 * const memory = new Memory("strounter-cike.exe");
 *
 * const clientDLL = memory.modules['client.dll'];
 *
 * if(clientDLL === undefined) {
 *  // ...
 * }
 *
 * // Write to your anmo...
 * const ammoOffset = 0xabcdefn;
 * memory.writeUInt32(clientDLL.modBaseAddr + ammoOffset, 9_999);
 *
 * // Read your health...
 * const healthOffset = 0x123456n;
 * const health = memory.readUInt32LE(clientDLL.modBaseAddr + healthOffset);
 * console.log('You have %d health...', health);
 *
 * // Find an offset by pattern...
 * const otherOffset = memory.findPattern('aa??bbccdd??ff', clientDLL.modBaseAddr, clientDLL.modBaseSize);
 * const otherValue = memory.readBoolean(otherOffset + 0x1234n);
 *
 * memory.close();
 * ```
 */

class Memory {
  /**
   * Create a new {@link Memory} instance by process image name.
   *
   * @param name Fully-qualified process image name (e.g. `"notepad.exe"`).
   * @throws {Win32Error} If enumerating processes or opening the process fails.
   * @throws {Error} If the process cannot be found.
   */
  constructor(name: string) {
    const dwFlags = 0x00000002; /* TH32CS_SNAPPROCESS */
    const th32ProcessID = 0;

    const hSnapshot = Kernel32.CreateToolhelp32Snapshot(dwFlags, th32ProcessID);

    if (hSnapshot === -1n) {
      throw new Win32Error('CreateToolhelp32Snapshot', Kernel32.GetLastError());
    }

    const lppe = Buffer.allocUnsafe(0x238 /* sizeof(PROCESSENTRY32) */);
    /* */ lppe.writeUInt32LE(0x238 /* sizeof(PROCESSENTRY32) */);

    const bProcess32FirstW = Kernel32.Process32FirstW(hSnapshot, lppe);

    if (!bProcess32FirstW) {
      Kernel32.CloseHandle(hSnapshot);

      throw new Win32Error('Process32FirstW', Kernel32.GetLastError());
    }

    do {
      const szExeFile = lppe.toString('utf16le', 0x2c, 0x234).replace(/\0+$/, '');

      if (name === szExeFile) {
        const desiredAccess = 0x001f0fff; /* PROCESS_ALL_ACCESS */
        const inheritHandle = false;
        const th32ProcessID = lppe.readUInt32LE(0x08);

        const hProcess = Kernel32.OpenProcess(desiredAccess, inheritHandle, th32ProcessID);

        if (hProcess === 0n) {
          Kernel32.CloseHandle(hSnapshot);

          throw new Win32Error('OpenProcess', Kernel32.GetLastError());
        }

        this.szModule = szExeFile;
        this.hProcess = hProcess;
        this.th32ProcessID = th32ProcessID;

        this.refresh();

        Kernel32.CloseHandle(hSnapshot);

        return;
      }
    } while (Kernel32.Process32NextW(hSnapshot, lppe));

    Kernel32.CloseHandle(hSnapshot);

    throw new Error(`Process not found: ${name}…`);
  }

  // Properties…

  private static readonly MemoryProtections = {
    Safe: 0x10 /* PAGE_EXECUTE */ | 0x20 /* PAGE_EXECUTE_READ */ | 0x40 /* PAGE_EXECUTE_READWRITE */ | 0x80 /* PAGE_EXECUTE_WRITECOPY */ | 0x02 /* PAGE_READONLY */ | 0x04 /* PAGE_READWRITE */ | 0x08 /* PAGE_WRITECOPY */,
    Unsafe: 0x100 /* PAGE_GUARD */ | 0x01 /* PAGE_NOACCESS */,
  };

  private static readonly PatternMatchAll = /([0-9A-Fa-f]{2})+/g;
  private static readonly PatternTest = /^(?:[0-9A-Fa-f]{2}|\?{2})+$/;

  private static readonly Scratch1 = Buffer.allocUnsafe(0x01);
  private static readonly Scratch2 = Buffer.allocUnsafe(0x02);
  private static readonly Scratch4 = Buffer.allocUnsafe(0x04);
  private static readonly Scratch4_2 = Buffer.allocUnsafe(0x04);
  private static readonly Scratch8 = Buffer.allocUnsafe(0x08);
  private static readonly Scratch12 = Buffer.allocUnsafe(0x0c);

  private readonly ScratchMemoryBasicInformation = Buffer.allocUnsafe(0x30 /* sizeof(MEMORY_BASIC_INFORMATION) */);
  private readonly ScratchModuleEntry32W = Buffer.allocUnsafe(0x438 /* sizeof(MODULEENTRY32W) */);

  private _modules!: { [key: string]: Module };

  /**
   * Native process handle returned by `OpenProcess`.
   */

  public readonly hProcess: bigint;
  public readonly szModule: string;

  /**
   * Target process identifier (PID).
   */

  public readonly th32ProcessID: number;

  public get modBaseAddr(): Memory['_modules'][string]['modBaseAddr'] {
    return this.modules[this.szModule].modBaseAddr;
  }

  public get modBaseSize(): Memory['_modules'][string]['modBaseSize'] {
    return this.modules[this.szModule].modBaseSize;
  }

  /**
   * Snapshot of modules loaded in the target process.
   *
   * @remarks Call {@link refresh} to update this list.
   */

  public get modules(): Memory['_modules'] {
    return this._modules;
  }

  // Methods…

  /**
   * Close the underlying process handle.
   */

  public close(): void {
    Kernel32.CloseHandle(this.hProcess);

    return;
  }

  /**
   * Enumerate committed, readable/executable memory regions within the given range.
   *
   * @param address Start address for the query.
   * @param length Number of bytes to cover from `address`.
   * @returns Array of safe regions intersecting the requested range.
   * @private
   */

  private regions(address: bigint | number, length: bigint | number): Region[] {
    const dwLength = 0x30; /* sizeof(MEMORY_BASIC_INFORMATION) */
    let   lpAddress = BigInt(address); // prettier-ignore
    const lpBuffer = this.ScratchMemoryBasicInformation;

    const bVirtualQueryEx = !!Kernel32.VirtualQueryEx(this.hProcess, lpAddress, lpBuffer, dwLength);

    if (!bVirtualQueryEx) {
      throw new Win32Error('VirtualQueryEx', Kernel32.GetLastError());
    }

    const end = lpAddress + BigInt(length);
    const result: Region[] = [];

    do {
      const baseAddress = lpBuffer.readBigUInt64LE();
      const protect = lpBuffer.readUInt32LE(36);
      const regionSize = lpBuffer.readBigUInt64LE(24);
      const state = lpBuffer.readUInt32LE(32);
      const type = lpBuffer.readUInt32LE(40);

      if ((protect & Memory.MemoryProtections.Safe) !== 0 && (protect & Memory.MemoryProtections.Unsafe) === 0 && state === 0x1000 /* MEM_COMMIT */) {
        result.push({ base: baseAddress, protect, size: regionSize, state, type });
      }

      lpAddress = baseAddress + regionSize;
    } while (lpAddress < end && !!Kernel32.VirtualQueryEx(this.hProcess, lpAddress, lpBuffer, dwLength));

    return result;
  }

  /**
   * Refresh the list of loaded modules for the target process.
   *
   * @throws {Win32Error} If Toolhelp snapshots cannot be created or iterated.
   */

  public refresh(): void {
    const dwFlags = 0x00000008 /* TH32CS_SNAPMODULE */ | 0x00000010; /* TH32CS_SNAPMODULE32 */

    const hSnapshot = Kernel32.CreateToolhelp32Snapshot(dwFlags, this.th32ProcessID)!;

    if (hSnapshot === -1n) {
      throw new Win32Error('CreateToolhelp32Snapshot', Kernel32.GetLastError());
    }

    const lpme = this.ScratchModuleEntry32W;
    /* */ lpme.writeUInt32LE(0x438 /* sizeof(MODULEENTRY32W) */);

    const bModule32FirstW = Kernel32.Module32FirstW(hSnapshot, lpme);

    if (!bModule32FirstW) {
      Kernel32.CloseHandle(hSnapshot);

      throw new Win32Error('Module32FirstW', Kernel32.GetLastError());
    }

    const modules: Memory['_modules'] = {};

    do {
      const modBaseAddr = lpme.readBigUInt64LE(0x18);
      const modBaseSize = lpme.readUInt32LE(0x20);
      const szModule = lpme.toString('utf16le', 0x30, 0x230).replace(/\0+$/, '');

      modules[szModule] = { modBaseAddr, modBaseSize, szModule };
    } while (Kernel32.Module32NextW(hSnapshot, lpme));

    Kernel32.CloseHandle(hSnapshot);

    this._modules = Object.freeze(modules);

    return;
  }

  // Private Methods…

  // QoL methods…

  /**
   * Scan memory for a hex signature with wildcard support.
   *
   * @param needle Hex pattern using pairs of hex digits; use `??` as a byte wildcard.
   *               Whitespace is not permitted (e.g. `"48895C24??48896C24??"`).
   * @param address Start address to begin scanning.
   * @param length Number of bytes to scan from `address`.
   * @returns Address of the first match, or `-1n` if not found.
   */

  public findPattern(needle: string, address: bigint | number, length: bigint | number): bigint {
    const { PatternMatchAll, PatternTest } = Memory;

    address = BigInt(address);
    length = BigInt(length);

    const test = PatternTest.test(needle);

    if (!test) {
      return -1n;
    }

    const actualEnd = address + length;
    const actualStart = address;

    const needleLength = needle.length >>> 1;

    const [anchor, ...tokens] = [...needle.matchAll(PatternMatchAll)] //
      .map((match) => ({ buffer: Buffer.from(match[0], 'hex'), index: match.index >>> 1, length: match[0].length >>> 1 }))
      .sort(({ buffer: { length: a } }, { buffer: { length: b } }) => b - a);

    const regions = this.regions(address, length);

    for (const region of regions) {
      const regionEnd = region.base + region.size;
      const regionStart = region.base;

      const scanEnd = regionEnd < actualEnd ? regionEnd : actualEnd;
      const scanStart = regionStart > actualStart ? regionStart : actualStart;

      const scanLength = scanEnd - scanStart;

      if (needleLength > scanLength) {
        continue;
      }

      const haystack = this.readBuffer(scanStart, scanLength);

      let indexOf = haystack.indexOf(anchor.buffer, anchor.index);

      if (indexOf === -1) {
        continue;
      }

      const lastStart = scanLength - BigInt(needleLength);

      outer: do {
        const matchStart = indexOf - anchor.index;

        if (lastStart < matchStart) {
          break;
        }

        for (const token of tokens) {
          const sourceEnd = matchStart + token.index + token.length;
          const sourceStart = matchStart + token.index;

          const targetEnd = token.length;
          const targetStart = 0;

          const compare = haystack.compare(token.buffer, targetStart, targetEnd, sourceStart, sourceEnd);

          if (compare !== 0) {
            indexOf = haystack.indexOf(anchor.buffer, indexOf + 1);
            continue outer;
          }
        }

        return scanStart + BigInt(matchStart);
      } while (indexOf !== -1);
    }

    return -1n;
  }

  /**
   * Search memory for a sequence of bytes or a string.
   *
   * @param needle A `Uint8Array`, number, or string to locate.
   * @param address Start address.
   * @param length Number of bytes to search.
   * @param encoding Optional encoding when `needle` is a string.
   * @returns Address of the first match, or `-1n` if not found.
   */

  public indexOf(needle: Uint8Array | number | string, address: bigint | number, length: bigint | number, encoding?: BufferEncoding): bigint {
    address = BigInt(address);
    length = BigInt(length);

    const regions = this.regions(address, length);

    for (const { base, size } of regions) {
      const address_ = address > base ? address : base;

      const haystack = this.readBuffer(address_, base + size - address_);
      const indexOf = haystack.indexOf(needle, 0, encoding);

      if (indexOf === -1) {
        continue;
      }

      return address_ + BigInt(indexOf);
    }

    return -1n;
  }

  // Read/write methods…

  /**
   * Read a contiguous block as a `BigInt64Array`.
   *
   * @param address Source address.
   * @param length Element count (not bytes).
   * @param scratch Optional destination buffer to avoid allocations.
   * @returns View over the backing buffer as `BigInt64Array`.
   */

  public readBigInt64Array(address: bigint | number, length: number, scratch?: Buffer): BigInt64Array {
    const buffer = this.readBuffer(address, length * 8, scratch);

    const bigUInt64Array = new BigInt64Array(buffer.buffer, buffer.byteOffset, length);

    return bigUInt64Array;
  }

  /**
   * Read a signed 64‑bit big-endian integer.
   * @param address Source address.
   */

  public readBigInt64BE(address: bigint | number): bigint {
    return this.readBuffer(address, 8).readBigInt64BE();
  }

  /**
   * Read a signed 64‑bit little-endian integer.
   * @param address Source address.
   */

  public readBigInt64LE(address: bigint | number): bigint {
    return this.readBuffer(address, 8).readBigInt64LE();
  }

  /**
   * Read a contiguous block as a `BigUint64Array`.
   *
   * @param address Source address.
   * @param length Element count (not bytes).
   * @param scratch Optional destination buffer.
   * @returns View over the backing buffer as `BigUint64Array`.
   */

  public readBigUint64Array(address: bigint | number, length: number, scratch?: Buffer): BigUint64Array {
    const buffer = this.readBuffer(address, length * 8, scratch);

    const bigUInt64Array = new BigUint64Array(buffer.buffer, buffer.byteOffset, length);

    return bigUInt64Array;
  }

  /**
   * Read an unsigned 64‑bit big-endian integer.
   * @param address Source address.
   */

  public readBigUInt64BE(address: bigint | number): bigint {
    return this.readBuffer(address, 0x08, Memory.Scratch8).readBigUInt64BE();
  }

  /**
   * Read an unsigned 64‑bit little-endian integer.
   * @param address Source address.
   */

  public readBigUInt64LE(address: bigint | number): bigint {
    return this.readBuffer(address, 0x08, Memory.Scratch8).readBigUInt64LE();
  }

  /**
   * Read a boolean value (non-zero -> `true`).
   * @param address Source address.
   */

  public readBoolean(address: bigint | number): boolean {
    return Boolean(this.readUInt8(address));
  }

  /**
   * Read raw bytes from the target process.
   *
   * @param address Source address.
   * @param length Number of bytes to read.
   * @param scratch Optional Buffer to reuse for improved performance.
   * @returns Buffer containing the bytes read.
   * @throws {Win32Error} If `ReadProcessMemory` fails.
   */

  public readBuffer(address: bigint | number, length: bigint | number, scratch?: Buffer): Buffer {
    const { hProcess } = this;

    address = BigInt(address);
    length = BigInt(length);

    const lpBaseAddress = address;
    const lpBuffer = scratch ?? Buffer.allocUnsafe(Number(length));
    const nSize = length;
    const numberOfBytesRead = 0x00n;

    const bReadProcessMemory = Kernel32.ReadProcessMemory(hProcess, lpBaseAddress, lpBuffer, nSize, numberOfBytesRead);

    if (!bReadProcessMemory) {
      throw new Win32Error('ReadProcessMemory', Kernel32.GetLastError());
    }

    return lpBuffer;
  }

  /**
   * Read a 64‑bit big-endian IEEE-754 float.
   * @param address Source address.
   */

  public readDoubleBE(address: bigint | number): number {
    return this.readBuffer(address, 0x08, Memory.Scratch8).readDoubleBE();
  }

  /**
   * Read a 64‑bit little-endian IEEE-754 float.
   * @param address Source address.
   */

  public readDoubleLE(address: bigint | number): number {
    return this.readBuffer(address, 0x08, Memory.Scratch8).readDoubleLE();
  }

  // + TODO: Implement scratch…

  /**
   * Read a contiguous block as a `Float32Array`.
   *
   * @param address Source address.
   * @param length Element count (not bytes).
   * @param scratch Optional Buffer to reuse for improved performance.
   * @returns View over the backing buffer as `Float32Array`.
   */

  public readFloat32Array(address: bigint | number, length: number, scratch?: Buffer): Float32Array {
    const buffer = this.readBuffer(address, length * 0x04, scratch);

    const float32Array = new Float32Array(buffer.buffer, buffer.byteOffset, length);

    return float32Array;
  }

  /**
   * Read a 32‑bit big-endian IEEE-754 float.
   * @param address Source address.
   */

  public readFloatBE(address: bigint | number): number {
    return this.readBuffer(address, 0x04, Memory.Scratch4).readFloatBE();
  }

  /**
   * Read a 32‑bit little-endian IEEE-754 float.
   * @param address Source address.
   */

  public readFloatLE(address: bigint | number): number {
    return this.readBuffer(address, 0x04, Memory.Scratch4).readFloatLE();
  }

  /**
   * Read a 16‑bit big-endian signed integer.
   * @param address Source address.
   */

  public readInt16BE(address: bigint | number): number {
    return this.readBuffer(address, 0x02, Memory.Scratch2).readInt16BE();
  }

  /**
   * Read a 16‑bit little-endian signed integer.
   * @param address Source address.
   */

  public readInt16LE(address: bigint | number): number {
    return this.readBuffer(address, 0x02, Memory.Scratch2).readInt16LE();
  }

  /**
   * Read a 32‑bit big-endian signed integer.
   * @param address Source address.
   */

  public readInt32BE(address: bigint | number): number {
    return this.readBuffer(address, 0x04, Memory.Scratch4).readInt32BE();
  }

  /**
   * Read a 32‑bit little-endian signed integer.
   * @param address Source address.
   */

  public readInt32LE(address: bigint | number): number {
    return this.readBuffer(address, 0x04, Memory.Scratch4).readInt32LE();
  }

  /**
   * Read an 8‑bit signed integer.
   * @param address Source address.
   */

  public readInt8(address: bigint | number): number {
    return this.readBuffer(address, 0x01, Memory.Scratch1).readInt8();
  }

  // ? I don't have the brain-power for this right now… 🫠…

  /**
   * Read a big-endian signed integer of arbitrary byte length.
   * @param address Source address.
   * @param byteLength Number of bytes (1–6).
   * @param scratch Optional Buffer to reuse for improved performance.
   */

  public readIntBE(address: bigint | number, byteLength: number, scratch: Buffer): number {
    return this.readBuffer(address, byteLength, scratch).readIntBE(0, byteLength);
  }

  /**
   * Read a little-endian signed integer of arbitrary byte length.
   * @param address Source address.
   * @param byteLength Number of bytes (1–6).
   * @param scratch Optional Buffer to reuse for improved performance.
   */

  public readIntLE(address: bigint | number, byteLength: number, scratch?: Buffer): number {
    return this.readBuffer(address, byteLength, scratch).readIntLE(0, byteLength);
  }

  // ? …

  /**
   * Read bytes directly into the provided scratch buffer.
   * @param address Source address.
   * @param scratch Destination buffer; its length determines the read size.
   * @returns The same scratch buffer for chaining.
   */

  public readInto(address: bigint | number, scratch: Buffer): Buffer {
    this.readBuffer(address, scratch.byteLength, scratch);

    return scratch;
  }

  // + TODO: Implement scratch…

  /**
   * Read a `CUtlVector`-like structure of 32‑bit elements used in some networked engines.
   *
   * @param address Address of the vector base structure:
   * - `+0x00` = size (uint32)
   * - `+0x08` = pointer to elements
   * @param scratch Optional Buffer to reuse for improved performance.
   * @returns A `Uint32Array` of elements, or empty if size is 0 or pointer is null.
   */

  public readNetworkUtlVectorBase(address: bigint | number, scratch?: Buffer): Uint32Array {
    address = BigInt(address);

    const size = this.readUInt32LE(address);

    if (size === 0) {
      return new Uint32Array(0);
    }

    const elementsPtr = this.readBigUInt64LE(address + 0x08n);

    if (elementsPtr === 0n) {
      return new Uint32Array(0);
    }

    const elementsBuffer = this.readBuffer(elementsPtr, size * 0x04, scratch);

    return new Uint32Array(elementsBuffer.buffer, elementsBuffer.byteOffset, size);
  }

  /**
   * Read a UTF‑8 string up to `length` bytes or until the first NUL terminator.
   * @param address Source address.
   * @param length Maximum number of bytes to read.
   * @param scratch Optional Buffer to reuse for improved performance.
   */

  public readString(address: bigint | number, length: number, scratch?: Buffer): string {
    const buffer = this.readBuffer(address, length, scratch);

    const indexOf = buffer.indexOf(0);

    const end = indexOf !== -1 ? indexOf : buffer.length;
    const start = 0;

    return buffer.toString('utf8', start, end);
  }

  /**
   * Read a 16‑bit big-endian unsigned integer.
   * @param address Source address.
   */

  public readUInt16BE(address: bigint | number): number {
    return this.readBuffer(address, 0x02, Memory.Scratch2).readUInt16BE();
  }

  /**
   * Read a 16‑bit little-endian unsigned integer.
   * @param address Source address.
   */

  public readUInt16LE(address: bigint | number): number {
    return this.readBuffer(address, 0x02, Memory.Scratch2).readUInt16LE();
  }

  /**
   * Read a 32‑bit big-endian unsigned integer.
   * @param address Source address.
   */

  public readUInt32BE(address: bigint | number): number {
    return this.readBuffer(address, 0x04, Memory.Scratch4).readUInt32BE();
  }

  /**
   * Read a 32‑bit little-endian unsigned integer.
   * @param address Source address.
   */

  public readUInt32LE(address: bigint | number): number {
    return this.readBuffer(address, 0x04, Memory.Scratch4).readUInt32LE();
  }

  /**
   * Read an 8‑bit unsigned integer.
   * @param address Source address.
   */

  public readUInt8(address: bigint | number): number {
    return this.readBuffer(address, 0x01, Memory.Scratch1).readUInt8();
  }

  // ? I don't have the brain-power for this right now… 🫠…

  /**
   * Read a big-endian unsigned integer of arbitrary byte length.
   * @param address Source address.
   * @param byteLength Number of bytes (1–6).
   * @param scratch Optional Buffer to reuse for improved performance.
   */

  public readUIntBE(address: bigint | number, byteLength: number, scratch?: Buffer): number {
    return this.readBuffer(address, byteLength, scratch).readUIntBE(0, byteLength);
  }

  /**
   * Read a little-endian unsigned integer of arbitrary byte length.
   * @param address Source address.
   * @param byteLength Number of bytes (1–6).
   * @param scratch Optional Buffer to reuse for improved performance.
   */

  public readUIntLE(address: bigint | number, byteLength: number, scratch?: Buffer): number {
    return this.readBuffer(address, byteLength, scratch).readUIntLE(0, byteLength);
  }

  // ? …

  /**
   * Read a {@link Vector3} (three consecutive 32‑bit floats).
   * @param address Source address.
   * @returns A `{ x, y, z }` object.
   */

  public readVector3(address: bigint | number): Vector3 {
    const buffer = this.readBuffer(address, 0x0c, Memory.Scratch12);

    const x = buffer.readFloatLE();
    const y = buffer.readFloatLE(0x04);
    const z = buffer.readFloatLE(0x08);

    return { x, y, z };
  }

  // ? …

  /**
   * Write a signed 64‑bit big-endian integer.
   * @param address Destination address.
   * @param value Value to write.
   * @param force When true, temporarily enables `PAGE_EXECUTE_READWRITE` to bypass protection.
   * @returns `this` for chaining.
   * @throws {Win32Error} If the underlying write or protection change fails.
   */

  public writeBigInt64BE(address: bigint | number, value: bigint, force = false): this {
    Memory.Scratch8.writeBigInt64BE(value);

    this.writeBuffer(address, Memory.Scratch8, force);

    return this;
  }

  /**
   * Write a signed 64‑bit little-endian integer.
   * @param address Destination address.
   * @param value Value to write.
   * @param force When true, temporarily enables `PAGE_EXECUTE_READWRITE` to bypass protection.
   * @returns `this` for chaining.
   * @throws {Win32Error} If the underlying write or protection change fails.
   */

  public writeBigInt64LE(address: bigint | number, value: bigint, force = false): this {
    Memory.Scratch8.writeBigInt64LE(value);

    this.writeBuffer(address, Memory.Scratch8, force);

    return this;
  }

  /**
   * Write an unsigned 64‑bit big-endian integer.
   * @param address Destination address.
   * @param value Value to write.
   * @param force When true, temporarily enables `PAGE_EXECUTE_READWRITE` to bypass protection.
   * @returns `this` for chaining.
   * @throws {Win32Error} If the underlying write or protection change fails.
   */

  public writeBigUInt64BE(address: bigint | number, value: bigint, force = false): this {
    Memory.Scratch8.writeBigUInt64BE(value);

    this.writeBuffer(address, Memory.Scratch8, force);

    return this;
  }

  /**
   * Write an unsigned 64‑bit little-endian integer.
   * @param address Destination address.
   * @param value Value to write.
   * @param force When true, temporarily enables `PAGE_EXECUTE_READWRITE` to bypass protection.
   * @returns `this` for chaining.
   * @throws {Win32Error} If the underlying write or protection change fails.
   */

  public writeBigUInt64LE(address: bigint | number, value: bigint, force = false): this {
    Memory.Scratch8.writeBigUInt64LE(value);

    this.writeBuffer(address, Memory.Scratch8, force);

    return this;
  }

  /**
   * Write a boolean as an 8‑bit value (0 or 1).
   * @param address Destination address.
   * @param value Value to write.
   * @param force When true, temporarily enables `PAGE_EXECUTE_READWRITE` to bypass protection.
   * @returns `this` for chaining.
   * @throws {Win32Error} If the underlying write or protection change fails.
   */

  public writeBoolean(address: bigint | number, value: boolean, force = false): this {
    Memory.Scratch1.writeUInt8(+value);

    this.writeBuffer(address, Memory.Scratch1, force);

    return this;
  }

  /**
   * Write raw bytes to the target process.
   *
   * @param address Destination address.
   * @param buffer Source buffer to write.
   * @param force When true, temporarily enables `PAGE_EXECUTE_READWRITE` and restores
   *              the original protection after the write.
   * @returns `this` for chaining.
   * @throws {Win32Error} If the underlying write or protection change fails.
   */

  public writeBuffer(address: bigint | number, buffer: Buffer, force = false): this {
    const { hProcess } = this;

    address = BigInt(address);

    const lpBaseAddress = address;
    const lpBuffer = buffer;
    // const lpNumberOfBytesWritten = 0n;
    const nSize = BigInt(buffer.byteLength);

    if (!force) {
      const bWriteProcessMemory = Kernel32.WriteProcessMemory(hProcess, lpBaseAddress, lpBuffer, nSize, 0n);

      if (!bWriteProcessMemory) {
        throw new Win32Error('WriteProcessMemory', Kernel32.GetLastError());
      }

      return this;
    }

    const dwSize = BigInt(buffer.byteLength);
    const flNewProtect = 0x40; /* PAGE_EXECUTE_READWRITE */
    const lpAddress = address;
    const lpflOldProtect = Memory.Scratch4;

    const bVirtualProtectEx = !!Kernel32.VirtualProtectEx(hProcess, lpAddress, dwSize, flNewProtect, lpflOldProtect);

    if (!bVirtualProtectEx) {
      throw new Win32Error('VirtualProtectEx', Kernel32.GetLastError());
    }

    const bWriteProcessMemory = Kernel32.WriteProcessMemory(hProcess, lpBaseAddress, lpBuffer, nSize, 0n);

    if (!bWriteProcessMemory) {
      Kernel32.VirtualProtectEx(hProcess, lpAddress, nSize, lpflOldProtect.readUInt32LE(), Memory.Scratch4_2);

      throw new Win32Error('WriteProcessMemory', Kernel32.GetLastError());
    }

    Kernel32.VirtualProtectEx(hProcess, lpAddress, nSize, lpflOldProtect.readUInt32LE(), Memory.Scratch4_2);

    return this;
  }

  /**
   * Write a 64‑bit big-endian IEEE-754 float.
   * @param address Destination address.
   * @param value Value to write.
   * @param force When true, temporarily enables `PAGE_EXECUTE_READWRITE` to bypass protection.
   * @returns `this` for chaining.
   * @throws {Win32Error} If the underlying write or protection change fails.
   */

  public writeDoubleBE(address: bigint | number, value: number, force = false): this {
    Memory.Scratch8.writeDoubleBE(value);

    this.writeBuffer(address, Memory.Scratch8, force);

    return this;
  }

  /**
   * Write a 64‑bit little-endian IEEE-754 float.
   * @param address Destination address.
   * @param value Value to write.
   * @param force When true, temporarily enables `PAGE_EXECUTE_READWRITE` to bypass protection.
   * @returns `this` for chaining.
   * @throws {Win32Error} If the underlying write or protection change fails.
   */

  public writeDoubleLE(address: bigint | number, value: number, force = false): this {
    Memory.Scratch8.writeDoubleLE(value);

    this.writeBuffer(address, Memory.Scratch8, force);

    return this;
  }

  /**
   * Write a 32‑bit big-endian IEEE-754 float.
   * @param address Destination address.
   * @param value Value to write.
   * @param force When true, temporarily enables `PAGE_EXECUTE_READWRITE` to bypass protection.
   * @returns `this` for chaining.
   * @throws {Win32Error} If the underlying write or protection change fails.
   */

  public writeFloatBE(address: bigint | number, value: number, force = false): this {
    Memory.Scratch4.writeFloatBE(value);

    this.writeBuffer(address, Memory.Scratch4, force);

    return this;
  }

  /**
   * Write a 32‑bit little-endian IEEE-754 float.
   * @param address Destination address.
   * @param value Value to write.
   * @param force When true, temporarily enables `PAGE_EXECUTE_READWRITE` to bypass protection.
   * @returns `this` for chaining.
   * @throws {Win32Error} If the underlying write or protection change fails.
   */

  public writeFloatLE(address: bigint | number, value: number, force = false): this {
    Memory.Scratch4.writeFloatLE(value);

    this.writeBuffer(address, Memory.Scratch4, force);

    return this;
  }

  /**
   * Write a 16‑bit big-endian signed integer.
   * @param address Destination address.
   * @param value Value to write.
   * @param force When true, temporarily enables `PAGE_EXECUTE_READWRITE` to bypass protection.
   * @returns `this` for chaining.
   * @throws {Win32Error} If the underlying write or protection change fails.
   */

  public writeInt16BE(address: bigint | number, value: number, force = false): this {
    Memory.Scratch2.writeInt16BE(value);

    this.writeBuffer(address, Memory.Scratch2, force);

    return this;
  }

  /**
   * Write a 16‑bit little-endian signed integer.
   * @param address Destination address.
   * @param value Value to write.
   * @param force When true, temporarily enables `PAGE_EXECUTE_READWRITE` to bypass protection.
   * @returns `this` for chaining.
   * @throws {Win32Error} If the underlying write or protection change fails.
   */

  public writeInt16LE(address: bigint | number, value: number, force = false): this {
    Memory.Scratch2.writeInt16LE(value);

    this.writeBuffer(address, Memory.Scratch2, force);

    return this;
  }

  /**
   * Write a 32‑bit big-endian signed integer.
   * @param address Destination address.
   * @param value Value to write.
   * @param force When true, temporarily enables `PAGE_EXECUTE_READWRITE` to bypass protection.
   * @returns `this` for chaining.
   * @throws {Win32Error} If the underlying write or protection change fails.
   */

  public writeInt32BE(address: bigint | number, value: number, force = false): this {
    Memory.Scratch4.writeInt32BE(value);

    this.writeBuffer(address, Memory.Scratch4, force);

    return this;
  }

  /**
   * Write a 32‑bit little-endian signed integer.
   * @param address Destination address.
   * @param value Value to write.
   * @param force When true, temporarily enables `PAGE_EXECUTE_READWRITE` to bypass protection.
   * @returns `this` for chaining.
   * @throws {Win32Error} If the underlying write or protection change fails.
   */

  public writeInt32LE(address: bigint | number, value: number, force = false): this {
    Memory.Scratch4.writeInt32LE(value);

    this.writeBuffer(address, Memory.Scratch4, force);

    return this;
  }

  /**
   * Write an 8‑bit signed integer.
   * @param address Destination address.
   * @param value Value to write.
   * @param force When true, temporarily enables `PAGE_EXECUTE_READWRITE` to bypass protection.
   * @returns `this` for chaining.
   * @throws {Win32Error} If the underlying write or protection change fails.
   */

  public writeInt8(address: bigint | number, value: number, force = false): this {
    Memory.Scratch1.writeInt8(value);

    this.writeBuffer(address, Memory.Scratch1, force);

    return this;
  }

  // + TODO: Implement scratch…

  /**
   * Write a big-endian signed integer of arbitrary byte length.
   * @param address Destination address.
   * @param value Value to write.
   * @param force When true, temporarily enables `PAGE_EXECUTE_READWRITE` to bypass protection.
   * @returns `this` for chaining.
   * @throws {Win32Error} If the underlying write or protection change fails.
   */

  public writeIntBE(address: bigint | number, value: number, byteLength: number, force = false): this {
    const buffer = Buffer.allocUnsafe(byteLength);
    /* */ buffer.writeIntBE(value, 0, byteLength);

    this.writeBuffer(address, buffer, force);

    return this;
  }

  // + TODO: Implement scratch…

  /**
   * Write a little-endian signed integer of arbitrary byte length.
   * @param address Destination address.
   * @param value Value to write.
   * @param force When true, temporarily enables `PAGE_EXECUTE_READWRITE` to bypass protection.
   * @returns `this` for chaining.
   * @throws {Win32Error} If the underlying write or protection change fails.
   */

  public writeIntLE(address: bigint | number, value: number, byteLength: number, force = false): this {
    const buffer = Buffer.allocUnsafe(byteLength);
    /* */ buffer.writeIntLE(value, 0, byteLength);

    this.writeBuffer(address, buffer, force);

    return this;
  }

  // + TODO: Implement scratch…

  /**
   * Write a UTF‑8 string (no terminator is appended).
   * @param address Destination address.
   * @param value Value to write.
   * @param force When true, temporarily enables `PAGE_EXECUTE_READWRITE` to bypass protection.
   * @returns `this` for chaining.
   * @throws {Win32Error} If the underlying write or protection change fails.
   */

  public writeString(address: bigint | number, value: string, force = false): this {
    const byteLength = Buffer.byteLength(value);

    const buffer = Buffer.allocUnsafe(byteLength);
    /* */ buffer.write(value, 0, byteLength, 'utf8');

    this.writeBuffer(address, buffer, force);

    return this;
  }

  /**
   * Write a 16‑bit big-endian unsigned integer.
   * @param address Destination address.
   * @param value Value to write.
   * @param force When true, temporarily enables `PAGE_EXECUTE_READWRITE` to bypass protection.
   * @returns `this` for chaining.
   * @throws {Win32Error} If the underlying write or protection change fails.
   */

  public writeUInt16BE(address: bigint | number, value: number, force = false): this {
    Memory.Scratch2.writeUInt16BE(value);

    this.writeBuffer(address, Memory.Scratch2, force);

    return this;
  }

  /**
   * Write a 16‑bit little-endian unsigned integer.
   * @param address Destination address.
   * @param value Value to write.
   * @param force When true, temporarily enables `PAGE_EXECUTE_READWRITE` to bypass protection.
   * @returns `this` for chaining.
   * @throws {Win32Error} If the underlying write or protection change fails.
   */

  public writeUInt16LE(address: bigint | number, value: number, force = false): this {
    Memory.Scratch2.writeUInt16LE(value);

    this.writeBuffer(address, Memory.Scratch2, force);

    return this;
  }

  /**
   * Write a 32‑bit big-endian unsigned integer.
   * @param address Destination address.
   * @param value Value to write.
   * @param force When true, temporarily enables `PAGE_EXECUTE_READWRITE` to bypass protection.
   * @returns `this` for chaining.
   * @throws {Win32Error} If the underlying write or protection change fails.
   */

  public writeUInt32BE(address: bigint | number, value: number, force = false): this {
    Memory.Scratch4.writeUInt32BE(value);

    this.writeBuffer(address, Memory.Scratch4, force);

    return this;
  }

  /**
   * Write a 32‑bit little-endian unsigned integer.
   * @param address Destination address.
   * @param value Value to write.
   * @param force When true, temporarily enables `PAGE_EXECUTE_READWRITE` to bypass protection.
   * @returns `this` for chaining.
   * @throws {Win32Error} If the underlying write or protection change fails.
   */

  public writeUInt32LE(address: bigint | number, value: number, force = false): this {
    Memory.Scratch4.writeUInt32LE(value);

    this.writeBuffer(address, Memory.Scratch4, force);

    return this;
  }

  /**
   * Write an 8‑bit unsigned integer.
   * @param address Destination address.
   * @param value Value to write.
   * @param force When true, temporarily enables `PAGE_EXECUTE_READWRITE` to bypass protection.
   * @returns `this` for chaining.
   * @throws {Win32Error} If the underlying write or protection change fails.
   */

  public writeUInt8(address: bigint | number, value: number, force = false): this {
    Memory.Scratch1.writeUInt8(value);

    this.writeBuffer(address, Memory.Scratch1, force);

    return this;
  }

  // + TODO: Implement scratch…

  /**
   * Write a big-endian unsigned integer of arbitrary byte length.
   * @param address Destination address.
   * @param value Value to write.
   * @param force When true, temporarily enables `PAGE_EXECUTE_READWRITE` to bypass protection.
   * @returns `this` for chaining.
   * @throws {Win32Error} If the underlying write or protection change fails.
   */

  public writeUIntBE(address: bigint | number, value: number, byteLength: number, force = false): this {
    const buffer = Buffer.allocUnsafe(byteLength);
    /* */ buffer.writeUIntBE(value, 0, byteLength);

    this.writeBuffer(address, buffer, force);

    return this;
  }

  // + TODO: Implement scratch…

  /**
   * Write a little-endian unsigned integer of arbitrary byte length.
   * @param address Destination address.
   * @param value Value to write.
   * @param force When true, temporarily enables `PAGE_EXECUTE_READWRITE` to bypass protection.
   * @returns `this` for chaining.
   * @throws {Win32Error} If the underlying write or protection change fails.
   */

  public writeUIntLE(address: bigint | number, value: number, byteLength: number, force = false): this {
    const buffer = Buffer.allocUnsafe(byteLength);
    /* */ buffer.writeUIntLE(value, 0, byteLength);

    this.writeBuffer(address, buffer, force);

    return this;
  }

  /**
   * Write a {@link Vector3} as three consecutive 32-bit little-endian floats at the target address.
   *
   * Layout:
   * - +0x00 = x (float32)
   * - +0x04 = y (float32)
   * - +0x08 = z (float32)
   *
   * Uses `Memory.Scratch12` to avoid allocations and delegates to {@link writeBuffer}.
   *
   * @param address Destination address.
   * @param value Vector with `x`, `y`, and `z` components to write.
   * @param force When true, temporarily enables `PAGE_EXECUTE_READWRITE` to bypass protection.
   * @returns `this` for chaining.
   * @throws {Win32Error} If the underlying write or protection change fails.
   */

  public writeVector3(address: bigint | number, value: Vector3, force = false): this {
    Memory.Scratch12.writeFloatLE(value.x);
    Memory.Scratch12.writeFloatLE(value.y, 0x04);
    Memory.Scratch12.writeFloatLE(value.z, 0x08);

    this.writeBuffer(address, Memory.Scratch12, force);

    return this;
  }
}

export default Memory;
