import type { FFIType, Pointer } from 'bun:ffi';

export type CallResult<R extends FFIType> = R extends typeof FFIType.bool
  ? boolean
  : R extends typeof FFIType.f32 | typeof FFIType.f64 | typeof FFIType.i8 | typeof FFIType.i16 | typeof FFIType.i32 | typeof FFIType.u8 | typeof FFIType.u16 | typeof FFIType.u32
  ? number
  : R extends typeof FFIType.i64 | typeof FFIType.u64
  ? bigint
  : R extends typeof FFIType.cstring | typeof FFIType.ptr
  ? bigint | Pointer
  : void;

export type CallSignature = {
  args: (
    | { type: typeof FFIType.bool; value: boolean }
    | { type: typeof FFIType.cstring; value: ArrayBuffer | ArrayBufferView | bigint | Buffer | null | number | string }
    | { type: typeof FFIType.f32; value: number }
    | { type: typeof FFIType.f64; value: number }
    | { type: typeof FFIType.i8; value: number }
    | { type: typeof FFIType.i16; value: number }
    | { type: typeof FFIType.i32; value: number }
    | { type: typeof FFIType.i64; value: bigint }
    | { type: typeof FFIType.ptr; value: ArrayBuffer | ArrayBufferView | bigint | Buffer | null | number | Pointer }
    | { type: typeof FFIType.u8; value: number }
    | { type: typeof FFIType.u16; value: number }
    | { type: typeof FFIType.u32; value: number }
    | { type: typeof FFIType.u64; value: bigint }
  )[];
  returns: FFIType;
};

/**
 * Represents a loaded module in a process.
 * @property base Base address of the module.
 * @property name Module filename.
 * @property size Module size in bytes.
 * @example
 * ```ts
 * const cs2 = new Memory('cs2.exe');
 * const mainModule = cs2.modules['cs2.exe'];
 * ```
 */
export type Module = {
  /** Base address of the module. */
  base: bigint;
  /** Module filename. */
  name: string;
  /** Module size in bytes. */
  size: number;
};

/**
 * Represents a contiguous vector of unsigned 32-bit integers.
 * @example
 * ```ts
 * const cs2 = new Memory('cs2.exe');
 * const myVector = cs2.networkUtlVector(0x12345678n);
 * ```
 */
export type NetworkUtlVector = Uint32Array;

/**
 * Represents a 2D point.
 * @property x X coordinate.
 * @property y Y coordinate.
 * @example
 * ```ts
 * const cs2 = new Memory('cs2.exe');
 * const myPoint = cs2.point(0x12345678n);
 * ```
 */
export type Point = {
  /** X coordinate. */
  x: number;
  /** Y coordinate. */
  y: number;
};

/**
 * Represents a quaternion for 3D rotations.
 * @property w W component.
 * @property x X component.
 * @property y Y component.
 * @property z Z component.
 * @example
 * ```ts
 * const cs2 = new Memory('cs2.exe');
 * const myQuaternion = cs2.quaternion(0x12345678n);
 * ```
 */
export type Quaternion = {
  /** W component. */
  w: number;
  /** X component. */
  x: number;
  /** Y component. */
  y: number;
  /** Z component. */
  z: number;
};

/**
 * Represents an orientation using Euler angles.
 * @property pitch Pitch (X axis).
 * @property roll Roll (Z axis).
 * @property yaw Yaw (Y axis).
 * @example
 * ```ts
 * const cs2 = new Memory('cs2.exe');
 * const myQAngle = cs2.qAngle(0x12345678n);
 * ```
 */
export interface QAngle {
  /** Pitch (X axis). */
  pitch: number;
  /** Roll (Z axis). */
  roll: number;
  /** Yaw (Y axis). */
  yaw: number;
}

/**
 * Represents an RGB color.
 * @property r Red.
 * @property g Green.
 * @property b Blue.
 * @example
 * ```ts
 * const cs2 = new Memory('cs2.exe');
 * const myRGB = cs2.rgb(0x12345678n);
 * ```
 */
export type RGB = {
  /** Red. */
  r: number;
  /** Green. */
  g: number;
  /** Blue. */
  b: number;
};

/**
 * Represents an RGBA color.
 * @property r Red.
 * @property g Green.
 * @property b Blue.
 * @property a Alpha.
 * @example
 * ```ts
 * const cs2 = new Memory('cs2.exe');
 * const myRGBA = cs2.rgba(0x12345678n);
 * ```
 */
export type RGBA = {
  /** Red. */
  r: number;
  /** Green. */
  g: number;
  /** Blue. */
  b: number;
  /** Alpha. */
  a: number;
};

/**
 * Represents a memory region.
 * @property base Base address.
 * @property protect Protection flags.
 * @property size Size in bytes.
 * @property state State.
 * @property type Type.
 * @example
 * ```ts
 * // Used internally by Memory
 * ```
 */
export type Region = {
  /** Base address. */
  base: bigint;
  /** Protection flags. */
  protect: number;
  /** Size in bytes. */
  size: bigint;
  /** State. */
  state: number;
  /** Type. */
  type: number;
};

/**
 * Represents a buffer usable for memory operations.
 * @example
 * ```ts
 * const cs2 = new Memory('cs2.exe');
 * const myBuffer = new Uint8Array(4);
 * cs2.read(0x12345678n, myBuffer);
 * ```
 */
export type Scratch = BigInt64Array | BigUint64Array | Buffer | Float32Array | Float64Array | DataView | Int16Array | Int32Array | Int8Array | Uint16Array | Uint8Array | Uint8ClampedArray | Uint32Array;

/**
 * Represents a 2D vector.
 * @property x X coordinate.
 * @property y Y coordinate.
 * @example
 * ```ts
 * const cs2 = new Memory('cs2.exe');
 * const myVector2 = cs2.vector2(0x12345678n);
 * ```
 */
export type Vector2 = {
  /** X coordinate. */
  x: number;
  /** Y coordinate. */
  y: number;
};

export type UPtr = bigint;

export type UPtrArray = BigUint64Array;

/**
 * Represents a 3D vector.
 * @property x X coordinate.
 * @property y Y coordinate.
 * @property z Z coordinate.
 * @example
 * ```ts
 * const cs2 = new Memory('cs2.exe');
 * const myVector3 = cs2.vector3(0x12345678n);
 * ```
 */
export type Vector3 = {
  /** X coordinate. */
  x: number;
  /** Y coordinate. */
  y: number;
  /** Z coordinate. */
  z: number;
};

/**
 * Represents a 4D vector.
 * @property w W component.
 * @property x X component.
 * @property y Y component.
 * @property z Z component.
 * @example
 * ```ts
 * const cs2 = new Memory('cs2.exe');
 * const myVector4 = cs2.vector4(0x12345678n);
 * ```
 */
export type Vector4 = {
  /** W component. */
  w: number;
  /** X component. */
  x: number;
  /** Y component. */
  y: number;
  /** Z component. */
  z: number;
};
