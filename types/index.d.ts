/**
 * Global type augmentations for ArrayBuffer-like views with native pointer access.
 *
 * This ambient declaration module augments common Buffer and TypedArray types with a
 * read-only `ptr` property that returns a native pointer usable by `bun:ffi`. This
 * provides TypeScript type safety and IntelliSense support for the pointer properties
 * that are added at runtime by the corresponding implementation in `extensions.ts`.
 *
 * The `ptr` property enables direct memory access for FFI (Foreign Function Interface)
 * operations, allowing JavaScript code to pass buffer addresses to native functions
 * without additional marshaling overhead.
 *
 * @remarks
 * - These are ambient type declarations only - runtime implementation is in `extensions.ts`
 * - The property is defined as a non-enumerable getter at runtime
 * - Pointers are only valid for the lifetime of the buffer and should not be cached long-term
 * - It is safe to take the pointer immediately before an FFI call; do not store
 *   it long-term across reallocations or garbage collection cycles
 * - Requires Bun runtime environment for the underlying `bun:ffi` functionality
 *
 * @example
 * ```typescript
 * // TypeScript will recognize .ptr property on these types
 * declare function nativeFunction(data: Pointer, size: number): boolean;
 *
 * const buffer = new Uint8Array([1, 2, 3, 4]);
 * const success = nativeFunction(buffer.ptr, buffer.length); // Type-safe!
 * ```
 *
 * @example
 * ```typescript
 * // Useful for Win32 API calls
 * import { dlopen, FFIType } from 'bun:ffi';
 *
 * const { symbols } = dlopen('kernel32.dll', {
 *   WriteFile: {
 *     args: [FFIType.u64, FFIType.ptr, FFIType.u32, FFIType.ptr, FFIType.ptr],
 *     returns: FFIType.bool
 *   }
 * });
 *
 * const data = Buffer.from('Hello, World!', 'utf8');
 * const bytesWritten = new Uint32Array(1);
 *
 * // TypeScript knows about .ptr properties
 * const result = symbols.WriteFile(
 *   fileHandle,
 *   data.ptr,        // Buffer pointer
 *   data.length,
 *   bytesWritten.ptr, // Uint32Array pointer
 *   0n
 * );
 * ```
 *
 * @see {@link ../extensions.ts} for the runtime implementation
 */

import type { Pointer } from 'bun:ffi';

declare global {
  /**
   * Augmentation for ArrayBuffer with native pointer access.
   *
   * ArrayBuffer represents a raw binary data buffer of a fixed length.
   * The `ptr` property provides access to the underlying memory address
   * for direct FFI operations.
   *
   * @example
   * ```typescript
   * const buffer = new ArrayBuffer(1024);
   * const view = new DataView(buffer);
   *
   * // Both buffer and view provide access to the same memory
   * console.log(buffer.ptr === view.ptr); // Should be true
   *
   * // Use in FFI calls
   * nativeMemcpy(destPtr, buffer.ptr, buffer.byteLength);
   * ```
   *
   * @example
   * ```typescript
   * // Allocate buffer for native function output
   * const outputBuffer = new ArrayBuffer(512);
   * const success = nativeFunction(inputData, outputBuffer.ptr, outputBuffer.byteLength);
   *
   * if (success) {
   *   // Process the data written by native function
   *   const view = new Uint8Array(outputBuffer);
   *   processResults(view);
   * }
   * ```
   */
  interface ArrayBuffer {
    /**
     * Native pointer to the backing memory for Bun FFI operations.
     *
     * This property returns a Pointer object that can be passed directly to
     * native functions via Bun's FFI system. The pointer represents the start
     * address of the ArrayBuffer's data.
     *
     * @readonly
     * @example
     * ```typescript
     * const buffer = new ArrayBuffer(256);
     * const memPtr = buffer.ptr;
     *
     * // Pass to native memory operation
     * memset(memPtr, 0, buffer.byteLength);
     * ```
     */
    readonly ptr: Pointer;
  }

  /**
   * Augmentation for BigInt64Array with native pointer access.
   *
   * BigInt64Array represents an array of 64-bit signed integers using BigInt.
   * Used for very large integer values, timestamps, file sizes, and memory addresses.
   *
   * @example
   * ```typescript
   * const timestamps = new BigInt64Array([
   *   1640995200000n, // Unix timestamp in milliseconds
   *   1641081600000n,
   *   1641168000000n
   * ]);
   *
   * // Process timestamps with native date/time library
   * const formatted = nativeFormatTimestamps(timestamps.ptr, timestamps.length);
   * ```
   *
   * @example
   * ```typescript
   * // Large file sizes or memory addresses
   * const fileSizes = new BigInt64Array([
   *   1099511627776n, // 1TB
   *   2199023255552n, // 2TB
   *   4398046511104n  // 4TB
   * ]);
   *
   * // Analyze storage with native file system utilities
   * const analysis = nativeAnalyzeStorage(fileSizes.ptr, fileSizes.length);
   * ```
   */
  interface BigInt64Array {
    /**
     * Native pointer to the underlying buffer for Bun FFI operations.
     *
     * @readonly
     * @example
     * ```typescript
     * const bigInts = new BigInt64Array([-9223372036854775808n, 0n, 9223372036854775807n]);
     * const result = nativeProcessBigInt64(bigInts.ptr, bigInts.length);
     * ```
     */
    readonly ptr: Pointer;
  }

  /**
   * Augmentation for BigUint64Array with native pointer access.
   *
   * BigUint64Array represents an array of 64-bit unsigned integers using BigInt.
   * Used for very large positive values, memory addresses (on 64-bit systems),
   * and cryptographic operations.
   *
   * @example
   * ```typescript
   * const memoryAddresses = new BigUint64Array([
   *   0x7fff00000000n,
   *   0x7fff12345678n,
   *   0x7fffabcdef00n
   * ]);
   *
   * // Process memory addresses with native memory manager
   * const valid = nativeValidateAddresses(memoryAddresses.ptr, memoryAddresses.length);
   * ```
   *
   * @example
   * ```typescript
   * // Cryptographic key material
   * const keyMaterial = new BigUint64Array([
   *   0x123456789ABCDEF0n,
   *   0xFEDCBA9876543210n,
   *   0x0F0F0F0F0F0F0F0Fn
   * ]);
   *
   * // Generate cryptographic keys with native crypto library
   * const keys = nativeGenerateKeys(keyMaterial.ptr, keyMaterial.length);
   * ```
   */
  interface BigUint64Array {
    /**
     * Native pointer to the underlying buffer for Bun FFI operations.
     *
     * @readonly
     * @example
     * ```typescript
     * const bigUints = new BigUint64Array([0n, 1n, 18446744073709551615n]);
     * const hash = nativeHashBigUint64(bigUints.ptr, bigUints.length);
     * ```
     */
    readonly ptr: Pointer;
  }

  interface Buffer {
    /**
     * Native pointer to the underlying buffer for Bun FFI operations.
     *
     * This property provides direct access to the memory address of the Buffer's
     * data, enabling efficient data exchange with native functions without copying.
     * The pointer is compatible with all FFI operations and can be passed directly
     * to native functions expecting raw memory addresses.
     *
     * @readonly
     * @example
     * ```typescript
     * const data = Buffer.from([0x41, 0x42, 0x43, 0x44]); // "ABCD"
     *
     * // Pass buffer directly to native function
     * const checksum = nativeCalculateChecksum(data.ptr, data.length);
     *
     * // Use for memory operations
     * const copied = Buffer.alloc(data.length);
     * nativeMemcpy(copied.ptr, data.ptr, data.length);
     * ```
     *
     * @example
     * ```typescript
     * // Efficient string processing with native functions
     * const text = Buffer.from('Process this text', 'utf8');
     * const result = Buffer.alloc(text.length * 2); // Assume processing might expand
     *
     * const newLength = nativeProcessText(
     *   text.ptr,           // Input buffer
     *   text.length,        // Input length
     *   result.ptr,         // Output buffer
     *   result.length       // Output capacity
     * );
     *
     * if (newLength > 0) {
     *   const processedText = result.subarray(0, newLength).toString('utf8');
     *   console.log('Processed:', processedText);
     * }
     * ```
     */
    readonly ptr: Pointer;
  }

  /**
   * Augmentation for DataView with native pointer access.
   *
   * DataView provides a low-level interface for reading and writing multiple
   * data types in an ArrayBuffer. The `ptr` property provides access to the
   * underlying buffer's memory address.
   *
   * @example
   * ```typescript
   * const buffer = new ArrayBuffer(64);
   * const view = new DataView(buffer, 16, 32); // Offset 16, length 32
   *
   * // DataView ptr points to the underlying ArrayBuffer start, not the view offset
   * console.log(buffer.ptr === view.ptr); // Should be true
   *
   * // For native functions, you may need to account for the offset
   * const offsetPtr = view.ptr + view.byteOffset;
   * nativeFunction(offsetPtr, view.byteLength);
   * ```
   *
   * @example
   * ```typescript
   * // Read structured data from native function
   * const resultBuffer = new ArrayBuffer(128);
   * const view = new DataView(resultBuffer);
   *
   * if (nativeGetStructData(view.ptr, view.byteLength)) {
   *   const id = view.getUint32(0, true);      // Little endian uint32
   *   const value = view.getFloat64(4, true);   // Little endian float64
   *   const flags = view.getUint16(12, true);   // Little endian uint16
   * }
   * ```
   */
  interface DataView {
    /**
     * Native pointer to the underlying buffer for Bun FFI operations.
     *
     * Note that this points to the start of the underlying ArrayBuffer,
     * not accounting for any byteOffset of the DataView. If you need to
     * pass the exact view location to native code, add byteOffset to the pointer.
     *
     * @readonly
     * @example
     * ```typescript
     * const buffer = new ArrayBuffer(1024);
     * const view = new DataView(buffer, 100, 200);
     *
     * // Points to buffer start
     * const bufferPtr = view.ptr;
     *
     * // Points to view start (buffer + offset)
     * const viewPtr = view.ptr + view.byteOffset;
     * ```
     */
    readonly ptr: Pointer;
  }

  /**
   * Augmentation for Float32Array with native pointer access.
   *
   * Float32Array represents an array of 32-bit floating-point numbers.
   * Commonly used for 3D graphics, audio processing, scientific computing,
   * and any application requiring single-precision floating-point data.
   *
   * @example
   * ```typescript
   * const vertices = new Float32Array([
   *   -1.0, -1.0, 0.0,  // Vertex 1: x, y, z
   *    1.0, -1.0, 0.0,  // Vertex 2: x, y, z
   *    0.0,  1.0, 0.0   // Vertex 3: x, y, z
   * ]);
   *
   * // Render triangle with native graphics API
   * nativeRenderTriangle(vertices.ptr, vertices.length / 3);
   * ```
   *
   * @example
   * ```typescript
   * // Audio signal processing
   * const audioBuffer = new Float32Array(1024); // Audio samples
   *
   * // Apply native audio filter
   * nativeApplyFilter(audioBuffer.ptr, audioBuffer.length, filterCoeffs);
   *
   * // Output processed audio
   * outputAudio(audioBuffer);
   * ```
   *
   * @example
   * ```typescript
   * // Matrix operations for 3D transformations
   * const matrix4x4 = new Float32Array(16); // 4x4 transformation matrix
   *
   * // Calculate view-projection matrix with native math library
   * nativeCalculateMatrix(matrix4x4.ptr, viewMatrix, projectionMatrix);
   * ```
   */
  interface Float32Array {
    /**
     * Native pointer to the underlying buffer for Bun FFI operations.
     *
     * @readonly
     * @example
     * ```typescript
     * const floats = new Float32Array([3.14159, 2.71828, 1.41421]);
     * const result = nativeMathOperation(floats.ptr, floats.length);
     * ```
     */
    readonly ptr: Pointer;
  }

  /**
   * Augmentation for Float64Array with native pointer access.
   *
   * Float64Array represents an array of 64-bit floating-point numbers (double precision).
   * Used for high-precision mathematical calculations, scientific computing,
   * financial calculations, and applications requiring maximum floating-point accuracy.
   *
   * @example
   * ```typescript
   * const scientificData = new Float64Array([
   *   6.62607015e-34,  // Planck constant
   *   1.602176634e-19, // Elementary charge
   *   9.1093837015e-31 // Electron mass
   * ]);
   *
   * // Perform high-precision physics calculations
   * const results = nativePhysicsCalculation(scientificData.ptr, scientificData.length);
   * ```
   *
   * @example
   * ```typescript
   * // Financial calculations requiring high precision
   * const prices = new Float64Array([1234.56789012345, 9876.54321098765]);
   *
   * // Calculate precise financial metrics
   * const metrics = nativeFinancialAnalysis(prices.ptr, prices.length);
   * ```
   *
   * @example
   * ```typescript
   * // Numerical analysis and statistics
   * const dataset = new Float64Array(10000);
   *
   * // Fill with measurement data
   * nativePopulateDataset(dataset.ptr, dataset.length, measurementParams);
   *
   * // Perform statistical analysis
   * const statistics = nativeStatisticalAnalysis(dataset.ptr, dataset.length);
   * ```
   */
  interface Float64Array {
    /**
     * Native pointer to the underlying buffer for Bun FFI operations.
     *
     * @readonly
     * @example
     * ```typescript
     * const doubles = new Float64Array([Math.PI, Math.E, Math.SQRT2]);
     * const precise = nativePrecisionMath(doubles.ptr, doubles.length);
     * ```
     */
    readonly ptr: Pointer;
  }

  /**
   * Augmentation for Int8Array with native pointer access.
   *
   * Int8Array represents an array of 8-bit signed integers. The `ptr` property
   * provides access to the underlying memory address for FFI operations.
   *
   * @example
   * ```typescript
   * const signedBytes = new Int8Array([-128, -1, 0, 1, 127]);
   *
   * // Pass to native function expecting signed byte array
   * const result = nativeProcessSignedBytes(signedBytes.ptr, signedBytes.length);
   * ```
   *
   * @example
   * ```typescript
   * // Audio processing with signed 8-bit samples
   * const audioSamples = new Int8Array(44100); // 1 second at 44.1kHz
   *
   * if (nativeGenerateAudio(audioSamples.ptr, audioSamples.length)) {
   *   // Process the generated audio data
   *   playAudio(audioSamples);
   * }
   * ```
   */
  interface Int8Array {
    /**
     * Native pointer to the underlying buffer for Bun FFI operations.
     *
     * @readonly
     * @example
     * ```typescript
     * const data = new Int8Array([1, -2, 3, -4]);
     * nativeFunction(data.ptr, data.length);
     * ```
     */
    readonly ptr: Pointer;
  }

  /**
   * Augmentation for SharedArrayBuffer with native pointer access.
   *
   * SharedArrayBuffer represents raw binary data that can be shared between
   * multiple JavaScript contexts (workers). The `ptr` property provides access
   * to the underlying shared memory address for FFI operations.
   *
   * @example
   * ```typescript
   * const sharedBuffer = new SharedArrayBuffer(1024);
   * const worker1View = new Int32Array(sharedBuffer);
   * const worker2View = new Int32Array(sharedBuffer);
   *
   * // All views share the same underlying memory pointer
   * console.log(sharedBuffer.ptr === worker1View.ptr); // Should be true
   *
   * // Native function can operate on shared memory
   * nativeProcessData(sharedBuffer.ptr, sharedBuffer.byteLength);
   * ```
   *
   * @example
   * ```typescript
   * // Inter-worker communication through shared memory
   * const sharedData = new SharedArrayBuffer(4096);
   *
   * // Worker can pass shared memory to native code
   * if (nativeInitializeBuffer(sharedData.ptr, sharedData.byteLength)) {
   *   // Share the buffer with other workers
   *   worker.postMessage({ sharedBuffer: sharedData });
   * }
   * ```
   */
  interface SharedArrayBuffer {
    /**
     * Native pointer to the backing shared memory for Bun FFI operations.
     *
     * This property returns a Pointer object representing the start address of
     * the SharedArrayBuffer's data. The pointer can be used across multiple
     * workers that share the same buffer.
     *
     * @readonly
     * @example
     * ```typescript
     * const shared = new SharedArrayBuffer(512);
     *
     * // Initialize shared memory with native function
     * nativeMemoryInit(shared.ptr, shared.byteLength);
     *
     * // Multiple workers can access the same memory via the pointer
     * ```
     */
    readonly ptr: Pointer;
  }

  /**
   * Augmentation for Uint8Array with native pointer access.
   *
   * Uint8Array represents an array of 8-bit unsigned integers. This is one of
   * the most commonly used types for binary data and raw memory operations.
   *
   * @example
   * ```typescript
   * const imageData = new Uint8Array(width * height * 4); // RGBA pixels
   *
   * // Load image data from native library
   * if (nativeLoadImage(filename, imageData.ptr, imageData.length)) {
   *   // Process loaded pixel data
   *   displayImage(imageData, width, height);
   * }
   * ```
   *
   * @example
   * ```typescript
   * // Network packet processing
   * const packet = new Uint8Array(1500); // Maximum Ethernet frame
   * const bytesReceived = nativeReceivePacket(socket, packet.ptr, packet.length);
   *
   * if (bytesReceived > 0) {
   *   const actualPacket = packet.subarray(0, bytesReceived);
   *   processNetworkPacket(actualPacket);
   * }
   * ```
   */
  interface Uint8Array {
    /**
     * Native pointer to the underlying buffer for Bun FFI operations.
     *
     * @readonly
     * @example
     * ```typescript
     * const bytes = new Uint8Array([0xFF, 0xAB, 0x12, 0x00]);
     * const checksum = nativeCalculateChecksum(bytes.ptr, bytes.length);
     * ```
     */
    readonly ptr: Pointer;
  }

  /**
   * Augmentation for Uint8ClampedArray with native pointer access.
   *
   * Uint8ClampedArray represents an array of 8-bit unsigned integers clamped
   * to 0-255 range. Commonly used for canvas image data.
   *
   * @example
   * ```typescript
   * const canvas = document.createElement('canvas');
   * const ctx = canvas.getContext('2d');
   * const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
   *
   * // Apply native image filter
   * nativeImageFilter(imageData.data.ptr, imageData.data.length, filterType);
   *
   * // Put processed data back to canvas
   * ctx.putImageData(imageData, 0, 0);
   * ```
   *
   * @example
   * ```typescript
   * // Create clamped pixel data
   * const pixels = new Uint8ClampedArray(256 * 256 * 4);
   *
   * // Generate procedural texture with native code
   * nativeGenerateTexture(pixels.ptr, 256, 256, textureParams);
   * ```
   */
  interface Uint8ClampedArray {
    /**
     * Native pointer to the underlying buffer for Bun FFI operations.
     *
     * @readonly
     * @example
     * ```typescript
     * const clampedData = new Uint8ClampedArray([300, -10, 128, 255]);
     * // Values are clamped: [255, 0, 128, 255]
     * nativeProcessClamped(clampedData.ptr, clampedData.length);
     * ```
     */
    readonly ptr: Pointer;
  }

  /**
   * Augmentation for Int16Array with native pointer access.
   *
   * Int16Array represents an array of 16-bit signed integers. Commonly used
   * for audio samples, coordinate data, and other medium-range integer values.
   *
   * @example
   * ```typescript
   * const audioSamples = new Int16Array(44100 * 2); // Stereo, 1 second
   *
   * // Generate audio with native synthesizer
   * nativeGenerateWaveform(audioSamples.ptr, audioSamples.length, frequency);
   *
   * // Play the generated audio
   * playAudioSamples(audioSamples);
   * ```
   *
   * @example
   * ```typescript
   * // 2D coordinate data
   * const coordinates = new Int16Array([-1000, 500, 0, -250, 750, 1000]);
   *
   * // Transform coordinates with native math library
   * nativeTransformPoints(coordinates.ptr, coordinates.length / 2, transformMatrix);
   * ```
   */
  interface Int16Array {
    /**
     * Native pointer to the underlying buffer for Bun FFI operations.
     *
     * @readonly
     * @example
     * ```typescript
     * const samples = new Int16Array([-32768, -1, 0, 1, 32767]);
     * const rms = nativeCalculateRMS(samples.ptr, samples.length);
     * ```
     */
    readonly ptr: Pointer;
  }

  /**
   * Augmentation for Int32Array with native pointer access.
   *
   * Int32Array represents an array of 32-bit signed integers. Commonly used
   * for large integer values, IDs, timestamps, and general numeric data.
   *
   * @example
   * ```typescript
   * const playerScores = new Int32Array([150000, -50, 999999, 0, 42]);
   *
   * // Process game scores with native leaderboard system
   * const rankings = nativeCalculateRankings(playerScores.ptr, playerScores.length);
   * ```
   *
   * @example
   * ```typescript
   * // Large dataset processing
   * const dataset = new Int32Array(1000000);
   *
   * // Populate with native data generator
   * nativeGenerateDataset(dataset.ptr, dataset.length, seed);
   *
   * // Analyze with native statistics
   * const stats = nativeAnalyzeInt32(dataset.ptr, dataset.length);
   * ```
   */
  interface Int32Array {
    /**
     * Native pointer to the underlying buffer for Bun FFI operations.
     *
     * @readonly
     * @example
     * ```typescript
     * const integers = new Int32Array([-2147483648, -1, 0, 1, 2147483647]);
     * const result = nativeProcessInt32(integers.ptr, integers.length);
     * ```
     */
    readonly ptr: Pointer;
  }

  /**
   * Augmentation for Uint16Array with native pointer access.
   *
   * Uint16Array represents an array of 16-bit unsigned integers. Commonly used
   * for Unicode character codes, port numbers, and other unsigned 16-bit data.
   *
   * @example
   * ```typescript
   * const unicodeText = new Uint16Array([0x48, 0x65, 0x6C, 0x6C, 0x6F]); // "Hello"
   *
   * // Process Unicode string with native text processor
   * const processed = nativeProcessUnicode(unicodeText.ptr, unicodeText.length);
   * ```
   *
   * @example
   * ```typescript
   * // Network port configuration
   * const ports = new Uint16Array([80, 443, 8080, 3000, 5432]);
   *
   * // Configure network services with native code
   * nativeConfigurePorts(ports.ptr, ports.length);
   * ```
   */
  interface Uint16Array {
    /**
     * Native pointer to the underlying buffer for Bun FFI operations.
     *
     * @readonly
     * @example
     * ```typescript
     * const values = new Uint16Array([0, 1, 65535]);
     * const sum = nativeSum16(values.ptr, values.length);
     * ```
     */
    readonly ptr: Pointer;
  }

  /**
   * Augmentation for Uint32Array with native pointer access.
   *
   * Uint32Array represents an array of 32-bit unsigned integers. Commonly used
   * for large positive values, memory addresses (on 32-bit systems), and counts.
   *
   * @example
   * ```typescript
   * const pixelColors = new Uint32Array(width * height); // ARGB pixels
   *
   * // Render with native graphics engine
   * nativeRenderScene(pixelColors.ptr, width, height, sceneData);
   *
   * // Display rendered pixels
   * displayPixelBuffer(pixelColors, width, height);
   * ```
   *
   * @example
   * ```typescript
   * // Hash table or ID mapping
   * const hashValues = new Uint32Array([0x12345678, 0xABCDEF00, 0xFF00FF00]);
   *
   * // Process hashes with native cryptographic function
   * const verified = nativeVerifyHashes(hashValues.ptr, hashValues.length);
   * ```
   */
  interface Uint32Array {
    /**
     * Native pointer to the underlying buffer for Bun FFI operations.
     *
     * @readonly
     * @example
     * ```typescript
     * const counts = new Uint32Array([0, 1, 4294967295]);
     * const total = nativeSum32(counts.ptr, counts.length);
     * ```
     */
    readonly ptr: Pointer;
  }
}

export {};
