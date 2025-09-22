/**
 * Runtime definition of a non-enumerable `ptr` getter on Buffer and TypedArray
 * prototypes, returning a native pointer compatible with Bun's FFI layer.
 *
 * This module extends common JavaScript binary view objects (Buffer, TypedArrays, etc.)
 * with a `.ptr` property that provides direct access to the underlying memory address.
 * This pairs with the ambient declarations in `global.d.ts` so that common
 * JavaScript binary views expose a strongly-typed `.ptr` for direct FFI calls.
 *
 * The `ptr` property enables seamless integration between JavaScript memory views
 * and native code through Bun's Foreign Function Interface, allowing efficient
 * data exchange without additional copying or marshaling overhead.
 *
 * @remarks
 * - The property is added lazily only if not already present, avoiding conflicts
 * - The getter calls `bun:ffi.ptr(this)` each time it is accessed; avoid calling
 *   it in tight loops when the value can be reused for performance
 * - The property is **non-enumerable** and **configurable**, minimizing surface
 *   area and allowing controlled redefinition in tests if necessary
 * - Requires Bun runtime environment (uses `bun:ffi`)
 * - Properties are installed on prototype objects, affecting all instances
 *
 * @example
 * ```typescript
 * import './extensions'; // Import to install ptr getters
 *
 * // Create various binary views
 * const buffer = Buffer.from([1, 2, 3, 4]);
 * const floats = new Float32Array([1.0, 2.0, 3.0]);
 * const ints = new Int32Array([100, 200, 300]);
 *
 * // Access native pointers for FFI calls
 * console.log('Buffer pointer:', buffer.ptr);
 * console.log('Float array pointer:', floats.ptr);
 * console.log('Int array pointer:', ints.ptr);
 *
 * // Use in FFI function calls
 * const success = someNativeFunction(buffer.ptr, buffer.length);
 * ```
 *
 * @example
 * ```typescript
 * import './extensions';
 * import { dlopen, FFIType } from 'bun:ffi';
 *
 * const { symbols } = dlopen('user32.dll', {
 *   MessageBoxA: {
 *     args: [FFIType.ptr, FFIType.cstring, FFIType.cstring, FFIType.u32],
 *     returns: FFIType.i32
 *   }
 * });
 *
 * // Create message text in a buffer
 * const messageText = Buffer.from('Hello from FFI!\0', 'utf8');
 * const titleText = Buffer.from('Notification\0', 'utf8');
 *
 * // Use .ptr property to pass buffer addresses to native function
 * symbols.MessageBoxA(0n, messageText.ptr, titleText.ptr, 0);
 * ```
 *
 * @example
 * ```typescript
 * import './extensions';
 *
 * function processAudioData(samples: Float32Array) {
 *   // Cache the pointer for multiple uses in tight loop
 *   const samplePtr = samples.ptr;
 *
 *   for (let i = 0; i < 100; i++) {
 *     // Use cached pointer instead of accessing .ptr repeatedly
 *     processAudioBuffer(samplePtr, samples.length);
 *   }
 * }
 * ```
 */

import { ptr, type Pointer } from 'bun:ffi';

/**
 * List of binary view constructor functions whose prototypes will be extended
 * with the `ptr` getter property.
 *
 * This array contains all the standard JavaScript binary data types that can
 * hold raw memory data. Each type is extended with a `ptr` getter that returns
 * a native pointer compatible with Bun's FFI system.
 *
 * Supported types:
 * - **ArrayBuffer**: Raw binary data buffer
 * - **SharedArrayBuffer**: Shared memory buffer for worker threads
 * - **Buffer**: Node.js/Bun Buffer object (subclass of Uint8Array)
 * - **DataView**: View for reading/writing various data types from ArrayBuffer
 * - **Typed Arrays**: All standard typed array types for specific numeric types
 *   - Int8Array, Uint8Array, Uint8ClampedArray (8-bit integers)
 *   - Int16Array, Uint16Array (16-bit integers)
 *   - Int32Array, Uint32Array (32-bit integers)
 *   - BigInt64Array, BigUint64Array (64-bit integers)
 *   - Float32Array, Float64Array (floating-point numbers)
 *
 * @example
 * ```typescript
 * // All these types will have .ptr available after importing extensions
 * const arrayBuffer = new ArrayBuffer(1024);
 * const sharedBuffer = new SharedArrayBuffer(512);
 * const nodeBuffer = Buffer.allocUnsafe(256);
 * const dataView = new DataView(arrayBuffer);
 * const int32View = new Int32Array(arrayBuffer);
 * const float64View = new Float64Array(8);
 *
 * // Each can provide its native pointer
 * console.log(arrayBuffer.ptr, sharedBuffer.ptr, nodeBuffer.ptr);
 * console.log(dataView.ptr, int32View.ptr, float64View.ptr);
 * ```
 */
const constructors = [
  ArrayBuffer, //
  BigInt64Array,
  BigUint64Array,
  Buffer,
  DataView,
  Float32Array,
  Float64Array,
  Int16Array,
  Int32Array,
  Int8Array,
  SharedArrayBuffer,
  Uint16Array,
  Uint8Array,
  Uint8ClampedArray,
  Uint32Array,
] as const;

/**
 * Install the `ptr` getter on common binary view prototypes if not already present.
 *
 * This code iterates through all supported binary view types and adds a non-enumerable
 * `ptr` getter property to each prototype. The getter calls `bun:ffi.ptr()` to obtain
 * the native memory address of the underlying buffer.
 *
 * The property is only added if it doesn't already exist, preventing conflicts with
 * existing implementations or multiple imports of this module.
 *
 * Property characteristics:
 * - **configurable: true** - Can be reconfigured or deleted if needed
 * - **enumerable: false** - Won't appear in Object.keys() or for...in loops
 * - **get function** - Computed property that calls bun:ffi.ptr() on each access
 *
 * @example
 * ```typescript
 * // Before importing extensions
 * const buffer = Buffer.from([1, 2, 3]);
 * console.log(buffer.ptr); // undefined or TypeError
 *
 * // After importing extensions
 * import './extensions';
 * console.log(buffer.ptr); // Pointer { [native pointer address] }
 * ```
 *
 * @example
 * ```typescript
 * // Property is non-enumerable
 * const array = new Uint8Array([1, 2, 3]);
 * console.log(Object.keys(array)); // ['0', '1', '2'] - ptr not included
 * console.log(array.ptr); // Pointer { [native pointer address] } - but still accessible
 * ```
 *
 * @example
 * ```typescript
 * // Property can be reconfigured if needed (for testing, etc.)
 * const mockPtr = { mockPointer: true };
 * Object.defineProperty(Uint8Array.prototype, 'ptr', {
 *   configurable: true,
 *   enumerable: false,
 *   value: mockPtr
 * });
 *
 * const testArray = new Uint8Array([1, 2, 3]);
 * console.log(testArray.ptr); // { mockPointer: true }
 * ```
 */
constructors.forEach(({ prototype }) => {
  if (!Object.getOwnPropertyDescriptor(prototype, 'ptr')) {
    Object.defineProperty(prototype, 'ptr', {
      configurable: true,
      enumerable: false,
      /**
       * Getter function that returns a native pointer to the underlying memory.
       *
       * This getter calls `bun:ffi.ptr()` each time the property is accessed to
       * obtain the current memory address of the buffer. The pointer is computed
       * on-demand to ensure it reflects the current state of the buffer.
       *
       * **Important Performance Note**: The pointer is computed on every access.
       * In performance-critical code with repeated FFI calls, cache the pointer
       * value in a local variable rather than accessing this property repeatedly.
       *
       * **Memory Safety**: The returned pointer is only valid as long as the
       * buffer exists and hasn't been reallocated. Do not store pointers long-term
       * across garbage collection cycles or buffer resizing operations.
       *
       * @returns Native pointer compatible with Bun FFI system
       *
       * @example
       * ```typescript
       * const data = new Float32Array([1.0, 2.0, 3.0, 4.0]);
       *
       * // Inefficient: ptr computed on each call
       * for (let i = 0; i < 1000; i++) {
       *   processData(data.ptr, data.length); // ptr computed 1000 times!
       * }
       *
       * // Efficient: cache the pointer
       * const dataPtr = data.ptr; // Computed once
       * for (let i = 0; i < 1000; i++) {
       *   processData(dataPtr, data.length); // Reuse cached pointer
       * }
       * ```
       *
       * @example
       * ```typescript
       * // Pointer reflects current buffer state
       * const buffer = Buffer.alloc(10);
       * const ptr1 = buffer.ptr;
       *
       * // Buffer might be reallocated internally
       * buffer.write('Hello World', 0); // May cause reallocation
       * const ptr2 = buffer.ptr;
       *
       * // ptr1 and ptr2 might be different if reallocation occurred
       * console.log('Same pointer?', ptr1 === ptr2);
       * ```
       */
      get(this): Pointer {
        // The pointer is computed on demand; do not cache across GC or growth.
        return ptr(this);
      },
    });
  }
});
