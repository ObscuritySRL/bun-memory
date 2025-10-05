import { type Pointer, ptr } from 'bun:ffi';

declare global {
  /**
   * Adds a native pointer property to all ArrayBuffer, Buffer, DataView, and TypedArray types.
   *
   * The `ptr` property returns a native pointer usable with Bun FFI.
   *
   * @example
   * ```ts
   * const arr = new Uint8Array([1, 2, 3]);
   * nativeFunction(arr.ptr, arr.length);
   * ```
   */
  interface ArrayBuffer {
    /**
     * Native pointer to ArrayBuffer memory for Bun FFI.
     * @example
     * ```ts
     * const buf = new ArrayBuffer(8);
     * nativeFunction(buf.ptr, buf.byteLength);
     * ```
     */
    readonly ptr: Pointer;
  }
  interface BigInt64Array {
    /**
     * Native pointer to BigInt64Array memory for Bun FFI.
     * @example
     * ```ts
     * const arr = new BigInt64Array([1n, 2n]);
     * nativeFunction(arr.ptr, arr.length);
     * ```
     */
    readonly ptr: Pointer;
  }
  interface BigUint64Array {
    /**
     * Native pointer to BigUint64Array memory for Bun FFI.
     * @example
     * ```ts
     * const arr = new BigUint64Array([1n, 2n]);
     * nativeFunction(arr.ptr, arr.length);
     * ```
     */
    readonly ptr: Pointer;
  }
  interface Buffer {
    /**
     * Native pointer to Buffer memory for Bun FFI.
     * @example
     * ```ts
     * const buf = Buffer.from([1, 2, 3]);
     * nativeFunction(buf.ptr, buf.length);
     * ```
     */
    readonly ptr: Pointer;
  }
  interface DataView {
    /**
     * Native pointer to DataView memory for Bun FFI.
     * @example
     * ```ts
     * const view = new DataView(new ArrayBuffer(4));
     * nativeFunction(view.ptr, view.byteLength);
     * ```
     */
    readonly ptr: Pointer;
  }
  interface Float32Array {
    /**
     * Native pointer to Float32Array memory for Bun FFI.
     * @example
     * ```ts
     * const arr = new Float32Array([1, 2, 3]);
     * nativeFunction(arr.ptr, arr.length);
     * ```
     */
    readonly ptr: Pointer;
  }
  interface Float64Array {
    /**
     * Native pointer to Float64Array memory for Bun FFI.
     * @example
     * ```ts
     * const arr = new Float64Array([1, 2, 3]);
     * nativeFunction(arr.ptr, arr.length);
     * ```
     */
    readonly ptr: Pointer;
  }
  interface Int16Array {
    /**
     * Native pointer to Int16Array memory for Bun FFI.
     * @example
     * ```ts
     * const arr = new Int16Array([1, 2, 3]);
     * nativeFunction(arr.ptr, arr.length);
     * ```
     */
    readonly ptr: Pointer;
  }
  interface Int32Array {
    /**
     * Native pointer to Int32Array memory for Bun FFI.
     * @example
     * ```ts
     * const arr = new Int32Array([1, 2, 3]);
     * nativeFunction(arr.ptr, arr.length);
     * ```
     */
    readonly ptr: Pointer;
  }
  interface Int8Array {
    /**
     * Native pointer to Int8Array memory for Bun FFI.
     * @example
     * ```ts
     * const arr = new Int8Array([1, 2, 3]);
     * nativeFunction(arr.ptr, arr.length);
     * ```
     */
    readonly ptr: Pointer;
  }
  interface SharedArrayBuffer {
    /**
     * Native pointer to SharedArrayBuffer memory for Bun FFI.
     * @example
     * ```ts
     * const buf = new SharedArrayBuffer(8);
     * nativeFunction(buf.ptr, buf.byteLength);
     * ```
     */
    readonly ptr: Pointer;
  }
  interface Uint16Array {
    /**
     * Native pointer to Uint16Array memory for Bun FFI.
     * @example
     * ```ts
     * const arr = new Uint16Array([1, 2, 3]);
     * nativeFunction(arr.ptr, arr.length);
     * ```
     */
    readonly ptr: Pointer;
  }
  interface Uint32Array {
    /**
     * Native pointer to Uint32Array memory for Bun FFI.
     * @example
     * ```ts
     * const arr = new Uint32Array([1, 2, 3]);
     * nativeFunction(arr.ptr, arr.length);
     * ```
     */
    readonly ptr: Pointer;
  }
  interface Uint8Array {
    /**
     * Native pointer to Uint8Array memory for Bun FFI.
     * @example
     * ```ts
     * const arr = new Uint8Array([1, 2, 3]);
     * nativeFunction(arr.ptr, arr.length);
     * ```
     */
    readonly ptr: Pointer;
  }
  interface Uint8ClampedArray {
    /**
     * Native pointer to Uint8ClampedArray memory for Bun FFI.
     * @example
     * ```ts
     * const arr = new Uint8ClampedArray([1, 2, 3]);
     * nativeFunction(arr.ptr, arr.length);
     * ```
     */
    readonly ptr: Pointer;
  }
}

/**
 * Installs the `ptr` property on all supported binary view prototypes.
 *
 * The property is non-enumerable and non-configurable. The getter calls `ptr(this)`.
 */
const constructors = [ArrayBuffer, BigInt64Array, BigUint64Array, Buffer, DataView, Float32Array, Float64Array, Int16Array, Int32Array, Int8Array, SharedArrayBuffer, Uint16Array, Uint32Array, Uint8Array, Uint8ClampedArray] as const;

constructors.forEach(
  ({ prototype }) =>
    !Object.getOwnPropertyDescriptor(prototype, 'ptr') &&
    Object.defineProperty(prototype, 'ptr', {
      configurable: false,
      enumerable: false,
      /**
       * Returns a native pointer to the underlying memory.
       * @returns Native pointer for Bun FFI.
       * @example
       * ```ts
       * const arr = new Uint8Array([1, 2, 3]);
       * nativeFunction(arr.ptr, arr.length);
       * ```
       */
      get(this): Pointer {
        return ptr(this);
      },
    })
);

export {};
