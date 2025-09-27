// TODO: Reintroduce findPattern(…)…
// TODO: Reintroduce indexOf(…)…
// TODO: String methods…

import { CString, FFIType, dlopen, read } from 'bun:ffi';

import type { Module, NetworkUtlVector, Quaternion, Region, Scratch, Vector2, Vector3 } from '../types/Memory';
import Win32Error from './Win32Error';

const { f32, f64, i16, i32, i64, i8, u16, u32, u64, u8 } = read;

/**
 * Kernel32 Windows API functions imported via Foreign Function Interface (FFI).
 * These functions provide low-level access to process and memory management operations.
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
  ReadProcessMemory: { args: [FFIType.u64, FFIType.u64, FFIType.ptr, FFIType.u64_fast, FFIType.ptr], returns: FFIType.bool },
  VirtualProtectEx: { args: [FFIType.u64, FFIType.u64, FFIType.u64, FFIType.u32, FFIType.ptr], returns: FFIType.bool },
  VirtualQueryEx: { args: [FFIType.u64, FFIType.u64, FFIType.ptr, FFIType.u64], returns: FFIType.u64 },
  WriteProcessMemory: { args: [FFIType.u64, FFIType.u64, FFIType.ptr, FFIType.u64_fast, FFIType.ptr], returns: FFIType.bool },
});

/**
 * Memory class provides cross-process memory manipulation capabilities on Windows systems.
 * This class allows reading from and writing to memory addresses in external processes,
 * supporting various data types including primitives, arrays, and custom structures like vectors and quaternions.
 *
 * @example
 * ```typescript
 * // Connect to a process by name
 * const memory = new Memory('notepad.exe');
 *
 * // Connect to a process by ID
 * const memory = new Memory(1234);
 *
 * // Read a 32-bit integer from memory
 * const value = memory.i32(0x12345678n);
 *
 * // Write a float to memory
 * memory.f32(0x12345678n, 3.14159);
 *
 * // Clean up when done
 * memory.close();
 * ```
 */
class Memory {
  /**
   * Creates a new Memory instance and attaches to the specified process.
   *
   * @param identifier - Either a process ID (number) or process name (string)
   * @throws {Win32Error} When process operations fail
   * @throws {Error} When the specified process is not found
   *
   * @example
   * ```typescript
   * // Attach to process by name
   * const memory = new Memory('calculator.exe');
   *
   * // Attach to process by ID
   * const memory = new Memory(5432);
   * ```
   */
  constructor(identifier: number | string) {
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
      const th32ProcessID = lppe.readUInt32LE(0x08);

      if (
        (typeof identifier === 'number' && identifier !== th32ProcessID) || //
        (typeof identifier === 'string' && identifier !== szExeFile)
      ) {
        continue;
      }

      const desiredAccess = 0x001f0fff; /* PROCESS_ALL_ACCESS */
      const inheritHandle = false;

      const hProcess = Kernel32.OpenProcess(desiredAccess, inheritHandle, th32ProcessID);

      if (hProcess === 0n) {
        Kernel32.CloseHandle(hSnapshot);

        throw new Win32Error('OpenProcess', Kernel32.GetLastError());
      }

      this._modules = {};
      this.hProcess = hProcess;
      this.th32ProcessID = th32ProcessID;

      this.refresh();

      Kernel32.CloseHandle(hSnapshot);

      return;
    } while (Kernel32.Process32NextW(hSnapshot, lppe));

    Kernel32.CloseHandle(hSnapshot);

    throw new Error(`Process not found: ${identifier}…`);
  }

  /**
   * Memory protection constants used for determining safe memory regions.
   * Safe regions can be read from or written to, while unsafe regions should be avoided.
   */
  private static readonly MemoryProtections = {
    Safe: 0x10 /* PAGE_EXECUTE */ | 0x20 /* PAGE_EXECUTE_READ */ | 0x40 /* PAGE_EXECUTE_READWRITE */ | 0x80 /* PAGE_EXECUTE_WRITECOPY */ | 0x02 /* PAGE_READONLY */ | 0x04 /* PAGE_READWRITE */ | 0x08 /* PAGE_WRITECOPY */,
    Unsafe: 0x100 /* PAGE_GUARD */ | 0x01 /* PAGE_NOACCESS */,
  };

  /**
   * Internal storage for loaded modules information.
   */
  private _modules: { [key: string]: Module };

  /**
   * Pre-allocated scratch buffers for memory operations to avoid repeated allocations.
   * These buffers are reused across multiple read/write operations for performance.
   */
  private readonly Scratch1 = new Uint8Array(0x01);
  private readonly Scratch2 = new Uint8Array(0x02);
  private readonly Scratch4 = new Uint8Array(0x04);
  private readonly Scratch8 = new Uint8Array(0x08);
  private readonly Scratch12 = new Uint8Array(0x0c);
  private readonly Scratch16 = new Uint8Array(0x10);

  /**
   * Buffer views of the scratch arrays for easier data manipulation.
   */
  private readonly Scratch1Buffer = Buffer.from(this.Scratch1.buffer, this.Scratch1.byteOffset, this.Scratch1.byteLength);
  private readonly Scratch2Buffer = Buffer.from(this.Scratch2.buffer, this.Scratch2.byteOffset, this.Scratch2.byteLength);
  private readonly Scratch4Buffer = Buffer.from(this.Scratch4.buffer, this.Scratch4.byteOffset, this.Scratch4.byteLength);
  private readonly Scratch8Buffer = Buffer.from(this.Scratch8.buffer, this.Scratch8.byteOffset, this.Scratch8.byteLength);
  private readonly Scratch12Buffer = Buffer.from(this.Scratch12.buffer, this.Scratch12.byteOffset, this.Scratch12.byteLength);
  private readonly Scratch16Buffer = Buffer.from(this.Scratch16.buffer, this.Scratch16.byteOffset, this.Scratch16.byteLength);

  /**
   * Scratch buffers for Windows API structures.
   */
  private readonly ScratchMemoryBasicInformation = Buffer.allocUnsafe(0x30 /* sizeof(MEMORY_BASIC_INFORMATION) */);
  private readonly ScratchModuleEntry32W = Buffer.allocUnsafe(0x438 /* sizeof(MODULEENTRY32W) */);

  private static readonly TextDecoderUTF16 = new TextDecoder('utf-16');
  private static readonly TextDecoderUTF8 = new TextDecoder('utf-8');

  /**
   * Handle to the target process.
   */
  private readonly hProcess: bigint;

  /**
   * Process ID of the target process.
   */
  private readonly th32ProcessID: number;

  /**
   * Gets the loaded modules for the target process.
   *
   * @returns A frozen object containing module information indexed by module name
   *
   * @example
   * ```typescript
   * const modules = memory.modules;
   *
   * // Access a specific module
   * const mainModule = modules['notepad.exe'];
   * console.log(`Base address: 0x${mainModule.base.toString(16)}`);
   * console.log(`Size: ${mainModule.size} bytes`);
   * ```
   */
  public get modules(): Memory['_modules'] {
    return this._modules;
  }

  // Internal methods

  /**
   * Retrieves memory region information for a specified address range.
   * This method queries the virtual memory layout to identify safe regions for memory operations.
   *
   * @param address - Starting memory address
   * @param length - Length of the memory range to query
   * @returns Array of Region objects describing the memory layout
   * @throws {Win32Error} When memory query operations fail
   *
   * @example
   * ```typescript
   * const regions = memory.regions(0x10000000n, 0x1000n);
   *
   * regions.forEach(region => {
   *   console.log(`Region: 0x${region.base.toString(16)} - Size: ${region.size}`);
   * });
   * ```
   */
  private regions(address: bigint, length: bigint | number): Region[] {
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

  // Core memory operations

  /**
   * Reads data from the target process memory into a scratch buffer.
   * This is a low-level method used internally by the typed read methods.
   *
   * @param address - Memory address to read from
   * @param scratch - Buffer to store the read data
   * @returns This Memory instance for method chaining
   * @throws {Win32Error} When the read operation fails
   *
   * @todo Research what it will take to add CString to the Scratch type.
   *
   * @example
   * ```typescript
   * const buffer = new Uint8Array(4);
   * memory.read(0x12345678n, buffer);
   * ```
   */
  public read(address: bigint, scratch: Scratch): this {
    const lpBaseAddress = address;
    const lpBuffer = scratch.ptr;
    const nSize = scratch.byteLength;
    const numberOfBytesRead = 0x00n;

    const bReadProcessMemory = Kernel32.ReadProcessMemory(this.hProcess, lpBaseAddress, lpBuffer, nSize, numberOfBytesRead);

    if (!bReadProcessMemory) {
      throw new Win32Error('ReadProcessMemory', Kernel32.GetLastError());
    }

    return this;
  }

  /**
   * Writes data from a scratch buffer to the target process memory.
   * This is a low-level method used internally by the typed write methods.
   *
   * @param address - Memory address to write to
   * @param scratch - Buffer containing the data to write
   * @throws {Win32Error} When the write operation fails
   *
   * @example
   * ```typescript
   * const buffer = new Uint8Array([0x41, 0x42, 0x43, 0x44]);
   * memory.write(0x12345678n, buffer);
   * ```
   */
  private write(address: bigint, scratch: Scratch): void {
    const lpBaseAddress = address;
    const lpBuffer = scratch.ptr;
    const nSize = scratch.byteLength;
    const numberOfBytesWritten = 0x00n;

    const WriteProcessMemory = Kernel32.WriteProcessMemory(this.hProcess, lpBaseAddress, lpBuffer, nSize, numberOfBytesWritten);

    if (!WriteProcessMemory) {
      throw new Win32Error('WriteProcessMemory', Kernel32.GetLastError());
    }

    return;
  }

  // Public utility methods

  /**
   * Closes the handle to the target process and releases resources.
   * This method should be called when the Memory instance is no longer needed.
   *
   * @example
   * ```typescript
   * const memory = new Memory('notepad.exe');
   * // ... perform memory operations
   * memory.close(); // Clean up resources
   * ```
   */
  public close(): void {
    Kernel32.CloseHandle(this.hProcess);

    return;
  }

  /**
   * Refreshes the list of modules loaded in the target process.
   * This method should be called if modules are loaded or unloaded during runtime.
   *
   * @throws {Win32Error} When module enumeration fails
   *
   * @example
   * ```typescript
   * // Initial modules
   * console.log('Initial modules:', Object.keys(memory.modules));
   *
   * // After some time, refresh to get updated module list
   * memory.refresh();
   * console.log('Updated modules:', Object.keys(memory.modules));
   * ```
   */
  public refresh(): void {
    const dwFlags = 0x00000008 /* TH32CS_SNAPMODULE */ | 0x00000010; /* TH32CS_SNAPMODULE32 */

    const hSnapshot = Kernel32.CreateToolhelp32Snapshot(dwFlags, this.th32ProcessID)!;

    if (hSnapshot === -1n) {
      throw new Win32Error('CreateToolhelp32Snapshot', Kernel32.GetLastError());
    }

    this.ScratchModuleEntry32W.writeUInt32LE(0x438 /* sizeof(MODULEENTRY32W) */);

    const lpme = this.ScratchModuleEntry32W;

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

      modules[szModule] = Object.freeze({ base: modBaseAddr, name: szModule, size: modBaseSize });
    } while (Kernel32.Module32NextW(hSnapshot, lpme));

    Kernel32.CloseHandle(hSnapshot);

    this._modules = Object.freeze(modules);

    return;
  }

  // Typed read/write methods

  /**
   * Reads a boolean value from memory or writes a boolean value to memory.
   *
   * @param address - Memory address to read from or write to
   * @param value - Optional value to write. If omitted, performs a read operation
   * @returns The boolean value when reading, or this Memory instance when writing
   *
   * @example
   * ```typescript
   * // Read a boolean value
   * const isAlive = memory.bool(0x12345678n);
   * console.log('Player is alive:', isAlive);
   *
   * // Write a boolean value
   * memory.bool(0x12345678n, true);
   * ```
   */
  public bool(address: bigint): boolean;
  public bool(address: bigint, value: boolean): this;
  public bool(address: bigint, value?: boolean): boolean | this {
    if (value === undefined) {
      this.read(address, this.Scratch1);

      return u8(this.Scratch1.ptr) !== 0;
    }

    this.Scratch1Buffer.writeUInt8(+value);

    this.write(address, this.Scratch1);

    return this;
  }

  /**
   * Reads a NUL-terminated C string from memory or writes a NUL-terminated C string to memory.
   *
   * When reading, up to `length` bytes are copied into a temporary buffer and a `CString`
   * is constructed from that buffer. Ensure the requested `length` is large enough to
   * include the terminator to avoid truncation. When writing, pass a `CString` that is
   * already NUL-terminated.
   *
   * @param address - Memory address to read from or write to
   * @param lengthOrValue - Number of bytes to read (when reading), or `CString` to write (when writing)
   * @returns `CString` when reading, or this `Memory` instance when writing
   *
   * @todo Investigate odd behavior when reading strings longer than `lengthOrValue`.
   * @todo Research and consider alternatives that do not require so many new allocations.
   *
   * @example
   * ```typescript
   * // Read up to 64 bytes and interpret as a C string
   * const playerName = memory.cString(0x12345678n, 64);
   * console.log('Player name:', playerName.toString());
   *
   * // Write a C string (NUL-terminated)
   * const valueBuffer = Buffer.from('PlayerOne\0');
   * const valuePtr = ptr(valueBuffer);
   * const value = new CString(valuePtr);
   * memory.cString(0x12345678n, value);
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
   * Reads a 32-bit floating-point value from memory or writes a 32-bit floating-point value to memory.
   *
   * @param address - Memory address to read from or write to
   * @param value - Optional value to write. If omitted, performs a read operation
   * @returns The float value when reading, or this Memory instance when writing
   *
   * @example
   * ```typescript
   * // Read a float value
   * const playerHealth = memory.f32(0x12345678n);
   * console.log('Player health:', playerHealth);
   *
   * // Write a float value
   * memory.f32(0x12345678n, 100.0);
   * ```
   */
  public f32(address: bigint): number;
  public f32(address: bigint, value: number): this;
  public f32(address: bigint, value?: number): number | this {
    if (value === undefined) {
      this.read(address, this.Scratch4);

      return f32(this.Scratch4.ptr);
    }

    this.Scratch4Buffer.writeFloatLE(value);

    this.write(address, this.Scratch4);

    return this;
  }

  /**
   * Reads an array of 32-bit floating-point values from memory or writes an array of 32-bit floating-point values to memory.
   *
   * @param address - Memory address to read from or write to
   * @param lengthOrValues - Length of array to read, or array of values to write
   * @returns Float32Array when reading, or this Memory instance when writing
   *
   * @example
   * ```typescript
   * // Read an array of 10 float values
   * const coordinates = memory.f32Array(0x12345678n, 10);
   * console.log('Coordinates:', coordinates);
   *
   * // Write an array of float values
   * const newCoordinates = new Float32Array([1.0, 2.5, 3.14, 4.2]);
   * memory.f32Array(0x12345678n, newCoordinates);
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
   * Reads a 64-bit floating-point value from memory or writes a 64-bit floating-point value to memory.
   *
   * @param address - Memory address to read from or write to
   * @param value - Optional value to write. If omitted, performs a read operation
   * @returns The double value when reading, or this Memory instance when writing
   *
   * @example
   * ```typescript
   * // Read a double precision value
   * const preciseValue = memory.f64(0x12345678n);
   * console.log('Precise value:', preciseValue);
   *
   * // Write a double precision value
   * memory.f64(0x12345678n, 3.141592653589793);
   * ```
   */
  public f64(address: bigint): number;
  public f64(address: bigint, value: number): this;
  public f64(address: bigint, value?: number): number | this {
    if (value === undefined) {
      this.read(address, this.Scratch8);

      return f64(this.Scratch8.ptr);
    }

    this.Scratch8Buffer.writeDoubleLE(value);

    this.write(address, this.Scratch8);

    return this;
  }

  /**
   * Reads an array of 64-bit floating-point values from memory or writes an array of 64-bit floating-point values to memory.
   *
   * @param address - Memory address to read from or write to
   * @param lengthOrValues - Length of array to read, or array of values to write
   * @returns Float64Array when reading, or this Memory instance when writing
   *
   * @example
   * ```typescript
   * // Read an array of 5 double precision values
   * const preciseData = memory.f64Array(0x12345678n, 5);
   * console.log('Precise data:', preciseData);
   *
   * // Write an array of double precision values
   * const newData = new Float64Array([1.1, 2.2, 3.3, 4.4, 5.5]);
   * memory.f64Array(0x12345678n, newData);
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
   * Reads a signed 16-bit integer value from memory or writes a signed 16-bit integer value to memory.
   *
   * @param address - Memory address to read from or write to
   * @param value - Optional value to write. If omitted, performs a read operation
   * @returns The int16 value when reading, or this Memory instance when writing
   *
   * @example
   * ```typescript
   * // Read a signed 16-bit integer
   * const temperature = memory.i16(0x12345678n);
   * console.log('Temperature:', temperature);
   *
   * // Write a signed 16-bit integer
   * memory.i16(0x12345678n, -273);
   * ```
   */
  public i16(address: bigint): number;
  public i16(address: bigint, value: number): this;
  public i16(address: bigint, value?: number): number | this {
    if (value === undefined) {
      this.read(address, this.Scratch2);

      return i16(this.Scratch2.ptr);
    }

    this.Scratch2Buffer.writeInt16LE(value);

    this.write(address, this.Scratch2);

    return this;
  }

  /**
   * Reads an array of signed 16-bit integer values from memory or writes an array of signed 16-bit integer values to memory.
   *
   * @param address - Memory address to read from or write to
   * @param lengthOrValues - Length of array to read, or array of values to write
   * @returns Int16Array when reading, or this Memory instance when writing
   *
   * @example
   * ```typescript
   * // Read an array of audio samples
   * const samples = memory.i16Array(0x12345678n, 1024);
   * console.log('Audio samples:', samples);
   *
   * // Write audio samples
   * const newSamples = new Int16Array([-100, 200, -300, 400]);
   * memory.i16Array(0x12345678n, newSamples);
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
   * Reads a signed 32-bit integer value from memory or writes a signed 32-bit integer value to memory.
   *
   * @param address - Memory address to read from or write to
   * @param value - Optional value to write. If omitted, performs a read operation
   * @returns The int32 value when reading, or this Memory instance when writing
   *
   * @example
   * ```typescript
   * // Read a player's score
   * const score = memory.i32(0x12345678n);
   * console.log('Player score:', score);
   *
   * // Set a new score
   * memory.i32(0x12345678n, 999999);
   * ```
   */
  public i32(address: bigint): number;
  public i32(address: bigint, value: number): this;
  public i32(address: bigint, value?: number): number | this {
    if (value === undefined) {
      this.read(address, this.Scratch4);

      return i32(this.Scratch4.ptr);
    }

    this.Scratch4Buffer.writeInt32LE(value);

    this.write(address, this.Scratch4);

    return this;
  }

  /**
   * Reads an array of signed 32-bit integer values from memory or writes an array of signed 32-bit integer values to memory.
   *
   * @param address - Memory address to read from or write to
   * @param lengthOrValues - Length of array to read, or array of values to write
   * @returns Int32Array when reading, or this Memory instance when writing
   *
   * @example
   * ```typescript
   * // Read inventory item counts
   * const inventory = memory.i32Array(0x12345678n, 20);
   * console.log('Inventory:', inventory);
   *
   * // Set inventory values
   * const newInventory = new Int32Array([99, 50, 25, 10, 5]);
   * memory.i32Array(0x12345678n, newInventory);
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
   * Reads a signed 64-bit integer value from memory or writes a signed 64-bit integer value to memory.
   *
   * @param address - Memory address to read from or write to
   * @param value - Optional value to write. If omitted, performs a read operation
   * @returns The int64 value when reading, or this Memory instance when writing
   *
   * @example
   * ```typescript
   * // Read a large number (timestamp, file size, etc.)
   * const timestamp = memory.i64(0x12345678n);
   * console.log('Timestamp:', timestamp);
   *
   * // Write a large number
   * memory.i64(0x12345678n, 9223372036854775807n);
   * ```
   */
  public i64(address: bigint): bigint;
  public i64(address: bigint, value: bigint): this;
  public i64(address: bigint, value?: bigint): bigint | this {
    if (value === undefined) {
      this.read(address, this.Scratch8);

      return i64(this.Scratch8.ptr);
    }

    this.Scratch8Buffer.writeBigInt64LE(value);

    this.write(address, this.Scratch8);

    return this;
  }

  /**
   * Reads an array of signed 64-bit integer values from memory or writes an array of signed 64-bit integer values to memory.
   *
   * @param address - Memory address to read from or write to
   * @param lengthOrValues - Length of array to read, or array of values to write
   * @returns BigInt64Array when reading, or this Memory instance when writing
   *
   * @example
   * ```typescript
   * // Read an array of large numbers
   * const largeNumbers = memory.i64Array(0x12345678n, 10);
   * console.log('Large numbers:', largeNumbers);
   *
   * // Write an array of large numbers
   * const newNumbers = new BigInt64Array([1n, 2n, 3n, 4n, 5n]);
   * memory.i64Array(0x12345678n, newNumbers);
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
   * Reads a signed 8-bit integer value from memory or writes a signed 8-bit integer value to memory.
   *
   * @param address - Memory address to read from or write to
   * @param value - Optional value to write. If omitted, performs a read operation
   * @returns The int8 value when reading, or this Memory instance when writing
   *
   * @example
   * ```typescript
   * // Read a small signed value (e.g., direction, state)
   * const direction = memory.i8(0x12345678n);
   * console.log('Direction:', direction);
   *
   * // Write a small signed value
   * memory.i8(0x12345678n, -127);
   * ```
   */
  public i8(address: bigint): number;
  public i8(address: bigint, value: number): this;
  public i8(address: bigint, value?: number): number | this {
    if (value === undefined) {
      this.read(address, this.Scratch1);

      return i8(this.Scratch1.ptr);
    }

    this.Scratch1Buffer.writeInt8(value);

    this.write(address, this.Scratch1);

    return this;
  }

  /**
   * Reads an array of signed 8-bit integer values from memory or writes an array of signed 8-bit integer values to memory.
   *
   * @param address - Memory address to read from or write to
   * @param lengthOrValues - Length of array to read, or array of values to write
   * @returns Int8Array when reading, or this Memory instance when writing
   *
   * @example
   * ```typescript
   * // Read an array of small signed values
   * const directions = memory.i8Array(0x12345678n, 8);
   * console.log('Movement directions:', directions);
   *
   * // Write movement directions
   * const newDirections = new Int8Array([-1, 0, 1, -1, 0, 1, -1, 0]);
   * memory.i8Array(0x12345678n, newDirections);
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
   * Reads a 3×3 matrix from memory or writes a 3×3 matrix to memory.
   *
   * The matrix is represented as 9 contiguous 32-bit floating-point values (`Float32Array`).
   * No transposition or stride is applied—values are copied exactly as stored in memory.
   *
   * @param address - Memory address to read from or write to
   * @param values - Optional `Float32Array` of length 9 to write. If omitted, performs a read operation
   * @returns `Float32Array` of length 9 when reading, or this `Memory` instance when writing
   * @throws {RangeError} When `values.length` is not exactly 9
   *
   * @example
   * ```typescript
   * // Read a 3×3 matrix
   * const matrix = memory.matrix3x3(0x12345678n); // Float32Array(9)
   *
   * // Write a 3×3 matrix (length must be 9)
   * const next = new Float32Array([
   *   1, 0, 0,
   *   0, 1, 0,
   *   0, 0, 1
   * ]);
   * memory.matrix3x3(0x12345678n, next);
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
   * Reads a 4×4 matrix from memory or writes a 4×4 matrix to memory.
   *
   * The matrix is represented as 16 contiguous 32-bit floating-point values (`Float32Array`).
   * No transposition or stride is applied—values are copied exactly as stored in memory.
   *
   * @param address - Memory address to read from or write to
   * @param values - Optional `Float32Array` of length 16 to write. If omitted, performs a read operation
   * @returns `Float32Array` of length 16 when reading, or this `Memory` instance when writing
   * @throws {RangeError} When `values.length` is not exactly 16
   *
   * @example
   * ```typescript
   * // Read a 4×4 matrix
   * const matrix = memory.matrix4x4(0x12345678n); // Float32Array(16)
   *
   * // Write a 4×4 matrix (length must be 16)
   * const next = new Float32Array([
   *   1, 0, 0, 0,
   *   0, 1, 0, 0,
   *   0, 0, 1, 0,
   *   0, 0, 0, 1
   * ]);
   * memory.matrix4x4(0x12345678n, next);
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
   * Reads a `NetworkUtlVector` (`Uint32Array`) from memory or writes a `NetworkUtlVector` to memory.
   *
   * The vector is represented in memory as a small header with an out-of-line elements buffer.
   * Layout at `address`:
   * - 0x00: `uint32` size (number of elements)
   * - 0x04: `uint32` capacity/reserved (not modified by this method)
   * - 0x08: `uint64` pointer to a contiguous array of `uint32` elements
   *
   * When reading, this method returns a `Uint32Array` containing `size` elements copied from the
   * elements pointer. When writing, it updates the size field and writes the provided values to the
   * existing elements buffer (no reallocation is performed).
   *
   * @param address - Memory address of the vector header to read from or write to
   * @param values - Optional `NetworkUtlVector` to write. If omitted, performs a read operation
   * @returns `NetworkUtlVector` when reading, or this `Memory` instance when writing
   *
   * @example
   * ```typescript
   * // Read the current vector
   * const ids = memory.networkUtlVector(0x12345678n);
   * console.log('IDs:', Array.from(ids));
   *
   * // Write new values (must fit the existing buffer capacity)
   * const next = new Uint32Array([10, 20, 30, 40]);
   * memory.networkUtlVector(0x12345678n, next);
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
   * Reads a quaternion (4D rotation) from memory or writes a quaternion to memory.
   * Quaternions are stored as four 32-bit floats: x, y, z, w.
   *
   * @param address - Memory address to read from or write to
   * @param value - Optional quaternion to write. If omitted, performs a read operation
   * @returns The Quaternion object when reading, or this Memory instance when writing
   *
   * @example
   * ```typescript
   * // Read player rotation
   * const rotation = memory.quaternion(0x12345678n);
   * console.log('Player rotation:', rotation);
   *
   * // Set player rotation to identity
   * memory.quaternion(0x12345678n, { x: 0, y: 0, z: 0, w: 1 });
   * ```
   */
  public quaternion(address: bigint): Quaternion;
  public quaternion(address: bigint, value: Quaternion): this;
  public quaternion(address: bigint, value?: Quaternion): Quaternion | this {
    if (value === undefined) {
      this.read(address, this.Scratch16);

      const w = f32(this.Scratch16.ptr, 0x0c);
      const x = f32(this.Scratch16.ptr);
      const y = f32(this.Scratch16.ptr, 0x04);
      const z = f32(this.Scratch16.ptr, 0x08);

      return { w, x, y, z };
    }

    this.Scratch16Buffer.writeFloatLE(value.w, 0x0c);
    this.Scratch16Buffer.writeFloatLE(value.x);
    this.Scratch16Buffer.writeFloatLE(value.y, 0x04);
    this.Scratch16Buffer.writeFloatLE(value.z, 0x08);

    this.write(address, this.Scratch16);

    return this;
  }

  /**
   * Reads an array of quaternions from memory or writes an array of quaternions to memory.
   *
   * @param address - Memory address to read from or write to
   * @param lengthOrValues - Length of array to read, or array of quaternions to write
   * @returns Array of Quaternion objects when reading, or this Memory instance when writing
   *
   * @example
   * ```typescript
   * // Read bone rotations for skeletal animation
   * const boneRotations = memory.quaternionArray(0x12345678n, 50);
   * console.log('Bone rotations:', boneRotations);
   *
   * // Set all bones to identity rotation
   * const identityRotations = Array(50).fill({ x: 0, y: 0, z: 0, w: 1 });
   * memory.quaternionArray(0x12345678n, identityRotations);
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
   * Reads an unsigned 16-bit integer value from memory or writes an unsigned 16-bit integer value to memory.
   *
   * @param address - Memory address to read from or write to
   * @param value - Optional value to write. If omitted, performs a read operation
   * @returns The uint16 value when reading, or this Memory instance when writing
   *
   * @example
   * ```typescript
   * // Read a port number or small positive value
   * const port = memory.u16(0x12345678n);
   * console.log('Network port:', port);
   *
   * // Write a port number
   * memory.u16(0x12345678n, 8080);
   * ```
   */
  public u16(address: bigint): number;
  public u16(address: bigint, value: number): this;
  public u16(address: bigint, value?: number): number | this {
    if (value === undefined) {
      this.read(address, this.Scratch2);

      return u16(this.Scratch2.ptr);
    }

    this.Scratch2Buffer.writeUInt16LE(value);

    this.write(address, this.Scratch2);

    return this;
  }

  /**
   * Reads an array of unsigned 16-bit integer values from memory or writes an array of unsigned 16-bit integer values to memory.
   *
   * @param address - Memory address to read from or write to
   * @param lengthOrValues - Length of array to read, or array of values to write
   * @returns Uint16Array when reading, or this Memory instance when writing
   *
   * @example
   * ```typescript
   * // Read an array of port numbers
   * const ports = memory.u16Array(0x12345678n, 10);
   * console.log('Active ports:', ports);
   *
   * // Write port configuration
   * const newPorts = new Uint16Array([80, 443, 8080, 3000, 5432]);
   * memory.u16Array(0x12345678n, newPorts);
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
   * Reads an unsigned 32-bit integer value from memory or writes an unsigned 32-bit integer value to memory.
   *
   * @param address - Memory address to read from or write to
   * @param value - Optional value to write. If omitted, performs a read operation
   * @returns The uint32 value when reading, or this Memory instance when writing
   *
   * @example
   * ```typescript
   * // Read player's money (always positive)
   * const money = memory.u32(0x12345678n);
   * console.log('Player money:', money);
   *
   * // Give player maximum money
   * memory.u32(0x12345678n, 4294967295);
   * ```
   */
  public u32(address: bigint): number;
  public u32(address: bigint, value: number): this;
  public u32(address: bigint, value?: number): number | this {
    if (value === undefined) {
      this.read(address, this.Scratch4);

      return u32(this.Scratch4.ptr);
    }

    this.Scratch4Buffer.writeUInt32LE(value);

    this.write(address, this.Scratch4);

    return this;
  }

  /**
   * Reads an array of unsigned 32-bit integer values from memory or writes an array of unsigned 32-bit integer values to memory.
   *
   * @param address - Memory address to read from or write to
   * @param lengthOrValues - Length of array to read, or array of values to write
   * @returns Uint32Array when reading, or this Memory instance when writing
   *
   * @example
   * ```typescript
   * // Read resource amounts
   * const resources = memory.u32Array(0x12345678n, 6);
   * console.log('Resources:', resources);
   *
   * // Set resource amounts
   * const newResources = new Uint32Array([1000, 2000, 3000, 4000, 5000, 6000]);
   * memory.u32Array(0x12345678n, newResources);
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
   * Reads an unsigned 64-bit integer value from memory or writes an unsigned 64-bit integer value to memory.
   *
   * @param address - Memory address to read from or write to
   * @param value - Optional value to write. If omitted, performs a read operation
   * @returns The uint64 value when reading, or this Memory instance when writing
   *
   * @example
   * ```typescript
   * // Read a very large positive number
   * const recordId = memory.u64(0x12345678n);
   * console.log('Record ID:', recordId);
   *
   * // Write a very large positive number
   * memory.u64(0x12345678n, 18446744073709551615n);
   * ```
   */
  public u64(address: bigint): bigint;
  public u64(address: bigint, value: bigint): this;
  public u64(address: bigint, value?: bigint): bigint | this {
    if (value === undefined) {
      this.read(address, this.Scratch8);

      return u64(this.Scratch8.ptr);
    }

    this.Scratch8Buffer.writeBigUInt64LE(value);

    this.write(address, this.Scratch8);

    return this;
  }

  /**
   * Reads an array of unsigned 64-bit integer values from memory or writes an array of unsigned 64-bit integer values to memory.
   *
   * @param address - Memory address to read from or write to
   * @param lengthOrValues - Length of array to read, or array of values to write
   * @returns BigUint64Array when reading, or this Memory instance when writing
   *
   * @example
   * ```typescript
   * // Read an array of record IDs
   * const recordIds = memory.u64Array(0x12345678n, 100);
   * console.log('Record IDs:', recordIds);
   *
   * // Write record IDs
   * const newIds = new BigUint64Array([1000n, 2000n, 3000n, 4000n]);
   * memory.u64Array(0x12345678n, newIds);
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
   * Reads an unsigned 8-bit integer value from memory or writes an unsigned 8-bit integer value to memory.
   *
   * @param address - Memory address to read from or write to
   * @param value - Optional value to write. If omitted, performs a read operation
   * @returns The uint8 value when reading, or this Memory instance when writing
   *
   * @example
   * ```typescript
   * // Read a byte value (0-255)
   * const opacity = memory.u8(0x12345678n);
   * console.log('UI opacity:', opacity);
   *
   * // Set opacity to maximum
   * memory.u8(0x12345678n, 255);
   * ```
   */
  public u8(address: bigint): number;
  public u8(address: bigint, value: number): this;
  public u8(address: bigint, value?: number): number | this {
    if (value === undefined) {
      this.read(address, this.Scratch1);

      return u8(this.Scratch1.ptr);
    }

    this.Scratch1Buffer.writeUInt8(value);

    this.write(address, this.Scratch1);

    return this;
  }

  /**
   * Reads an array of unsigned 8-bit integer values from memory or writes an array of unsigned 8-bit integer values to memory.
   *
   * @param address - Memory address to read from or write to
   * @param lengthOrValues - Length of array to read, or array of values to write
   * @returns Uint8Array when reading, or this Memory instance when writing
   *
   * @example
   * ```typescript
   * // Read pixel data
   * const pixels = memory.u8Array(0x12345678n, 1024);
   * console.log('Pixel data:', pixels);
   *
   * // Write pixel data
   * const newPixels = new Uint8Array([255, 128, 64, 32, 16, 8, 4, 2]);
   * memory.u8Array(0x12345678n, newPixels);
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
   * Reads a 2D vector from memory or writes a 2D vector to memory.
   * Vectors are stored as two 32-bit floats: x, y.
   *
   * @param address - Memory address to read from or write to
   * @param value - Optional vector to write. If omitted, performs a read operation
   * @returns The Vector2 object when reading, or this Memory instance when writing
   *
   * @example
   * ```typescript
   * // Read player position
   * const position = memory.vector2(0x12345678n);
   * console.log('Player position:', position);
   *
   * // Teleport player to origin
   * memory.vector2(0x12345678n, { x: 0, y: 0 });
   * ```
   */
  public vector2(address: bigint): Vector2;
  public vector2(address: bigint, value: Vector2): this;
  public vector2(address: bigint, value?: Vector2): Vector2 | this {
    if (value === undefined) {
      this.read(address, this.Scratch8);

      const x = f32(this.Scratch8.ptr);
      const y = f32(this.Scratch8.ptr, 0x04);

      return { x, y };
    }

    this.Scratch8Buffer.writeFloatLE(value.x);
    this.Scratch8Buffer.writeFloatLE(value.y, 0x04);

    this.write(address, this.Scratch8);

    return this;
  }

  /**
   * Reads an array of 2D vectors from memory or writes an array of 2D vectors to memory.
   *
   * @param address - Memory address to read from or write to
   * @param lengthOrValues - Length of array to read, or array of vectors to write
   * @returns Array of Vector2 objects when reading, or this Memory instance when writing
   *
   * @example
   * ```typescript
   * // Read waypoints for AI pathfinding
   * const waypoints = memory.vector2Array(0x12345678n, 20);
   * console.log('AI waypoints:', waypoints);
   *
   * // Set new waypoints
   * const newWaypoints = [
   *   { x: 10, y: 20 },
   *   { x: 30, y: 40 },
   *   { x: 50, y: 60 }
   * ];
   * memory.vector2Array(0x12345678n, newWaypoints);
   * ```
   */
  public vector2Array(address: bigint, length: number): Vector2[];
  public vector2Array(address: bigint, values: Vector2[]): this;
  public vector2Array(address: bigint, lengthOrValues: Vector2[] | number): Vector2[] | this {
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

  /**
   * Reads a 3D vector from memory or writes a 3D vector to memory.
   * Vectors are stored as three 32-bit floats: x, y, z.
   *
   * @param address - Memory address to read from or write to
   * @param value - Optional vector to write. If omitted, performs a read operation
   * @returns The Vector3 object when reading, or this Memory instance when writing
   *
   * @example
   * ```typescript
   * // Read player 3D position
   * const position = memory.vector3(0x12345678n);
   * console.log('Player 3D position:', position);
   *
   * // Teleport player to specific location
   * memory.vector3(0x12345678n, { x: 100, y: 50, z: 200 });
   * ```
   */
  public vector3(address: bigint): Vector3;
  public vector3(address: bigint, value: Vector3): this;
  public vector3(address: bigint, value?: Vector3): Vector3 | this {
    if (value === undefined) {
      this.read(address, this.Scratch12);

      const x = f32(this.Scratch12.ptr);
      const y = f32(this.Scratch12.ptr, 0x04);
      const z = f32(this.Scratch12.ptr, 0x08);

      return { x, y, z };
    }

    this.Scratch12Buffer.writeFloatLE(value.x);
    this.Scratch12Buffer.writeFloatLE(value.y, 0x04);
    this.Scratch12Buffer.writeFloatLE(value.z, 0x08);

    this.write(address, this.Scratch12);

    return this;
  }

  /**
   * Reads an array of 3D vectors from memory or writes an array of 3D vectors to memory.
   *
   * @param address - Memory address to read from or write to
   * @param lengthOrValues - Length of array to read, or array of vectors to write
   * @returns Array of Vector3 objects when reading, or this Memory instance when writing
   *
   * @example
   * ```typescript
   * // Read vertex positions for 3D model
   * const vertices = memory.vector3Array(0x12345678n, 500);
   * console.log('3D vertices:', vertices);
   *
   * // Update vertex positions
   * const newVertices = [
   *   { x: 1.0, y: 0.0, z: 0.0 },
   *   { x: 0.0, y: 1.0, z: 0.0 },
   *   { x: 0.0, y: 0.0, z: 1.0 }
   * ];
   * memory.vector3Array(0x12345678n, newVertices);
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
}

export default Memory;
