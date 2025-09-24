/**
 * Type definitions for the Memory module providing cross-process memory manipulation.
 *
 * This module exports type definitions used by the Memory class for type-safe
 * interaction with process memory, modules, and various data structures commonly
 * found in native applications and games.
 *
 * These types ensure proper TypeScript support when working with:
 * - Process modules and their metadata
 * - Memory regions and their properties
 * - Mathematical structures (vectors and quaternions)
 * - FFI-compatible buffer types for memory operations
 *
 * @example
 * ```typescript
 * import Memory, { Module, Vector3, Quaternion } from './Memory';
 *
 * const memory = new Memory('game.exe');
 *
 * // Type-safe module access
 * const mainModule: Module = memory.modules['game.exe'];
 * console.log(`Base: 0x${mainModule.base.toString(16)}`);
 *
 * // Type-safe vector operations
 * const position: Vector3 = memory.vector3(0x12345678n);
 * memory.vector3(0x12345678n, { x: position.x + 10, y: position.y, z: position.z });
 *
 * memory.close();
 * ```
 */

/**
 * Represents a loaded module within a target process.
 *
 * Modules are executable files (EXE, DLL) that have been loaded into a process's
 * address space. Each module has a base address where it's loaded, a name
 * (typically the filename), and a size indicating how much memory it occupies.
 *
 * This information is essential for:
 * - Calculating absolute addresses from relative offsets
 * - Understanding memory layout of the target process
 * - Identifying specific libraries or executables
 * - Memory scanning within specific module boundaries
 *
 * @example
 * ```typescript
 * const memory = new Memory('notepad.exe');
 * const modules = memory.modules;
 *
 * // Access the main executable module
 * const mainModule: Module = modules['notepad.exe'];
 * console.log(`Main module loaded at: 0x${mainModule.base.toString(16)}`);
 * console.log(`Module size: ${mainModule.size} bytes`);
 *
 * // Access a system library
 * const kernel32: Module = modules['kernel32.dll'];
 * console.log(`Kernel32 base: 0x${kernel32.base.toString(16)}`);
 * ```
 *
 * @example
 * ```typescript
 * // Calculate absolute address from relative offset
 * const gameModule: Module = memory.modules['game.exe'];
 * const relativeOffset = 0x12345678;
 * const absoluteAddress = gameModule.base + BigInt(relativeOffset);
 *
 * // Read data at the calculated address
 * const health = memory.f32(absoluteAddress);
 * ```
 *
 * @example
 * ```typescript
 * // Enumerate all loaded modules
 * function listModules(memory: Memory) {
 *   const modules = memory.modules;
 *
 *   console.log('Loaded modules:');
 *   for (const [name, module] of Object.entries(modules)) {
 *     console.log(`  ${name}:`);
 *     console.log(`    Base: 0x${module.base.toString(16)}`);
 *     console.log(`    Size: ${module.size} bytes`);
 *     console.log(`    End:  0x${(module.base + BigInt(module.size)).toString(16)}`);
 *   }
 * }
 * ```
 */
export type Module = {
  /**
   * Base memory address where the module is loaded.
   *
   * This is the virtual memory address where the module's first byte resides
   * in the target process. All relative offsets within the module should be
   * added to this base address to get the absolute memory address.
   *
   * @example
   * ```typescript
   * const module: Module = memory.modules['example.dll'];
   * const functionOffset = 0x1000; // Relative offset to a function
   * const functionAddress = module.base + BigInt(functionOffset);
   * ```
   */
  base: bigint;

  /**
   * Name of the module, typically the filename.
   *
   * This is usually the filename of the executable or library, including
   * the file extension (e.g., 'game.exe', 'user32.dll', 'ntdll.dll').
   *
   * @example
   * ```typescript
   * const modules = memory.modules;
   *
   * if ('game.exe' in modules) {
   *   console.log(`Game executable found: ${modules['game.exe'].name}`);
   * }
   * ```
   */
  name: string;

  /**
   * Size of the module in bytes.
   *
   * This represents how much virtual memory the module occupies in the
   * target process. The module occupies memory from `base` to `base + size`.
   *
   * @example
   * ```typescript
   * const module: Module = memory.modules['large_library.dll'];
   * const endAddress = module.base + BigInt(module.size);
   *
   * console.log(`Module spans from 0x${module.base.toString(16)} to 0x${endAddress.toString(16)}`);
   * console.log(`Total size: ${(module.size / 1024 / 1024).toFixed(2)} MB`);
   * ```
   */
  size: number;
};

/**
 * Represents a contiguous vector of unsigned 32-bit integers used by the network
 * utility subsystem.
 *
 * `NetworkUtlVector` is an alias of `Uint32Array`. In the target process, the
 * vector’s elements live in an out-of-line buffer referenced by a small header
 * at `address` (read/write via {@link Memory.networkUtlVector}):
 *
 * - 0x00: `uint32` size (number of elements)
 * - 0x04: `uint32` capacity (preallocated element count)
 * - 0x08: `uint64` pointer to contiguous `uint32` elements
 *
 * This alias provides a type-safe view for high-throughput operations such as
 * batched identifier handling, index sets, and routing tables, while keeping
 * zero-copy semantics in userland and avoiding per-element boxing.
 *
 * Characteristics:
 * - Little-endian `uint32` element layout
 * - Backed by a single contiguous elements buffer
 * - Suitable for FFI and bulk memory transfers
 *
 * Usage notes:
 * - Use {@link Memory.networkUtlVector} to read or write the elements without
 *   reallocating the in-process buffer.
 * - When writing, the implementation updates the size field to `values.length`
 *   and copies elements into the existing buffer; capacity and pointer are not
 *   modified.
 * - Ensure `values.length` does not exceed the current capacity of the in-process
 *   buffer to avoid truncation or undefined behavior imposed by the target.
 *
 * @example
 * ```typescript
 * const memory = new Memory('network_app.exe');
 *
 * // Read the current vector
 * const ids: NetworkUtlVector = memory.networkUtlVector(0x12345678n);
 * console.log(`Count: ${ids.length}`, Array.from(ids));
 * ```
 *
 * @example
 * ```typescript
 * // Overwrite the vector contents (must fit existing capacity)
 * const next: NetworkUtlVector = Uint32Array.from([101, 202, 303, 404]);
 * memory.networkUtlVector(0x12345678n, next);
 * ```
 *
 * @example
 * ```typescript
 * // Append in place by staging into a new typed array, then writing back
 * const baseAddress = 0x12345678n;
 * const current = memory.networkUtlVector(baseAddress);
 * const extended = new Uint32Array(current.length + 1);
 * extended.set(current);
 * extended[extended.length - 1] = 0xDEADBEEF;
 * memory.networkUtlVector(baseAddress, extended); // capacity must allow the new size
 * ```
 */
export type NetworkUtlVector = Uint32Array;

/**
 * Represents a quaternion for 3D rotations.
 *
 * Quaternions are a mathematical representation of rotations in 3D space that
 * avoid gimbal lock and provide smooth interpolation. They consist of four
 * components: x, y, z (vector part) and w (scalar part).
 *
 * Quaternions are commonly used in:
 * - 3D games for character and camera rotations
 * - 3D modeling and animation software
 * - Robotics and aerospace applications
 * - Physics simulations
 *
 * The quaternion components represent:
 * - x, y, z: The axis of rotation (vector part)
 * - w: The amount of rotation around that axis (scalar part)
 *
 * @example
 * ```typescript
 * const memory = new Memory('3d_game.exe');
 *
 * // Read player rotation
 * const playerRotation: Quaternion = memory.quaternion(0x12345678n);
 * console.log(`Player rotation: x=${playerRotation.x}, y=${playerRotation.y}, z=${playerRotation.z}, w=${playerRotation.w}`);
 *
 * // Set identity rotation (no rotation)
 * const identity: Quaternion = { x: 0, y: 0, z: 0, w: 1 };
 * memory.quaternion(0x12345678n, identity);
 * ```
 *
 * @example
 * ```typescript
 * // Read array of bone rotations for skeletal animation
 * const boneCount = 50;
 * const boneRotations: Quaternion[] = memory.quaternionArray(0x12345678n, boneCount);
 *
 * // Modify specific bone rotation
 * boneRotations[10] = { x: 0.707, y: 0, z: 0, w: 0.707 }; // 90-degree rotation around X-axis
 *
 * // Write back the modified rotations
 * memory.quaternionArray(0x12345678n, boneRotations);
 * ```
 *
 * @example
 * ```typescript
 * // Interpolate between two rotations (basic lerp example)
 * function lerpQuaternion(q1: Quaternion, q2: Quaternion, t: number): Quaternion {
 *   return {
 *     x: q1.x + (q2.x - q1.x) * t,
 *     y: q1.y + (q2.y - q1.y) * t,
 *     z: q1.z + (q2.z - q1.z) * t,
 *     w: q1.w + (q2.w - q1.w) * t
 *   };
 * }
 *
 * const startRotation: Quaternion = memory.quaternion(0x12345678n);
 * const endRotation: Quaternion = { x: 0, y: 0.707, z: 0, w: 0.707 };
 * const interpolated = lerpQuaternion(startRotation, endRotation, 0.5);
 * memory.quaternion(0x12345678n, interpolated);
 * ```
 */
export type Quaternion = {
  /**
   * W component (scalar part) of the quaternion.
   *
   * The w component represents the "amount" of rotation. For a normalized quaternion:
   * - w = 1 represents no rotation (identity)
   * - w = 0 represents a 180-degree rotation
   * - w = cos(θ/2) where θ is the rotation angle
   *
   * @example
   * ```typescript
   * // Identity quaternion (no rotation)
   * const identity: Quaternion = { x: 0, y: 0, z: 0, w: 1 };
   *
   * // 180-degree rotation around Y-axis
   * const flip: Quaternion = { x: 0, y: 1, z: 0, w: 0 };
   * ```
   */
  w: number;

  /**
   * X component of the quaternion's vector part.
   *
   * The x component contributes to the axis of rotation. For rotations around
   * the X-axis, this value will be non-zero while y and z approach zero.
   *
   * @example
   * ```typescript
   * // 90-degree rotation around X-axis
   * const xRotation: Quaternion = { x: 0.707, y: 0, z: 0, w: 0.707 };
   * ```
   */
  x: number;

  /**
   * Y component of the quaternion's vector part.
   *
   * The y component contributes to the axis of rotation. For rotations around
   * the Y-axis (yaw), this value will be non-zero while x and z approach zero.
   *
   * @example
   * ```typescript
   * // 45-degree yaw rotation (around Y-axis)
   * const yawRotation: Quaternion = { x: 0, y: 0.383, z: 0, w: 0.924 };
   * ```
   */
  y: number;

  /**
   * Z component of the quaternion's vector part.
   *
   * The z component contributes to the axis of rotation. For rotations around
   * the Z-axis (roll), this value will be non-zero while x and y approach zero.
   *
   * @example
   * ```typescript
   * // 30-degree roll rotation (around Z-axis)
   * const rollRotation: Quaternion = { x: 0, y: 0, z: 0.259, w: 0.966 };
   * ```
   */
  z: number;
};

/**
 * Represents a memory region with its properties and protection flags.
 *
 * Memory regions are contiguous blocks of virtual memory with uniform properties
 * such as protection flags (read/write/execute permissions), state (committed,
 * reserved, free), and type (private, mapped, image).
 *
 * This information is crucial for:
 * - Safe memory scanning and modification
 * - Understanding memory layout and permissions
 * - Avoiding access violations when reading/writing memory
 * - Identifying different types of memory (code, data, heap, etc.)
 *
 * @example
 * ```typescript
 * // This type is typically used internally by the Memory class
 * // Users generally don't need to create Region objects directly
 *
 * const memory = new Memory('target_process.exe');
 * // The regions() method (if exposed) would return Region objects
 * ```
 *
 * @example
 * ```typescript
 * // Understanding memory protection flags
 * // These constants match Windows PAGE_* flags:
 * // 0x04 = PAGE_READWRITE
 * // 0x20 = PAGE_EXECUTE_READ
 * // 0x40 = PAGE_EXECUTE_READWRITE
 * // 0x02 = PAGE_READONLY
 * ```
 */
export type Region = {
  /**
   * Base address of the memory region.
   *
   * This is the starting virtual memory address of the region. All addresses
   * within the region fall between base and (base + size).
   *
   * @example
   * ```typescript
   * const region: Region = {
   *   base: 0x10000000n,
   *   size: 0x1000n,
   *   protect: 0x04, // PAGE_READWRITE
   *   state: 0x1000, // MEM_COMMIT
   *   type: 0x20000  // MEM_PRIVATE
   * };
   *
   * // Region spans from 0x10000000 to 0x10001000
   * ```
   */
  base: bigint;

  /**
   * Memory protection flags for this region.
   *
   * These flags determine what operations are allowed on the memory:
   * - Read permissions: Can the memory be read?
   * - Write permissions: Can the memory be modified?
   * - Execute permissions: Can code in this memory be executed?
   *
   * Common Windows protection flags:
   * - 0x01: PAGE_NOACCESS - No access allowed
   * - 0x02: PAGE_READONLY - Read-only access
   * - 0x04: PAGE_READWRITE - Read and write access
   * - 0x08: PAGE_WRITECOPY - Copy-on-write access
   * - 0x10: PAGE_EXECUTE - Execute-only access
   * - 0x20: PAGE_EXECUTE_READ - Execute and read access
   * - 0x40: PAGE_EXECUTE_READWRITE - Execute, read, and write access
   * - 0x100: PAGE_GUARD - Guard page (triggers exception on access)
   *
   * @example
   * ```typescript
   * function isWritableRegion(region: Region): boolean {
   *   const writableFlags = 0x04 | 0x08 | 0x40; // READWRITE | WRITECOPY | EXECUTE_READWRITE
   *   return (region.protect & writableFlags) !== 0;
   * }
   *
   * function isExecutableRegion(region: Region): boolean {
   *   const executableFlags = 0x10 | 0x20 | 0x40 | 0x80; // Various execute flags
   *   return (region.protect & executableFlags) !== 0;
   * }
   * ```
   */
  protect: number;

  /**
   * Size of the memory region in bytes.
   *
   * This indicates how many bytes the region spans. The region occupies
   * virtual addresses from base to (base + size - 1).
   *
   * @example
   * ```typescript
   * function analyzeRegion(region: Region) {
   *   const endAddress = region.base + region.size;
   *   const sizeMB = Number(region.size) / (1024 * 1024);
   *
   *   console.log(`Region: 0x${region.base.toString(16)} - 0x${endAddress.toString(16)}`);
   *   console.log(`Size: ${sizeMB.toFixed(2)} MB`);
   * }
   * ```
   */
  size: bigint;

  /**
   * State of the memory region.
   *
   * The state indicates how the virtual memory is currently being used:
   * - MEM_COMMIT (0x1000): Memory is allocated and backed by physical storage
   * - MEM_RESERVE (0x2000): Memory is reserved but not yet committed
   * - MEM_FREE (0x10000): Memory is available for allocation
   *
   * Only committed memory (MEM_COMMIT) can be safely read from or written to.
   *
   * @example
   * ```typescript
   * function isCommittedMemory(region: Region): boolean {
   *   const MEM_COMMIT = 0x1000;
   *   return region.state === MEM_COMMIT;
   * }
   *
   * function getStateDescription(state: number): string {
   *   switch (state) {
   *     case 0x1000: return 'Committed';
   *     case 0x2000: return 'Reserved';
   *     case 0x10000: return 'Free';
   *     default: return `Unknown (0x${state.toString(16)})`;
   *   }
   * }
   * ```
   */
  state: number;

  /**
   * Type of the memory region.
   *
   * The type indicates how the memory was allocated and what it contains:
   * - MEM_PRIVATE (0x20000): Private memory allocated by the process
   * - MEM_MAPPED (0x40000): Memory-mapped file
   * - MEM_IMAGE (0x1000000): Memory containing executable image (EXE/DLL)
   *
   * Different types have different characteristics and usage patterns.
   *
   * @example
   * ```typescript
   * function getMemoryTypeDescription(type: number): string {
   *   switch (type) {
   *     case 0x20000: return 'Private (heap/stack)';
   *     case 0x40000: return 'Mapped (file-backed)';
   *     case 0x1000000: return 'Image (executable)';
   *     default: return `Unknown (0x${type.toString(16)})`;
   *   }
   * }
   *
   * function isExecutableImage(region: Region): boolean {
   *   const MEM_IMAGE = 0x1000000;
   *   return region.type === MEM_IMAGE;
   * }
   * ```
   */
  type: number;
};

/**
 * Union type of all buffer types that can be used as scratch space for memory operations.
 *
 * This type represents all the binary data views that can be used with the Memory class's
 * low-level read() and write() methods. These types all provide direct access to raw
 * memory buffers and can be passed to FFI functions.
 *
 * The Scratch type ensures type safety when working with different buffer formats while
 * maintaining compatibility with Bun's FFI system through the .ptr property extensions.
 *
 * Supported buffer types:
 * - **BigInt64Array / BigUint64Array**: 64-bit integer arrays
 * - **Buffer**: Node.js-style buffer (Bun-compatible)
 * - **Float32Array / Float64Array**: Floating-point number arrays
 * - **DataView**: Generic binary data view
 * - **Int8Array / Int16Array / Int32Array**: Signed integer arrays
 * - **Uint8Array / Uint16Array / Uint32Array / Uint8ClampedArray**: Unsigned integer arrays
 *
 * @example
 * ```typescript
 * const memory = new Memory('target.exe');
 *
 * // All of these are valid Scratch types:
 * const buffer1: Scratch = new Uint8Array(1024);
 * const buffer2: Scratch = Buffer.allocUnsafe(512);
 * const buffer3: Scratch = new Float32Array(256);
 * const buffer4: Scratch = new DataView(new ArrayBuffer(128));
 *
 * // Can be used with Memory methods:
 * memory.read(0x12345678n, buffer1);
 * memory.read(0x12345679n, buffer2);
 * memory.read(0x1234567An, buffer3);
 * ```
 *
 * @example
 * ```typescript
 * // Type-safe function that accepts any valid scratch buffer
 * function readMemoryBlock(memory: Memory, address: bigint, buffer: Scratch): void {
 *   memory.read(address, buffer);
 *   console.log(`Read ${buffer.byteLength} bytes from 0x${address.toString(16)}`);
 * }
 *
 * // Usage with different buffer types
 * const floatData = new Float32Array(10);
 * const byteData = new Uint8Array(40);
 *
 * readMemoryBlock(memory, 0x1000000n, floatData);
 * readMemoryBlock(memory, 0x1000100n, byteData);
 * ```
 *
 * @example
 * ```typescript
 * // Custom memory reader with automatic buffer allocation
 * function createScratchBuffer(size: number, type: 'bytes' | 'floats' | 'ints'): Scratch {
 *   switch (type) {
 *     case 'bytes': return new Uint8Array(size);
 *     case 'floats': return new Float32Array(size);
 *     case 'ints': return new Int32Array(size);
 *     default: throw new Error('Unknown buffer type');
 *   }
 * }
 *
 * const scratchBuffer = createScratchBuffer(1024, 'bytes');
 * memory.read(someAddress, scratchBuffer);
 * ```
 */
export type Scratch = BigInt64Array | BigUint64Array | Buffer | Float32Array | Float64Array | DataView | Int16Array | Int32Array | Int8Array | Uint16Array | Uint8Array | Uint8ClampedArray | Uint32Array;

/**
 * Represents a 2D vector with x and y components.
 *
 * Vector2 is commonly used for:
 * - 2D positions and coordinates
 * - Screen/UI coordinates
 * - Texture coordinates (UV mapping)
 * - 2D velocities and directions
 * - Size and dimension data
 * - Mouse cursor positions
 *
 * @example
 * ```typescript
 * const memory = new Memory('2d_game.exe');
 *
 * // Read player position in 2D space
 * const playerPos: Vector2 = memory.vector2(0x12345678n);
 * console.log(`Player at (${playerPos.x}, ${playerPos.y})`);
 *
 * // Move player to a new location
 * const newPosition: Vector2 = { x: 100.5, y: 200.7 };
 * memory.vector2(0x12345678n, newPosition);
 * ```
 *
 * @example
 * ```typescript
 * // Read array of waypoints for 2D pathfinding
 * const waypointCount = 10;
 * const waypoints: Vector2[] = memory.vector2Array(0x12345678n, waypointCount);
 *
 * // Process each waypoint
 * waypoints.forEach((point, index) => {
 *   console.log(`Waypoint ${index}: (${point.x}, ${point.y})`);
 * });
 *
 * // Add a new waypoint at the end
 * waypoints.push({ x: 500, y: 300 });
 * memory.vector2Array(0x12345678n, waypoints);
 * ```
 *
 * @example
 * ```typescript
 * // Vector math operations
 * function distance2D(a: Vector2, b: Vector2): number {
 *   const dx = b.x - a.x;
 *   const dy = b.y - a.y;
 *   return Math.sqrt(dx * dx + dy * dy);
 * }
 *
 * function add2D(a: Vector2, b: Vector2): Vector2 {
 *   return { x: a.x + b.x, y: a.y + b.y };
 * }
 *
 * const playerPos = memory.vector2(0x12345678n);
 * const targetPos = memory.vector2(0x12345688n);
 * const distanceToTarget = distance2D(playerPos, targetPos);
 *
 * console.log(`Distance to target: ${distanceToTarget.toFixed(2)}`);
 * ```
 */
export type Vector2 = {
  /**
   * X coordinate component.
   *
   * In most coordinate systems:
   * - Represents horizontal position
   * - Positive values typically go right
   * - For screen coordinates, usually increases left-to-right
   *
   * @example
   * ```typescript
   * const screenPos: Vector2 = { x: 640, y: 480 }; // Center of 1280x960 screen
   * const worldPos: Vector2 = { x: -15.5, y: 23.7 }; // World coordinates
   * ```
   */
  x: number;

  /**
   * Y coordinate component.
   *
   * In most coordinate systems:
   * - Represents vertical position
   * - Direction (up/down) depends on the coordinate system
   * - Screen coordinates often have Y increasing downward
   * - World coordinates often have Y increasing upward
   *
   * @example
   * ```typescript
   * // Screen coordinates (Y increases downward)
   * const uiElement: Vector2 = { x: 100, y: 50 }; // 100 pixels right, 50 pixels down
   *
   * // 3D world coordinates (Y often increases upward)
   * const worldPoint: Vector2 = { x: 10, y: 25 }; // 10 units east, 25 units up
   * ```
   */
  y: number;
};

/**
 * Represents a 3D vector with x, y, and z components.
 *
 * Vector3 is commonly used for:
 * - 3D positions and coordinates
 * - 3D velocities and directions
 * - Surface normals in 3D graphics
 * - RGB color values (though usually normalized to 0-1)
 * - 3D rotations (Euler angles)
 * - Scale factors for 3D objects
 * - Physics forces and accelerations
 *
 * @example
 * ```typescript
 * const memory = new Memory('3d_game.exe');
 *
 * // Read player position in 3D world
 * const playerPos: Vector3 = memory.vector3(0x12345678n);
 * console.log(`Player at (${playerPos.x}, ${playerPos.y}, ${playerPos.z})`);
 *
 * // Teleport player to spawn point
 * const spawnPoint: Vector3 = { x: 0, y: 10, z: 0 };
 * memory.vector3(0x12345678n, spawnPoint);
 * ```
 *
 * @example
 * ```typescript
 * // Read array of 3D model vertices
 * const vertexCount = 1000;
 * const vertices: Vector3[] = memory.vector3Array(0x12345678n, vertexCount);
 *
 * // Find the bounding box of the model
 * let minX = Infinity, minY = Infinity, minZ = Infinity;
 * let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
 *
 * vertices.forEach(vertex => {
 *   minX = Math.min(minX, vertex.x);
 *   maxX = Math.max(maxX, vertex.x);
 *   minY = Math.min(minY, vertex.y);
 *   maxY = Math.max(maxY, vertex.y);
 *   minZ = Math.min(minZ, vertex.z);
 *   maxZ = Math.max(maxZ, vertex.z);
 * });
 *
 * console.log(`Bounding box: (${minX}, ${minY}, ${minZ}) to (${maxX}, ${maxY}, ${maxZ})`);
 * ```
 *
 * @example
 * ```typescript
 * // Vector math operations for 3D
 * function distance3D(a: Vector3, b: Vector3): number {
 *   const dx = b.x - a.x;
 *   const dy = b.y - a.y;
 *   const dz = b.z - a.z;
 *   return Math.sqrt(dx * dx + dy * dy + dz * dz);
 * }
 *
 * function normalize3D(v: Vector3): Vector3 {
 *   const length = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
 *   if (length === 0) return { x: 0, y: 0, z: 0 };
 *   return { x: v.x / length, y: v.y / length, z: v.z / length };
 * }
 *
 * function crossProduct(a: Vector3, b: Vector3): Vector3 {
 *   return {
 *     x: a.y * b.z - a.z * b.y,
 *     y: a.z * b.x - a.x * b.z,
 *     z: a.x * b.y - a.y * b.x
 *   };
 * }
 *
 * const forward = memory.vector3(0x12345678n);
 * const right = memory.vector3(0x12345688n);
 * const up = crossProduct(forward, right); // Calculate up vector
 * ```
 *
 * @example
 * ```typescript
 * // Color manipulation using Vector3
 * const playerColor: Vector3 = memory.vector3(0x12345678n);
 *
 * // Assuming RGB values are in 0-255 range
 * console.log(`Player color: R=${playerColor.x}, G=${playerColor.y}, B=${playerColor.z}`);
 *
 * // Set player color to bright red
 * const brightRed: Vector3 = { x: 255, y: 0, z: 0 };
 * memory.vector3(0x12345678n, brightRed);
 * ```
 */
export type Vector3 = {
  /**
   * X coordinate component.
   *
   * In 3D coordinate systems:
   * - Often represents the horizontal axis (left-right)
   * - In right-handed systems, positive X typically points right
   * - In left-handed systems, positive X typically points right
   * - May represent red component in RGB color contexts
   *
   * @example
   * ```typescript
   * const position: Vector3 = { x: 15.5, y: 0, z: -10 }; // 15.5 units right
   * const color: Vector3 = { x: 255, y: 128, z: 64 };      // Red component = 255
   * ```
   */
  x: number;

  /**
   * Y coordinate component.
   *
   * In 3D coordinate systems:
   * - Often represents the vertical axis (up-down)
   * - In right-handed systems, positive Y typically points up
   * - In some graphics systems, positive Y may point down
   * - May represent green component in RGB color contexts
   *
   * @example
   * ```typescript
   * const position: Vector3 = { x: 0, y: 10.5, z: 0 }; // 10.5 units up
   * const color: Vector3 = { x: 255, y: 128, z: 64 };   // Green component = 128
   * ```
   */
  y: number;

  /**
   * Z coordinate component.
   *
   * In 3D coordinate systems:
   * - Often represents the depth axis (forward-backward)
   * - In right-handed systems, positive Z typically points toward viewer
   * - In left-handed systems, positive Z typically points away from viewer
   * - May represent blue component in RGB color contexts
   *
   * @example
   * ```typescript
   * const position: Vector3 = { x: 0, y: 0, z: -5.2 }; // 5.2 units away (right-handed)
   * const color: Vector3 = { x: 255, y: 128, z: 64 };   // Blue component = 64
   * ```
   */
  z: number;
};
