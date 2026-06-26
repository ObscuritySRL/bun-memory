import type { FFIType, FFITypeOrString, FFITypeToArgsType, FFITypeToReturnsType, Pointer, ToFFIType } from 'bun:ffi';

/**
 * Any typed array or buffer that can be used as a memory region for reading/writing.
 * @example
 * ```ts
 * const cs2 = new Process('cs2.exe');
 * const myBuffer = new Uint8Array(4);
 * cs2.read(0x12345678n, myBuffer);
 * ```
 */
export type BufferLike = BigInt64Array | BigUint64Array | Buffer | DataView | Float16Array | Float32Array | Float64Array | Int16Array | Int32Array | Int8Array | Uint16Array | Uint32Array | Uint8Array | Uint8ClampedArray;

export type CallArgument<Type extends FFITypeOrString> =
  ToFFIType<Type> extends FFIType.bool ? boolean : ToFFIType<Type> extends FFIType.cstring | FFIType.function | FFIType.ptr | FFIType.pointer ? CallPointer | null : FFITypeToArgsType[ToFFIType<Type>];

export type CallArguments<Signature extends CallSignature> = Signature['args'] extends infer Arguments extends readonly FFITypeOrString[] ? { [Index in keyof Arguments]: CallArgument<Arguments[Index]> } : never;

export type CallPointer = Pointer | bigint;

export type CallReturn<Signature extends CallSignature> = [unknown] extends [Signature['returns']]
  ? undefined
  : ToFFIType<NonNullable<Signature['returns']>> extends FFIType.cstring | FFIType.function | FFIType.ptr | FFIType.pointer
    ? bigint
    : FFITypeToReturnsType[ToFFIType<NonNullable<Signature['returns']>>];

export type CallSignature = {
  readonly args: readonly FFITypeOrString[];
  readonly returns: FFITypeOrString;
};

/**
 * A single hexadecimal character (0-9, a-f, A-F).
 */
export type HexChar = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | 'a' | 'b' | 'c' | 'd' | 'e' | 'f' | 'A' | 'B' | 'C' | 'D' | 'E' | 'F';

/**
 * A single byte in a pattern (two hex chars or a wildcard).
 */
export type PatternByte = `${HexChar}${HexChar}` | PatternWildcard;

/**
 * A wildcard byte pattern that matches any byte.
 */
export type PatternWildcard = '**' | '??';

/**
 * Represents a 2D point.
 * @property x X coordinate.
 * @property y Y coordinate.
 * @example
 * ```ts
 * const cs2 = new Process('cs2.exe');
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
 * Represents an orientation using Euler angles.
 * @property pitch Pitch (X axis).
 * @property roll Roll (Z axis).
 * @property yaw Yaw (Y axis).
 * @example
 * ```ts
 * const cs2 = new Process('cs2.exe');
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
 * Represents a quaternion for 3D rotations.
 * @property w W component.
 * @property x X component.
 * @property y Y component.
 * @property z Z component.
 * @example
 * ```ts
 * const cs2 = new Process('cs2.exe');
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
 * Represents an RGB color.
 * @property r Red.
 * @property g Green.
 * @property b Blue.
 * @example
 * ```ts
 * const cs2 = new Process('cs2.exe');
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
 * const cs2 = new Process('cs2.exe');
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

export type UPtr = bigint;

export type UPtrArray = BigUint64Array;

/**
 * Represents a 2D vector.
 * @property x X coordinate.
 * @property y Y coordinate.
 * @example
 * ```ts
 * const cs2 = new Process('cs2.exe');
 * const myVector2 = cs2.vector2(0x12345678n);
 * ```
 */
export type Vector2 = {
  /** X coordinate. */
  x: number;
  /** Y coordinate. */
  y: number;
};

/**
 * Represents a 3D vector.
 * @property x X coordinate.
 * @property y Y coordinate.
 * @property z Z coordinate.
 * @example
 * ```ts
 * const cs2 = new Process('cs2.exe');
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
 * const cs2 = new Process('cs2.exe');
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
