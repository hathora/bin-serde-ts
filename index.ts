import { pack, unpack } from "./utf8-buffer.js";
import utf8Size from "utf8-buffer-size";

const SLAB_SIZE = 8192;
const MAX_POOLED = 4096;

let slab = allocUint8Array(SLAB_SIZE);
let slabOffset = 0;

const f32 = new Float32Array(1);
const f32u8 = new Uint8Array(f32.buffer);

function allocFromSlab(size: number): Uint8Array {
  if (size > MAX_POOLED) {
    // Too large for pool, allocate directly
    return allocUint8Array(size);
  }
  if (slabOffset + size > SLAB_SIZE) {
    // Slab full, allocate new one
    slab = allocUint8Array(SLAB_SIZE);
    slabOffset = 0;
  }
  const buf = slab.subarray(slabOffset, slabOffset + size);
  slabOffset += size;
  return buf;
}

function allocUint8Array(size: number): Uint8Array {
  return typeof Buffer !== "undefined" ? Buffer.allocUnsafe(size) : new Uint8Array(size);
}

export class Writer {
  private pos = 0;
  private bytes: Uint8Array;
  private _view: DataView | null = null; // lazily allocated

  constructor(initialSize = 256) {
    this.bytes = allocFromSlab(Math.max(initialSize, 16));
  }

  writeUInt8(val: number) {
    this.ensureSize(1);
    this.bytes[this.pos++] = val;
    return this;
  }

  writeUInt16(val: number) {
    this.ensureSize(2);
    this.view.setUint16(this.pos, val);
    this.pos += 2;
    return this;
  }

  writeUInt32(val: number) {
    this.ensureSize(4);
    this.view.setUint32(this.pos, val);
    this.pos += 4;
    return this;
  }

  writeUVarint(val: number) {
    // Protobuf-style LEB128: little-endian, 7 bits per byte, MSB is continuation
    // Use Math.floor instead of >>> to handle values > 32 bits
    while (val >= 0x80) {
      this.writeUInt8((val & 0x7f) | 0x80);
      val = Math.floor(val / 128);
    }
    this.writeUInt8(val);
    return this;
  }

  writeVarint(val: number) {
    const encoded = val >= 0 ? val * 2 : val * -2 - 1;
    return this.writeUVarint(encoded);
  }

  writeFloat(val: number) {
    this.ensureSize(4);
    f32[0] = val;
    this.bytes[this.pos++] = f32u8[0]!;
    this.bytes[this.pos++] = f32u8[1]!;
    this.bytes[this.pos++] = f32u8[2]!;
    this.bytes[this.pos++] = f32u8[3]!;
    return this;
  }

  writeBits(bits: boolean[]) {
    const numBytes = Math.ceil(bits.length / 8);
    this.ensureSize(numBytes);
    for (let i = 0; i < bits.length; i += 8) {
      let byte = 0;
      for (let j = 0; j < 8 && i + j < bits.length; j++) {
        if (bits[i + j]) {
          byte |= 1 << j;
        }
      }
      this.bytes[this.pos++] = byte;
    }
    return this;
  }

  writeStringAscii(val: string) {
    if (val.length === 0) {
      return this;
    }
    this.ensureSize(val.length);
    for (let i = 0; i < val.length; i++) {
      this.bytes[this.pos++] = val.charCodeAt(i);
    }
    return this;
  }

  writeStringUtf8(val: string, len?: number) {
    if (len != null) {
      if (len === 0) {
        return this;
      }
      this.ensureSize(len);
      pack(val, this.bytes, this.pos);
      this.pos += len;
      return this;
    }
    if (val.length === 0) {
      this.writeUVarint(0);
      return this;
    }
    const byteSize = utf8Size(val);
    this.writeUVarint(byteSize);
    this.ensureSize(byteSize);
    pack(val, this.bytes, this.pos);
    this.pos += byteSize;
    return this;
  }

  writeBuffer(buf: Uint8Array) {
    this.ensureSize(buf.length);
    this.bytes.set(buf, this.pos);
    this.pos += buf.length;
    return this;
  }

  concat(other: Writer) {
    const otherLen = other.pos;
    this.ensureSize(otherLen);
    if (otherLen < 64) {
      for (let i = 0; i < otherLen; i++) {
        this.bytes[this.pos++] = other.bytes[i];
      }
    } else {
      this.bytes.set(other.bytes.subarray(0, otherLen), this.pos);
      this.pos += otherLen;
    }
    return this;
  }

  toBuffer() {
    return this.bytes.subarray(0, this.pos);
  }

  reset(): this {
    this.pos = 0;
    this.bytes = allocFromSlab(this.bytes.length);
    this._view = null;
    return this;
  }

  get size(): number {
    return this.pos;
  }

  private ensureSize(size: number) {
    if (this.bytes.length >= this.pos + size) {
      return;
    }
    let newSize = this.bytes.length * 2;
    while (newSize < this.pos + size) {
      newSize *= 2;
    }
    const newBytes = allocFromSlab(newSize);
    newBytes.set(this.bytes);
    this.bytes = newBytes;
    this._view = null;
  }

  private get view(): DataView {
    if (!this._view) {
      this._view = new DataView(this.bytes.buffer, this.bytes.byteOffset);
    }
    return this._view;
  }
}

export class Reader {
  private pos = 0;
  private bytes: Uint8Array;
  private _view: DataView | null = null; // lazily allocated

  constructor(buf: Uint8Array) {
    this.bytes = buf;
  }

  readUInt8() {
    return this.bytes[this.pos++];
  }

  readUInt16() {
    const val = this.view.getUint16(this.pos);
    this.pos += 2;
    return val;
  }

  readUInt32() {
    const val = this.view.getUint32(this.pos);
    this.pos += 4;
    return val;
  }

  readUVarint() {
    // Protobuf-style LEB128: little-endian, 7 bits per byte, MSB is continuation
    // Use multiplication instead of << to handle values > 32 bits
    let result = 0;
    let multiplier = 1;
    while (true) {
      const byte = this.readUInt8();
      result += (byte & 0x7f) * multiplier;
      if (byte < 0x80) {
        return result;
      }
      multiplier *= 128;
    }
  }

  readVarint() {
    const val = this.readUVarint();
    return val % 2 === 0 ? val / 2 : -(val + 1) / 2;
  }

  readFloat() {
    f32u8[0] = this.bytes[this.pos++];
    f32u8[1] = this.bytes[this.pos++];
    f32u8[2] = this.bytes[this.pos++];
    f32u8[3] = this.bytes[this.pos++];
    return f32[0];
  }

  readBits(numBits: number) {
    const numBytes = Math.ceil(numBits / 8);
    const bits: boolean[] = [];
    for (let i = 0; i < numBytes; i++) {
      const byte = this.readUInt8();
      for (let j = 0; j < 8 && bits.length < numBits; j++) {
        bits.push(((byte >> j) & 1) === 1);
      }
    }
    return bits;
  }

  readStringAscii(len: number) {
    if (len === 0) {
      return "";
    }
    let val = "";
    for (let i = 0; i < len; i++) {
      val += String.fromCharCode(this.readUInt8());
    }
    return val;
  }

  readStringUtf8(len?: number) {
    if (len == null) {
      len = this.readUVarint();
    }
    if (len === 0) {
      return "";
    }
    const val = unpack(this.bytes, this.pos, this.pos + len);
    this.pos += len;
    return val;
  }

  readBuffer(numBytes: number) {
    const bytes = this.bytes.slice(this.pos, this.pos + numBytes);
    this.pos += numBytes;
    return bytes;
  }

  remaining() {
    return this.bytes.length - this.pos;
  }

  private get view(): DataView {
    if (!this._view) {
      this._view = new DataView(this.bytes.buffer, this.bytes.byteOffset);
    }
    return this._view;
  }
}
