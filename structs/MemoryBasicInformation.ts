import { Buffer } from 'node:buffer';

import { type Pointer, ptr } from 'bun:ffi';

import type { MemoryAllocationType, MemoryProtection } from '@bun-win32/kernel32';

/**
 * Typed view over a 48-byte MEMORY_BASIC_INFORMATION buffer (x64).
 *
 * When constructed without a buffer, allocates its own and reads
 * directly each access (reusable across VirtualQueryEx calls).
 * When constructed with a buffer, caches properties on first access.
 *
 * @example
 * ```ts
 * const mbi = new MemoryBasicInformation();
 * VirtualQueryEx(hProcess, lpAddress, mbi.ptr, 0x30n);
 * console.log(mbi.BaseAddress, mbi.RegionSize, mbi.State);
 * ```
 */
class MemoryBasicInformation {
  public readonly buffer: Buffer;
  public readonly ptr: Pointer;

  readonly #cached: boolean;

  #AllocationBase?: bigint;
  #AllocationProtect?: MemoryProtection;
  #BaseAddress?: bigint;
  #PartitionId?: number;
  #Protect?: MemoryProtection;
  #RegionSize?: bigint;
  #State?: MemoryAllocationType;
  #Type?: number;

  constructor(buffer?: Buffer) {
    this.#cached = !!buffer;

    this.buffer = buffer ?? Buffer.allocUnsafe(0x30);
    this.ptr = ptr(this.buffer);
  }

  get AllocationBase(): bigint {
    return this.#cached ? (this.#AllocationBase ??= this.buffer.readBigUInt64LE(0x08)) : this.buffer.readBigUInt64LE(0x08);
  }

  get AllocationProtect(): MemoryProtection {
    return this.#cached ? (this.#AllocationProtect ??= this.buffer.readUInt32LE(0x10)) : this.buffer.readUInt32LE(0x10);
  }

  get BaseAddress(): bigint {
    return this.#cached ? (this.#BaseAddress ??= this.buffer.readBigUInt64LE(0x00)) : this.buffer.readBigUInt64LE(0x00);
  }

  get PartitionId(): number {
    return this.#cached ? (this.#PartitionId ??= this.buffer.readUInt16LE(0x14)) : this.buffer.readUInt16LE(0x14);
  }

  get Protect(): MemoryProtection {
    return this.#cached ? (this.#Protect ??= this.buffer.readUInt32LE(0x24)) : this.buffer.readUInt32LE(0x24);
  }

  get RegionSize(): bigint {
    return this.#cached ? (this.#RegionSize ??= this.buffer.readBigUInt64LE(0x18)) : this.buffer.readBigUInt64LE(0x18);
  }

  get State(): MemoryAllocationType {
    return this.#cached ? (this.#State ??= this.buffer.readUInt32LE(0x20)) : this.buffer.readUInt32LE(0x20);
  }

  get Type(): number {
    return this.#cached ? (this.#Type ??= this.buffer.readUInt32LE(0x28)) : this.buffer.readUInt32LE(0x28);
  }
}

export default MemoryBasicInformation;
export { MemoryBasicInformation };
