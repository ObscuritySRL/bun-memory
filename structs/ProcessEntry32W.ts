import { Buffer } from 'node:buffer';

import { type Pointer, ptr } from 'bun:ffi';

import Kernel32, { ToolhelpSnapshotFlags } from '@bun-win32/kernel32';

import Win32Error from './Win32Error';

const { CloseHandle, CreateToolhelp32Snapshot, GetLastError, Process32FirstW, Process32NextW } = Kernel32;

/**
 * Typed view over a 568-byte PROCESSENTRY32W buffer (x64).
 *
 * When constructed without a buffer, allocates its own and initializes
 * dwSize (reusable across Process32FirstW / Process32NextW calls).
 * When constructed with a buffer, caches properties on first access.
 *
 * @example
 * ```ts
 * const lppe = new ProcessEntry32W();
 * Process32FirstW(hSnapshot, lppe.ptr);
 * console.log(lppe.szExeFile, lppe.th32ProcessID);
 * ```
 */
class ProcessEntry32W {
  public readonly buffer: Buffer;
  public readonly ptr: Pointer;

  readonly #cached: boolean;

  #cntThreads?: number;
  #cntUsage?: number;
  #dwFlags?: number;
  #dwSize?: number;
  #pcPriClassBase?: number;
  #szExeFile?: string;
  #th32DefaultHeapID?: bigint;
  #th32ModuleID?: number;
  #th32ParentProcessID?: number;
  #th32ProcessID?: number;

  constructor(buffer?: Buffer) {
    this.#cached = !!buffer;

    this.buffer = buffer ?? Buffer.allocUnsafe(0x238);
    this.ptr = ptr(this.buffer);

    if (!buffer) {
      this.buffer.writeUInt32LE(0x238);
    }
  }

  get cntThreads(): number {
    return this.#cached ? (this.#cntThreads ??= this.buffer.readUInt32LE(0x1c)) : this.buffer.readUInt32LE(0x1c);
  }

  get cntUsage(): number {
    return this.#cached ? (this.#cntUsage ??= this.buffer.readUInt32LE(0x04)) : this.buffer.readUInt32LE(0x04);
  }

  get dwFlags(): number {
    return this.#cached ? (this.#dwFlags ??= this.buffer.readUInt32LE(0x28)) : this.buffer.readUInt32LE(0x28);
  }

  get dwSize(): number {
    return this.#cached ? (this.#dwSize ??= this.buffer.readUInt32LE(0x00)) : this.buffer.readUInt32LE(0x00);
  }

  get pcPriClassBase(): number {
    return this.#cached ? (this.#pcPriClassBase ??= this.buffer.readInt32LE(0x24)) : this.buffer.readInt32LE(0x24);
  }

  get szExeFile(): string {
    if (this.#cached && this.#szExeFile !== undefined) return this.#szExeFile;

    const raw = this.buffer.toString('utf16le', 0x2c, 0x234);
    const nullIndex = raw.indexOf('\0');
    const value = nullIndex === -1 ? raw : raw.slice(0, nullIndex);

    if (this.#cached) this.#szExeFile = value;

    return value;
  }

  get th32DefaultHeapID(): bigint {
    return this.#cached ? (this.#th32DefaultHeapID ??= this.buffer.readBigUInt64LE(0x10)) : this.buffer.readBigUInt64LE(0x10);
  }

  get th32ModuleID(): number {
    return this.#cached ? (this.#th32ModuleID ??= this.buffer.readUInt32LE(0x18)) : this.buffer.readUInt32LE(0x18);
  }

  get th32ParentProcessID(): number {
    return this.#cached ? (this.#th32ParentProcessID ??= this.buffer.readUInt32LE(0x20)) : this.buffer.readUInt32LE(0x20);
  }

  get th32ProcessID(): number {
    return this.#cached ? (this.#th32ProcessID ??= this.buffer.readUInt32LE(0x08)) : this.buffer.readUInt32LE(0x08);
  }

  static *snapshot(): Generator<ProcessEntry32W> {
    const dwFlags = ToolhelpSnapshotFlags.TH32CS_SNAPPROCESS;

    const hSnapshot = CreateToolhelp32Snapshot(dwFlags, 0);

    if (hSnapshot === -1n) {
      throw new Win32Error('CreateToolhelp32Snapshot', GetLastError());
    }

    try {
      const lppe = new ProcessEntry32W();

      const bProcess32FirstW = Process32FirstW(hSnapshot, lppe.ptr);

      if (!bProcess32FirstW) {
        throw new Win32Error('Process32FirstW', GetLastError());
      }

      do {
        yield new ProcessEntry32W(Buffer.from(lppe.buffer));
      } while (Process32NextW(hSnapshot, lppe.ptr));
    } finally {
      CloseHandle(hSnapshot);
    }
  }
}

export default ProcessEntry32W;
export { ProcessEntry32W };
