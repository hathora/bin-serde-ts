import { pack, unpack } from "./utf8-buffer.js";
import utf8Size from "utf8-buffer-size";

export class Writer {
  private pos = 0;
  private bytes: Uint8Array;
  private _view: DataView | null = null;

  constructor(initialSize = 256) {
    this.bytes = new Uint8Array(Math.max(initialSize, 16));
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
    if (val < 0x80) {
      this.writeUInt8(val);
    } else if (val < 0x4000) {
      this.writeUInt16((val & 0x7f) | ((val & 0x3f80) << 1) | 0x8000);
    } else if (val < 0x200000) {
      this.writeUInt8((val >> 14) | 0x80);
      this.writeUInt16((val & 0x7f) | ((val & 0x3f80) << 1) | 0x8000);
    } else if (val < 0x10000000) {
      this.writeUInt32(
        (val & 0x7f) | ((val & 0x3f80) << 1) | ((val & 0x1fc000) << 2) | ((val & 0xfe00000) << 3) | 0x80808000
      );
    } else if (val < 0x800000000) {
      this.writeUInt8(Math.floor(val / 0x10000000) | 0x80);
      this.writeUInt32(
        (val & 0x7f) | ((val & 0x3f80) << 1) | ((val & 0x1fc000) << 2) | ((val & 0xfe00000) << 3) | 0x80808000
      );
    } else if (val < 0x40000000000) {
      const shiftedVal = Math.floor(val / 0x10000000);
      this.writeUInt16((shiftedVal & 0x7f) | ((shiftedVal & 0x3f80) << 1) | 0x8080);
      this.writeUInt32(
        (val & 0x7f) | ((val & 0x3f80) << 1) | ((val & 0x1fc000) << 2) | ((val & 0xfe00000) << 3) | 0x80808000
      );
    } else {
      throw new Error("Value out of range");
    }
    return this;
  }

  writeVarint(val: number) {
    this.writeUVarint((val << 1) ^ (val >> 31));
    return this;
  }

  writeFloat(val: number) {
    this.ensureSize(4);
    this.view.setFloat32(this.pos, val, true);
    this.pos += 4;
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
    const newBytes = new Uint8Array(newSize);
    newBytes.set(this.bytes);
    this.bytes = newBytes;
    this._view = null;
  }

  private get view(): DataView {
    if (!this._view) {
      this._view = new DataView(this.bytes.buffer);
    }
    return this._view;
  }
}

export class Reader {
  private pos = 0;
  private bytes: Uint8Array;
  private view: DataView;

  constructor(buf: Uint8Array) {
    this.bytes = buf;
    this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
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
    let val = 0;
    while (true) {
      const byte = this.readUInt8();
      if (byte < 0x80) {
        return val + byte;
      }
      val = (val + (byte & 0x7f)) * 128;
    }
  }

  readVarint() {
    const val = this.readUVarint();
    return (val >>> 1) ^ -(val & 1);
  }

  readFloat() {
    const val = this.view.getFloat32(this.pos, true);
    this.pos += 4;
    return val;
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
}
