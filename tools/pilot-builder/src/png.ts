import { deflateSync, inflateSync } from "node:zlib";

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function makeChunk(type: string, data: Uint8Array): Buffer {
  const len = data.length;
  const out = Buffer.allocUnsafe(12 + len);
  out.writeUInt32BE(len, 0);
  out.write(type, 4, 4, "ascii");
  Buffer.from(data.buffer, data.byteOffset, data.byteLength).copy(out, 8);
  const crc = crc32(out.subarray(4, 8 + len));
  out.writeUInt32BE(crc, 8 + len);
  return out;
}

/**
 * Lossless RGBA8 PNG encoder using Sub (filter=1) scanlines for compact lossless data and color tiles.
 */
export function encodePngRgba(width: number, height: number, rgba: Uint8Array): Buffer {
  if (rgba.length !== width * height * 4) {
    throw new Error(`Expected ${width * height * 4} bytes, got ${rgba.length}`);
  }

  const ihdr = Buffer.allocUnsafe(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const stride = width * 4;
  const raw = Buffer.allocUnsafe(height * (1 + stride));

  for (let y = 0; y < height; y++) {
    const srcRow = y * stride;
    const dstRow = y * (1 + stride);
    raw[dstRow] = 1; // Filter type 1: Sub
    for (let x = 0; x < stride; x++) {
      const val = rgba[srcRow + x]!;
      const left = x >= 4 ? rgba[srcRow + x - 4]! : 0;
      raw[dstRow + 1 + x] = (val - left) & 0xff;
    }
  }

  const compressed = deflateSync(raw, { level: 4 });
  return Buffer.concat([
    PNG_SIGNATURE,
    makeChunk("IHDR", ihdr),
    makeChunk("IDAT", compressed),
    makeChunk("IEND", Buffer.alloc(0)),
  ]);
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

export function decodePngRgba(buffer: Uint8Array): {
  width: number;
  height: number;
  data: Uint8Array;
} {
  const buf = Buffer.from(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  if (buf.subarray(0, 8).compare(PNG_SIGNATURE) !== 0) {
    throw new Error("Invalid PNG signature");
  }

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idatChunks: Buffer[] = [];

  while (offset + 8 <= buf.length) {
    const len = buf.readUInt32BE(offset);
    const type = buf.toString("ascii", offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + len;
    if (type === "IHDR") {
      width = buf.readUInt32BE(dataStart);
      height = buf.readUInt32BE(dataStart + 4);
      bitDepth = buf[dataStart + 8]!;
      colorType = buf[dataStart + 9]!;
      if (bitDepth !== 8 || colorType !== 6) {
        throw new Error(`Unsupported PNG format (bitDepth=${bitDepth}, colorType=${colorType})`);
      }
    } else if (type === "IDAT") {
      idatChunks.push(buf.subarray(dataStart, dataEnd));
    } else if (type === "IEND") {
      break;
    }
    offset = dataEnd + 4;
  }

  const raw = inflateSync(Buffer.concat(idatChunks));
  const stride = width * 4;
  const out = new Uint8Array(height * stride);

  for (let y = 0; y < height; y++) {
    const rowStart = y * (1 + stride);
    const filter = raw[rowStart]!;
    const outRow = y * stride;
    const prevRow = (y - 1) * stride;

    for (let x = 0; x < stride; x++) {
      const rawByte = raw[rowStart + 1 + x]!;
      const left = x >= 4 ? out[outRow + x - 4]! : 0;
      const up = y > 0 ? out[prevRow + x]! : 0;
      const upLeft = y > 0 && x >= 4 ? out[prevRow + x - 4]! : 0;

      let recon = rawByte;
      if (filter === 1) recon = (rawByte + left) & 0xff;
      else if (filter === 2) recon = (rawByte + up) & 0xff;
      else if (filter === 3) recon = (rawByte + ((left + up) >> 1)) & 0xff;
      else if (filter === 4) recon = (rawByte + paeth(left, up, upLeft)) & 0xff;
      else if (filter !== 0) throw new Error(`Unsupported PNG filter ${filter}`);

      out[outRow + x] = recon;
    }
  }

  return { width, height, data: out };
}
