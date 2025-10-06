import { CString, FFIType, dlopen, ptr } from 'bun:ffi';

import type { Module, NetworkUtlVector, Point, QAngle, Quaternion, Region, RGB, RGBA, Scratch, UPtr, UPtrArray, Vector2, Vector3, Vector4 } from '../types/Memory';
import Win32Error from './Win32Error';

const {
  symbols: { CloseHandle, CreateToolhelp32Snapshot, GetLastError, Module32FirstW, Module32NextW, OpenProcess, Process32FirstW, Process32NextW, ReadProcessMemory, VirtualQueryEx, WriteProcessMemory },
} = dlopen('kernel32.dll', {
  CloseHandle: { args: [FFIType.u64], returns: FFIType.bool },
  CreateToolhelp32Snapshot: { args: [FFIType.u32, FFIType.u32], returns: FFIType.u64 },
  GetLastError: { returns: FFIType.u32 },
  IsWow64Process2: { args: [FFIType.u64, FFIType.ptr, FFIType.ptr], returns: FFIType.bool },
  Module32FirstW: { args: [FFIType.u64, FFIType.ptr], returns: FFIType.bool },
  Module32NextW: { args: [FFIType.u64, FFIType.ptr], returns: FFIType.bool },
  OpenProcess: { args: [FFIType.u32, FFIType.bool, FFIType.u32], returns: FFIType.u64 },
  Process32FirstW: { args: [FFIType.u64, FFIType.ptr], returns: FFIType.bool },
  Process32NextW: { args: [FFIType.u64, FFIType.ptr], returns: FFIType.bool },
  ReadProcessMemory: { args: [FFIType.u64, FFIType.u64, FFIType.ptr, FFIType.u64_fast, FFIType.ptr], returns: FFIType.bool },
  VirtualProtectEx: { args: [FFIType.u64, FFIType.u64, FFIType.u64, FFIType.u32, FFIType.ptr], returns: FFIType.bool },
  VirtualQueryEx: { args: [FFIType.u64, FFIType.u64, FFIType.ptr, FFIType.u64], returns: FFIType.u64 },
  WriteProcessMemory: { args: [FFIType.u64, FFIType.u64, FFIType.ptr, FFIType.u64_fast, FFIType.ptr], returns: FFIType.bool },
});

/**
 * Provides cross-process memory manipulation for native applications.
 *
 * Use this class to read and write memory, access modules, and work with common data structures in external processes.
 *
 * Many scalar reads utilize `TypedArray` scratches to avoid a second FFI hop, such as calling `bun:ffi.read.*`.
 *
 * @todo Add support for 32 or 64-bit processes using IsWow64Process2 (Windows 10+).
 * @todo When adding 32-bit support, several u64 will need changed to u64_fast.
 *
 * @example
 * ```ts
 * import Memory from './structs/Memory';
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
    const dwFlags = 0x00000002; /* TH32CS_SNAPPROCESS */
    const th32ProcessID = 0;

    const hSnapshot = CreateToolhelp32Snapshot(dwFlags, th32ProcessID);

    if (hSnapshot === -1n) {
      throw new Win32Error('CreateToolhelp32Snapshot', GetLastError());
    }

    const lppe = Buffer.allocUnsafe(0x238 /* sizeof(PROCESSENTRY32) */);
    /* */ lppe.writeUInt32LE(0x238 /* sizeof(PROCESSENTRY32) */);

    const bProcess32FirstW = Process32FirstW(hSnapshot, lppe);

    if (!bProcess32FirstW) {
      CloseHandle(hSnapshot);

      throw new Win32Error('Process32FirstW', GetLastError());
    }

    do {
      const szExeFile = lppe.toString('utf16le', 0x2c, 0x234).replace(/\0+$/, '');
      const th32ProcessID = lppe.readUInt32LE(0x08);

      if (
        (typeof identifier === 'number' && identifier !== th32ProcessID) || //
        (typeof identifier === 'string' && identifier !== szExeFile)
      ) {
        continue;
      }

      const desiredAccess = 0x001f0fff; /* PROCESS_ALL_ACCESS */
      const inheritHandle = false;

      const hProcess = OpenProcess(desiredAccess, inheritHandle, th32ProcessID);

      if (hProcess === 0n) {
        CloseHandle(hSnapshot);

        throw new Win32Error('OpenProcess', GetLastError());
      }

      this._modules = {};

      this.hProcess = hProcess;
      this.th32ProcessID = th32ProcessID;

      this.refresh();

      CloseHandle(hSnapshot);

      return;
    } while (Process32NextW(hSnapshot, lppe));

    CloseHandle(hSnapshot);

    throw new Error(`Process not found: ${identifier}…`);
  }

  /**
   * Memory protection flags for safe and unsafe regions.
   * Used to filter readable/writable memory areas.
   */
  private static readonly MemoryProtections = {
    Safe: 0x10 /* PAGE_EXECUTE */ | 0x20 /* PAGE_EXECUTE_READ */ | 0x40 /* PAGE_EXECUTE_READWRITE */ | 0x80 /* PAGE_EXECUTE_WRITECOPY */ | 0x02 /* PAGE_READONLY */ | 0x04 /* PAGE_READWRITE */ | 0x08 /* PAGE_WRITECOPY */,
    Unsafe: 0x100 /* PAGE_GUARD */ | 0x01 /* PAGE_NOACCESS */,
  };

  /**
   * Regex patterns for matching hex strings and wildcards in memory scans.
   * Used by the pattern method.
   */
  private static readonly Patterns = {
    MatchAll: /(?:[0-9A-Fa-f]{2})+/g,
    Test: /^(?=.*[0-9A-Fa-f]{2})(?:\*{2}|\?{2}|[0-9A-Fa-f]{2})+$/,
    // Test: /^(?:\*{2}|[0-9A-Fa-f]{2}|\?{2})+$/,
  };

  /**
   * Map of loaded modules in the process, keyed by module name.
   * @example
   * ```ts
   * const cs2 = new Memory('cs2.exe');
   * const mainModule = cs2.modules['cs2.exe'];
   * ```
   */
  private _modules: { [key: string]: Module };

  /**
   * Scratch buffers and typed views for temporary FFI reads/writes.
   * Used internally for efficient memory access and conversions.
   */
  private readonly Scratch1 = new Uint8Array(0x01);
  private readonly Scratch1Int8Array = new Int8Array(this.Scratch1.buffer, this.Scratch1.byteOffset, 0x01);

  private readonly Scratch2 = new Uint8Array(0x02);
  private readonly Scratch2Int16Array = new Int16Array(this.Scratch2.buffer, this.Scratch2.byteOffset, 0x01);
  private readonly Scratch2Uint16Array = new Uint16Array(this.Scratch2.buffer, this.Scratch2.byteOffset, 0x01);

  private readonly Scratch3 = new Uint8Array(0x03);

  private readonly Scratch4 = new Uint8Array(0x04);
  private readonly Scratch4Float32Array = new Float32Array(this.Scratch4.buffer, this.Scratch4.byteOffset, 0x01);
  private readonly Scratch4Int32Array = new Int32Array(this.Scratch4.buffer, this.Scratch4.byteOffset, 0x01);
  private readonly Scratch4Uint32Array = new Uint32Array(this.Scratch4.buffer, this.Scratch4.byteOffset, 0x01);

  private readonly Scratch8 = new Uint8Array(0x08);
  private readonly Scratch8BigInt64Array = new BigInt64Array(this.Scratch8.buffer, this.Scratch8.byteOffset, 0x01);
  private readonly Scratch8BigUint64Array = new BigUint64Array(this.Scratch8.buffer, this.Scratch8.byteOffset, 0x01);
  private readonly Scratch8Float32Array = new Float32Array(this.Scratch8.buffer, this.Scratch8.byteOffset, 0x02);
  private readonly Scratch8Float64Array = new Float64Array(this.Scratch8.buffer, this.Scratch8.byteOffset, 0x01);

  private readonly Scratch12 = new Uint8Array(0x0c);
  private readonly Scratch12Float32Array = new Float32Array(this.Scratch12.buffer, this.Scratch12.byteOffset, 0x03);

  private readonly Scratch16 = new Uint8Array(0x10);
  private readonly Scratch16Float32Array = new Float32Array(this.Scratch16.buffer, this.Scratch16.byteOffset, 0x04);

  private readonly ScratchMemoryBasicInformation = Buffer.allocUnsafe(0x30 /* sizeof(MEMORY_BASIC_INFORMATION) */);
  private readonly ScratchModuleEntry32W = Buffer.allocUnsafe(0x438 /* sizeof(MODULEENTRY32W) */);

  private static TextDecoderUTF16 = new TextDecoder('utf-16');
  private static TextDecoderUTF8 = new TextDecoder('utf-8');

  private readonly hProcess: bigint;
  private readonly th32ProcessID: number;

  /**
   * Gets all loaded modules in the process.
   * @returns Map of module name to module info.
   * @example
   * ```ts
   * const cs2 = new Memory('cs2.exe');
   * const client = cs2.modules['client.dll'];
   * ```
   */
  public get modules(): Memory['_modules'] {
    return this._modules;
  }

  /**
   * Returns memory regions in a given address range.
   * @param address Start address.
   * @param length Number of bytes to scan.
   * @returns Array of memory regions.
   */
  private regions(address: bigint, length: bigint | number): Region[] {
    const dwLength = 0x30; /* sizeof(MEMORY_BASIC_INFORMATION) */
    let   lpAddress = BigInt(address); // prettier-ignore
    const lpBuffer = this.ScratchMemoryBasicInformation;

    const bVirtualQueryEx = !!VirtualQueryEx(this.hProcess, lpAddress, lpBuffer, dwLength);

    if (!bVirtualQueryEx) {
      throw new Win32Error('VirtualQueryEx', GetLastError());
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
    } while (lpAddress < end && !!VirtualQueryEx(this.hProcess, lpAddress, lpBuffer, dwLength));

    return result;
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
   * Refreshes the module list for the process.
   * @example
   * ```ts
   * const cs2 = new Memory('cs2.exe');
   * cs2.refresh();
   * ```
   */
  public refresh(): void {
    const dwFlags = 0x00000008 /* TH32CS_SNAPMODULE */ | 0x00000010; /* TH32CS_SNAPMODULE32 */

    const hSnapshot = CreateToolhelp32Snapshot(dwFlags, this.th32ProcessID)!;

    if (hSnapshot === -1n) {
      throw new Win32Error('CreateToolhelp32Snapshot', GetLastError());
    }

    this.ScratchModuleEntry32W.writeUInt32LE(0x438 /* sizeof(MODULEENTRY32W) */);

    const lpme = this.ScratchModuleEntry32W;

    const bModule32FirstW = Module32FirstW(hSnapshot, lpme);

    if (!bModule32FirstW) {
      CloseHandle(hSnapshot);

      throw new Win32Error('Module32FirstW', GetLastError());
    }

    const modules: Memory['_modules'] = {};

    do {
      const modBaseAddr = lpme.readBigUInt64LE(0x18);
      const modBaseSize = lpme.readUInt32LE(0x20);
      const szModule = lpme.toString('utf16le', 0x30, 0x230).replace(/\0+$/, '');

      modules[szModule] = Object.freeze({ base: modBaseAddr, name: szModule, size: modBaseSize });
    } while (Module32NextW(hSnapshot, lpme));

    CloseHandle(hSnapshot);

    this._modules = Object.freeze(modules);

    return;
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
    const lpBaseAddress = address;
    const lpBuffer = ptr(scratch);
    const nSize = scratch.byteLength;
    const numberOfBytesRead = 0x00n;

    const bReadProcessMemory = ReadProcessMemory(this.hProcess, lpBaseAddress, lpBuffer, nSize, numberOfBytesRead);

    if (!bReadProcessMemory) {
      throw new Win32Error('ReadProcessMemory', GetLastError());
    }

    return scratch;
  }

  /**
   * Writes a buffer to memory.
   * @param address Address to write to.
   * @param scratch Buffer to write.
   * @returns This instance.
   * @todo Add a `force: boolean` option that uses `VirtualProtectEx` for a temporary protection change when set to `true`.
   * @todo Consider inlining the call in the if to cut a binding… I hate the idea… 🫠…
   * @example
   * ```ts
   * const cs2 = new Memory('cs2.exe');
   * cs2.write(0x12345678n, new Uint8Array([1,2,3,4]));
   * ```
   */
  private write(address: bigint, scratch: Scratch): this {
    const lpBaseAddress = address;
    const lpBuffer = scratch.ptr;
    const nSize = scratch.byteLength;
    const numberOfBytesWritten = 0x00n;

    const bWriteProcessMemory = WriteProcessMemory(this.hProcess, lpBaseAddress, lpBuffer, nSize, numberOfBytesWritten);

    if (!bWriteProcessMemory) {
      throw new Win32Error('WriteProcessMemory', GetLastError());
    }

    return this;
  }

  /**
   * Reads or writes a boolean value.
   * @param address Address to access.
   * @param value Optional value to write.
   * @returns The boolean at address, or this instance if writing.
   * @example
   * ```ts
   * const cs2 = new Memory('cs2.exe');
   * const myBool = cs2.bool(0x12345678n);
   * cs2.bool(0x12345678n, true);
   * ```
   */
  public bool(address: bigint): boolean;
  public bool(address: bigint, value: boolean): this;
  public bool(address: bigint, value?: boolean): boolean | this {
    const Scratch1 = this.Scratch1;

    if (value === undefined) {
      return this.read(address, Scratch1)[0x00] !== 0;
    }

    Scratch1[0x00] = value ? 1 : 0;

    this.write(address, Scratch1);

    return this;
  }

  /**
   * Reads or writes a Buffer.
   * @param address Address to access.
   * @param lengthOrValue Length to read or Buffer to write.
   * @returns Buffer read or this instance if writing.
   * @example
   * ```ts
   * const cs2 = new Memory('cs2.exe');
   * const myBuffer = cs2.buffer(0x12345678n, 8);
   * cs2.buffer(0x12345678n, Buffer.from([1,2,3,4]));
   * ```
   */
  public buffer(address: bigint, length: number): Buffer;
  public buffer(address: bigint, value: Buffer): this;
  public buffer(address: bigint, lengthOrValue: number | Buffer): Buffer | this {
    if (typeof lengthOrValue === 'number') {
      const length = lengthOrValue;
      const scratch = Buffer.allocUnsafe(length);

      return this.read(address, scratch);
    }

    const value = lengthOrValue;

    this.write(address, value);

    return this;
  }

  /**
   * Reads or writes a C-style string.
   * @param address Address to access.
   * @param lengthOrValue Length to read or CString to write.
   * @returns CString read or this instance if writing.
   * @example
   * ```ts
   * const cs2 = new Memory('cs2.exe');
   * const myCString = cs2.cString(0x12345678n, 16);
   * cs2.cString(0x12345678n, new CString('hello'));
   * ```
   */
  public cString(address: bigint, length: number): CString;
  public cString(address: bigint, value: CString): this;
  public cString(address: bigint, lengthOrValue: number | CString): CString | this {
    if (typeof lengthOrValue === 'number') {
      const scratch = new Uint8Array(lengthOrValue);

      this.read(address, scratch);

      return new CString(scratch.ptr);
    }

    const scratch = Buffer.from(lengthOrValue);

    this.write(address, scratch);

    return this;
  }

  /**
   * Reads or writes a 32-bit float.
   * @param address Address to access.
   * @param value Optional value to write.
   * @returns The float at address, or this instance if writing.
   * @example
   * ```ts
   * const cs2 = new Memory('cs2.exe');
   * const myFloat = cs2.f32(0x12345678n);
   * cs2.f32(0x12345678n, 1.23);
   * ```
   */
  public f32(address: bigint): number;
  public f32(address: bigint, value: number): this;
  public f32(address: bigint, value?: number): number | this {
    const Scratch4Float32Array = this.Scratch4Float32Array; // prettier-ignore

    if (value === undefined) {
      return this.read(address, Scratch4Float32Array)[0x00];
    }

    Scratch4Float32Array[0x00] = value;

    this.write(address, Scratch4Float32Array);

    return this;
  }

  /**
   * Reads or writes a Float32Array.
   * @param address Address to access.
   * @param lengthOrValues Length to read or Float32Array to write.
   * @returns Float32Array read or this instance if writing.
   * @example
   * ```ts
   * const cs2 = new Memory('cs2.exe');
   * const myArray = cs2.f32Array(0x12345678n, 3);
   * cs2.f32Array(0x12345678n, new Float32Array([1,2,3]));
   * ```
   */
  public f32Array(address: bigint, length: number): Float32Array;
  public f32Array(address: bigint, values: Float32Array): this;
  public f32Array(address: bigint, lengthOrValues: Float32Array | number): Float32Array | this {
    if (typeof lengthOrValues === 'number') {
      const length = lengthOrValues;
      const scratch = new Float32Array(length);

      this.read(address, scratch);

      return scratch;
    }

    const values = lengthOrValues;

    this.write(address, values);

    return this;
  }

  /**
   * Reads or writes a 64-bit float.
   * @param address Address to access.
   * @param value Optional value to write.
   * @returns The float at address, or this instance if writing.
   * @example
   * ```ts
   * const cs2 = new Memory('cs2.exe');
   * const myFloat = cs2.f64(0x12345678n);
   * cs2.f64(0x12345678n, 1.23);
   * ```
   */
  public f64(address: bigint): number;
  public f64(address: bigint, value: number): this;
  public f64(address: bigint, value?: number): number | this {
    const Scratch8Float64Array = this.Scratch8Float64Array; // prettier-ignore

    if (value === undefined) {
      return this.read(address, Scratch8Float64Array)[0x00];
    }

    Scratch8Float64Array[0x00] = value;

    this.write(address, Scratch8Float64Array);

    return this;
  }

  /**
   * Reads or writes a Float64Array.
   * @param address Address to access.
   * @param lengthOrValues Length to read or Float64Array to write.
   * @returns Float64Array read or this instance if writing.
   * @example
   * ```ts
   * const cs2 = new Memory('cs2.exe');
   * const myArray = cs2.f64Array(0x12345678n, 2);
   * cs2.f64Array(0x12345678n, new Float64Array([1,2]));
   * ```
   */
  public f64Array(address: bigint, length: number): Float64Array;
  public f64Array(address: bigint, values: Float64Array): this;
  public f64Array(address: bigint, lengthOrValues: Float64Array | number): Float64Array | this {
    if (typeof lengthOrValues === 'number') {
      const length = lengthOrValues;
      const scratch = new Float64Array(length);

      this.read(address, scratch);

      return scratch;
    }

    const values = lengthOrValues;

    this.write(address, values);

    return this;
  }

  /**
   * Reads or writes a 16-bit integer.
   * @param address Address to access.
   * @param value Optional value to write.
   * @returns The int at address, or this instance if writing.
   * @example
   * ```ts
   * const cs2 = new Memory('cs2.exe');
   * const myInt = cs2.i16(0x12345678n);
   * cs2.i16(0x12345678n, 42);
   * ```
   */
  public i16(address: bigint): number;
  public i16(address: bigint, value: number): this;
  public i16(address: bigint, value?: number): number | this {
    const Scratch2Int16Array = this.Scratch2Int16Array; // prettier-ignore

    if (value === undefined) {
      return this.read(address, Scratch2Int16Array)[0x00];
    }

    Scratch2Int16Array[0x00] = value;

    this.write(address, Scratch2Int16Array);

    return this;
  }

  /**
   * Reads or writes an Int16Array.
   * @param address Address to access.
   * @param lengthOrValues Length to read or Int16Array to write.
   * @returns Int16Array read or this instance if writing.
   * @example
   * ```ts
   * const cs2 = new Memory('cs2.exe');
   * const myArray = cs2.i16Array(0x12345678n, 2);
   * cs2.i16Array(0x12345678n, new Int16Array([1,2]));
   * ```
   */
  public i16Array(address: bigint, length: number): Int16Array;
  public i16Array(address: bigint, values: Int16Array): this;
  public i16Array(address: bigint, lengthOrValues: Int16Array | number): Int16Array | this {
    if (typeof lengthOrValues === 'number') {
      const length = lengthOrValues;
      const scratch = new Int16Array(length);

      this.read(address, scratch);

      return scratch;
    }

    const values = lengthOrValues;

    this.write(address, values);

    return this;
  }

  /**
   * Reads or writes a 32-bit integer.
   * @param address Address to access.
   * @param value Optional value to write.
   * @returns The int at address, or this instance if writing.
   * @example
   * ```ts
   * const cs2 = new Memory('cs2.exe');
   * const myInt = cs2.i32(0x12345678n);
   * cs2.i32(0x12345678n, 42);
   * ```
   */
  public i32(address: bigint): number;
  public i32(address: bigint, value: number): this;
  public i32(address: bigint, value?: number): number | this {
    const Scratch4Int32Array = this.Scratch4Int32Array;

    if (value === undefined) {
      return this.read(address, Scratch4Int32Array)[0x00];
    }

    Scratch4Int32Array[0x00] = value;

    this.write(address, Scratch4Int32Array);

    return this;
  }

  /**
   * Reads or writes an Int32Array.
   * @param address Address to access.
   * @param lengthOrValues Length to read or Int32Array to write.
   * @returns Int32Array read or this instance if writing.
   * @example
   * ```ts
   * const cs2 = new Memory('cs2.exe');
   * const myArray = cs2.i32Array(0x12345678n, 2);
   * cs2.i32Array(0x12345678n, new Int32Array([1,2]));
   * ```
   */
  public i32Array(address: bigint, length: number): Int32Array;
  public i32Array(address: bigint, values: Int32Array): this;
  public i32Array(address: bigint, lengthOrValues: Int32Array | number): Int32Array | this {
    if (typeof lengthOrValues === 'number') {
      const length = lengthOrValues;
      const scratch = new Int32Array(length);

      this.read(address, scratch);

      return scratch;
    }

    const values = lengthOrValues;

    this.write(address, values);

    return this;
  }

  /**
   * Reads or writes a 64-bit integer.
   * @param address Address to access.
   * @param value Optional value to write.
   * @returns The bigint at address, or this instance if writing.
   * @example
   * ```ts
   * const cs2 = new Memory('cs2.exe');
   * const myBigInt = cs2.i64(0x12345678n);
   * cs2.i64(0x12345678n, 123n);
   * ```
   */
  public i64(address: bigint): bigint;
  public i64(address: bigint, value: bigint): this;
  public i64(address: bigint, value?: bigint): bigint | this {
    const Scratch8BigInt64Array = this.Scratch8BigInt64Array;

    if (value === undefined) {
      return this.read(address, Scratch8BigInt64Array)[0x00];
    }

    Scratch8BigInt64Array[0x00] = value;

    this.write(address, Scratch8BigInt64Array);

    return this;
  }

  /**
   * Reads or writes a BigInt64Array.
   * @param address Address to access.
   * @param lengthOrValues Length to read or BigInt64Array to write.
   * @returns BigInt64Array read or this instance if writing.
   * @example
   * ```ts
   * const cs2 = new Memory('cs2.exe');
   * const myArray = cs2.i64Array(0x12345678n, 2);
   * cs2.i64Array(0x12345678n, new BigInt64Array([1n,2n]));
   * ```
   */
  public i64Array(address: bigint, length: number): BigInt64Array;
  public i64Array(address: bigint, values: BigInt64Array): this;
  public i64Array(address: bigint, lengthOrValues: BigInt64Array | number): BigInt64Array | this {
    if (typeof lengthOrValues === 'number') {
      const length = lengthOrValues;
      const scratch = new BigInt64Array(length);

      this.read(address, scratch);

      return scratch;
    }

    const values = lengthOrValues;

    this.write(address, values);

    return this;
  }

  /**
   * Reads or writes an 8-bit integer.
   * @param address Address to access.
   * @param value Optional value to write.
   * @returns The int at address, or this instance if writing.
   * @example
   * ```ts
   * const cs2 = new Memory('cs2.exe');
   * const myInt = cs2.i8(0x12345678n);
   * cs2.i8(0x12345678n, 7);
   * ```
   */
  public i8(address: bigint): number;
  public i8(address: bigint, value: number): this;
  public i8(address: bigint, value?: number): number | this {
    const Scratch1Int8Array = this.Scratch1Int8Array;

    if (value === undefined) {
      return this.read(address, Scratch1Int8Array)[0x00];
    }

    Scratch1Int8Array[0x00] = value;

    this.write(address, Scratch1Int8Array);

    return this;
  }

  /**
   * Reads or writes an Int8Array.
   * @param address Address to access.
   * @param lengthOrValues Length to read or Int8Array to write.
   * @returns Int8Array read or this instance if writing.
   * @example
   * ```ts
   * const cs2 = new Memory('cs2.exe');
   * const myArray = cs2.i8Array(0x12345678n, 2);
   * cs2.i8Array(0x12345678n, new Int8Array([1,2]));
   * ```
   */
  public i8Array(address: bigint, length: number): Int8Array;
  public i8Array(address: bigint, values: Int8Array): this;
  public i8Array(address: bigint, lengthOrValues: Int8Array | number): Int8Array | this {
    if (typeof lengthOrValues === 'number') {
      const length = lengthOrValues;
      const scratch = new Int8Array(length);

      this.read(address, scratch);

      return scratch;
    }

    const values = lengthOrValues;

    this.write(address, values);

    return this;
  }

  /**
   * Reads or writes a 3x3 matrix (Float32Array of length 9).
   * @param address Address to access.
   * @param values Optional Float32Array to write.
   * @returns The matrix at address, or this instance if writing.
   * @example
   * ```ts
   * const cs2 = new Memory('cs2.exe');
   * const myMatrix = cs2.matrix3x3(0x12345678n);
   * cs2.matrix3x3(0x12345678n, new Float32Array(9));
   * ```
   */
  public matrix3x3(address: bigint): Float32Array;
  public matrix3x3(address: bigint, values: Float32Array): this;
  public matrix3x3(address: bigint, values?: Float32Array): Float32Array | this {
    if (values === undefined) {
      const scratch = new Float32Array(0x09);

      this.read(address, scratch);

      return scratch;
    }

    if (values.length !== 0x09) {
      throw new RangeError('values.length must be 9.');
    }

    this.write(address, values);

    return this;
  }

  /**
   * Reads or writes a 3x4 matrix (Float32Array of length 12).
   * @param address Address to access.
   * @param values Optional Float32Array to write.
   * @returns The matrix at address, or this instance if writing.
   * @example
   * ```ts
   * const cs2 = new Memory('cs2.exe');
   * const myMatrix = cs2.matrix3x4(0x12345678n);
   * cs2.matrix3x4(0x12345678n, new Float32Array(12));
   * ```
   */
  public matrix3x4(address: bigint): Float32Array;
  public matrix3x4(address: bigint, values: Float32Array): this;
  public matrix3x4(address: bigint, values?: Float32Array): Float32Array | this {
    if (values === undefined) {
      const scratch = new Float32Array(0x0c);

      this.read(address, scratch);

      return scratch;
    }

    if (values.length !== 0x0c) {
      throw new RangeError('values.length must be 12.');
    }

    this.write(address, values);

    return this;
  }

  /**
   * Reads or writes a 4x4 matrix (Float32Array of length 16).
   * @param address Address to access.
   * @param values Optional Float32Array to write.
   * @returns The matrix at address, or this instance if writing.
   * @example
   * ```ts
   * const cs2 = new Memory('cs2.exe');
   * const myMatrix = cs2.matrix4x4(0x12345678n);
   * cs2.matrix4x4(0x12345678n, new Float32Array(16));
   * ```
   */
  public matrix4x4(address: bigint): Float32Array;
  public matrix4x4(address: bigint, values: Float32Array): this;
  public matrix4x4(address: bigint, values?: Float32Array): Float32Array | this {
    if (values === undefined) {
      const scratch = new Float32Array(0x10);

      this.read(address, scratch);

      return scratch;
    }

    if (values.length !== 0x10) {
      throw new RangeError('values.length must be 16.');
    }

    this.write(address, values);

    return this;
  }

  /**
   * Reads or writes a NetworkUtlVector (Uint32Array).
   * @param address Address to access.
   * @param values Optional Uint32Array to write.
   * @returns The vector at address, or this instance if writing.
   * @example
   * ```ts
   * const cs2 = new Memory('cs2.exe');
   * const myVector = cs2.networkUtlVector(0x12345678n);
   * cs2.networkUtlVector(0x12345678n, new Uint32Array([1,2,3]));
   * ```
   */
  public networkUtlVector(address: bigint): NetworkUtlVector;
  public networkUtlVector(address: bigint, values: NetworkUtlVector): this;
  public networkUtlVector(address: bigint, values?: NetworkUtlVector): NetworkUtlVector | this {
    const elementsPtr = this.u64(address + 0x08n);

    if (values === undefined) {
      const size = this.u32(address);

      const scratch = new Uint32Array(size);

      this.read(elementsPtr, scratch);

      return scratch;
    }

    this.u32(address, values.length);

    this.write(elementsPtr, values);

    return this;
  }

  /**
   * Reads or writes a Point (object with x, y).
   * @param address Address to access.
   * @param value Optional Point to write.
   * @returns The point at address, or this instance if writing.
   * @example
   * ```ts
   * const cs2 = new Memory('cs2.exe');
   * const myPoint = cs2.point(0x12345678n);
   * cs2.point(0x12345678n, { x: 1, y: 2 });
   * ```
   */
  public point(address: bigint): Point;
  public point(address: bigint, value: Point): this;
  public point(address: bigint, value?: Point): Point | this {
    const Scratch8Float32Array = this.Scratch8Float32Array;

    if (value === undefined) {
      this.read(address, Scratch8Float32Array);

      const x = Scratch8Float32Array[0x00],
            y = Scratch8Float32Array[0x01]; // prettier-ignore

      return { x, y };
    }

    Scratch8Float32Array[0x00] = value.x;
    Scratch8Float32Array[0x01] = value.y;

    this.write(address, Scratch8Float32Array);

    return this;
  }

  /**
   * Reads or writes an array of Points.
   * @param address Address to access.
   * @param lengthOrValues Length to read or array to write.
   * @returns Array of points read or this instance if writing.
   * @example
   * ```ts
   * const cs2 = new Memory('cs2.exe');
   * const myPoints = cs2.pointArray(0x12345678n, 2);
   * cs2.pointArray(0x12345678n, [{ x: 1, y: 2 }, { x: 3, y: 4 }]);
   * ```
   */
  public pointArray(address: bigint, length: number): Point[];
  public pointArray(address: bigint, value: Point[]): this;
  public pointArray(address: bigint, lengthOrValues: number | Point[]): Point[] | this {
    if (typeof lengthOrValues === 'number') {
      const length = lengthOrValues;
      const scratch = new Float32Array(length * 2);

      this.read(address, scratch);

      const result = new Array<Vector2>(length);

      for (let i = 0, j = 0; i < length; i++, j += 0x02) {
        const x = scratch[j];
        const y = scratch[j + 0x01];

        result[i] = { x, y };
      }

      return result;
    }

    const values = lengthOrValues;
    const scratch = new Float32Array(values.length * 0x02);

    for (let i = 0, j = 0; i < values.length; i++, j += 0x02) {
      const vector2 = values[i];

      scratch[j] = vector2.x;
      scratch[j + 0x01] = vector2.y;
    }

    this.write(address, scratch);

    return this;
  }

  public pointRaw(address: bigint): Float32Array;
  public pointRaw(address: bigint, values: Float32Array): this;
  public pointRaw(address: bigint, values?: Float32Array): Float32Array | this {
    if (values === undefined) {
      return this.f32Array(address, 0x02);
    }

    if (values.length !== 0x02) {
      throw new RangeError('values.length must be 2.');
    }

    this.write(address, values);

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
  public qAngle(address: bigint, value: QAngle): this;
  public qAngle(address: bigint, value?: QAngle): QAngle | this {
    const Scratch12Float32Array = this.Scratch12Float32Array;

    if (value === undefined) {
      this.read(address, Scratch12Float32Array);

      const pitch = Scratch12Float32Array[0x00],
            roll  = Scratch12Float32Array[0x02],
            yaw   = Scratch12Float32Array[0x01]; // prettier-ignore

      return { pitch, roll, yaw };
    }

    Scratch12Float32Array[0x00] = value.pitch;
    Scratch12Float32Array[0x02] = value.roll;
    Scratch12Float32Array[0x01] = value.yaw;

    this.write(address, Scratch12Float32Array);

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
  public qAngleArray(address: bigint, values: QAngle[]): this;
  public qAngleArray(address: bigint, lengthOrValues: QAngle[] | number): QAngle[] | this {
    if (typeof lengthOrValues === 'number') {
      const length = lengthOrValues;
      const scratch = new Float32Array(length * 0x03);

      this.read(address, scratch);

      const result = new Array<QAngle>(length);

      for (let i = 0, j = 0; i < length; i++, j += 0x03) {
        const pitch = scratch[j];
        const yaw = scratch[j + 0x01];
        const roll = scratch[j + 0x02];

        result[i] = { pitch, yaw, roll };
      }

      return result;
    }

    const values = lengthOrValues;
    const scratch = new Float32Array(values.length * 0x03);

    for (let i = 0, j = 0; i < values.length; i++, j += 0x03) {
      const qAngle = values[i];

      scratch[j] = qAngle.pitch;
      scratch[j + 0x02] = qAngle.roll;
      scratch[j + 0x01] = qAngle.yaw;
    }

    this.write(address, scratch);

    return this;
  }

  /**
   * Reads or writes a raw QAngle as a Float32Array.
   * @param address Address to access.
   * @param values Optional Float32Array to write.
   * @returns Float32Array read or this instance if writing.
   * @example
   * ```ts
   * const cs2 = new Memory('cs2.exe');
   * const raw = cs2.qAngleRaw(0x12345678n);
   * cs2.qAngleRaw(0x12345678n, new Float32Array([1,2,3]));
   * ```
   */
  public qAngleRaw(address: bigint): Float32Array;
  public qAngleRaw(address: bigint, values: Float32Array): this;
  public qAngleRaw(address: bigint, values?: Float32Array): Float32Array | this {
    if (values === undefined) {
      return this.f32Array(address, 0x03);
    }

    if (values.length !== 0x03) {
      throw new RangeError('values.length must be 3.');
    }

    this.write(address, values);

    return this;
  }

  /**
   * Reads or writes a Quaternion (object with w, x, y, z).
   * @param address Address to access.
   * @param value Optional Quaternion to write.
   * @returns The Quaternion at address, or this instance if writing.
   * @example
   * ```ts
   * const cs2 = new Memory('cs2.exe');
   * const myQuaternion = cs2.quaternion(0x12345678n);
   * cs2.quaternion(0x12345678n, { w: 1, x: 0, y: 0, z: 0 });
   * ```
   */
  public quaternion(address: bigint): Quaternion;
  public quaternion(address: bigint, value: Quaternion): this;
  public quaternion(address: bigint, value?: Quaternion): Quaternion | this {
    const Scratch16Float32Array = this.Scratch16Float32Array;

    if (value === undefined) {
      this.read(address, Scratch16Float32Array);

      const w = Scratch16Float32Array[0x03],
            x = Scratch16Float32Array[0x00],
            y = Scratch16Float32Array[0x01],
            z = Scratch16Float32Array[0x02]; // prettier-ignore

      return { w, x, y, z };
    }

    Scratch16Float32Array[0x03] = value.w;
    Scratch16Float32Array[0x00] = value.x;
    Scratch16Float32Array[0x01] = value.y;
    Scratch16Float32Array[0x02] = value.z;

    this.write(address, Scratch16Float32Array);

    return this;
  }

  /**
   * Reads or writes an array of Quaternions.
   * @param address Address to access.
   * @param lengthOrValues Length to read or array to write.
   * @returns Array of Quaternions read or this instance if writing.
   * @example
   * ```ts
   * const cs2 = new Memory('cs2.exe');
   * const myQuaternions = cs2.quaternionArray(0x12345678n, 2);
   * cs2.quaternionArray(0x12345678n, [{ w: 1, x: 0, y: 0, z: 0 }]);
   * ```
   */
  public quaternionArray(address: bigint, length: number): Quaternion[];
  public quaternionArray(address: bigint, values: Quaternion[]): this;
  public quaternionArray(address: bigint, lengthOrValues: Quaternion[] | number): Quaternion[] | this {
    if (typeof lengthOrValues === 'number') {
      const length = lengthOrValues;
      const scratch = new Float32Array(length * 0x04); // 4 * f32 per Quaternion

      this.read(address, scratch);

      const result = new Array<Quaternion>(length);

      for (let i = 0, j = 0; i < length; i++, j += 0x04) {
        const w = scratch[j + 0x03];
        const x = scratch[j];
        const y = scratch[j + 0x01];
        const z = scratch[j + 0x02];

        result[i] = { w, x, y, z };
      }

      return result;
    }

    const values = lengthOrValues;
    const scratch = new Float32Array(values.length * 0x04);

    for (let i = 0, j = 0; i < values.length; i++, j += 0x04) {
      const quaternion = values[i];

      scratch[j + 0x03] = quaternion.w;
      scratch[j] = quaternion.x;
      scratch[j + 0x01] = quaternion.y;
      scratch[j + 0x02] = quaternion.z;
    }

    this.write(address, scratch);

    return this;
  }

  /**
   * Reads or writes a raw Quaternion as a Float32Array.
   * @param address Address to access.
   * @param values Optional Float32Array to write.
   * @returns Float32Array read or this instance if writing.
   * @example
   * ```ts
   * const cs2 = new Memory('cs2.exe');
   * const raw = cs2.quaternionRaw(0x12345678n);
   * cs2.quaternionRaw(0x12345678n, new Float32Array([1,0,0,0]));
   * ```
   */
  public quaternionRaw(address: bigint): Float32Array;
  public quaternionRaw(address: bigint, values: Float32Array): this;
  public quaternionRaw(address: bigint, values?: Float32Array): Float32Array | this {
    if (values === undefined) {
      return this.f32Array(address, 0x04);
    }

    if (values.length !== 0x04) {
      throw new RangeError('values.length must be 4.');
    }

    this.write(address, values);

    return this;
  }

  /**
   * Reads or writes an RGB color (object with r, g, b).
   * @param address Address to access.
   * @param value Optional RGB to write.
   * @returns The RGB at address, or this instance if writing.
   * @example
   * ```ts
   * const cs2 = new Memory('cs2.exe');
   * const myRGB = cs2.rgb(0x12345678n);
   * cs2.rgb(0x12345678n, { r: 255, g: 0, b: 0 });
   * ```
   */
  public rgb(address: bigint): RGB;
  public rgb(address: bigint, value: RGB): this;
  public rgb(address: bigint, value?: RGB): RGB | this {
    const Scratch3 = this.Scratch3;

    if (value === undefined) {
      this.read(address, Scratch3);

      const r = Scratch3[0x00],
            g = Scratch3[0x01],
            b = Scratch3[0x02]; // prettier-ignore

      return { r, g, b };
    }

    Scratch3[0x00] = value.r;
    Scratch3[0x01] = value.g;
    Scratch3[0x02] = value.b;

    return this.write(address, Scratch3);
  }

  /**
   * Reads or writes a raw RGB value as a Uint8Array.
   * @param address Address to access.
   * @param values Optional buffer to write.
   * @returns Uint8Array read or this instance if writing.
   * @example
   * ```ts
   * const cs2 = new Memory('cs2.exe');
   * const raw = cs2.rgbRaw(0x12345678n);
   * cs2.rgbRaw(0x12345678n, new Uint8Array([255,0,0]));
   * ```
   */
  public rgbRaw(address: bigint): Uint8Array;
  public rgbRaw(address: bigint, values: Buffer | Uint8Array | Uint8ClampedArray): this;
  public rgbRaw(address: bigint, values?: Buffer | Uint8Array | Uint8ClampedArray): Uint8Array | this {
    if (values === undefined) {
      return this.u8Array(address, 0x03);
    }

    if (values.length !== 0x03) {
      throw new RangeError('values.length must be 3.');
    }

    this.write(address, values);

    return this;
  }

  /**
   * Reads or writes an RGBA color (object with r, g, b, a).
   * @param address Address to access.
   * @param value Optional RGBA to write.
   * @returns The RGBA at address, or this instance if writing.
   * @example
   * ```ts
   * const cs2 = new Memory('cs2.exe');
   * const myRGBA = cs2.rgba(0x12345678n);
   * cs2.rgba(0x12345678n, { r: 255, g: 0, b: 0, a: 255 });
   * ```
   */
  public rgba(address: bigint): RGBA;
  public rgba(address: bigint, value: RGBA): this;
  public rgba(address: bigint, value?: RGBA): RGBA | this {
    const Scratch4 = this.Scratch4;

    if (value === undefined) {
      this.read(address, Scratch4);

      const r = Scratch4[0x00],
            g = Scratch4[0x01],
            b = Scratch4[0x02],
            a = Scratch4[0x03]; // prettier-ignore

      return { r, g, b, a };
    }

    Scratch4[0x00] = value.r;
    Scratch4[0x01] = value.g;
    Scratch4[0x02] = value.b;
    Scratch4[0x03] = value.a;

    return this.write(address, Scratch4);
  }

  /**
   * Reads or writes a raw RGBA value as a Uint8Array.
   * @param address Address to access.
   * @param values Optional buffer to write.
   * @returns Uint8Array read or this instance if writing.
   * @example
   * ```ts
   * const cs2 = new Memory('cs2.exe');
   * const raw = cs2.rgbaRaw(0x12345678n);
   * cs2.rgbaRaw(0x12345678n, new Uint8Array([255,0,0,255]));
   * ```
   */
  public rgbaRaw(address: bigint): Uint8Array;
  public rgbaRaw(address: bigint, values: Buffer | Uint8Array | Uint8ClampedArray): this;
  public rgbaRaw(address: bigint, values?: Buffer | Uint8Array | Uint8ClampedArray): Uint8Array | this {
    if (values === undefined) {
      return this.u8Array(address, 0x04);
    }

    if (values.length !== 0x04) {
      throw new RangeError('values.length must be 4.');
    }

    this.write(address, values);

    return this;
  }

  /**
   * Reads or writes a 16-bit unsigned integer.
   * @param address Address to access.
   * @param value Optional value to write.
   * @returns The value at address, or this instance if writing.
   * @example
   * ```ts
   * const cs2 = new Memory('cs2.exe');
   * const myInt = cs2.u16(0x12345678n);
   * cs2.u16(0x12345678n, 42);
   * ```
   */
  public u16(address: bigint): number;
  public u16(address: bigint, value: number): this;
  public u16(address: bigint, value?: number): number | this {
    const Scratch2Uint16Array = this.Scratch2Uint16Array;

    if (value === undefined) {
      return this.read(address, Scratch2Uint16Array)[0x00];
    }

    Scratch2Uint16Array[0x00] = value;

    this.write(address, Scratch2Uint16Array);

    return this;
  }

  /**
   * Reads or writes a Uint16Array.
   * @param address Address to access.
   * @param lengthOrValues Length to read or Uint16Array to write.
   * @returns Uint16Array read or this instance if writing.
   * @example
   * ```ts
   * const cs2 = new Memory('cs2.exe');
   * const myArray = cs2.u16Array(0x12345678n, 2);
   * cs2.u16Array(0x12345678n, new Uint16Array([1,2]));
   * ```
   */
  public u16Array(address: bigint, length: number): Uint16Array;
  public u16Array(address: bigint, values: Uint16Array): this;
  public u16Array(address: bigint, lengthOrValues: Uint16Array | number): Uint16Array | this {
    if (typeof lengthOrValues === 'number') {
      const length = lengthOrValues;
      const scratch = new Uint16Array(length);

      this.read(address, scratch);

      return scratch;
    }

    const values = lengthOrValues;

    this.write(address, values);

    return this;
  }

  /**
   * Reads or writes a 32-bit unsigned integer.
   * @param address Address to access.
   * @param value Optional value to write.
   * @returns The value at address, or this instance if writing.
   * @example
   * ```ts
   * const cs2 = new Memory('cs2.exe');
   * const myInt = cs2.u32(0x12345678n);
   * cs2.u32(0x12345678n, 42);
   * ```
   */
  public u32(address: bigint): number;
  public u32(address: bigint, value: number): this;
  public u32(address: bigint, value?: number): number | this {
    const Scratch4Uint32Array = this.Scratch4Uint32Array;

    if (value === undefined) {
      return this.read(address, Scratch4Uint32Array)[0x00];
    }

    Scratch4Uint32Array[0x00] = value;

    this.write(address, Scratch4Uint32Array);

    return this;
  }

  /**
   * Reads or writes a Uint32Array.
   * @param address Address to access.
   * @param lengthOrValues Length to read or Uint32Array to write.
   * @returns Uint32Array read or this instance if writing.
   * @example
   * ```ts
   * const cs2 = new Memory('cs2.exe');
   * const myArray = cs2.u32Array(0x12345678n, 2);
   * cs2.u32Array(0x12345678n, new Uint32Array([1,2]));
   * ```
   */
  public u32Array(address: bigint, length: number): Uint32Array;
  public u32Array(address: bigint, values: Uint32Array): this;
  public u32Array(address: bigint, lengthOrValues: Uint32Array | number): Uint32Array | this {
    if (typeof lengthOrValues === 'number') {
      const length = lengthOrValues;
      const scratch = new Uint32Array(length);

      this.read(address, scratch);

      return scratch;
    }

    const values = lengthOrValues;

    this.write(address, values);

    return this;
  }

  /**
   * Reads or writes a 64-bit unsigned integer.
   * @param address Address to access.
   * @param value Optional value to write.
   * @returns The bigint at address, or this instance if writing.
   * @example
   * ```ts
   * const cs2 = new Memory('cs2.exe');
   * const myBigInt = cs2.u64(0x12345678n);
   * cs2.u64(0x12345678n, 123n);
   * ```
   */
  public u64(address: bigint): bigint;
  public u64(address: bigint, value: bigint): this;
  public u64(address: bigint, value?: bigint): bigint | this {
    const Scratch8BigUint64Array = this.Scratch8BigUint64Array;

    if (value === undefined) {
      return this.read(address, Scratch8BigUint64Array)[0x00];
    }

    Scratch8BigUint64Array[0x00] = value;

    this.write(address, Scratch8BigUint64Array);

    return this;
  }

  /**
   * Reads or writes a BigUint64Array.
   * @param address Address to access.
   * @param lengthOrValues Length to read or BigUint64Array to write.
   * @returns BigUint64Array read or this instance if writing.
   * @example
   * ```ts
   * const cs2 = new Memory('cs2.exe');
   * const myArray = cs2.u64Array(0x12345678n, 2);
   * cs2.u64Array(0x12345678n, new BigUint64Array([1n,2n]));
   * ```
   */
  public u64Array(address: bigint, length: number): BigUint64Array;
  public u64Array(address: bigint, values: BigUint64Array): this;
  public u64Array(address: bigint, lengthOrValues: BigUint64Array | number): BigUint64Array | this {
    if (typeof lengthOrValues === 'number') {
      const length = lengthOrValues;
      const scratch = new BigUint64Array(length);

      this.read(address, scratch);

      return scratch;
    }

    const values = lengthOrValues;

    this.write(address, values);

    return this;
  }

  /**
   * Reads or writes an 8-bit unsigned integer.
   * @param address Address to access.
   * @param value Optional value to write.
   * @returns The value at address, or this instance if writing.
   * @example
   * ```ts
   * const cs2 = new Memory('cs2.exe');
   * const myInt = cs2.u8(0x12345678n);
   * cs2.u8(0x12345678n, 7);
   * ```
   */
  public u8(address: bigint): number;
  public u8(address: bigint, value: number): this;
  public u8(address: bigint, value?: number): number | this {
    const Scratch1 = this.Scratch1;

    if (value === undefined) {
      return this.read(address, Scratch1)[0x00];
    }

    Scratch1[0x00] = value;

    this.write(address, Scratch1);

    return this;
  }

  /**
   * Reads or writes a Uint8Array.
   * @param address Address to access.
   * @param lengthOrValues Length to read or Uint8Array to write.
   * @returns Uint8Array read or this instance if writing.
   * @example
   * ```ts
   * const cs2 = new Memory('cs2.exe');
   * const myArray = cs2.u8Array(0x12345678n, 2);
   * cs2.u8Array(0x12345678n, new Uint8Array([1,2]));
   * ```
   */
  public u8Array(address: bigint, length: number): Uint8Array;
  public u8Array(address: bigint, values: Uint8Array): this;
  public u8Array(address: bigint, lengthOrValues: Uint8Array | number): Uint8Array | this {
    if (typeof lengthOrValues === 'number') {
      const length = lengthOrValues;
      const scratch = new Uint8Array(length);

      this.read(address, scratch);

      return scratch;
    }

    const values = lengthOrValues;

    this.write(address, values);

    return this;
  }

  /**
   * Reads or writes a pointer-sized unsigned integer.
   * @param address Address to access.
   * @param value Optional value to write.
   * @returns The value at address, or this instance if writing.
   * @example
   * ```ts
   * const cs2 = new Memory('cs2.exe');
   * const myPtr = cs2.uPtr(0x12345678n);
   * cs2.uPtr(0x12345678n, 123n);
   * ```
   */
  public uPtr(address: bigint): UPtr;
  public uPtr(address: bigint, value: UPtr): this;
  public uPtr(address: bigint, value?: UPtr): UPtr | this {
    // TypeScript is funny sometimes, isn't it?… 🫠…
    if (value === undefined) {
      return this.u64(address);
    }

    return this.u64(address, value);
  }

  /**
   * Reads or writes an array of pointer-sized unsigned integers.
   * @param address Address to access.
   * @param lengthOrValues Length to read or array to write.
   * @returns Array read or this instance if writing.
   * @example
   * ```ts
   * const cs2 = new Memory('cs2.exe');
   * const myPtrs = cs2.uPtrArray(0x12345678n, 2);
   * cs2.uPtrArray(0x12345678n, new BigUint64Array([1n,2n]));
   * ```
   */
  public uPtrArray(address: bigint, length: number): UPtrArray;
  public uPtrArray(address: bigint, values: UPtrArray): this;
  public uPtrArray(address: bigint, lengthOrValues: UPtrArray | number): UPtrArray | this {
    // TypeScript is funny sometimes, isn't it?… 🫠…
    if (typeof lengthOrValues === 'number') {
      return this.u64Array(address, lengthOrValues);
    }

    return this.u64Array(address, lengthOrValues);
  }

  /**
   * Reads or writes a Vector2 (object with x, y).
   * @param address Address to access.
   * @param value Optional Vector2 to write.
   * @returns The Vector2 at address, or this instance if writing.
   * @example
   * ```ts
   * const cs2 = new Memory('cs2.exe');
   * const myVector2 = cs2.vector2(0x12345678n);
   * cs2.vector2(0x12345678n, { x: 1, y: 2 });
   * ```
   */
  public vector2(address: bigint): Vector2;
  public vector2(address: bigint, value: Vector2): this;
  public vector2(address: bigint, value?: Vector2): Vector2 | this {
    // TypeScript is funny sometimes, isn't it?… 🫠…
    if (value === undefined) {
      return this.point(address);
    }

    return this.point(address, value);
  }

  /**
   * Reads or writes an array of Vector2.
   * @param address Address to access.
   * @param lengthOrValues Length to read or array to write.
   * @returns Array of Vector2 read or this instance if writing.
   * @example
   * ```ts
   * const cs2 = new Memory('cs2.exe');
   * const myVectors = cs2.vector2Array(0x12345678n, 2);
   * cs2.vector2Array(0x12345678n, [{ x: 1, y: 2 }, { x: 3, y: 4 }]);
   * ```
   */
  public vector2Array(address: bigint, length: number): Vector2[];
  public vector2Array(address: bigint, values: Vector2[]): this;
  public vector2Array(address: bigint, lengthOrValues: Vector2[] | number): Vector2[] | this {
    // TypeScript is funny sometimes, isn't it?… 🫠…
    if (typeof lengthOrValues === 'number') {
      return this.pointArray(address, lengthOrValues);
    }

    return this.pointArray(address, lengthOrValues);
  }

  public vector2Raw(address: bigint): Float32Array;
  public vector2Raw(address: bigint, values: Float32Array): this;
  public vector2Raw(address: bigint, values?: Float32Array): Float32Array | this {
    if (values === undefined) {
      return this.f32Array(address, 0x02);
    }

    if (values.length !== 0x02) {
      throw new RangeError('values.length must be 2.');
    }

    this.write(address, values);

    return this;
  }

  /**
   * Reads or writes a Vector3 (object with x, y, z).
   * @param address Address to access.
   * @param value Optional Vector3 to write.
   * @returns The Vector3 at address, or this instance if writing.
   * @example
   * ```ts
   * const cs2 = new Memory('cs2.exe');
   * const myVector3 = cs2.vector3(0x12345678n);
   * cs2.vector3(0x12345678n, { x: 1, y: 2, z: 3 });
   * ```
   */
  public vector3(address: bigint): Vector3;
  public vector3(address: bigint, value: Vector3): this;
  public vector3(address: bigint, value?: Vector3): Vector3 | this {
    const Scratch12Float32Array = this.Scratch12Float32Array;

    if (value === undefined) {
      this.read(address, Scratch12Float32Array);

      const x = Scratch12Float32Array[0x00],
            y = Scratch12Float32Array[0x01],
            z = Scratch12Float32Array[0x02]; // prettier-ignore

      return { x, y, z };
    }

    Scratch12Float32Array[0x00] = value.x;
    Scratch12Float32Array[0x01] = value.y;
    Scratch12Float32Array[0x02] = value.z;

    this.write(address, Scratch12Float32Array);

    return this;
  }

  /**
   * Reads or writes an array of Vector3.
   * @param address Address to access.
   * @param lengthOrValues Length to read or array to write.
   * @returns Array of Vector3 read or this instance if writing.
   * @example
   * ```ts
   * const cs2 = new Memory('cs2.exe');
   * const myVectors = cs2.vector3Array(0x12345678n, 2);
   * cs2.vector3Array(0x12345678n, [{ x: 1, y: 2, z: 3 }]);
   * ```
   */
  public vector3Array(address: bigint, length: number): Vector3[];
  public vector3Array(address: bigint, values: Vector3[]): this;
  public vector3Array(address: bigint, lengthOrValues: Vector3[] | number): Vector3[] | this {
    if (typeof lengthOrValues === 'number') {
      const length = lengthOrValues;
      const scratch = new Float32Array(length * 0x03);

      this.read(address, scratch);

      const result = new Array<Vector3>(length);

      for (let i = 0, j = 0; i < length; i++, j += 0x03) {
        const x = scratch[j];
        const y = scratch[j + 0x01];
        const z = scratch[j + 0x02];

        result[i] = { x, y, z };
      }

      return result;
    }

    const values = lengthOrValues;
    const scratch = new Float32Array(values.length * 0x03);

    for (let i = 0, j = 0; i < values.length; i++, j += 0x03) {
      const vector3 = values[i];

      scratch[j] = vector3.x;
      scratch[j + 0x01] = vector3.y;
      scratch[j + 0x02] = vector3.z;
    }

    this.write(address, scratch);

    return this;
  }

  public vector3Raw(address: bigint): Float32Array;
  public vector3Raw(address: bigint, values: Float32Array): this;
  public vector3Raw(address: bigint, values?: Float32Array): Float32Array | this {
    if (values === undefined) {
      return this.f32Array(address, 0x03);
    }

    if (values.length !== 0x03) {
      throw new RangeError('values.length must be 3.');
    }

    this.write(address, values);

    return this;
  }

  /**
   * Reads or writes a Vector4 (object with w, x, y, z).
   * @param address Address to access.
   * @param value Optional Vector4 to write.
   * @returns The Vector4 at address, or this instance if writing.
   * @example
   * ```ts
   * const cs2 = new Memory('cs2.exe');
   * const myVector4 = cs2.vector4(0x12345678n);
   * cs2.vector4(0x12345678n, { w: 1, x: 0, y: 0, z: 0 });
   * ```
   */
  public vector4(address: bigint): Vector4;
  public vector4(address: bigint, value: Vector4): this;
  public vector4(address: bigint, value?: Vector4): Vector4 | this {
    // TypeScript is funny sometimes, isn't it?… 🫠…
    if (value === undefined) {
      return this.quaternion(address);
    }

    return this.quaternion(address, value);
  }

  /**
   * Reads or writes an array of Vector4.
   * @param address Address to access.
   * @param lengthOrValues Length to read or array to write.
   * @returns Array of Vector4 read or this instance if writing.
   * @example
   * ```ts
   * const cs2 = new Memory('cs2.exe');
   * const myVectors = cs2.vector4Array(0x12345678n, 2);
   * cs2.vector4Array(0x12345678n, [{ w: 1, x: 0, y: 0, z: 0 }]);
   * ```
   */
  public vector4Array(address: bigint, length: number): Vector4[];
  public vector4Array(address: bigint, values: Vector4[]): this;
  public vector4Array(address: bigint, lengthOrValues: Vector4[] | number): Vector4[] | this {
    // TypeScript is funny sometimes, isn't it?… 🫠…
    if (typeof lengthOrValues === 'number') {
      return this.quaternionArray(address, lengthOrValues);
    }

    return this.quaternionArray(address, lengthOrValues);
  }

  public vector4Raw(address: bigint): Float32Array;
  public vector4Raw(address: bigint, values: Float32Array): this;
  public vector4Raw(address: bigint, values?: Float32Array): Float32Array | this {
    if (values === undefined) {
      return this.f32Array(address, 0x04);
    }

    if (values.length !== 0x04) {
      throw new RangeError('values.length must be 4.');
    }

    this.write(address, values);

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
    const last = offsets.length - 1;

    for (let i = 0; i < last; i++) {
      address = this.u64(address + offsets[i]);

      if (address === 0n) {
        return -1n;
      }
    }

    return address + (offsets[last] ?? 0n);
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
    const test = Memory.Patterns.Test.test(needle);

    if (!test) {
      return !all ? -1n : [];
    }

    // The RegExp test ensures that we have at least one token…

    const tokens = [...needle.matchAll(Memory.Patterns.MatchAll)]
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
