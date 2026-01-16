import '../runtime/extensions';

import { CString, ptr } from 'bun:ffi';

import Kernel32, { INVALID_HANDLE_VALUE } from 'bun-kernel32';

Kernel32.Preload([
  'CloseHandle',
  'CreateToolhelp32Snapshot',
  'GetLastError',
  'Module32FirstW',
  'Module32NextW',
  'OpenProcess',
  'Process32FirstW',
  'Process32NextW',
  'ReadProcessMemory',
  'VirtualAllocEx',
  'VirtualFreeEx',
  'VirtualProtectEx',
  'WriteProcessMemory',
]);

const {
  CloseHandle,
  CreateToolhelp32Snapshot,
  GetLastError,
  Module32FirstW,
  Module32NextW,
  OpenProcess,
  Process32FirstW,
  Process32NextW,
  ReadProcessMemory,
  VirtualAllocEx,
  VirtualFreeEx,
  VirtualProtectEx,
  WriteProcessMemory,
} = Kernel32;

import type { Module, Point, QAngle, Quaternion, RGB, RGBA, Scratch, UPtr, UPtrArray, Vector2, Vector3, Vector4 } from '../types/Memory';
import Win32Error from './Win32Error';

/**
 * Provides cross-process memory manipulation for native applications.
 *
 * Use this class to read and write memory, access modules, and work with common data structures in external processes.
 *
 * Many scalar reads utilize `TypedArray` scratches to avoid a second FFI hop, such as calling `bun:ffi.read.*`.
 *
 * @todo Add support for 32 or 64-bit processes using IsWow64Process2 (Windows 10+).
 * @todo When adding 32-bit support, several u64 will need changed to u64_fast.
 * @todo Add memory region query using VirtualQueryEx (find next readable region, enumerate regions).
 * @todo Function hooking - VTable hooks (pointer swaps), IAT hooks (PE parsing), inline hooks (x64 disassembler).
 *
 * @example
 * ```ts
 * import Memory from 'bun-memory';
 * const cs2 = new Memory('cs2.exe');
 * const myFloat = cs2.f32(0x12345678n);
 * cs2.close();
 * ```
 */
class Memory {
  /**
   * Opens a process by PID or executable name.
   * @param identifier Process ID or executable name.
   * @throws If the process cannot be found or opened.
   * @example
   * ```ts
   * const cs2 = new Memory('cs2.exe');
   * ```
   */
  constructor(identifier: number | string) {
    const { Patterns: { ReplaceTrailingNull } } = Memory; // prettier-ignore

    const dwFlags = 0x00000002; /* TH32CS_SNAPPROCESS */
    const th32ProcessID = 0;

    const hSnapshot = CreateToolhelp32Snapshot(dwFlags, th32ProcessID);

    if (hSnapshot === -1n) {
      throw new Win32Error('CreateToolhelp32Snapshot', GetLastError());
    }

    const lppeBuffer = Buffer.allocUnsafe(0x238 /* sizeof(PROCESSENTRY32) */);
    /* */ lppeBuffer.writeUInt32LE(0x238 /* sizeof(PROCESSENTRY32) */);

    const lppe = lppeBuffer.ptr;

    const bProcess32FirstW = Process32FirstW(hSnapshot, lppe);

    if (!bProcess32FirstW) {
      CloseHandle(hSnapshot);

      throw new Win32Error('Process32FirstW', GetLastError());
    }

    do {
      const szExeFile = lppeBuffer.toString('utf16le', 0x2c, 0x234).replace(ReplaceTrailingNull, '');
      const th32ProcessID = lppeBuffer.readUInt32LE(0x08);

      if (
        (typeof identifier === 'number' && identifier !== th32ProcessID) || //
        (typeof identifier === 'string' && identifier !== szExeFile)
      ) {
        continue;
      }

      const desiredAccess = 0x001f0fff; /* PROCESS_ALL_ACCESS */
      const inheritHandle = 0;

      const hProcess = OpenProcess(desiredAccess, inheritHandle, th32ProcessID);

      if (hProcess === 0n) {
        CloseHandle(hSnapshot);

        throw new Win32Error('OpenProcess', GetLastError());
      }

      this.__modules = {};

      this.hProcess = hProcess;
      this.th32ProcessID = th32ProcessID;

      this.refresh();

      CloseHandle(hSnapshot);

      return;
    } while (Process32NextW(hSnapshot, lppe));

    CloseHandle(hSnapshot);

    throw new Error(`Process not found: ${identifier}.`);
  }

  /**
   * Creates a Memory instance from a process identifier.
   * @param identifier Process ID or executable name.
   * @returns A new Memory instance.
   * @throws If the process cannot be found or opened.
   * @example
   * ```ts
   * const cs2 = Memory.from('cs2.exe');
   * const byPid = Memory.from(1234);
   * ```
   */
  public static from(identifier: number | string): Memory {
    return new Memory(identifier);
  }

  /**
   * Map of loaded modules in the process, keyed by module name.
   * @example
   * ```ts
   * const cs2 = new Memory('cs2.exe');
   * const mainModule = cs2.modules['cs2.exe'];
   * ```
   */
  private __modules: Record<string, Module>;

  /**
   * Regex patterns for matching hex strings and wildcards in memory scans.
   * Used by the pattern method.
   */
  private static readonly Patterns = {
    PatternMatchAll: /(?:[0-9A-Fa-f]{2})+/g,
    PatternTest: /^(?=.*[0-9A-Fa-f]{2})(?:\*{2}|\?{2}|[0-9A-Fa-f]{2})+$/,
    ReplaceTrailingNull: /\0+$/,
  };

  /**
   * Scratch buffers and typed views for temporary FFI reads/writes.
   * Used internally for efficient memory access and conversions.
   * Pointer values are pre-cached to eliminate property access overhead in hot paths.
   */
  private readonly Scratch1 = new Uint8Array(0x01);
  private readonly Scratch1Int8Array = new Int8Array(this.Scratch1.buffer, this.Scratch1.byteOffset, 0x01);
  private readonly Scratch1Ptr = this.Scratch1.ptr;

  private readonly Scratch2 = new Uint8Array(0x02);
  private readonly Scratch2Int16Array = new Int16Array(this.Scratch2.buffer, this.Scratch2.byteOffset, 0x01);
  private readonly Scratch2Ptr = this.Scratch2.ptr;
  private readonly Scratch2Uint16Array = new Uint16Array(this.Scratch2.buffer, this.Scratch2.byteOffset, 0x01);

  private readonly Scratch3 = new Uint8Array(0x03);

  private readonly Scratch4 = new Uint8Array(0x04);
  private readonly Scratch4Float32Array = new Float32Array(this.Scratch4.buffer, this.Scratch4.byteOffset, 0x01);
  private readonly Scratch4Int32Array = new Int32Array(this.Scratch4.buffer, this.Scratch4.byteOffset, 0x01);
  private readonly Scratch4Ptr = this.Scratch4.ptr;
  private readonly Scratch4Uint32Array = new Uint32Array(this.Scratch4.buffer, this.Scratch4.byteOffset, 0x01);

  private readonly Scratch8 = new Uint8Array(0x08);
  private readonly Scratch8BigInt64Array = new BigInt64Array(this.Scratch8.buffer, this.Scratch8.byteOffset, 0x01);
  private readonly Scratch8BigUint64Array = new BigUint64Array(this.Scratch8.buffer, this.Scratch8.byteOffset, 0x01);
  private readonly Scratch8Float32Array = new Float32Array(this.Scratch8.buffer, this.Scratch8.byteOffset, 0x02);
  private readonly Scratch8Float64Array = new Float64Array(this.Scratch8.buffer, this.Scratch8.byteOffset, 0x01);
  private readonly Scratch8Ptr = this.Scratch8.ptr;

  private readonly Scratch12 = new Uint8Array(0x0c);
  private readonly Scratch12Float32Array = new Float32Array(this.Scratch12.buffer, this.Scratch12.byteOffset, 0x03);
  private readonly Scratch12Ptr = this.Scratch12.ptr;

  private readonly Scratch16 = new Uint8Array(0x10);
  private readonly Scratch16Float32Array = new Float32Array(this.Scratch16.buffer, this.Scratch16.byteOffset, 0x04);
  private readonly Scratch16Ptr = this.Scratch16.ptr;

  // Reserved for future remote code execution features
  private readonly _Scratch48 = new Uint8Array([
    0x48, 0xb9, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x48, 0xb8, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x48, 0x83, 0xec, 0x28, 0xff, 0xd0, 0x48, 0xa3, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x48, 0x83, 0xc4,
    0x28, 0xc3, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  ]);

  // Reserved for future features
  private readonly _Scratch112 = new Uint8Array(0x70);

  private readonly Scratch1080 = Buffer.allocUnsafe(0x438 /* sizeof(MODULEENTRY32W) */);

  private static TextDecoderUTF8 = new TextDecoder('utf-8');
  private static TextEncoderUTF8 = new TextEncoder('utf-8');

  private readonly hProcess: bigint;
  private readonly th32ProcessID: number;

  /**
   * Gets all loaded modules in the process.
   * @returns Map of module name to module info with base-relative helpers.
   * @example
   * ```ts
   * const cs2 = new Memory('cs2.exe');
   * const client = cs2.modules['client.dll'];
   * ```
   */
  public get modules(): Memory['__modules'] {
    return this.__modules;
  }

  /**
   * Disposes resources held by this Memory instance.
   * Called automatically when using `using` blocks.
   * @example
   * ```ts
   * using const mem = new Memory('cs2.exe');
   * // mem is disposed at the end of the block
   * ```
   */
  public [Symbol.dispose](): void {
    this.close();

    return;
  }

  /**
   * Asynchronously disposes resources held by this Memory instance.
   * Use in `await using` blocks for async cleanup.
   * @example
   * ```ts
   * await using const mem = new Memory('cs2.exe');
   * // mem is disposed asynchronously at the end of the block
   * ```
   */
  public [Symbol.asyncDispose](): Promise<void> {
    this.close();

    return Promise.resolve();
  }

  /**
   * Allocates memory in the remote process.
   * @param length Bytes to allocate.
   * @param protect Page protection (defaults to PAGE_READWRITE).
   * @returns Base address of the allocation.
   * @example
   * ```ts
   * const ptr = cs2.alloc(0x100);
   * ```
   */
  public alloc(length: number, protect: number = 0x04): bigint {
    const { hProcess } = this;

    if (length <= 0) {
      throw new RangeError('length must be greater than 0.');
    }

    const dwSize = BigInt(length);
    const flAllocationType = 0x3000; /* MEM_COMMIT | MEM_RESERVE */
    const flProtect = protect;
    const lpAddress = 0n;

    const lpBaseAddress = VirtualAllocEx(hProcess, lpAddress, dwSize, flAllocationType, flProtect);

    if (lpBaseAddress === 0n) {
      throw new Win32Error('VirtualAllocEx', GetLastError());
    }

    return lpBaseAddress;
  }

  /**
   * Closes the process handle.
   * @example
   * ```ts
   * const cs2 = new Memory('cs2.exe');
   * cs2.close();
   * ```
   */
  public close(): void {
    CloseHandle(this.hProcess);

    return;
  }

  /**
   * Frees memory allocated in the remote process.
   * @param address Allocation base address.
   * @example
   * ```ts
   * const ptr = cs2.alloc(0x100);
   * cs2.free(ptr);
   * ```
   */
  public free(address: bigint): void {
    const { hProcess } = this;

    const dwFreeType = 0x8000; /* MEM_RELEASE */
    const dwSize = 0x00n;
    const lpAddress = address;

    const bVirtualFreeEx = !!VirtualFreeEx(hProcess, lpAddress, dwSize, dwFreeType);

    if (!bVirtualFreeEx) {
      throw new Win32Error('VirtualFreeEx', GetLastError());
    }

    return;
  }

  /**
   * Changes the page protection of a region.
   * @param address Base address to protect.
   * @param length Bytes to protect.
   * @param protect New protection flags.
   * @returns Previous protection flags.
   * @example
   * ```ts
   * const cs2 = new Memory('cs2.exe');
   * const previous = cs2.protection(0x12345678n, 0x1000, 0x40);
   * ```
   */
  public protection(address: bigint, length: number, protect: number): number {
    const { Scratch4Uint32Array, hProcess } = this;

    if (length <= 0) {
      throw new RangeError('length must be greater than 0.');
    }

    const dwSize = BigInt(length);
    const flNewProtect = protect;
    const lpAddress = address;
    const lpflOldProtect = Scratch4Uint32Array.ptr;

    const bVirtualProtectEx = VirtualProtectEx(hProcess, lpAddress, dwSize, flNewProtect, lpflOldProtect);

    if (!bVirtualProtectEx) {
      throw new Win32Error('VirtualProtectEx', GetLastError());
    }

    return Scratch4Uint32Array[0x00]!;
  }

  /**
   * Reads memory into a buffer.
   * @param address Address to read from.
   * @param scratch Buffer to fill.
   * @returns The filled buffer.
   * @todo Consider inlining the call in the if to cut a binding… I hate the idea… 🫠…
   * @example
   * ```ts
   * const cs2 = new Memory('cs2.exe');
   * const myBuffer = cs2.read(0x12345678n, new Uint8Array(4));
   * ```
   */
  public read<T extends Scratch>(address: bigint, scratch: T): T {
    const { hProcess } = this;

    const lpBaseAddress = address;
    const lpBuffer = ptr(scratch);
    const nSize = BigInt(scratch.byteLength);
    const numberOfBytesRead = 0x00n;

    const bReadProcessMemory = ReadProcessMemory(hProcess, lpBaseAddress, lpBuffer, nSize, numberOfBytesRead);

    if (!bReadProcessMemory) {
      throw new Win32Error('ReadProcessMemory', GetLastError());
    }

    return scratch;
  }

  /**
   * Asynchronously reads memory into a buffer.
   * For large reads (>= 64KB), yields to the event loop between chunks to prevent blocking.
   * @param address Address to read from.
   * @param scratch Buffer to fill.
   * @returns Promise resolving to the filled buffer.
   * @example
   * ```ts
   * const cs2 = new Memory('cs2.exe');
   * const myBuffer = await cs2.readAsync(0x12345678n, new Uint8Array(0x100000));
   * ```
   */
  public async readAsync<T extends Scratch>(address: bigint, scratch: T): Promise<T> {
    const { hProcess } = this;

    const byteLength = scratch.byteLength;

    // For small reads, just do it directly
    if (byteLength < 0x10000) {
      const lpBuffer = ptr(scratch);
      const nSize = BigInt(byteLength);

      const bReadProcessMemory = !!ReadProcessMemory(hProcess, address, lpBuffer, nSize, 0x00n);

      if (!bReadProcessMemory) {
        throw new Win32Error('ReadProcessMemory', GetLastError());
      }

      return scratch;
    }

    // For large reads, chunk and yield to allow event loop processing
    const chunkSize = 0x10000; // 64KB chunks
    const scratchU8 = new Uint8Array(scratch.buffer, scratch.byteOffset, byteLength);

    let offset = 0;

    while (offset < byteLength) {
      const remaining = byteLength - offset;
      const size = remaining < chunkSize ? remaining : chunkSize;
      const chunk = scratchU8.subarray(offset, offset + size);

      const bReadProcessMemory = !!ReadProcessMemory(hProcess, address + BigInt(offset), chunk.ptr, BigInt(size), 0x00n);

      if (!bReadProcessMemory) {
        throw new Win32Error('ReadProcessMemory', GetLastError());
      }

      offset += size;

      // Yield to event loop between chunks
      if (offset < byteLength) {
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
    }

    return scratch;
  }

  /**
   * Refreshes the module list for the process.
   * @example
   * ```ts
   * const cs2 = new Memory('cs2.exe');
   * cs2.refresh();
   * ```
   */
  public refresh(): void {
    const { Patterns: { ReplaceTrailingNull } } = Memory; // prettier-ignore
    const { th32ProcessID } = this;

    const dwFlags = 0x00000018; /* TH32CS_SNAPMODULE | TH32CS_SNAPMODULE32 */

    const hSnapshot = CreateToolhelp32Snapshot(dwFlags, th32ProcessID)!;

    if (hSnapshot === INVALID_HANDLE_VALUE) {
      throw new Win32Error('CreateToolhelp32Snapshot', GetLastError());
    }

    const { Scratch1080: lpme } = this;
    /* */ lpme.writeUInt32LE(0x438 /* sizeof(MODULEENTRY32W) */);

    const bModule32FirstW = Module32FirstW(hSnapshot, ptr(lpme));

    if (!bModule32FirstW) {
      CloseHandle(hSnapshot);

      throw new Win32Error('Module32FirstW', GetLastError());
    }

    const modules: Record<string, Module> = {};

    do {
      const modBaseAddr = lpme.readBigUInt64LE(0x18);
      const modBaseSize = lpme.readUInt32LE(0x20);
      const szModule = lpme.toString('utf16le', 0x30, 0x230).replace(ReplaceTrailingNull, '');

      modules[szModule] = { base: modBaseAddr, name: szModule, size: modBaseSize };
    } while (Module32NextW(hSnapshot, ptr(lpme)));

    CloseHandle(hSnapshot);

    this.__modules = modules;

    return;
  }

  /**
   * Writes a buffer to memory.
   * @param address Address to write to.
   * @param scratch Buffer to write.
   * @param force When writing, if true temporarily changes page protection to allow the write.
   * @returns This instance.
   * @example
   * ```ts
   * const cs2 = new Memory('cs2.exe');
   * cs2.write(0x12345678n, new Uint8Array([1,2,3,4]));
   * // Force a write by temporarily changing memory protection
   * cs2.write(0x12345678n, new Uint8Array([1,2,3,4]), true);
   * ```
   */
  public write(address: bigint, scratch: Scratch, force: boolean = false): this {
    const { hProcess } = this;

    const lpBaseAddress = address;
    const lpBuffer = scratch.ptr;
    const nSize = BigInt(scratch.byteLength);
    const numberOfBytesWritten = 0x00n;

    if (!force) {
      const bWriteProcessMemory = WriteProcessMemory(hProcess, lpBaseAddress, lpBuffer, nSize, numberOfBytesWritten);

      if (!bWriteProcessMemory) {
        throw new Win32Error('WriteProcessMemory', GetLastError());
      }

      return this;
    }

    const dwSize = nSize;
    const flNewProtect = 0x40; /* PAGE_EXECUTE_READWRITE */
    const lpflOldProtect = Buffer.allocUnsafe(0x04);

    const bVirtualProtectEx = VirtualProtectEx(hProcess, lpBaseAddress, dwSize, flNewProtect, lpflOldProtect.ptr);

    if (!bVirtualProtectEx) {
      throw new Win32Error('VirtualProtectEx', GetLastError());
    }

    try {
      const bWriteProcessMemory = WriteProcessMemory(hProcess, lpBaseAddress, lpBuffer, nSize, numberOfBytesWritten);

      if (!bWriteProcessMemory) {
        throw new Win32Error('WriteProcessMemory', GetLastError());
      }
    } finally {
      const flNewProtect2 = lpflOldProtect.readUInt32LE(0x00);
      const lpflOldProtect2 = Buffer.allocUnsafe(0x04);

      const bVirtualProtectEx2 = VirtualProtectEx(hProcess, lpBaseAddress, dwSize, flNewProtect2, lpflOldProtect2.ptr);

      if (!bVirtualProtectEx2) {
        throw new Win32Error('VirtualProtectEx', GetLastError());
      }
    }

    return this;
  }

  /**
   * Reads or writes a boolean value.
   * @param address Address to access.
   * @param value Optional value to write.
   * @param force When writing, if true temporarily changes page protection to allow the write.
   * @returns The boolean at address, or this instance if writing.
   * @example
   * ```ts
   * const cs2 = new Memory('cs2.exe');
   * const myBool = cs2.bool(0x12345678n);
   * cs2.bool(0x12345678n, true);
   * ```
   */
  public bool(address: bigint): boolean;
  public bool(address: bigint, value: boolean, force?: boolean): this;
  public bool(address: bigint, value?: boolean, force?: boolean): boolean | this {
    const { hProcess, Scratch1, Scratch1Ptr } = this;

    if (value === undefined) {
      const bReadProcessMemory = !!ReadProcessMemory(hProcess, address, Scratch1Ptr, 0x01n, 0x00n);

      if (!bReadProcessMemory) {
        throw new Win32Error('ReadProcessMemory', GetLastError());
      }

      return Scratch1[0x00]! !== 0;
    }

    Scratch1[0x00] = value ? 0x01 : 0x00;

    this.write(address, Scratch1, force);

    return this;
  }

  /**
   * Reads specific bits from a 32-bit value.
   * @param address Address to read from.
   * @param startBit Starting bit position (0-31).
   * @param bitCount Number of bits to read (1-32).
   * @returns The extracted bits as a number.
   * @example
   * ```ts
   * const cs2 = new Memory('cs2.exe');
   * const flags = cs2.bits(0x12345678n, 4, 8); // Read 8 bits starting at bit 4
   * ```
   */
  public bits(address: bigint, startBit: number, bitCount: number): number {
    const { hProcess, Scratch4Ptr, Scratch4Uint32Array } = this;

    const bReadProcessMemory = !!ReadProcessMemory(hProcess, address, Scratch4Ptr, 0x04n, 0x00n);

    if (!bReadProcessMemory) {
      throw new Win32Error('ReadProcessMemory', GetLastError());
    }

    const mask  = (1 << bitCount) - 1,
          value = Scratch4Uint32Array[0x00]!; // prettier-ignore

    return (value >> startBit) & mask;
  }

  /**
   * Reads or writes a Buffer.
   * @param address Address to access.
   * @param lengthOrValue Length to read or Buffer to write.
   * @param force When writing, if true temporarily changes page protection to allow the write.
   * @returns Buffer read or this instance if writing.
   * @example
   * ```ts
   * const cs2 = new Memory('cs2.exe');
   * const myBuffer = cs2.buffer(0x12345678n, 8);
   * cs2.buffer(0x12345678n, Buffer.from([1,2,3,4]));
   * ```
   */
  public buffer(address: bigint, length: number): Buffer;
  public buffer(address: bigint, value: Buffer, force?: boolean): this;
  public buffer(address: bigint, lengthOrValue: number | Buffer, force?: boolean): Buffer | this {
    if (typeof lengthOrValue === 'number') {
      const length = lengthOrValue;
      const scratch = Buffer.allocUnsafe(length);

      return this.read(address, scratch);
    }

    const value = lengthOrValue;

    this.write(address, value, force);

    return this;
  }

  /**
   * Reads or writes a C-style string.
   * @param address Address to access.
   * @param lengthOrValue Length to read or CString to write.
   * @param force When writing, if true temporarily changes page protection to allow the write.
   * @returns CString read or this instance if writing.
   * @example
   * ```ts
   * const cs2 = new Memory('cs2.exe');
   * const myCString = cs2.cString(0x12345678n, 16);
   * cs2.cString(0x12345678n, new CString('hello'));
   * ```
   */
  public cString(address: bigint, length: number): CString;
  public cString(address: bigint, value: CString, force?: boolean): this;
  public cString(address: bigint, lengthOrValue: number | CString, force?: boolean): CString | this {
    if (typeof lengthOrValue === 'number') {
      const scratch = new Uint8Array(lengthOrValue);

      this.read(address, scratch);

      const indexOf = scratch.indexOf(0x00);

      if (indexOf === -1) {
        scratch[lengthOrValue - 1] = 0x00;
      }

      return new CString(scratch.ptr);
    }

    const scratch = Buffer.from(lengthOrValue);

    this.write(address, scratch, force);

    return this;
  }

  /**
   * Reads or writes a 32-bit float.
   * @param address Address to access.
   * @param value Optional value to write.
   * @param force When writing, if true temporarily changes page protection to allow the write.
   * @returns The float at address, or this instance if writing.
   * @example
   * ```ts
   * const cs2 = new Memory('cs2.exe');
   * const myFloat = cs2.f32(0x12345678n);
   * cs2.f32(0x12345678n, 1.23);
   * ```
   */
  public f32(address: bigint): number;
  public f32(address: bigint, value: number, force?: boolean): this;
  public f32(address: bigint, value?: number, force?: boolean): number | this {
    const { hProcess, Scratch4Float32Array, Scratch4Ptr } = this;

    if (value === undefined) {
      const bReadProcessMemory = !!ReadProcessMemory(hProcess, address, Scratch4Ptr, 0x04n, 0x00n);

      if (!bReadProcessMemory) {
        throw new Win32Error('ReadProcessMemory', GetLastError());
      }

      return Scratch4Float32Array[0x00]!;
    }

    Scratch4Float32Array[0x00] = value;

    this.write(address, Scratch4Float32Array, force);

    return this;
  }

  /**
   * Reads or writes a Float32Array.
   * @param address Address to access.
   * @param lengthOrValues Length to read or Float32Array to write.
   * @param force When writing, if true temporarily changes page protection to allow the write.
   * @returns Float32Array read or this instance if writing.
   * @example
   * ```ts
   * const cs2 = new Memory('cs2.exe');
   * const myArray = cs2.f32Array(0x12345678n, 3);
   * cs2.f32Array(0x12345678n, new Float32Array([1,2,3]));
   * ```
   */
  public f32Array(address: bigint, length: number): Float32Array;
  public f32Array(address: bigint, values: Float32Array, force?: boolean): this;
  public f32Array(address: bigint, lengthOrValues: Float32Array | number, force?: boolean): Float32Array | this {
    if (typeof lengthOrValues === 'number') {
      const length = lengthOrValues;
      const scratch = new Float32Array(length);

      this.read(address, scratch);

      return scratch;
    }

    const values = lengthOrValues;

    this.write(address, values, force);

    return this;
  }

  /**
   * Reads or writes a 64-bit float.
   * @param address Address to access.
   * @param value Optional value to write.
   * @param force When writing, if true temporarily changes page protection to allow the write.
   * @returns The float at address, or this instance if writing.
   * @example
   * ```ts
   * const cs2 = new Memory('cs2.exe');
   * const myFloat = cs2.f64(0x12345678n);
   * cs2.f64(0x12345678n, 1.23);
   * ```
   */
  public f64(address: bigint): number;
  public f64(address: bigint, value: number, force?: boolean): this;
  public f64(address: bigint, value?: number, force?: boolean): number | this {
    const { hProcess, Scratch8Float64Array, Scratch8Ptr } = this;

    if (value === undefined) {
      const bReadProcessMemory = !!ReadProcessMemory(hProcess, address, Scratch8Ptr, 0x08n, 0x00n);

      if (!bReadProcessMemory) {
        throw new Win32Error('ReadProcessMemory', GetLastError());
      }

      return Scratch8Float64Array[0x00]!;
    }

    Scratch8Float64Array[0x00] = value;

    this.write(address, Scratch8Float64Array, force);

    return this;
  }

  /**
   * Reads or writes a Float64Array.
   * @param address Address to access.
   * @param lengthOrValues Length to read or Float64Array to write.
   * @param force When writing, if true temporarily changes page protection to allow the write.
   * @returns Float64Array read or this instance if writing.
   * @example
   * ```ts
   * const cs2 = new Memory('cs2.exe');
   * const myArray = cs2.f64Array(0x12345678n, 2);
   * cs2.f64Array(0x12345678n, new Float64Array([1,2]));
   * ```
   */
  public f64Array(address: bigint, length: number): Float64Array;
  public f64Array(address: bigint, values: Float64Array, force?: boolean): this;
  public f64Array(address: bigint, lengthOrValues: Float64Array | number, force?: boolean): Float64Array | this {
    if (typeof lengthOrValues === 'number') {
      const length = lengthOrValues;
      const scratch = new Float64Array(length);

      this.read(address, scratch);

      return scratch;
    }

    const values = lengthOrValues;

    this.write(address, values, force);

    return this;
  }

  /**
   * Reads or writes a 16-bit integer.
   * @param address Address to access.
   * @param value Optional value to write.
   * @param force When writing, if true temporarily changes page protection to allow the write.
   * @returns The int at address, or this instance if writing.
   * @example
   * ```ts
   * const cs2 = new Memory('cs2.exe');
   * const myInt = cs2.i16(0x12345678n);
   * cs2.i16(0x12345678n, 42);
   * ```
   */
  public i16(address: bigint): number;
  public i16(address: bigint, value: number, force?: boolean): this;
  public i16(address: bigint, value?: number, force?: boolean): number | this {
    const { hProcess, Scratch2Int16Array, Scratch2Ptr } = this;

    if (value === undefined) {
      const bReadProcessMemory = !!ReadProcessMemory(hProcess, address, Scratch2Ptr, 0x02n, 0x00n);

      if (!bReadProcessMemory) {
        throw new Win32Error('ReadProcessMemory', GetLastError());
      }

      return Scratch2Int16Array[0x00]!;
    }

    Scratch2Int16Array[0x00] = value;

    this.write(address, Scratch2Int16Array, force);

    return this;
  }

  /**
   * Reads or writes an Int16Array.
   * @param address Address to access.
   * @param lengthOrValues Length to read or Int16Array to write.
   * @param force When writing, if true temporarily changes page protection to allow the write.
   * @returns Int16Array read or this instance if writing.
   * @example
   * ```ts
   * const cs2 = new Memory('cs2.exe');
   * const myArray = cs2.i16Array(0x12345678n, 2);
   * cs2.i16Array(0x12345678n, new Int16Array([1,2]));
   * ```
   */
  public i16Array(address: bigint, length: number): Int16Array;
  public i16Array(address: bigint, values: Int16Array, force?: boolean): this;
  public i16Array(address: bigint, lengthOrValues: Int16Array | number, force?: boolean): Int16Array | this {
    if (typeof lengthOrValues === 'number') {
      const length = lengthOrValues;
      const scratch = new Int16Array(length);

      this.read(address, scratch);

      return scratch;
    }

    const values = lengthOrValues;

    this.write(address, values, force);

    return this;
  }

  /**
   * Reads or writes a 32-bit integer.
   * @param address Address to access.
   * @param value Optional value to write.
   * @param force When writing, if true temporarily changes page protection to allow the write.
   * @returns The int at address, or this instance if writing.
   * @example
   * ```ts
   * const cs2 = new Memory('cs2.exe');
   * const myInt = cs2.i32(0x12345678n);
   * cs2.i32(0x12345678n, 42);
   * ```
   */
  public i32(address: bigint): number;
  public i32(address: bigint, value: number, force?: boolean): this;
  public i32(address: bigint, value?: number, force?: boolean): number | this {
    const { hProcess, Scratch4Int32Array, Scratch4Ptr } = this;

    if (value === undefined) {
      const bReadProcessMemory = !!ReadProcessMemory(hProcess, address, Scratch4Ptr, 0x04n, 0x00n);

      if (!bReadProcessMemory) {
        throw new Win32Error('ReadProcessMemory', GetLastError());
      }

      return Scratch4Int32Array[0x00]!;
    }

    Scratch4Int32Array[0x00] = value;

    this.write(address, Scratch4Int32Array, force);

    return this;
  }

  /**
   * Reads or writes an Int32Array.
   * @param address Address to access.
   * @param lengthOrValues Length to read or Int32Array to write.
   * @param force When writing, if true temporarily changes page protection to allow the write.
   * @returns Int32Array read or this instance if writing.
   * @example
   * ```ts
   * const cs2 = new Memory('cs2.exe');
   * const myArray = cs2.i32Array(0x12345678n, 2);
   * cs2.i32Array(0x12345678n, new Int32Array([1,2]));
   * ```
   */
  public i32Array(address: bigint, length: number): Int32Array;
  public i32Array(address: bigint, values: Int32Array, force?: boolean): this;
  public i32Array(address: bigint, lengthOrValues: Int32Array | number, force?: boolean): Int32Array | this {
    if (typeof lengthOrValues === 'number') {
      const length = lengthOrValues;
      const scratch = new Int32Array(length);

      this.read(address, scratch);

      return scratch;
    }

    const values = lengthOrValues;

    this.write(address, values, force);

    return this;
  }

  /**
   * Reads or writes a 64-bit integer.
   * @param address Address to access.
   * @param value Optional value to write.
   * @param force When writing, if true temporarily changes page protection to allow the write.
   * @returns The bigint at address, or this instance if writing.
   * @example
   * ```ts
   * const cs2 = new Memory('cs2.exe');
   * const myBigInt = cs2.i64(0x12345678n);
   * cs2.i64(0x12345678n, 123n);
   * ```
   */
  public i64(address: bigint): bigint;
  public i64(address: bigint, value: bigint, force?: boolean): this;
  public i64(address: bigint, value?: bigint, force?: boolean): bigint | this {
    const { hProcess, Scratch8BigInt64Array, Scratch8Ptr } = this;

    if (value === undefined) {
      const bReadProcessMemory = !!ReadProcessMemory(hProcess, address, Scratch8Ptr, 0x08n, 0x00n);

      if (!bReadProcessMemory) {
        throw new Win32Error('ReadProcessMemory', GetLastError());
      }

      return Scratch8BigInt64Array[0x00]!;
    }

    Scratch8BigInt64Array[0x00] = value;

    this.write(address, Scratch8BigInt64Array, force);

    return this;
  }

  /**
   * Reads or writes a BigInt64Array.
   * @param address Address to access.
   * @param lengthOrValues Length to read or BigInt64Array to write.
   * @param force When writing, if true temporarily changes page protection to allow the write.
   * @returns BigInt64Array read or this instance if writing.
   * @example
   * ```ts
   * const cs2 = new Memory('cs2.exe');
   * const myArray = cs2.i64Array(0x12345678n, 2);
   * cs2.i64Array(0x12345678n, new BigInt64Array([1n,2n]));
   * ```
   */
  public i64Array(address: bigint, length: number): BigInt64Array;
  public i64Array(address: bigint, values: BigInt64Array, force?: boolean): this;
  public i64Array(address: bigint, lengthOrValues: BigInt64Array | number, force?: boolean): BigInt64Array | this {
    if (typeof lengthOrValues === 'number') {
      const length = lengthOrValues;
      const scratch = new BigInt64Array(length);

      this.read(address, scratch);

      return scratch;
    }

    const values = lengthOrValues;

    this.write(address, values, force);

    return this;
  }

  /**
   * Reads or writes an 8-bit integer.
   * @param address Address to access.
   * @param value Optional value to write.
   * @param force When writing, if true temporarily changes page protection to allow the write.
   * @returns The int at address, or this instance if writing.
   * @example
   * ```ts
   * const cs2 = new Memory('cs2.exe');
   * const myInt = cs2.i8(0x12345678n);
   * cs2.i8(0x12345678n, 7);
   * ```
   */
  public i8(address: bigint): number;
  public i8(address: bigint, value: number, force?: boolean): this;
  public i8(address: bigint, value?: number, force?: boolean): number | this {
    const { hProcess, Scratch1Int8Array, Scratch1Ptr } = this;

    if (value === undefined) {
      const bReadProcessMemory = !!ReadProcessMemory(hProcess, address, Scratch1Ptr, 0x01n, 0x00n);

      if (!bReadProcessMemory) {
        throw new Win32Error('ReadProcessMemory', GetLastError());
      }

      return Scratch1Int8Array[0x00]!;
    }

    Scratch1Int8Array[0x00] = value;

    this.write(address, Scratch1Int8Array, force);

    return this;
  }

  /**
   * Reads or writes an Int8Array.
   * @param address Address to access.
   * @param lengthOrValues Length to read or Int8Array to write.
   * @param force When writing, if true temporarily changes page protection to allow the write.
   * @returns Int8Array read or this instance if writing.
   * @example
   * ```ts
   * const cs2 = new Memory('cs2.exe');
   * const myArray = cs2.i8Array(0x12345678n, 2);
   * cs2.i8Array(0x12345678n, new Int8Array([1,2]));
   * ```
   */
  public i8Array(address: bigint, length: number): Int8Array;
  public i8Array(address: bigint, values: Int8Array, force?: boolean): this;
  public i8Array(address: bigint, lengthOrValues: Int8Array | number, force?: boolean): Int8Array | this {
    if (typeof lengthOrValues === 'number') {
      const length = lengthOrValues;
      const scratch = new Int8Array(length);

      this.read(address, scratch);

      return scratch;
    }

    const values = lengthOrValues;

    this.write(address, values, force);

    return this;
  }

  /**
   * Reads or writes a 3x3 matrix (Float32Array of length 9).
   * @param address Address to access.
   * @param values Optional Float32Array to write.
   * @param force When writing, if true temporarily changes page protection to allow the write.
   * @returns The matrix at address, or this instance if writing.
   * @example
   * ```ts
   * const cs2 = new Memory('cs2.exe');
   * const myMatrix = cs2.matrix3x3(0x12345678n);
   * cs2.matrix3x3(0x12345678n, new Float32Array(9));
   * ```
   */
  public matrix3x3(address: bigint): Float32Array;
  public matrix3x3(address: bigint, values: Float32Array, force?: boolean): this;
  public matrix3x3(address: bigint, values?: Float32Array, force?: boolean): Float32Array | this {
    if (values === undefined) {
      const scratch = new Float32Array(0x09);

      this.read(address, scratch);

      return scratch;
    }

    if (values.length !== 0x09) {
      throw new RangeError('values.length must be 9.');
    }

    this.write(address, values, force);

    return this;
  }

  /**
   * Reads or writes a 3x4 matrix (Float32Array of length 12).
   * @param address Address to access.
   * @param values Optional Float32Array to write.
   * @param force When writing, if true temporarily changes page protection to allow the write.
   * @returns The matrix at address, or this instance if writing.
   * @example
   * ```ts
   * const cs2 = new Memory('cs2.exe');
   * const myMatrix = cs2.matrix3x4(0x12345678n);
   * cs2.matrix3x4(0x12345678n, new Float32Array(12));
   * ```
   */
  public matrix3x4(address: bigint): Float32Array;
  public matrix3x4(address: bigint, values: Float32Array, force?: boolean): this;
  public matrix3x4(address: bigint, values?: Float32Array, force?: boolean): Float32Array | this {
    if (values === undefined) {
      const scratch = new Float32Array(0x0c);

      this.read(address, scratch);

      return scratch;
    }

    if (values.length !== 0x0c) {
      throw new RangeError('values.length must be 12.');
    }

    this.write(address, values, force);

    return this;
  }

  /**
   * Reads or writes a 4x4 matrix (Float32Array of length 16).
   * @param address Address to access.
   * @param values Optional Float32Array to write.
   * @param force When writing, if true temporarily changes page protection to allow the write.
   * @returns The matrix at address, or this instance if writing.
   * @example
   * ```ts
   * const cs2 = new Memory('cs2.exe');
   * const myMatrix = cs2.matrix4x4(0x12345678n);
   * cs2.matrix4x4(0x12345678n, new Float32Array(16));
   * ```
   */
  public matrix4x4(address: bigint): Float32Array;
  public matrix4x4(address: bigint, values: Float32Array, force?: boolean): this;
  public matrix4x4(address: bigint, values?: Float32Array, force?: boolean): Float32Array | this {
    if (values === undefined) {
      const scratch = new Float32Array(0x10);

      this.read(address, scratch);

      return scratch;
    }

    if (values.length !== 0x10) {
      throw new RangeError('values.length must be 16.');
    }

    this.write(address, values, force);

    return this;
  }

  /**
   * Reads or writes a Point (object with x, y).
   * @param address Address to access.
   * @param value Optional Point to write.
   * @param force When writing, if true temporarily changes page protection to allow the write.
   * @returns The point at address, or this instance if writing.
   * @example
   * ```ts
   * const cs2 = new Memory('cs2.exe');
   * const myPoint = cs2.point(0x12345678n);
   * cs2.point(0x12345678n, { x: 1, y: 2 });
   * ```
   */
  public point(address: bigint): Point;
  public point(address: bigint, value: Point, force?: boolean): this;
  public point(address: bigint, value?: Point, force?: boolean): Point | this {
    const { hProcess, Scratch8Ptr, Scratch8Float32Array } = this;

    if (value === undefined) {
      const bReadProcessMemory = !!ReadProcessMemory(hProcess, address, Scratch8Ptr, 0x08n, 0x00n);

      if (!bReadProcessMemory) {
        throw new Win32Error('ReadProcessMemory', GetLastError());
      }

      const x = Scratch8Float32Array[0x00]!,
            y = Scratch8Float32Array[0x01]!; // prettier-ignore

      return { x, y };
    }

    Scratch8Float32Array[0x00] = value.x;
    Scratch8Float32Array[0x01] = value.y;

    this.write(address, Scratch8Float32Array, force);

    return this;
  }

  /**
   * Reads or writes an array of Points.
   * @param address Address to access.
   * @param lengthOrValues Length to read or array to write.
   * @param force When writing, if true temporarily changes page protection to allow the write.
   * @returns Array of points read or this instance if writing.
   * @example
   * ```ts
   * const cs2 = new Memory('cs2.exe');
   * const myPoints = cs2.pointArray(0x12345678n, 2);
   * cs2.pointArray(0x12345678n, [{ x: 1, y: 2 }, { x: 3, y: 4 }]);
   * ```
   */
  public pointArray(address: bigint, length: number): Point[];
  public pointArray(address: bigint, value: Point[], force?: boolean): this;
  public pointArray(address: bigint, lengthOrValues: number | Point[], force?: boolean): Point[] | this {
    if (typeof lengthOrValues === 'number') {
      const length = lengthOrValues;
      const scratch = new Float32Array(length * 2);

      this.read(address, scratch);

      const result = new Array<Vector2>(length);

      for (let i = 0, j = 0; i < length; i++, j += 0x02) {
        const x = scratch[j]!,
              y = scratch[j + 0x01]!; // prettier-ignore

        result[i] = { x, y };
      }

      return result;
    }

    const values = lengthOrValues;
    const scratch = new Float32Array(values.length * 0x02);

    for (let i = 0, j = 0; i < values.length; i++, j += 0x02) {
      const vector2 = values[i]!;

      scratch[j] = vector2.x;
      scratch[j + 0x01] = vector2.y;
    }

    this.write(address, scratch, force);

    return this;
  }

  /**
   * Reads or writes a raw Point (two Float32 values) as a Float32Array.
   * @param address Address to access.
   * @param values Optional Float32Array of length 2 to write.
   * @param force When writing, if true temporarily changes page protection to allow the write.
   * @returns Float32Array read or this instance if writing.
   * @example
   * ```ts
   * const cs2 = new Memory('cs2.exe');
   * const myPoint = cs2.pointRaw(0x12345678n);
   * cs2.pointRaw(0x12345678n, new Float32Array([1, 2]));
   * ```
   */
  public pointRaw(address: bigint): Float32Array;
  public pointRaw(address: bigint, values: Float32Array, force?: boolean): this;
  public pointRaw(address: bigint, values?: Float32Array, force?: boolean): Float32Array | this {
    if (values === undefined) {
      return this.f32Array(address, 0x02);
    }

    if (values.length !== 0x02) {
      throw new RangeError('values.length must be 2.');
    }

    this.write(address, values, force);

    return this;
  }

  /**
   * Reads or writes a QAngle (object with pitch, yaw, roll).
   * @param address Address to access.
   * @param value Optional QAngle to write.
   * @returns The QAngle at address, or this instance if writing.
   * @example
   * ```ts
   * const cs2 = new Memory('cs2.exe');
   * const myQAngle = cs2.qAngle(0x12345678n);
   * cs2.qAngle(0x12345678n, { pitch: 1, yaw: 2, roll: 3 });
   * ```
   */
  public qAngle(address: bigint): QAngle;
  public qAngle(address: bigint, value: QAngle, force?: boolean): this;
  public qAngle(address: bigint, value?: QAngle, force?: boolean): QAngle | this {
    const { Scratch12Float32Array } = this;

    if (value === undefined) {
      this.read(address, Scratch12Float32Array);

      const pitch = Scratch12Float32Array[0x00]!,
            roll  = Scratch12Float32Array[0x02]!,
            yaw   = Scratch12Float32Array[0x01]!; // prettier-ignore

      return { pitch, roll, yaw };
    }

    Scratch12Float32Array[0x00] = value.pitch;
    Scratch12Float32Array[0x02] = value.roll;
    Scratch12Float32Array[0x01] = value.yaw;

    this.write(address, Scratch12Float32Array, force);

    return this;
  }

  /**
   * Reads or writes an array of QAngles.
   * @param address Address to access.
   * @param lengthOrValues Length to read or array to write.
   * @returns Array of QAngles read or this instance if writing.
   * @example
   * ```ts
   * const cs2 = new Memory('cs2.exe');
   * const myQAngles = cs2.qAngleArray(0x12345678n, 2);
   * cs2.qAngleArray(0x12345678n, [{ pitch: 1, yaw: 2, roll: 3 }]);
   * ```
   */
  public qAngleArray(address: bigint, length: number): QAngle[];
  public qAngleArray(address: bigint, values: QAngle[], force?: boolean): this;
  public qAngleArray(address: bigint, lengthOrValues: QAngle[] | number, force?: boolean): QAngle[] | this {
    if (typeof lengthOrValues === 'number') {
      const length = lengthOrValues;
      const scratch = new Float32Array(length * 0x03);

      this.read(address, scratch);

      const result = new Array<QAngle>(length);

      for (let i = 0, j = 0; i < length; i++, j += 0x03) {
        const pitch = scratch[j]!,
              yaw   = scratch[j + 0x01]!,
              roll  = scratch[j + 0x02]!; // prettier-ignore

        result[i] = { pitch, yaw, roll };
      }

      return result;
    }

    const values = lengthOrValues;
    const scratch = new Float32Array(values.length * 0x03);

    for (let i = 0, j = 0; i < values.length; i++, j += 0x03) {
      const qAngle = values[i]!;

      scratch[j] = qAngle.pitch;
      scratch[j + 0x02] = qAngle.roll;
      scratch[j + 0x01] = qAngle.yaw;
    }

    this.write(address, scratch, force);

    return this;
  }

  /**
   * Reads or writes a raw QAngle as a Float32Array.
   * @param address Address to access.
   * @param values Optional Float32Array to write.
   * @param force When writing, if true temporarily changes page protection to allow the write.
   * @returns Float32Array read or this instance if writing.
   * @example
   * ```ts
   * const cs2 = new Memory('cs2.exe');
   * const raw = cs2.qAngleRaw(0x12345678n);
   * cs2.qAngleRaw(0x12345678n, new Float32Array([1,2,3]));
   * ```
   */
  public qAngleRaw(address: bigint): Float32Array;
  public qAngleRaw(address: bigint, values: Float32Array, force?: boolean): this;
  public qAngleRaw(address: bigint, values?: Float32Array, force?: boolean): Float32Array | this {
    if (values === undefined) {
      return this.f32Array(address, 0x03);
    }

    if (values.length !== 0x03) {
      throw new RangeError('values.length must be 3.');
    }

    this.write(address, values, force);

    return this;
  }

  /**
   * Reads or writes a Quaternion (object with w, x, y, z).
   * @param address Address to access.
   * @param value Optional Quaternion to write.
   * @param force When writing, if true temporarily changes page protection to allow the write.
   * @returns The Quaternion at address, or this instance if writing.
   * @example
   * ```ts
   * const cs2 = new Memory('cs2.exe');
   * const myQuaternion = cs2.quaternion(0x12345678n);
   * cs2.quaternion(0x12345678n, { w: 1, x: 0, y: 0, z: 0 });
   * ```
   */
  public quaternion(address: bigint): Quaternion;
  public quaternion(address: bigint, value: Quaternion, force?: boolean): this;
  public quaternion(address: bigint, value?: Quaternion, force?: boolean): Quaternion | this {
    const { hProcess, Scratch16Ptr, Scratch16Float32Array } = this;

    if (value === undefined) {
      const bReadProcessMemory = !!ReadProcessMemory(hProcess, address, Scratch16Ptr, 0x10n, 0x00n);

      if (!bReadProcessMemory) {
        throw new Win32Error('ReadProcessMemory', GetLastError());
      }

      const w = Scratch16Float32Array[0x03]!,
            x = Scratch16Float32Array[0x00]!,
            y = Scratch16Float32Array[0x01]!,
            z = Scratch16Float32Array[0x02]!; // prettier-ignore

      return { w, x, y, z };
    }

    Scratch16Float32Array[0x03] = value.w;
    Scratch16Float32Array[0x00] = value.x;
    Scratch16Float32Array[0x01] = value.y;
    Scratch16Float32Array[0x02] = value.z;

    this.write(address, Scratch16Float32Array, force);

    return this;
  }

  /**
   * Reads or writes an array of Quaternions.
   * @param address Address to access.
   * @param lengthOrValues Length to read or array to write.
   * @param force When writing, if true temporarily changes page protection to allow the write.
   * @returns Array of Quaternions read or this instance if writing.
   * @example
   * ```ts
   * const cs2 = new Memory('cs2.exe');
   * const myQuaternions = cs2.quaternionArray(0x12345678n, 2);
   * cs2.quaternionArray(0x12345678n, [{ w: 1, x: 0, y: 0, z: 0 }]);
   * ```
   */
  public quaternionArray(address: bigint, length: number): Quaternion[];
  public quaternionArray(address: bigint, values: Quaternion[], force?: boolean): this;
  public quaternionArray(address: bigint, lengthOrValues: Quaternion[] | number, force?: boolean): Quaternion[] | this {
    if (typeof lengthOrValues === 'number') {
      const length = lengthOrValues;
      const scratch = new Float32Array(length * 0x04); // 4 * f32 per Quaternion

      this.read(address, scratch);

      const result = new Array<Quaternion>(length);

      for (let i = 0, j = 0; i < length; i++, j += 0x04) {
        const w = scratch[j + 0x03]!;
        const x = scratch[j]!;
        const y = scratch[j + 0x01]!;
        const z = scratch[j + 0x02]!;

        result[i] = { w, x, y, z };
      }

      return result;
    }

    const values = lengthOrValues;
    const scratch = new Float32Array(values.length * 0x04);

    for (let i = 0, j = 0; i < values.length; i++, j += 0x04) {
      const quaternion = values[i]!;

      scratch[j + 0x03] = quaternion.w;
      scratch[j] = quaternion.x;
      scratch[j + 0x01] = quaternion.y;
      scratch[j + 0x02] = quaternion.z;
    }

    this.write(address, scratch, force);

    return this;
  }

  /**
   * Reads or writes a raw Quaternion as a Float32Array.
   * @param address Address to access.
   * @param values Optional Float32Array to write.
   * @param force When writing, if true temporarily changes page protection to allow the write.
   * @returns Float32Array read or this instance if writing.
   * @example
   * ```ts
   * const cs2 = new Memory('cs2.exe');
   * const raw = cs2.quaternionRaw(0x12345678n);
   * cs2.quaternionRaw(0x12345678n, new Float32Array([1,0,0,0]));
   * ```
   */
  public quaternionRaw(address: bigint): Float32Array;
  public quaternionRaw(address: bigint, values: Float32Array, force?: boolean): this;
  public quaternionRaw(address: bigint, values?: Float32Array, force?: boolean): Float32Array | this {
    if (values === undefined) {
      return this.f32Array(address, 0x04);
    }

    if (values.length !== 0x04) {
      throw new RangeError('values.length must be 4.');
    }

    this.write(address, values, force);

    return this;
  }

  /**
   * Reads or writes an RGB color (object with r, g, b).
   * @param address Address to access.
   * @param value Optional RGB to write.
   * @param force When writing, if true temporarily changes page protection to allow the write.
   * @returns The RGB at address, or this instance if writing.
   * @example
   * ```ts
   * const cs2 = new Memory('cs2.exe');
   * const myRGB = cs2.rgb(0x12345678n);
   * cs2.rgb(0x12345678n, { r: 255, g: 0, b: 0 });
   * ```
   */
  public rgb(address: bigint): RGB;
  public rgb(address: bigint, value: RGB, force?: boolean): this;
  public rgb(address: bigint, value?: RGB, force?: boolean): RGB | this {
    const { Scratch3 } = this;

    if (value === undefined) {
      this.read(address, Scratch3);

      const r = Scratch3[0x00]!,
            g = Scratch3[0x01]!,
            b = Scratch3[0x02]!; // prettier-ignore

      return { r, g, b };
    }

    Scratch3[0x00] = value.r;
    Scratch3[0x01] = value.g;
    Scratch3[0x02] = value.b;

    this.write(address, Scratch3, force);

    return this;
  }

  /**
   * Reads or writes a raw RGB value as a Uint8Array.
   * @param address Address to access.
   * @param values Optional buffer to write.
   * @param force When writing, if true temporarily changes page protection to allow the write.
   * @returns Uint8Array read or this instance if writing.
   * @example
   * ```ts
   * const cs2 = new Memory('cs2.exe');
   * const raw = cs2.rgbRaw(0x12345678n);
   * cs2.rgbRaw(0x12345678n, new Uint8Array([255,0,0]));
   * ```
   */
  public rgbRaw(address: bigint): Uint8Array;
  public rgbRaw(address: bigint, values: Buffer | Uint8Array | Uint8ClampedArray, force?: boolean): this;
  public rgbRaw(address: bigint, values?: Buffer | Uint8Array | Uint8ClampedArray, force?: boolean): Uint8Array | this {
    if (values === undefined) {
      return this.u8Array(address, 0x03);
    }

    if (values.length !== 0x03) {
      throw new RangeError('values.length must be 3.');
    }

    this.write(address, values, force);

    return this;
  }

  /**
   * Reads or writes an RGBA color (object with r, g, b, a).
   * @param address Address to access.
   * @param value Optional RGBA to write.
   * @param force When writing, if true temporarily changes page protection to allow the write.
   * @returns The RGBA at address, or this instance if writing.
   * @example
   * ```ts
   * const cs2 = new Memory('cs2.exe');
   * const myRGBA = cs2.rgba(0x12345678n);
   * cs2.rgba(0x12345678n, { r: 255, g: 0, b: 0, a: 255 });
   * ```
   */
  public rgba(address: bigint): RGBA;
  public rgba(address: bigint, value: RGBA, force?: boolean): this;
  public rgba(address: bigint, value?: RGBA, force?: boolean): RGBA | this {
    const { Scratch4 } = this;

    if (value === undefined) {
      this.read(address, Scratch4);

      const r = Scratch4[0x00]!,
            g = Scratch4[0x01]!,
            b = Scratch4[0x02]!,
            a = Scratch4[0x03]!; // prettier-ignore

      return { r, g, b, a };
    }

    Scratch4[0x00] = value.r;
    Scratch4[0x01] = value.g;
    Scratch4[0x02] = value.b;
    Scratch4[0x03] = value.a;

    this.write(address, Scratch4, force);

    return this;
  }

  /**
   * Reads or writes a raw RGBA value as a Uint8Array.
   * @param address Address to access.
   * @param values Optional buffer to write.
   * @param force When writing, if true temporarily changes page protection to allow the write.
   * @returns Uint8Array read or this instance if writing.
   * @example
   * ```ts
   * const cs2 = new Memory('cs2.exe');
   * const raw = cs2.rgbaRaw(0x12345678n);
   * cs2.rgbaRaw(0x12345678n, new Uint8Array([255,0,0,255]));
   * ```
   */
  public rgbaRaw(address: bigint): Uint8Array;
  public rgbaRaw(address: bigint, values: Buffer | Uint8Array | Uint8ClampedArray, force?: boolean): this;
  public rgbaRaw(address: bigint, values?: Buffer | Uint8Array | Uint8ClampedArray, force?: boolean): Uint8Array | this {
    if (values === undefined) {
      return this.u8Array(address, 0x04);
    }

    if (values.length !== 0x04) {
      throw new RangeError('values.length must be 4.');
    }

    this.write(address, values, force);

    return this;
  }

  /**
   * Reads or writes a UTF-8 string.
   * @param address Address to access.
   * @param lengthOrValue Length to read or string to write.
   * @param force When writing, if true temporarily changes page protection to allow the write.
   * @returns The string at address, or this instance if writing.
   * @notice When writing, remember to null-terminate your string (e.g., 'hello\0').
   * @todo Compare performance when using CString vs TextDecoder when reading…
   * @example
   * ```ts
   * const cs2 = new Memory('cs2.exe');
   * const myString = cs2.string(0x12345678n, 16);
   * cs2.string(0x12345678n, 'hello\0');
   * ```
   */
  public string(address: bigint, length: number): string;
  public string(address: bigint, value: string, force?: boolean): this;
  public string(address: bigint, lengthOrValue: number | string, force?: boolean): string | this {
    if (typeof lengthOrValue === 'number') {
      const scratch = new Uint8Array(lengthOrValue);

      this.read(address, scratch);

      const indexOf = scratch.indexOf(0x00);

      return Memory.TextDecoderUTF8.decode(
        scratch.subarray(0, indexOf !== -1 ? indexOf : lengthOrValue) //
      );

      // return new CString(scratch.ptr).valueOf();
    }

    const scratch = Memory.TextEncoderUTF8.encode(lengthOrValue);

    this.write(address, scratch, force);

    return this;
  }

  /**
   * Reads or writes a TArray (Data at 0x00, Count at 0x08, Max at 0x0c) as a UTF-8 string.
   * @param address Address of the TArray structure.
   * @param value Optional string to write.
   * @param force When writing, if true temporarily changes page protection to allow the write.
   * @returns The string, or this instance if writing.
   * @example
   * ```ts
   * const rl = new Memory('RocketLeague.exe');
   * const myString = rl.tArrayChar(0x12345678n);
   * rl.tArrayChar(0x12345678n, 'hello');
   * ```
   */
  public tArrayChar(address: bigint): string;
  public tArrayChar(address: bigint, value: string, force?: boolean): this;
  public tArrayChar(address: bigint, value?: string, force?: boolean): string | this {
    const dataPtr = this.u64(address);

    if (value === undefined) {
      const count = this.u32(address + 0x08n);

      if (count === 0x00) {
        return '';
      }

      const scratch = Buffer.allocUnsafe(count - 0x01);

      this.read(dataPtr, scratch);

      return scratch.toString('utf8');
    }

    const scratch = Buffer.from(value, 'utf8');

    this.u32(address + 0x08n, scratch.length + 0x01, force);

    this.write(dataPtr, scratch, force);

    return this;
  }

  /**
   * Reads or writes a TArray (Data at 0x00, Count at 0x08, Max at 0x0c) as a Float32Array.
   * @param address Address of the TArray structure.
   * @param values Optional Float32Array to write.
   * @param force When writing, if true temporarily changes page protection to allow the write.
   * @returns A Float32Array containing the elements, or this instance if writing.
   * @example
   * ```ts
   * const rl = new Memory('RocketLeague.exe');
   * const myArray = rl.tArrayF32(0x12345678n);
   * rl.tArrayF32(0x12345678n, new Float32Array([1.0, 2.0, 3.0]));
   * ```
   */
  public tArrayF32(address: bigint): Float32Array;
  public tArrayF32(address: bigint, values: Float32Array, force?: boolean): this;
  public tArrayF32(address: bigint, values?: Float32Array, force?: boolean): Float32Array | this {
    const dataPtr = this.u64(address);

    if (values === undefined) {
      const count = this.u32(address + 0x08n),
            scratch = new Float32Array(count); // prettier-ignore

      if (count === 0) {
        return scratch;
      }

      this.read(dataPtr, scratch);

      return scratch;
    }

    this.u32(address + 0x08n, values.length, force);

    this.write(dataPtr, values, force);

    return this;
  }

  /**
   * Reads or writes a TArray (Data at 0x00, Count at 0x08, Max at 0x0c) as a Float64Array.
   * @param address Address of the TArray structure.
   * @param values Optional Float64Array to write.
   * @param force When writing, if true temporarily changes page protection to allow the write.
   * @returns A Float64Array containing the elements, or this instance if writing.
   * @example
   * ```ts
   * const rl = new Memory('RocketLeague.exe');
   * const myArray = rl.tArrayF64(0x12345678n);
   * rl.tArrayF64(0x12345678n, new Float64Array([1.0, 2.0, 3.0]));
   * ```
   */
  public tArrayF64(address: bigint): Float64Array;
  public tArrayF64(address: bigint, values: Float64Array, force?: boolean): this;
  public tArrayF64(address: bigint, values?: Float64Array, force?: boolean): Float64Array | this {
    const dataPtr = this.u64(address);

    if (values === undefined) {
      const count = this.u32(address + 0x08n),
            scratch = new Float64Array(count); // prettier-ignore

      if (count === 0) {
        return scratch;
      }

      this.read(dataPtr, scratch);

      return scratch;
    }

    this.u32(address + 0x08n, values.length, force);

    this.write(dataPtr, values, force);

    return this;
  }

  /**
   * Reads or writes a TArray (Data at 0x00, Count at 0x08, Max at 0x0c) as an Int16Array.
   * @param address Address of the TArray structure.
   * @param values Optional Int16Array to write.
   * @param force When writing, if true temporarily changes page protection to allow the write.
   * @returns An Int16Array containing the elements, or this instance if writing.
   * @example
   * ```ts
   * const rl = new Memory('RocketLeague.exe');
   * const myArray = rl.tArrayI16(0x12345678n);
   * rl.tArrayI16(0x12345678n, new Int16Array([1, 2, 3]));
   * ```
   */
  public tArrayI16(address: bigint): Int16Array;
  public tArrayI16(address: bigint, values: Int16Array, force?: boolean): this;
  public tArrayI16(address: bigint, values?: Int16Array, force?: boolean): Int16Array | this {
    const dataPtr = this.u64(address);

    if (values === undefined) {
      const count = this.u32(address + 0x08n),
            scratch = new Int16Array(count); // prettier-ignore

      if (count === 0) {
        return scratch;
      }

      this.read(dataPtr, scratch);

      return scratch;
    }

    this.u32(address + 0x08n, values.length, force);

    this.write(dataPtr, values, force);

    return this;
  }

  /**
   * Reads or writes a TArray (Data at 0x00, Count at 0x08, Max at 0x0c) as an Int32Array.
   * @param address Address of the TArray structure.
   * @param values Optional Int32Array to write.
   * @param force When writing, if true temporarily changes page protection to allow the write.
   * @returns An Int32Array containing the elements, or this instance if writing.
   * @example
   * ```ts
   * const rl = new Memory('RocketLeague.exe');
   * const myArray = rl.tArrayI32(0x12345678n);
   * rl.tArrayI32(0x12345678n, new Int32Array([1, 2, 3]));
   * ```
   */
  public tArrayI32(address: bigint): Int32Array;
  public tArrayI32(address: bigint, values: Int32Array, force?: boolean): this;
  public tArrayI32(address: bigint, values?: Int32Array, force?: boolean): Int32Array | this {
    const dataPtr = this.u64(address);

    if (values === undefined) {
      const count = this.u32(address + 0x08n),
            scratch = new Int32Array(count); // prettier-ignore

      if (count === 0) {
        return scratch;
      }

      this.read(dataPtr, scratch);

      return scratch;
    }

    this.u32(address + 0x08n, values.length, force);

    this.write(dataPtr, values, force);

    return this;
  }

  /**
   * Reads or writes a TArray (Data at 0x00, Count at 0x08, Max at 0x0c) as a BigInt64Array.
   * @param address Address of the TArray structure.
   * @param values Optional BigInt64Array to write.
   * @param force When writing, if true temporarily changes page protection to allow the write.
   * @returns A BigInt64Array containing the elements, or this instance if writing.
   * @example
   * ```ts
   * const rl = new Memory('RocketLeague.exe');
   * const myArray = rl.tArrayI64(0x12345678n);
   * rl.tArrayI64(0x12345678n, new BigInt64Array([1n, 2n, 3n]));
   * ```
   */
  public tArrayI64(address: bigint): BigInt64Array;
  public tArrayI64(address: bigint, values: BigInt64Array, force?: boolean): this;
  public tArrayI64(address: bigint, values?: BigInt64Array, force?: boolean): BigInt64Array | this {
    const dataPtr = this.u64(address);

    if (values === undefined) {
      const count = this.u32(address + 0x08n),
            scratch = new BigInt64Array(count); // prettier-ignore

      if (count === 0) {
        return scratch;
      }

      this.read(dataPtr, scratch);

      return scratch;
    }

    this.u32(address + 0x08n, values.length, force);

    this.write(dataPtr, values, force);

    return this;
  }

  /**
   * Reads or writes a TArray (Data at 0x00, Count at 0x08, Max at 0x0c) as an Int8Array.
   * @param address Address of the TArray structure.
   * @param values Optional Int8Array to write.
   * @param force When writing, if true temporarily changes page protection to allow the write.
   * @returns An Int8Array containing the elements, or this instance if writing.
   * @example
   * ```ts
   * const rl = new Memory('RocketLeague.exe');
   * const myArray = rl.tArrayI8(0x12345678n);
   * rl.tArrayI8(0x12345678n, new Int8Array([1, 2, 3]));
   * ```
   */
  public tArrayI8(address: bigint): Int8Array;
  public tArrayI8(address: bigint, values: Int8Array, force?: boolean): this;
  public tArrayI8(address: bigint, values?: Int8Array, force?: boolean): Int8Array | this {
    const dataPtr = this.u64(address);

    if (values === undefined) {
      const count = this.u32(address + 0x08n),
            scratch = new Int8Array(count); // prettier-ignore

      if (count === 0) {
        return scratch;
      }

      this.read(dataPtr, scratch);

      return scratch;
    }

    this.u32(address + 0x08n, values.length, force);

    this.write(dataPtr, values, force);

    return this;
  }

  /**
   * Reads or writes a TArray (Data at 0x00, Count at 0x08, Max at 0x0c) as an array of raw buffers.
   * Useful for reading/writing arrays of structs or custom-sized elements.
   * @param address Address of the TArray structure.
   * @param dataSize Size in bytes of each element.
   * @param values Optional array of Buffers to write.
   * @param force When writing, if true temporarily changes page protection to allow the write.
   * @returns An array of Buffers, one per element, or this instance if writing.
   * @example
   * ```ts
   * const rl = new Memory('RocketLeague.exe');
   * const structs = rl.tArrayRaw(0x12345678n, 0x18); // Array of 0x18-byte buffers
   * rl.tArrayRaw(0x12345678n, [buffer1, buffer2]);
   * ```
   */
  public tArrayRaw(address: bigint, dataSize: number): Buffer[];
  public tArrayRaw(address: bigint, values: Buffer[], force?: boolean): this;
  public tArrayRaw(address: bigint, dataSizeOrValues: number | Buffer[], force?: boolean): Buffer[] | this {
    const dataPtr = this.u64(address);

    if (typeof dataSizeOrValues === 'number') {
      const count = this.u32(address + 0x08n),
            dataSize = dataSizeOrValues; // prettier-ignore

      if (count === 0) {
        return [];
      }

      const scratch = Buffer.allocUnsafe(count * dataSize);

      this.read(dataPtr, scratch);

      const result: Buffer[] = new Array(count);

      for (let i = 0; i < count; i++) {
        result[i] = scratch.subarray(i * dataSize, (i + 1) * dataSize);
      }

      return result;
    }

    const values = dataSizeOrValues;

    if (values.length === 0) {
      this.u32(address + 0x08n, 0, force);
      return this;
    }

    const dataSize = values[0]!.length;
    const scratch = Buffer.allocUnsafe(values.length * dataSize);

    for (let i = 0; i < values.length; i++) {
      values[i]!.copy(scratch, i * dataSize);
    }

    this.u32(address + 0x08n, values.length, force);

    this.write(dataPtr, scratch, force);

    return this;
  }

  /**
   * Reads or writes a TArray (Data at 0x00, Count at 0x08, Max at 0x0c) as a Uint16Array.
   * @param address Address of the TArray structure.
   * @param values Optional Uint16Array to write.
   * @param force When writing, if true temporarily changes page protection to allow the write.
   * @returns A Uint16Array containing the elements, or this instance if writing.
   * @example
   * ```ts
   * const rl = new Memory('RocketLeague.exe');
   * const myArray = rl.tArrayU16(0x12345678n);
   * rl.tArrayU16(0x12345678n, new Uint16Array([1, 2, 3]));
   * ```
   */
  public tArrayU16(address: bigint): Uint16Array;
  public tArrayU16(address: bigint, values: Uint16Array, force?: boolean): this;
  public tArrayU16(address: bigint, values?: Uint16Array, force?: boolean): Uint16Array | this {
    const dataPtr = this.u64(address);

    if (values === undefined) {
      const count = this.u32(address + 0x08n),
            scratch = new Uint16Array(count); // prettier-ignore

      if (count === 0) {
        return scratch;
      }

      this.read(dataPtr, scratch);

      return scratch;
    }

    this.u32(address + 0x08n, values.length, force);

    this.write(dataPtr, values, force);

    return this;
  }

  /**
   * Reads or writes a TArray (Data at 0x00, Count at 0x08, Max at 0x0c) as a Uint32Array.
   * @param address Address of the TArray structure.
   * @param values Optional Uint32Array to write.
   * @param force When writing, if true temporarily changes page protection to allow the write.
   * @returns A Uint32Array containing the elements, or this instance if writing.
   * @example
   * ```ts
   * const rl = new Memory('RocketLeague.exe');
   * const myArray = rl.tArrayU32(0x12345678n);
   * rl.tArrayU32(0x12345678n, new Uint32Array([1, 2, 3]));
   * ```
   */
  public tArrayU32(address: bigint): Uint32Array;
  public tArrayU32(address: bigint, values: Uint32Array, force?: boolean): this;
  public tArrayU32(address: bigint, values?: Uint32Array, force?: boolean): Uint32Array | this {
    const dataPtr = this.u64(address);

    if (values === undefined) {
      const count = this.u32(address + 0x08n),
            scratch = new Uint32Array(count); // prettier-ignore

      if (count === 0) {
        return scratch;
      }

      this.read(dataPtr, scratch);

      return scratch;
    }

    this.u32(address + 0x08n, values.length, force);

    this.write(dataPtr, values, force);

    return this;
  }

  /**
   * Reads or writes a TArray (Data at 0x00, Count at 0x08, Max at 0x0c) as a BigUint64Array.
   * @param address Address of the TArray structure.
   * @param values Optional BigUint64Array to write.
   * @param force When writing, if true temporarily changes page protection to allow the write.
   * @returns A BigUint64Array containing the elements, or this instance if writing.
   * @example
   * ```ts
   * const rl = new Memory('RocketLeague.exe');
   * const myArray = rl.tArrayU64(0x12345678n);
   * rl.tArrayU64(0x12345678n, new BigUint64Array([1n, 2n, 3n]));
   * ```
   */
  public tArrayU64(address: bigint): BigUint64Array;
  public tArrayU64(address: bigint, values: BigUint64Array, force?: boolean): this;
  public tArrayU64(address: bigint, values?: BigUint64Array, force?: boolean): BigUint64Array | this {
    const dataPtr = this.u64(address);

    if (values === undefined) {
      const count = this.u32(address + 0x08n),
            scratch = new BigUint64Array(count); // prettier-ignore

      if (count === 0) {
        return scratch;
      }

      this.read(dataPtr, scratch);

      return scratch;
    }

    this.u32(address + 0x08n, values.length, force);

    this.write(dataPtr, values, force);

    return this;
  }

  /**
   * Reads or writes a TArray (Data at 0x00, Count at 0x08, Max at 0x0c) as a Uint8Array.
   * @param address Address of the TArray structure.
   * @param values Optional Uint8Array to write.
   * @param force When writing, if true temporarily changes page protection to allow the write.
   * @returns A Uint8Array containing the elements, or this instance if writing.
   * @example
   * ```ts
   * const rl = new Memory('RocketLeague.exe');
   * const myArray = rl.tArrayU8(0x12345678n);
   * rl.tArrayU8(0x12345678n, new Uint8Array([1, 2, 3]));
   * ```
   */
  public tArrayU8(address: bigint): Uint8Array;
  public tArrayU8(address: bigint, values: Uint8Array, force?: boolean): this;
  public tArrayU8(address: bigint, values?: Uint8Array, force?: boolean): Uint8Array | this {
    const dataPtr = this.u64(address);

    if (values === undefined) {
      const count = this.u32(address + 0x08n),
            scratch = new Uint8Array(count); // prettier-ignore

      if (count === 0) {
        return scratch;
      }

      this.read(dataPtr, scratch);

      return scratch;
    }

    this.u32(address + 0x08n, values.length, force);

    this.write(dataPtr, values, force);

    return this;
  }

  /**
   * Reads or writes a TArray (Data at 0x00, Count at 0x08, Max at 0x0c) as a BigUint64Array.
   * @param address Address of the TArray structure.
   * @param values Optional BigUint64Array to write.
   * @param force When writing, if true temporarily changes page protection to allow the write.
   * @returns A BigUint64Array containing the elements, or this instance if writing.
   * @example
   * ```ts
   * const rl = new Memory('RocketLeague.exe');
   * const myArray = rl.tArrayUPtr(0x12345678n);
   * rl.tArrayUPtr(0x12345678n, new BigUint64Array([1n, 2n, 3n]));
   * ```
   */
  public tArrayUPtr(address: bigint): BigUint64Array;
  public tArrayUPtr(address: bigint, values: BigUint64Array, force?: boolean): this;
  public tArrayUPtr(address: bigint, values?: BigUint64Array, force?: boolean): BigUint64Array | this {
    // TypeScript is funny sometimes, isn't it?… 🫠…
    if (values === undefined) {
      return this.tArrayU64(address);
    }

    return this.tArrayU64(address, values, force);
  }

  /**
   * Reads or writes a TArray (Data at 0x00, Count at 0x08, Max at 0x0c) as a UTF-16LE string.
   * This is the format used by FName/FString in Unreal Engine.
   * @param address Address of the TArray structure.
   * @param value Optional string to write.
   * @param force When writing, if true temporarily changes page protection to allow the write.
   * @returns The string, or this instance if writing.
   * @example
   * ```ts
   * const rl = new Memory('RocketLeague.exe');
   * const myString = rl.tArrayWChar(0x12345678n);
   * rl.tArrayWChar(0x12345678n, 'hello');
   * ```
   */
  public tArrayWChar(address: bigint): string;
  public tArrayWChar(address: bigint, value: string, force?: boolean): this;
  public tArrayWChar(address: bigint, value?: string, force?: boolean): string | this {
    const dataPtr = this.u64(address);

    if (value === undefined) {
      const count = this.u32(address + 0x08n);

      if (count === 0) {
        return '';
      }

      const scratch = Buffer.allocUnsafe((count - 0x01) * 0x02);

      this.read(dataPtr, scratch);

      return scratch.toString('utf16le');
    }

    const scratch = Buffer.allocUnsafe(value.length * 0x02);

    scratch.write(value, 0, 'utf16le');

    this.u32(address + 0x08n, value.length + 0x01, force);

    this.write(dataPtr, scratch, force);

    return this;
  }

  /**
   * Reads or writes a 16-bit unsigned integer.
   * @param address Address to access.
   * @param value Optional value to write.
   * @param force When writing, if true temporarily changes page protection to allow the write.
   * @returns The value at address, or this instance if writing.
   * @example
   * ```ts
   * const cs2 = new Memory('cs2.exe');
   * const myInt = cs2.u16(0x12345678n);
   * cs2.u16(0x12345678n, 42);
   * ```
   */
  public u16(address: bigint): number;
  public u16(address: bigint, value: number, force?: boolean): this;
  public u16(address: bigint, value?: number, force?: boolean): number | this {
    const { hProcess, Scratch2Uint16Array, Scratch2Ptr } = this;

    if (value === undefined) {
      const bReadProcessMemory = !!ReadProcessMemory(hProcess, address, Scratch2Ptr, 0x02n, 0x00n);

      if (!bReadProcessMemory) {
        throw new Win32Error('ReadProcessMemory', GetLastError());
      }

      return Scratch2Uint16Array[0x00]!;
    }

    Scratch2Uint16Array[0x00] = value;

    this.write(address, Scratch2Uint16Array, force);

    return this;
  }

  /**
   * Reads or writes a Uint16Array.
   * @param address Address to access.
   * @param lengthOrValues Length to read or Uint16Array to write.
   * @param force When writing, if true temporarily changes page protection to allow the write.
   * @returns Uint16Array read or this instance if writing.
   * @example
   * ```ts
   * const cs2 = new Memory('cs2.exe');
   * const myArray = cs2.u16Array(0x12345678n, 2);
   * cs2.u16Array(0x12345678n, new Uint16Array([1,2]));
   * ```
   */
  public u16Array(address: bigint, length: number): Uint16Array;
  public u16Array(address: bigint, values: Uint16Array, force?: boolean): this;
  public u16Array(address: bigint, lengthOrValues: Uint16Array | number, force?: boolean): Uint16Array | this {
    if (typeof lengthOrValues === 'number') {
      const length = lengthOrValues;
      const scratch = new Uint16Array(length);

      this.read(address, scratch);

      return scratch;
    }

    const values = lengthOrValues;

    this.write(address, values, force);

    return this;
  }

  /**
   * Reads or writes a 32-bit unsigned integer.
   * @param address Address to access.
   * @param value Optional value to write.
   * @param force When writing, if true temporarily changes page protection to allow the write.
   * @returns The value at address, or this instance if writing.
   * @example
   * ```ts
   * const cs2 = new Memory('cs2.exe');
   * const myInt = cs2.u32(0x12345678n);
   * cs2.u32(0x12345678n, 42);
   * ```
   */
  public u32(address: bigint): number;
  public u32(address: bigint, value: number, force?: boolean): this;
  public u32(address: bigint, value?: number, force?: boolean): number | this {
    const { hProcess, Scratch4Uint32Array, Scratch4Ptr } = this;

    if (value === undefined) {
      const bReadProcessMemory = !!ReadProcessMemory(hProcess, address, Scratch4Ptr, 0x04n, 0x00n);

      if (!bReadProcessMemory) {
        throw new Win32Error('ReadProcessMemory', GetLastError());
      }

      return Scratch4Uint32Array[0x00]!;
    }

    Scratch4Uint32Array[0x00] = value;

    this.write(address, Scratch4Uint32Array, force);

    return this;
  }

  /**
   * Reads or writes a Uint32Array.
   * @param address Address to access.
   * @param lengthOrValues Length to read or Uint32Array to write.
   * @param force When writing, if true temporarily changes page protection to allow the write.
   * @returns Uint32Array read or this instance if writing.
   * @example
   * ```ts
   * const cs2 = new Memory('cs2.exe');
   * const myArray = cs2.u32Array(0x12345678n, 2);
   * cs2.u32Array(0x12345678n, new Uint32Array([1,2]));
   * ```
   */
  public u32Array(address: bigint, length: number): Uint32Array;
  public u32Array(address: bigint, values: Uint32Array, force?: boolean): this;
  public u32Array(address: bigint, lengthOrValues: Uint32Array | number, force?: boolean): Uint32Array | this {
    if (typeof lengthOrValues === 'number') {
      const length = lengthOrValues;
      const scratch = new Uint32Array(length);

      this.read(address, scratch);

      return scratch;
    }

    const values = lengthOrValues;

    this.write(address, values, force);

    return this;
  }

  /**
   * Reads or writes a 64-bit unsigned integer.
   * @param address Address to access.
   * @param value Optional value to write.
   * @param force When writing, if true temporarily changes page protection to allow the write.
   * @returns The bigint at address, or this instance if writing.
   * @example
   * ```ts
   * const cs2 = new Memory('cs2.exe');
   * const myBigInt = cs2.u64(0x12345678n);
   * cs2.u64(0x12345678n, 123n);
   * ```
   */
  public u64(address: bigint): bigint;
  public u64(address: bigint, value: bigint, force?: boolean): this;
  public u64(address: bigint, value?: bigint, force?: boolean): bigint | this {
    const { hProcess, Scratch8BigUint64Array, Scratch8Ptr } = this;

    if (value === undefined) {
      const bReadProcessMemory = !!ReadProcessMemory(hProcess, address, Scratch8Ptr, 0x08n, 0x00n);

      if (!bReadProcessMemory) {
        throw new Win32Error('ReadProcessMemory', GetLastError());
      }

      return Scratch8BigUint64Array[0x00]!;
    }

    Scratch8BigUint64Array[0x00] = value;

    this.write(address, Scratch8BigUint64Array, force);

    return this;
  }

  /**
   * Reads or writes a BigUint64Array.
   * @param address Address to access.
   * @param lengthOrValues Length to read or BigUint64Array to write.
   * @param force When writing, if true temporarily changes page protection to allow the write.
   * @returns BigUint64Array read or this instance if writing.
   * @example
   * ```ts
   * const cs2 = new Memory('cs2.exe');
   * const myArray = cs2.u64Array(0x12345678n, 2);
   * cs2.u64Array(0x12345678n, new BigUint64Array([1n,2n]));
   * ```
   */
  public u64Array(address: bigint, length: number): BigUint64Array;
  public u64Array(address: bigint, values: BigUint64Array, force?: boolean): this;
  public u64Array(address: bigint, lengthOrValues: BigUint64Array | number, force?: boolean): BigUint64Array | this {
    if (typeof lengthOrValues === 'number') {
      const length = lengthOrValues;
      const scratch = new BigUint64Array(length);

      this.read(address, scratch);

      return scratch;
    }

    const values = lengthOrValues;

    this.write(address, values, force);

    return this;
  }

  /**
   * Reads or writes an 8-bit unsigned integer.
   * @param address Address to access.
   * @param value Optional value to write.
   * @param force When writing, if true temporarily changes page protection to allow the write.
   * @returns The value at address, or this instance if writing.
   * @example
   * ```ts
   * const cs2 = new Memory('cs2.exe');
   * const myInt = cs2.u8(0x12345678n);
   * cs2.u8(0x12345678n, 7);
   * ```
   */
  public u8(address: bigint): number;
  public u8(address: bigint, value: number, force?: boolean): this;
  public u8(address: bigint, value?: number, force?: boolean): number | this {
    const { hProcess, Scratch1, Scratch1Ptr } = this;

    if (value === undefined) {
      const bReadProcessMemory = !!ReadProcessMemory(hProcess, address, Scratch1Ptr, 0x01n, 0x00n);

      if (!bReadProcessMemory) {
        throw new Win32Error('ReadProcessMemory', GetLastError());
      }

      return Scratch1[0x00]!;
    }

    Scratch1[0x00] = value;

    this.write(address, Scratch1, force);

    return this;
  }

  /**
   * Reads or writes a Uint8Array.
   * @param address Address to access.
   * @param lengthOrValues Length to read or Uint8Array to write.
   * @param force When writing, if true temporarily changes page protection to allow the write.
   * @returns Uint8Array read or this instance if writing.
   * @example
   * ```ts
   * const cs2 = new Memory('cs2.exe');
   * const myArray = cs2.u8Array(0x12345678n, 2);
   * cs2.u8Array(0x12345678n, new Uint8Array([1,2]));
   * ```
   */
  public u8Array(address: bigint, length: number): Uint8Array;
  public u8Array(address: bigint, values: Uint8Array, force?: boolean): this;
  public u8Array(address: bigint, lengthOrValues: Uint8Array | number, force?: boolean): Uint8Array | this {
    if (typeof lengthOrValues === 'number') {
      const length = lengthOrValues;
      const scratch = new Uint8Array(length);

      this.read(address, scratch);

      return scratch;
    }

    const values = lengthOrValues;

    this.write(address, values, force);

    return this;
  }

  /**
   * Reads or writes a pointer-sized unsigned integer.
   * @param address Address to access.
   * @param value Optional value to write.
   * @param force When writing, if true temporarily changes page protection to allow the write.
   * @returns The value at address, or this instance if writing.
   * @example
   * ```ts
   * const cs2 = new Memory('cs2.exe');
   * const myPtr = cs2.uPtr(0x12345678n);
   * cs2.uPtr(0x12345678n, 123n);
   * ```
   */
  public uPtr(address: bigint): UPtr;
  public uPtr(address: bigint, value: UPtr, force?: boolean): this;
  public uPtr(address: bigint, value?: UPtr, force?: boolean): UPtr | this {
    // TypeScript is funny sometimes, isn't it?… 🫠…
    if (value === undefined) {
      return this.u64(address);
    }

    return this.u64(address, value, force);
  }

  /**
   * Reads or writes an array of pointer-sized unsigned integers.
   * @param address Address to access.
   * @param lengthOrValues Length to read or array to write.
   * @param force When writing, if true temporarily changes page protection to allow the write.
   * @returns Array read or this instance if writing.
   * @example
   * ```ts
   * const cs2 = new Memory('cs2.exe');
   * const myPtrs = cs2.uPtrArray(0x12345678n, 2);
   * cs2.uPtrArray(0x12345678n, new BigUint64Array([1n,2n]));
   * ```
   */
  public uPtrArray(address: bigint, length: number): UPtrArray;
  public uPtrArray(address: bigint, values: UPtrArray, force?: boolean): this;
  public uPtrArray(address: bigint, lengthOrValues: UPtrArray | number, force?: boolean): UPtrArray | this {
    // TypeScript is funny sometimes, isn't it?… 🫠…
    if (typeof lengthOrValues === 'number') {
      return this.u64Array(address, lengthOrValues);
    }

    return this.u64Array(address, lengthOrValues, force);
  }

  /**
   * Reads a UtlLinkedList of 64-bit unsigned integers and returns its elements as a BigUint64Array.
   *
   * This helper reads the list header at `address`, validates the capacity and element pointer,
   * reads the elements table, and walks the internal linked indices to produce a compact
   * BigUint64Array of present elements. If the list is empty or invalid an empty array is
   * returned.
   *
   * @param address Address of the UtlLinkedList header in the remote process.
   * @returns BigUint64Array containing the list elements (empty if the list is invalid or empty).
   * @todo Create a writer so that users can write linked lists…
   * @example
   * ```ts
   * const cs2 = new Memory('cs2.exe');
   * const myList = cs2.utlLinkedListU64(0x12345678n);
   * ```
   */
  public utlLinkedListU64(address: bigint): BigUint64Array {
    const header = new Uint8Array(0x18);
    const headerUint16Array = new Uint16Array(header.buffer, header.byteOffset);
    const headerBigUint64Array = new BigUint64Array(header.buffer, header.byteOffset + 0x08, 2);

    this.read(address, header);

    const capacity = headerUint16Array[0x01]! & 0x7fff;
    const elementsPtr = headerBigUint64Array[0x00]!;
    let   index = headerUint16Array[0x08]!; // prettier-ignore

    if (capacity === 0 || capacity <= index || elementsPtr === 0n || index === 0xffff) {
      return new BigUint64Array(0);
    }

    const scratch = new Uint8Array(capacity << 0x04);
    const scratchBigUint64Array = new BigUint64Array(scratch.buffer, scratch.byteOffset);
    const scratchUint16Array = new Uint16Array(scratch.buffer, scratch.byteOffset);

    this.read(elementsPtr, scratch);

    let   count = 0; // prettier-ignore
    const result = new BigUint64Array(capacity);

    while (count < capacity && capacity > index && index !== 0xffff) {
      result[count++] = scratchBigUint64Array[index * 0x02]!;

      const next = scratchUint16Array[0x05 + index * 0x08]!;

      if (index === next || next === 0xffff) {
        break;
      }

      index = next;
    }

    return capacity === count ? result : result.subarray(0, count);
  }

  /**
   * Reads or writes a generic UtlVector as raw bytes (no typing).
   * Pass elementSize (bytes per element) so we can set/read the header count.
   * @example
   * ```ts
   * const bytes = cs2.utlVectorRaw(0x1234n, 0x14); // read size*elementSize bytes
   * cs2.utlVectorRaw(0x1234n, 0x14, new Uint8Array([...])); // write
   * ```
   */
  public utlVectorRaw(address: bigint, elementSize: number): Uint8Array;
  public utlVectorRaw(address: bigint, elementSize: number, values: Uint8Array, force?: boolean): this;
  public utlVectorRaw(address: bigint, elementSize: number, values?: Uint8Array, force?: boolean): Uint8Array | this {
    const elementsPtr = this.u64(address + 0x08n);

    if (values === undefined) {
      const count = this.u32(address);

      if (count === 0 || elementsPtr === 0n) {
        return new Uint8Array(0);
      }

      const byteLength = count * elementSize;
      const scratch = new Uint8Array(byteLength);

      this.read(elementsPtr, scratch);

      return scratch;
    }

    if (values.byteLength % elementSize !== 0) {
      throw new RangeError('values length must be a multiple of elementSize');
    }

    const count = values.byteLength / elementSize;

    this.u32(address, count, force);

    if (count === 0) {
      return this;
    }

    this.write(elementsPtr, values, force);

    return this;
  }

  /**
   * Reads or writes a UtlVectorU32 (Uint32Array).
   * @param address Address to access.
   * @param values Optional Uint32Array to write.
   * @param force When writing, if true temporarily changes page protection to allow the write.
   * @returns The vector at address, or this instance if writing.
   * @example
   * ```ts
   * const cs2 = new Memory('cs2.exe');
   * const myVector = cs2.utlVectorU32(0x12345678n);
   * cs2.utlVectorU32(0x12345678n, new Uint32Array([1,2,3]));
   * ```
   */
  public utlVectorU32(address: bigint): Uint32Array;
  public utlVectorU32(address: bigint, values: Uint32Array, force?: boolean): this;
  public utlVectorU32(address: bigint, values?: Uint32Array, force?: boolean): Uint32Array | this {
    const elementsPtr = this.u64(address + 0x08n);

    if (values === undefined) {
      const size = this.u32(address);
      const scratch = new Uint32Array(size);

      if (size === 0) {
        return scratch;
      }

      this.read(elementsPtr, scratch);

      return scratch;
    }

    this.u32(address, values.length, force);

    if (values.length === 0) {
      return this;
    }

    this.write(elementsPtr, values, force);

    return this;
  }

  /**
   * Reads or writes a UtlVectorU64 (BigUint64Array).
   * @param address Address to access.
   * @param values Optional BigUint64Array to write.
   * @param force When writing, if true temporarily changes page protection to allow the write.
   * @returns The vector at address, or this instance if writing.
   * @example
   * ```ts
   * const cs2 = new Memory('cs2.exe');
   * const myVector = cs2.utlVectorU64(0x12345678n);
   * cs2.utlVectorU64(0x12345678n, new BigUint64Array([1n,2n,3n]));
   * ```
   */
  public utlVectorU64(address: bigint): BigUint64Array;
  public utlVectorU64(address: bigint, values: BigUint64Array, force?: boolean): this;
  public utlVectorU64(address: bigint, values?: BigUint64Array, force?: boolean): BigUint64Array | this {
    const elementsPtr = this.u64(address + 0x08n);

    if (values === undefined) {
      const size = this.u32(address);
      const scratch = new BigUint64Array(size);

      if (size === 0) {
        return scratch;
      }

      this.read(elementsPtr, scratch);

      return scratch;
    }

    this.u32(address, values.length, force);

    if (values.length === 0) {
      return this;
    }

    this.write(elementsPtr, values, force);

    return this;
  }

  /**
   * Reads a virtual function pointer from an object's vtable.
   * @param address Address of the object (pointer to vtable).
   * @param index Index of the virtual function in the vtable.
   * @returns The virtual function pointer.
   * @example
   * ```ts
   * const cs2 = new Memory('cs2.exe');
   * const vfunc = cs2.vFunction(0x12345678n, 5); // Get 6th virtual function
   * ```
   */
  public vFunction(address: bigint, index: number): bigint {
    const { hProcess, Scratch8Ptr, Scratch8BigUint64Array } = this;

    const bReadProcessMemory = !!ReadProcessMemory(hProcess, address, Scratch8Ptr, 0x08n, 0x00n);

    if (!bReadProcessMemory) {
      throw new Win32Error('ReadProcessMemory', GetLastError());
    }

    const vtablePtr = Scratch8BigUint64Array[0x00]!;

    const bReadProcessMemory2 = !!ReadProcessMemory(hProcess, vtablePtr + BigInt(index * 0x08), Scratch8Ptr, 0x08n, 0x00n);

    if (!bReadProcessMemory2) {
      throw new Win32Error('ReadProcessMemory', GetLastError());
    }

    return Scratch8BigUint64Array[0x00]!;
  }

  /**
   * Reads the vtable pointer from an object.
   * @param address Address of the object.
   * @returns The vtable pointer.
   * @example
   * ```ts
   * const cs2 = new Memory('cs2.exe');
   * const vtable = cs2.vTable(0x12345678n);
   * ```
   */
  public vTable(address: bigint): bigint {
    return this.u64(address);
  }

  /**
   * Reads or writes a Vector2 (object with x, y).
   * @param address Address to access.
   * @param value Optional Vector2 to write.
   * @param force When writing, if true temporarily changes page protection to allow the write.
   * @returns The Vector2 at address, or this instance if writing.
   * @example
   * ```ts
   * const cs2 = new Memory('cs2.exe');
   * const myVector2 = cs2.vector2(0x12345678n);
   * cs2.vector2(0x12345678n, { x: 1, y: 2 });
   * ```
   */
  public vector2(address: bigint): Vector2;
  public vector2(address: bigint, value: Vector2, force?: boolean): this;
  public vector2(address: bigint, value?: Vector2, force?: boolean): Vector2 | this {
    // TypeScript is funny sometimes, isn't it?… 🫠…
    if (value === undefined) {
      return this.point(address);
    }

    return this.point(address, value, force);
  }

  /**
   * Reads or writes an array of Vector2.
   * @param address Address to access.
   * @param lengthOrValues Length to read or array to write.
   * @param force When writing, if true temporarily changes page protection to allow the write.
   * @returns Array of Vector2 read or this instance if writing.
   * @example
   * ```ts
   * const cs2 = new Memory('cs2.exe');
   * const myVector2s = cs2.vector2Array(0x12345678n, 2);
   * cs2.vector2Array(0x12345678n, [{ x: 1, y: 2 }, { x: 3, y: 4 }]);
   * ```
   */
  public vector2Array(address: bigint, length: number): Vector2[];
  public vector2Array(address: bigint, values: Vector2[], force?: boolean): this;
  public vector2Array(address: bigint, lengthOrValues: Vector2[] | number, force?: boolean): Vector2[] | this {
    // TypeScript is funny sometimes, isn't it?… 🫠…
    if (typeof lengthOrValues === 'number') {
      return this.pointArray(address, lengthOrValues);
    }

    return this.pointArray(address, lengthOrValues, force);
  }

  /**
   * Reads an array of Vector2 as a raw Float32Array (SIMD-friendly).
   * @param address Address to read from.
   * @param length Number of Vector2 elements to read.
   * @returns Float32Array of length * 2 floats.
   * @example
   * ```ts
   * const cs2 = new Memory('cs2.exe');
   * const raw = cs2.vector2ArrayRaw(0x12345678n, 100); // 200 floats
   * ```
   */
  public vector2ArrayRaw(address: bigint, length: number): Float32Array {
    return this.f32Array(address, length * 0x02);
  }

  /**
   * Reads or writes a raw Vector2 as a Float32Array.
   * @param address Address to access.
   * @param values Optional Float32Array to write.
   * @param force When writing, if true temporarily changes page protection to allow the write.
   * @returns Float32Array read or this instance if writing.
   * @example
   * ```ts
   * const cs2 = new Memory('cs2.exe');
   * const myVector2 = cs2.vector2Raw(0x12345678n);
   * cs2.vector2Raw(0x12345678n, new Float32Array([1, 2]));
   * ```
   */
  public vector2Raw(address: bigint): Float32Array;
  public vector2Raw(address: bigint, values: Float32Array, force?: boolean): this;
  public vector2Raw(address: bigint, values?: Float32Array, force?: boolean): Float32Array | this {
    if (values === undefined) {
      return this.f32Array(address, 0x02);
    }

    if (values.length !== 0x02) {
      throw new RangeError('values.length must be 2.');
    }

    this.write(address, values, force);

    return this;
  }

  /**
   * Reads or writes a Vector3 (object with x, y, z).
   * @param address Address to access.
   * @param value Optional Vector3 to write.
   * @param force When writing, if true temporarily changes page protection to allow the write.
   * @returns The Vector3 at address, or this instance if writing.
   * @example
   * ```ts
   * const cs2 = new Memory('cs2.exe');
   * const myVector3 = cs2.vector3(0x12345678n);
   * cs2.vector3(0x12345678n, { x: 1, y: 2, z: 3 });
   * ```
   */
  public vector3(address: bigint): Vector3;
  public vector3(address: bigint, value: Vector3, force?: boolean): this;
  public vector3(address: bigint, value?: Vector3, force?: boolean): Vector3 | this {
    const { hProcess, Scratch12Ptr, Scratch12Float32Array } = this;

    if (value === undefined) {
      const bReadProcessMemory = !!ReadProcessMemory(hProcess, address, Scratch12Ptr, 0x0cn, 0x00n);

      if (!bReadProcessMemory) {
        throw new Win32Error('ReadProcessMemory', GetLastError());
      }

      const x = Scratch12Float32Array[0x00]!,
            y = Scratch12Float32Array[0x01]!,
            z = Scratch12Float32Array[0x02]!; // prettier-ignore

      return { x, y, z };
    }

    Scratch12Float32Array[0x00] = value.x;
    Scratch12Float32Array[0x01] = value.y;
    Scratch12Float32Array[0x02] = value.z;

    this.write(address, Scratch12Float32Array, force);

    return this;
  }

  /**
   * Reads or writes an array of Vector3.
   * @param address Address to access.
   * @param lengthOrValues Length to read or array to write.
   * @param force When writing, if true temporarily changes page protection to allow the write.
   * @returns Array of Vector3 read or this instance if writing.
   * @example
   * ```ts
   * const cs2 = new Memory('cs2.exe');
   * const myVector3s = cs2.vector3Array(0x12345678n, 2);
   * cs2.vector3Array(0x12345678n, [{ x: 1, y: 2, z: 3 }]);
   * ```
   */
  public vector3Array(address: bigint, length: number): Vector3[];
  public vector3Array(address: bigint, values: Vector3[], force?: boolean): this;
  public vector3Array(address: bigint, lengthOrValues: Vector3[] | number, force?: boolean): Vector3[] | this {
    if (typeof lengthOrValues === 'number') {
      const length = lengthOrValues;
      const scratch = new Float32Array(length * 0x03);

      this.read(address, scratch);

      const result = new Array<Vector3>(length);

      for (let i = 0, j = 0; i < length; i++, j += 0x03) {
        const x = scratch[j]!;
        const y = scratch[j + 0x01]!;
        const z = scratch[j + 0x02]!;

        result[i] = { x, y, z };
      }

      return result;
    }

    const values = lengthOrValues;
    const scratch = new Float32Array(values.length * 0x03);

    for (let i = 0, j = 0; i < values.length; i++, j += 0x03) {
      const vector3 = values[i]!;

      scratch[j] = vector3.x;
      scratch[j + 0x01] = vector3.y;
      scratch[j + 0x02] = vector3.z;
    }

    this.write(address, scratch, force);

    return this;
  }

  /**
   * Reads an array of Vector3 as a raw Float32Array (SIMD-friendly).
   * @param address Address to read from.
   * @param length Number of Vector3 elements to read.
   * @returns Float32Array of length * 3 floats.
   * @example
   * ```ts
   * const cs2 = new Memory('cs2.exe');
   * const raw = cs2.vector3ArrayRaw(0x12345678n, 100); // 300 floats
   * ```
   */
  public vector3ArrayRaw(address: bigint, length: number): Float32Array {
    return this.f32Array(address, length * 0x03);
  }

  /**
   * Reads or writes a raw Vector3 as a Float32Array.
   * @param address Address to access.
   * @param values Optional Float32Array to write.
   * @param force When writing, if true temporarily changes page protection to allow the write.
   * @returns Float32Array read or this instance if writing.
   * @example
   * ```ts
   * const cs2 = new Memory('cs2.exe');
   * const myVector3 = cs2.vector3Raw(0x12345678n);
   * cs2.vector3Raw(0x12345678n, new Float32Array([1, 2, 3]));
   * ```
   */
  public vector3Raw(address: bigint): Float32Array;
  public vector3Raw(address: bigint, values: Float32Array, force?: boolean): this;
  public vector3Raw(address: bigint, values?: Float32Array, force?: boolean): Float32Array | this {
    if (values === undefined) {
      return this.f32Array(address, 0x03);
    }

    if (values.length !== 0x03) {
      throw new RangeError('values.length must be 3.');
    }

    this.write(address, values, force);

    return this;
  }

  /**
   * Reads or writes a Vector4 (object with w, x, y, z).
   * @param address Address to access.
   * @param value Optional Vector4 to write.
   * @param force When writing, if true temporarily changes page protection to allow the write.
   * @returns The Vector4 at address, or this instance if writing.
   * @example
   * ```ts
   * const cs2 = new Memory('cs2.exe');
   * const myVector4 = cs2.vector4(0x12345678n);
   * cs2.vector4(0x12345678n, { w: 1, x: 0, y: 0, z: 0 });
   * ```
   */
  public vector4(address: bigint): Vector4;
  public vector4(address: bigint, value: Vector4, force?: boolean): this;
  public vector4(address: bigint, value?: Vector4, force?: boolean): Vector4 | this {
    // TypeScript is funny sometimes, isn't it?… 🫠…
    if (value === undefined) {
      return this.quaternion(address);
    }

    return this.quaternion(address, value, force);
  }

  /**
   * Reads or writes an array of Vector4.
   * @param address Address to access.
   * @param lengthOrValues Length to read or array to write.
   * @param force When writing, if true temporarily changes page protection to allow the write.
   * @returns Array of Vector4 read or this instance if writing.
   * @example
   * ```ts
   * const cs2 = new Memory('cs2.exe');
   * const myVector4s = cs2.vector4Array(0x12345678n, 2);
   * cs2.vector4Array(0x12345678n, [{ w: 1, x: 0, y: 0, z: 0 }]);
   * ```
   */
  public vector4Array(address: bigint, length: number): Vector4[];
  public vector4Array(address: bigint, values: Vector4[], force?: boolean): this;
  public vector4Array(address: bigint, lengthOrValues: Vector4[] | number, force?: boolean): Vector4[] | this {
    // TypeScript is funny sometimes, isn't it?… 🫠…
    if (typeof lengthOrValues === 'number') {
      return this.quaternionArray(address, lengthOrValues);
    }

    return this.quaternionArray(address, lengthOrValues, force);
  }

  /**
   * Reads an array of Vector4 as a raw Float32Array (SIMD-friendly).
   * @param address Address to read from.
   * @param length Number of Vector4 elements to read.
   * @returns Float32Array of length * 4 floats.
   * @example
   * ```ts
   * const cs2 = new Memory('cs2.exe');
   * const raw = cs2.vector4ArrayRaw(0x12345678n, 100); // 400 floats
   * ```
   */
  public vector4ArrayRaw(address: bigint, length: number): Float32Array {
    return this.f32Array(address, length * 0x04);
  }

  /**
   * Reads or writes a raw Vector4 as a Float32Array.
   * @param address Address to access.
   * @param values Optional Float32Array to write.
   * @param force When writing, if true temporarily changes page protection to allow the write.
   * @returns Float32Array read or this instance if writing.
   * @example
   * ```ts
   * const cs2 = new Memory('cs2.exe');
   * const myVector4 = cs2.vector4Raw(0x12345678n);
   * cs2.vector4Raw(0x12345678n, new Float32Array([1, 0, 0, 0]));
   * ```
   */
  public vector4Raw(address: bigint): Float32Array;
  public vector4Raw(address: bigint, values: Float32Array, force?: boolean): this;
  public vector4Raw(address: bigint, values?: Float32Array, force?: boolean): Float32Array | this {
    if (values === undefined) {
      return this.f32Array(address, 0x04);
    }

    if (values.length !== 0x04) {
      throw new RangeError('values.length must be 4.');
    }

    this.write(address, values, force);

    return this;
  }

  /**
   * Reads or writes a 4x4 view matrix (Float32Array of length 16).
   * @param address Address to access.
   * @param values Optional Float32Array to write.
   * @param force When writing, if true temporarily changes page protection to allow the write.
   * @returns The matrix at address, or this instance if writing.
   * @example
   * ```ts
   * const cs2 = new Memory('cs2.exe');
   * const viewMatrix = cs2.viewMatrix(0x12345678n);
   * cs2.viewMatrix(0x12345678n, new Float32Array(16));
   * ```
   */
  public viewMatrix(address: bigint): Float32Array;
  public viewMatrix(address: bigint, values: Float32Array, force?: boolean): this;
  public viewMatrix(address: bigint, values?: Float32Array, force?: boolean): Float32Array | this {
    // TypeScript is funny sometimes, isn't it?… 🫠…
    if (values === undefined) {
      return this.matrix4x4(address);
    }

    return this.matrix4x4(address, values, force);
  }

  /**
   * Reads or writes a wide (UTF-16LE) string.
   * @param address Address to access.
   * @param lengthOrValue Length in characters to read or string to write.
   * @param force When writing, if true temporarily changes page protection to allow the write.
   * @returns The string at address, or this instance if writing.
   * @notice When writing, remember to null-terminate your string (e.g., 'hello\0').
   * @example
   * ```ts
   * const cs2 = new Memory('cs2.exe');
   * const myWideString = cs2.wideString(0x12345678n, 16);
   * cs2.wideString(0x12345678n, 'hello\0');
   * ```
   */
  public wideString(address: bigint, length: number): string;
  public wideString(address: bigint, value: string, force?: boolean): this;
  public wideString(address: bigint, lengthOrValue: number | string, force?: boolean): string | this {
    if (typeof lengthOrValue === 'number') {
      const scratch = Buffer.allocUnsafe(lengthOrValue * 2);

      this.read(address, scratch);

      const u16View = new Uint16Array(scratch.buffer, scratch.byteOffset, lengthOrValue);
      const indexOf = u16View.indexOf(0x0000);

      return scratch.toString('utf16le', 0, (indexOf !== -1 ? indexOf : lengthOrValue) * 2);
    }

    const scratch = Buffer.allocUnsafe(lengthOrValue.length * 2);

    scratch.write(lengthOrValue, 0, 'utf16le');

    this.write(address, scratch, force);

    return this;
  }

  // Public utility methods…

  /**
   * Follows a pointer chain with offsets.
   * @param address Base address.
   * @param offsets Array of pointer offsets.
   * @returns Final address after following the chain, or -1n if any pointer is null.
   * @example
   * ```ts
   * const cs2 = new Memory('cs2.exe');
   * const myAddress = cs2.follow(0x10000000n, [0x10n, 0x20n]);
   * ```
   */
  public follow(address: bigint, offsets: readonly bigint[]): bigint {
    const length = offsets.length;

    if (length === 0) {
      return address;
    }

    const { hProcess, Scratch8Ptr, Scratch8BigUint64Array } = this;
    const last = length - 1;

    for (let i = 0; i < last; i++) {
      const bReadProcessMemory = !!ReadProcessMemory(hProcess, address + offsets[i]!, Scratch8Ptr, 0x08n, 0x00n);

      if (!bReadProcessMemory) {
        throw new Win32Error('ReadProcessMemory', GetLastError());
      }

      address = Scratch8BigUint64Array[0x00]!;

      if (address === 0n) {
        return -1n;
      }
    }

    return address + offsets[last]!;
  }

  /**
   * Finds the address of a buffer within a memory region.
   * @param needle Buffer or typed array to search for.
   * @param address Start address.
   * @param length Number of bytes to search.
   * @param all If true, returns all matches as an array. If false or omitted, returns the first match or -1n.
   * @returns Address of the buffer if found, or -1n. If all is true, returns an array of addresses.
   * @example
   * ```ts
   * const cs2 = new Memory('cs2.exe');
   * const needle = Buffer.from('Hello world!');
   * // const needle = Buffer.from([0x01, 0x02, 0x03]);
   * // const needle = new Uint8Array([0x01, 0x02, 0x03]);
   * // const needle = new Float32Array([0x01, 0x02, 0x03]);
   * // Find first match
   * const address = cs2.indexOf(needle, 0x10000000n, 100);
   * // Find all matches
   * const allAddressess = cs2.indexOf(needle, 0x10000000n, 100, true);
   * ```
   */
  public indexOf(needle: Scratch, address: bigint, length: number): bigint;
  public indexOf(needle: Scratch, address: bigint, length: number, all: false): bigint;
  public indexOf(needle: Scratch, address: bigint, length: number, all: true): bigint[];
  public indexOf(needle: Scratch, address: bigint, length: number, all: boolean = false): bigint | bigint[] {
    const haystack = Buffer.allocUnsafe(length);

    const needleBuffer = ArrayBuffer.isView(needle) //
      ? Buffer.from(needle.buffer, needle.byteOffset, needle.byteLength)
      : Buffer.from(needle);

    this.read(address, haystack);

    if (!all) {
      const indexOf = haystack.indexOf(needleBuffer);

      return indexOf !== -1 ? BigInt(indexOf) + address : -1n;
    }

    const results: bigint[] = [];

    let start = haystack.indexOf(needleBuffer);

    if (start === -1) {
      return results;
    }

    do {
      results.push(address + BigInt(start));
    } while ((start = haystack.indexOf(needleBuffer, start + 0x01)) !== -1);

    return results;
  }

  /**
   * Finds the address of a byte pattern in memory. `**` and `??` match any byte.
   * @param needle Hex string pattern to search for (e.g., 'deadbeed', 'dead**ef', 'dead??ef').
   * @param address Start address to search.
   * @param length Number of bytes to search.
   * @param all If true, returns all matches as an array. If false or omitted, returns the first match or -1n.
   * @returns Address of the pattern if found, or -1n. If all is true, returns an array of addresses.
   * @example
   * ```ts
   * const cs2 = new Memory('cs2.exe');
   * // Find first match
   * const address = cs2.pattern('dead**ef', 0x10000000n, 0x1000);
   * // Find all matches
   * const allAddresses = cs2.pattern('dead**ef', 0x10000000n, 0x1000, true);
   * ```
   */
  public pattern(needle: string, address: bigint, length: number): bigint;
  public pattern(needle: string, address: bigint, length: number, all: false): bigint;
  public pattern(needle: string, address: bigint, length: number, all: true): bigint[];
  public pattern(needle: string, address: bigint, length: number, all: boolean = false): bigint | bigint[] {
    const test = Memory.Patterns.PatternTest.test(needle);

    if (!test) {
      return !all ? -1n : [];
    }

    // The RegExp test ensures that we have at least one token…

    const tokens = [...needle.matchAll(Memory.Patterns.PatternMatchAll)]
      .map((match) => ({ buffer: Buffer.from(match[0], 'hex'), index: match.index >>> 1, length: match[0].length >>> 1 })) //
      .sort(({ length: a }, { length: b }) => b - a);

    const anchor = tokens.shift()!;

    const haystack = this.buffer(address, length);

    const end = length - (needle.length >>> 1);
    let   start = haystack.indexOf(anchor.buffer); // prettier-ignore

    if (start === -1) {
      return !all ? -1n : [];
    }

    if (!all) {
      outer: do {
        const base = start - anchor.index;

        if (base < 0) {
          continue;
        }

        if (base > end) {
          return -1n;
        }

        for (const { buffer, index, length } of tokens) {
          const sourceEnd = base + index + length,
                sourceStart = base + index,
                target = buffer,
                targetEnd = length,
                targetStart = 0; // prettier-ignore

          const compare = haystack.compare(target, targetStart, targetEnd, sourceStart, sourceEnd);

          if (compare !== 0) {
            continue outer;
          }
        }

        return address + BigInt(base);
      } while ((start = haystack.indexOf(anchor.buffer, start + 0x01)) !== -1);

      return -1n;
    }

    const results: bigint[] = [];

    outer: do {
      const base = start - anchor.index;

      if (base < 0) {
        continue;
      }

      if (base > end) {
        return results;
      }

      for (const { buffer, index, length } of tokens) {
        const sourceEnd = base + index + length,
              sourceStart = base + index,
              target = buffer,
              targetEnd = length,
              targetStart = 0; // prettier-ignore

        const compare = haystack.compare(target, targetStart, targetEnd, sourceStart, sourceEnd);

        if (compare !== 0) {
          continue outer;
        }
      }

      results.push(address + BigInt(base));
    } while ((start = haystack.indexOf(anchor.buffer, start + 0x01)) !== -1);

    return results;
  }
}

export default Memory;
