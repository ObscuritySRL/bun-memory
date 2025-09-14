/**
 * Win32 error helper for Bun using `bun:ffi`.
 *
 * Exposes {@link Win32Error}, an `Error` subclass that formats Windows error codes
 * using `FormatMessageW` from `kernel32.dll`. Messages are memoized for performance
 * and the resulting error string contains the failing operation, the numeric code,
 * and the human-readable description.
 *
 * For a complete list of error codes, visit…
 * https://learn.microsoft.com/en-us/windows/win32/debug/system-error-codes#system-error-codes
 *
 * @remarks
 * - Requires Windows.
 * - Requires Bun runtime (uses `bun:ffi`).
 * - Designed to be fast and allocation‑conscious.
 */

import { dlopen, FFIType } from 'bun:ffi';

/**
 * Minimal Kernel32 FFI surface used by this module.
 * Currently binds only `FormatMessageW`.
 */

const { symbols: Kernel32 } = dlopen('kernel32.dll', {
  FormatMessageW: { args: [FFIType.u32, FFIType.u64, FFIType.u32, FFIType.u32, FFIType.ptr, FFIType.u32, FFIType.u64], returns: FFIType.u32 },
});

/**
 * Error type representing a Windows (Win32) system error.
 *
 * @example
 * ```ts
 * const hSnapshot = Kernel32.CreateToolhelp32Snapshot(dwFlags, th32ProcessID);
 *
 * if(hSnapshot === -1) {
 *   // Wrap with context and the last error code you observed
 *   throw new Win32Error('CreateToolhelp32Snapshot', Kernel32.GetLastError());
 * }
 * ```
 */

class Win32Error extends Error {
  /**
   * Create a formatted Win32 error.
   *
   * @param what Name of the operation that failed (e.g., `"OpenProcess"`).
   * @param code The Win32 error code (DWORD) associated with the failure.
   * @remarks
   * The constructor formats the error message using `FormatMessageW` and memoizes
   * the message text per code to avoid repeated system calls.
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

    super(`${what} failed (${code}): ${message}`);

    this.code = code;
    this.name = 'Win32Error';
    this.what = what;

    Error.captureStackTrace?.(this, Win32Error);
  }

  /**
   * Cache of formatted messages keyed by Win32 error code to minimize FFI calls.
   * @private
   */

  private static readonly formatMessageWCache = new Map<number, string>();

  /**
   * Temporary wide‑character buffer used as the target for `FormatMessageW`.
   * Uses 4,096 bytes which is ample for typical system messages.
   * @private
   */

  private static readonly scratch4096 = Buffer.allocUnsafe(4_096);

  /**
   * The Win32 error code associated with this failure.
   */

  public readonly code: number;

  /**
   * The operation or API name that failed.
   */

  public readonly what: string;
}

export default Win32Error;
