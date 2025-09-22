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
 * - Requires Windows operating system.
 * - Requires Bun runtime environment (uses `bun:ffi`).
 * - Designed to be fast and allocation-conscious.
 *
 * @example
 * ```typescript
 * import Win32Error from './Win32Error';
 *
 * // Typical usage in error handling
 * try {
 *   const result = someWin32Operation();
 *   if (result === INVALID_HANDLE_VALUE) {
 *     throw new Win32Error('CreateFile', GetLastError());
 *   }
 * } catch (error) {
 *   if (error instanceof Win32Error) {
 *     console.log(`Operation: ${error.what}`);
 *     console.log(`Error code: ${error.code}`);
 *     console.log(`Message: ${error.message}`);
 *   }
 * }
 * ```
 */

import { dlopen, FFIType } from 'bun:ffi';

/**
 * Minimal Kernel32 Windows API functions imported via Foreign Function Interface (FFI).
 * This module only imports FormatMessageW for converting error codes to human-readable messages.
 *
 * @remarks
 * FormatMessageW is used instead of FormatMessageA to properly handle Unicode characters
 * in error messages, which is important for internationalization support.
 */
const { symbols: Kernel32 } = dlopen('kernel32.dll', {
  /**
   * FormatMessageW - Formats a message string using a message definition from a message table resource.
   *
   * @param dwFlags - Formatting options (FORMAT_MESSAGE_FROM_SYSTEM | FORMAT_MESSAGE_IGNORE_INSERTS)
   * @param lpSource - Location of the message definition (unused when FROM_SYSTEM is specified)
   * @param dwMessageId - Message identifier (Win32 error code)
   * @param dwLanguageId - Language identifier (0 for system default)
   * @param lpBuffer - Buffer to receive the formatted message
   * @param nSize - Size of the buffer in TCHARs
   * @param Arguments - Array of values for message insertion (unused with IGNORE_INSERTS)
   * @returns Number of TCHARs stored in the buffer, 0 on failure
   */
  FormatMessageW: { args: [FFIType.u32, FFIType.u64, FFIType.u32, FFIType.u32, FFIType.ptr, FFIType.u32, FFIType.u64], returns: FFIType.u32 },
});

/**
 * Error class representing a Windows (Win32) system error.
 *
 * This class extends the standard JavaScript Error class to provide enhanced
 * error reporting for Windows API failures. It automatically formats Win32
 * error codes into human-readable messages using the Windows FormatMessageW API.
 *
 * Key features:
 * - Automatic error message formatting using Windows system messages
 * - Message caching for improved performance on repeated error codes
 * - Preserves both the operation name and numeric error code
 * - Provides stack trace capture for debugging
 *
 * @example
 * ```typescript
 * // Basic usage with a Win32 API call
 * const hSnapshot = Kernel32.CreateToolhelp32Snapshot(dwFlags, th32ProcessID);
 *
 * if (hSnapshot === -1) {
 *   // Wrap with context and the last error code you observed
 *   throw new Win32Error('CreateToolhelp32Snapshot', Kernel32.GetLastError());
 * }
 * ```
 *
 * @example
 * ```typescript
 * // Error handling and inspection
 * try {
 *   const hProcess = OpenProcess(PROCESS_ALL_ACCESS, false, processId);
 *   if (hProcess === 0n) {
 *     throw new Win32Error('OpenProcess', GetLastError());
 *   }
 * } catch (error) {
 *   if (error instanceof Win32Error) {
 *     console.error(`Failed operation: ${error.what}`);
 *     console.error(`Win32 error code: ${error.code}`);
 *     console.error(`System message: ${error.message}`);
 *
 *     // Handle specific error codes
 *     switch (error.code) {
 *       case 5: // ERROR_ACCESS_DENIED
 *         console.log('Access denied - try running as administrator');
 *         break;
 *       case 87: // ERROR_INVALID_PARAMETER
 *         console.log('Invalid parameter provided to the function');
 *         break;
 *       default:
 *         console.log('Unexpected error occurred');
 *     }
 *   }
 * }
 * ```
 *
 * @example
 * ```typescript
 * // Custom error handling utility
 * function handleWin32Result<T>(
 *   result: T,
 *   invalidValue: T,
 *   operation: string,
 *   getLastError: () => number
 * ): T {
 *   if (result === invalidValue) {
 *     throw new Win32Error(operation, getLastError());
 *   }
 *   return result;
 * }
 *
 * // Usage
 * const handle = handleWin32Result(
 *   CreateFileW(filename, access, share, null, disposition, flags, null),
 *   INVALID_HANDLE_VALUE,
 *   'CreateFileW',
 *   GetLastError
 * );
 * ```
 */
class Win32Error extends Error {
  /**
   * Creates a new Win32Error instance with formatted error message.
   *
   * The constructor automatically formats the Win32 error code into a human-readable
   * message using the Windows FormatMessageW API. Messages are cached to improve
   * performance when the same error code is encountered multiple times.
   *
   * The resulting error message follows the format:
   * "{operation} failed ({code}): {system_message}"
   *
   * @param what - Name of the operation that failed (e.g., "OpenProcess", "CreateFile")
   * @param code - The Win32 error code (DWORD) associated with the failure
   *
   * @throws {Error} This constructor does not throw, but may produce "Unknown error"
   *                 messages if FormatMessageW fails to format the error code
   *
   * @example
   * ```typescript
   * // Handle a file operation failure
   * const hFile = CreateFileW(filename, GENERIC_READ, FILE_SHARE_READ,
   *                          null, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, null);
   * if (hFile === INVALID_HANDLE_VALUE) {
   *   throw new Win32Error('CreateFileW', GetLastError());
   * }
   * // Result: "CreateFileW failed (2): The system cannot find the file specified."
   * ```
   *
   * @example
   * ```typescript
   * // Handle process access failure
   * const hProcess = OpenProcess(PROCESS_ALL_ACCESS, false, 1234);
   * if (hProcess === 0n) {
   *   throw new Win32Error('OpenProcess', GetLastError());
   * }
   * // Result: "OpenProcess failed (5): Access is denied."
   * ```
   *
   * @example
   * ```typescript
   * // Handle memory allocation failure
   * const hHeap = GetProcessHeap();
   * const ptr = HeapAlloc(hHeap, 0, 1024);
   * if (ptr === 0n) {
   *   throw new Win32Error('HeapAlloc', GetLastError());
   * }
   * // Result: "HeapAlloc failed (8): Not enough memory resources are available to process this command."
   * ```
   *
   * @remarks
   * - The constructor formats the error message using `FormatMessageW` and memoizes
   *   the message text per code to avoid repeated system calls
   * - Messages are cleaned of newline characters and trimmed for consistent formatting
   * - If FormatMessageW fails, "Unknown error" is used as the message
   * - Stack trace is captured using Error.captureStackTrace when available
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
   * Cache of formatted error messages keyed by Win32 error code.
   *
   * This cache stores the human-readable error messages returned by FormatMessageW
   * to avoid repeated FFI calls for the same error codes. This optimization is
   * particularly beneficial in scenarios where the same errors occur frequently.
   *
   * The cache is implemented as a static Map and persists for the lifetime of the
   * application. Memory usage is typically minimal as there are a finite number
   * of possible Win32 error codes, and most applications encounter only a subset.
   *
   * @remarks
   * - Messages are cached after the first successful FormatMessageW call
   * - Failed FormatMessageW calls result in "Unknown error" being cached
   * - The cache is never cleared, ensuring consistent performance throughout application lifetime
   * - Thread-safe in Node.js/Bun single-threaded environment
   *
   * @private
   */
  private static readonly formatMessageWCache = new Map<number, string>();

  /**
   * Static buffer used for FormatMessageW system calls.
   *
   * This buffer is allocated once and reused for all FormatMessageW calls to minimize
   * memory allocations. The buffer size of 4,096 bytes (2,048 UTF-16 characters) is
   * sufficient for typical Windows system error messages.
   *
   * The buffer is allocated as unsafe (uninitialized) memory for performance, as
   * FormatMessageW will overwrite its contents completely.
   *
   * @remarks
   * - Buffer size: 4,096 bytes (2,048 UTF-16 characters)
   * - Shared across all Win32Error instances to minimize memory footprint
   * - Contents are overwritten on each FormatMessageW call
   * - Adequate size for all standard Windows system error messages
   *
   * @private
   */
  private static readonly scratch4096 = Buffer.allocUnsafe(4_096);

  /**
   * The Win32 error code associated with this failure.
   *
   * This property contains the numeric error code that was returned by the Windows API
   * function GetLastError() at the time of the failure. This code can be used for
   * programmatic error handling and logging.
   *
   * Common Win32 error codes include:
   * - 2: ERROR_FILE_NOT_FOUND - The system cannot find the file specified
   * - 3: ERROR_PATH_NOT_FOUND - The system cannot find the path specified
   * - 5: ERROR_ACCESS_DENIED - Access is denied
   * - 6: ERROR_INVALID_HANDLE - The handle is invalid
   * - 87: ERROR_INVALID_PARAMETER - The parameter is incorrect
   * - 122: ERROR_INSUFFICIENT_BUFFER - The data area passed to a system call is too small
   *
   * @example
   * ```typescript
   * try {
   *   // Some Win32 operation that might fail
   *   performWin32Operation();
   * } catch (error) {
   *   if (error instanceof Win32Error) {
   *     switch (error.code) {
   *       case 2: // ERROR_FILE_NOT_FOUND
   *         console.log('File not found, creating new file...');
   *         break;
   *       case 5: // ERROR_ACCESS_DENIED
   *         console.log('Access denied, requesting elevated privileges...');
   *         break;
   *       default:
   *         console.log(`Unexpected error code: ${error.code}`);
   *     }
   *   }
   * }
   * ```
   *
   * @readonly
   */
  public readonly code: number;

  /**
   * The operation or Windows API function name that failed.
   *
   * This property contains the name of the operation or API function that was being
   * executed when the error occurred. It provides context for debugging and logging,
   * making it easier to identify which specific operation failed in complex code.
   *
   * The operation name is typically the exact name of the Win32 API function that
   * was called, but can also be a descriptive name for higher-level operations.
   *
   * @example
   * ```typescript
   * try {
   *   const hFile = CreateFileW(filename, access, share, null, disposition, flags, null);
   *   if (hFile === INVALID_HANDLE_VALUE) {
   *     throw new Win32Error('CreateFileW', GetLastError());
   *   }
   * } catch (error) {
   *   if (error instanceof Win32Error) {
   *     console.log(`Failed operation: ${error.what}`); // "CreateFileW"
   *     console.log(`Error details: ${error.message}`); // "CreateFileW failed (2): The system cannot find the file specified."
   *   }
   * }
   * ```
   *
   * @example
   * ```typescript
   * // Using descriptive operation names for complex operations
   * try {
   *   // Multiple API calls involved in process enumeration
   *   enumerateProcesses();
   * } catch (apiError) {
   *   // Re-throw with more descriptive operation name
   *   throw new Win32Error('ProcessEnumeration', apiError.code);
   * }
   * ```
   *
   * @readonly
   */
  public readonly what: string;
}

export default Win32Error;
