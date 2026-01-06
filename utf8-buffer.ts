const textDecoder = new TextDecoder();
const hasBuffer = typeof Buffer !== "undefined";

export function unpack(buffer: Uint8Array, start = 0, end = buffer.length): string {
  const len = end - start;
  if (len < 1) return "";

  // Node.js: use Buffer.toString()
  if (hasBuffer && Buffer.isBuffer(buffer)) {
    return buffer.toString("utf8", start, end);
  }

  // Long strings: use TextDecoder
  if (len > 64) {
    return textDecoder.decode(buffer.subarray(start, end));
  }

  // Short strings: use pure JS
  const chunks: number[] = [];
  let i = 0;
  let t: number;
  while (start < end) {
    t = buffer[start++]!;
    if (t < 128) {
      chunks[i++] = t;
    } else if (t > 191 && t < 224) {
      chunks[i++] = ((t & 31) << 6) | (buffer[start++]! & 63);
    } else if (t > 239 && t < 365) {
      t =
        (((t & 7) << 18) | ((buffer[start++]! & 63) << 12) | ((buffer[start++]! & 63) << 6) | (buffer[start++]! & 63)) -
        0x10000;
      chunks[i++] = 0xd800 + (t >> 10);
      chunks[i++] = 0xdc00 + (t & 1023);
    } else {
      chunks[i++] = ((t & 15) << 12) | ((buffer[start++]! & 63) << 6) | (buffer[start++]! & 63);
    }
  }
  return String.fromCharCode.apply(String, chunks);
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
