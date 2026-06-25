import { Buffer } from 'node:buffer';
import { type Pointer, ptr } from 'bun:ffi';

class Scratch {
  public readonly buffer: Buffer;
  public readonly ptr: Pointer;

  public readonly dataView: DataView;
  public readonly f16: Float16Array;
  public readonly f32: Float32Array;
  public readonly f64: Float64Array;
  public readonly i16: Int16Array;
  public readonly i32: Int32Array;
  public readonly i64: BigInt64Array;
  public readonly i8: Int8Array;
  public readonly u16: Uint16Array;
  public readonly u32: Uint32Array;
  public readonly u64: BigUint64Array;
  public readonly u8: Uint8Array;

  public constructor(lengthOrValue: number | number[]) {
    this.buffer = typeof lengthOrValue === 'number' ? Buffer.allocUnsafe(lengthOrValue) : Buffer.from(lengthOrValue);

    const { buffer, byteOffset, byteLength } = this.buffer;

    this.dataView = new DataView(buffer, byteOffset, byteLength);
    this.f16 = new Float16Array(buffer, byteOffset, byteLength >>> 1);
    this.f32 = new Float32Array(buffer, byteOffset, byteLength >>> 2);
    this.f64 = new Float64Array(buffer, byteOffset, byteLength >>> 3);
    this.i16 = new Int16Array(buffer, byteOffset, byteLength >>> 1);
    this.i32 = new Int32Array(buffer, byteOffset, byteLength >>> 2);
    this.i64 = new BigInt64Array(buffer, byteOffset, byteLength >>> 3);
    this.i8 = new Int8Array(buffer, byteOffset, byteLength);
    this.u16 = new Uint16Array(buffer, byteOffset, byteLength >>> 1);
    this.u32 = new Uint32Array(buffer, byteOffset, byteLength >>> 2);
    this.u64 = new BigUint64Array(buffer, byteOffset, byteLength >>> 3);
    this.u8 = new Uint8Array(buffer, byteOffset, byteLength);

    this.ptr = ptr(this.buffer);
  }
}

export default Scratch;
export { Scratch };
