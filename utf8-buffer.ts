const textDecoder = new TextDecoder();
const hasBuffer = typeof Buffer !== "undefined";

export function unpack(buffer: Uint8Array, start = 0, end = buffer.length): string {
  if (end - start < 1) return "";

  // Fast path: use Buffer.toString() in Node.js (avoids subarray overhead)
  if (hasBuffer && Buffer.isBuffer(buffer)) {
    return buffer.toString("utf8", start, end);
  }

  // Standard path: TextDecoder
  if (start === 0 && end === buffer.length) {
    return textDecoder.decode(buffer);
  }
  return textDecoder.decode(buffer.subarray(start, end));
}

export function pack(str: string, buffer: Uint8Array, index = 0): number {
  let c1: number, c2: number;
  for (let i = 0; i < str.length; i++) {
    c1 = str.charCodeAt(i);
    if (c1 < 128) {
      buffer[index++] = c1;
    } else if (c1 < 2048) {
      buffer[index++] = (c1 >> 6) | 192;
      buffer[index++] = (c1 & 63) | 128;
    } else if ((c1 & 0xfc00) === 0xd800 && ((c2 = str.charCodeAt(i + 1)) & 0xfc00) === 0xdc00) {
      c1 = 0x10000 + ((c1 & 0x03ff) << 10) + (c2 & 0x03ff);
      i++;
      buffer[index++] = (c1 >> 18) | 240;
      buffer[index++] = ((c1 >> 12) & 63) | 128;
      buffer[index++] = ((c1 >> 6) & 63) | 128;
      buffer[index++] = (c1 & 63) | 128;
    } else {
      buffer[index++] = (c1 >> 12) | 224;
      buffer[index++] = ((c1 >> 6) & 63) | 128;
      buffer[index++] = (c1 & 63) | 128;
    }
  }
  return index;
}
