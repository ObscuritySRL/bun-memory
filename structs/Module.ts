import type Process from './Process';

/**
 * Represents a loaded module in a process.
 *
 * @example
 * ```ts
 * const cs2 = new Process('cs2.exe');
 * const client = cs2.module('client.dll');
 * console.log(client.modBaseAddr, client.modBaseSize, client.szExePath);
 * ```
 */
class Module {
  /**
   * Creates a new Module instance.
   * @param process Parent process instance.
   * @param hModule Module handle.
   * @param modBaseAddr Base address of the module.
   * @param modBaseSize Module size in bytes.
   * @param szExePath Full path to the module.
   * @param szModule Module filename.
   */
  constructor(
    public readonly process: Process,
    public readonly hModule: bigint,
    public readonly modBaseAddr: bigint,
    public readonly modBaseSize: number,
    public readonly szExePath: string,
    public readonly szModule: string,
  ) {
    this.modEndAddr = modBaseAddr + BigInt(modBaseSize);
  }

  /**
   * End address of the module (modBaseAddr + modBaseSize).
   */
  public readonly modEndAddr: bigint;
}

export default Module;
