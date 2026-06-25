import { Buffer } from 'node:buffer';

const ReplaceTrailingNull = /\0+$/;

/**
 * Typed view over a 1080-byte MODULEENTRY32W buffer (x64).
 *
 * Properties are lazily parsed from the buffer on first access,
 * then the getter is replaced with a direct value property.
 *
 * @example
 * ```ts
 * const cs2 = new Process('cs2.exe');
 * const client = cs2.module('client.dll');
 * console.log(client.modBaseAddr, client.modBaseSize, client.szExePath);
 * ```
 */
class Module {
  readonly #buffer: Buffer;

  constructor(buffer: Buffer) {
    this.#buffer = buffer;
  }

  get hModule(): bigint {
    const value = this.#buffer.readBigUInt64LE(0x28);

    Object.defineProperty(this, 'hModule', { configurable: false, value });

    return value;
  }

  get modBaseAddr(): bigint {
    const value = this.#buffer.readBigUInt64LE(0x18);

    Object.defineProperty(this, 'modBaseAddr', { configurable: false, value });

    return value;
  }

  get modBaseSize(): number {
    const value = this.#buffer.readUInt32LE(0x20);

    Object.defineProperty(this, 'modBaseSize', { configurable: false, value });

    return value;
  }

  get modEndAddr(): bigint {
    const value = this.modBaseAddr + BigInt(this.modBaseSize);

    Object.defineProperty(this, 'modEndAddr', { configurable: false, value });

    return value;
  }

  get szExePath(): string {
    const value = this.#buffer.toString('utf16le', 0x230, 0x438).replace(ReplaceTrailingNull, '');

    Object.defineProperty(this, 'szExePath', { configurable: false, value });

    return value;
  }

  get szModule(): string {
    const value = this.#buffer.toString('utf16le', 0x30, 0x230).replace(ReplaceTrailingNull, '');

    Object.defineProperty(this, 'szModule', { configurable: false, value });

    return value;
  }
}

export default Module;
