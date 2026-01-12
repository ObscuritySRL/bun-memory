import { dlopen, FFIType } from 'bun:ffi';

const { symbols: Kernel32 } = dlopen('kernel32.dll', {
  FormatMessageW: { args: [FFIType.u32, FFIType.u64, FFIType.u32, FFIType.u32, FFIType.ptr, FFIType.u32, FFIType.u64], returns: FFIType.u32 },
});

/**
 * Represents a Windows (Win32) system error.
 *
 * Extends Error to provide formatted Win32 error messages using FormatMessageW.
 *
 * @example
 * ```ts
 * import Win32Error from './Win32Error';
 * throw new Win32Error('OpenProcess', 5);
 * ```
 */
class Win32Error extends Error {
  /**
   * Win32 error code.
   * @example
   * ```ts
   * if (error instanceof Win32Error) {
   *   console.log(error.code);
   * }
   * ```
   */
  public readonly code: number;

  /**
   * Name of the failed operation.
   * @example
   * ```ts
   * if (error instanceof Win32Error) {
   *   console.log(error.what);
   * }
   * ```
   */
  public readonly what: string;

  /**
   * Creates a new Win32Error with a formatted message.
   * @param what Name of the failed operation (e.g., "OpenProcess").
   * @param code Win32 error code.
   * @example
   * ```ts
   * throw new Win32Error('CreateFileW', 2);
   * ```
   */
  constructor(what: string, code: number) {
    let message = Win32Error.formatMessageWCache.get(code);

    if (message === undefined) {
      const dwFlags = 0x00001000 /* FORMAT_MESSAGE_FROM_SYSTEM */ | 0x00000200; /* FORMAT_MESSAGE_IGNORE_INSERTS */
      const dwMessageId = code >>> 0;
      const lpBuffer = Win32Error.scratch4096;
      const nSize = lpBuffer.byteLength / 2;

      const tChars = Kernel32.FormatMessageW(dwFlags, 0n, dwMessageId, 0, lpBuffer, nSize, 0n);

      message =
        tChars !== 0
          ? lpBuffer
              .toString('utf16le', 0, tChars * 2)
              .replaceAll(/(\r?\n)+/g, ' ')
              .trim()
          : 'Unknown error';

      Win32Error.formatMessageWCache.set(code, message);
    }

    super(`${what} failed (${code}): ${message!}`);

    this.code = code;
    this.name = 'Win32Error';
    this.what = what;

    Error.captureStackTrace?.(this, Win32Error);
  }

  /**
   * Cache of formatted error messages by code.
   * @private
   */
  private static readonly formatMessageWCache = new Map<number, string>();

  /**
   * Static buffer for FormatMessageW calls.
   * @private
   */
  private static readonly scratch4096 = Buffer.allocUnsafe(4_096);
}

export default Win32Error;
