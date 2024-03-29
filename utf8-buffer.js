/*
 * Copyright (c) 2018 Rafael da Silva Rocha.
 *
 * Permission is hereby granted, free of charge, to any person obtaining
 * a copy of this software and associated documentation files (the
 * "Software"), to deal in the Software without restriction, including
 * without limitation the rights to use, copy, modify, merge, publish,
 * distribute, sublicense, and/or sell copies of the Software, and to
 * permit persons to whom the Software is furnished to do so, subject to
 * the following conditions:
 *
 * The above copyright notice and this permission notice shall be
 * included in all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
 * EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
 * MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
 * NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE
 * LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
 * OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
 * WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 *
 */

/**
 * @fileoverview Functions to serialize and deserialize UTF-8 strings.
 * @see https://github.com/rochars/utf8-buffer
 * @see https://encoding.spec.whatwg.org/#the-encoding
 * @see https://encoding.spec.whatwg.org/#utf-8-encoder
 */

/** @module utf8-buffer */

/**
 * Read a string of UTF-8 characters from a byte buffer.
 * Invalid characters are replaced with 'REPLACEMENT CHARACTER' (U+FFFD).
 * @see https://encoding.spec.whatwg.org/#the-encoding
 * @see https://stackoverflow.com/a/34926911
 * @param {!Uint8Array|!Array<number>} buffer A byte buffer.
 * @param {number=} start The buffer index to start reading.
 * @param {?number=} end The buffer index to stop reading.
 *   Assumes the buffer length if undefined.
 * @return {string}
 */
export function unpack(buffer, start = 0, end = buffer.length) {
  /** @type {string} */
  let str = "";
  for (let index = start; index < end; ) {
    /** @type {number} */
    let lowerBoundary = 0x80;
    /** @type {number} */
    let upperBoundary = 0xbf;
    /** @type {boolean} */
    let replace = false;
    /** @type {number} */
    let charCode = buffer[index++];
    if (charCode >= 0x00 && charCode <= 0x7f) {
      str += String.fromCharCode(charCode);
    } else {
      /** @type {number} */
      let count = 0;
      if (charCode >= 0xc2 && charCode <= 0xdf) {
        count = 1;
      } else if (charCode >= 0xe0 && charCode <= 0xef) {
        count = 2;
        if (buffer[index] === 0xe0) {
          lowerBoundary = 0xa0;
        }
        if (buffer[index] === 0xed) {
          upperBoundary = 0x9f;
        }
      } else if (charCode >= 0xf0 && charCode <= 0xf4) {
        count = 3;
        if (buffer[index] === 0xf0) {
          lowerBoundary = 0x90;
        }
        if (buffer[index] === 0xf4) {
          upperBoundary = 0x8f;
        }
      } else {
        replace = true;
      }
      charCode = charCode & ((1 << (8 - count - 1)) - 1);
      for (let i = 0; i < count; i++) {
        if (buffer[index] < lowerBoundary || buffer[index] > upperBoundary) {
          replace = true;
        }
        charCode = (charCode << 6) | (buffer[index] & 0x3f);
        index++;
      }
      if (replace) {
        str += String.fromCharCode(0xfffd);
      } else if (charCode <= 0xffff) {
        str += String.fromCharCode(charCode);
      } else {
        charCode -= 0x10000;
        str += String.fromCharCode(((charCode >> 10) & 0x3ff) + 0xd800, (charCode & 0x3ff) + 0xdc00);
      }
    }
  }
  return str;
}

/**
 * Write a string of UTF-8 characters to a byte buffer.
 * @see https://encoding.spec.whatwg.org/#utf-8-encoder
 * @param {string} str The string to pack.
 * @param {!Uint8Array|!Array<number>} buffer The buffer to pack the string to.
 * @param {number=} index The buffer index to start writing.
 * @return {number} The next index to write in the buffer.
 */
export function pack(str, buffer, index = 0) {
  for (let i = 0, len = str.length; i < len; i++) {
    /** @type {number} */
    let codePoint = str.codePointAt(i);
    if (codePoint < 128) {
      buffer[index] = codePoint;
      index++;
    } else {
      /** @type {number} */
      let count = 0;
      /** @type {number} */
      let offset = 0;
      if (codePoint <= 0x07ff) {
        count = 1;
        offset = 0xc0;
      } else if (codePoint <= 0xffff) {
        count = 2;
        offset = 0xe0;
      } else if (codePoint <= 0x10ffff) {
        count = 3;
        offset = 0xf0;
        i++;
      }
      buffer[index] = (codePoint >> (6 * count)) + offset;
      index++;
      while (count > 0) {
        buffer[index] = 0x80 | ((codePoint >> (6 * (count - 1))) & 0x3f);
        index++;
        count--;
      }
    }
  }
  return index;
}
