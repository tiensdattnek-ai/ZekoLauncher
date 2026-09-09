/**
 * Trình đọc ZIP/JAR tối giản — chỉ đọc, không ghi.
 * Đủ để Zeko Sentinel liệt kê entry, đọc magic bytes và xem trước nội dung
 * mà không cần giải nén toàn bộ ra đĩa.
 */
import fs from 'node:fs/promises';

const EOCD_SIG = 0x06054b50;
const ZIP64_EOCD_SIG = 0x06064b50;
const CD_SIG = 0x02014b50;
const LFH_SIG = 0x04034b50;

export class ZipReader {
  constructor(fd, size) {
    this.fd = fd;
    this.size = size;
    this.entries = [];
  }

  static async open(file) {
    const handle = await fs.open(file, 'r');
    const { size } = await handle.stat();
    const reader = new ZipReader(handle, size);
    await reader._parse();
    return reader;
  }

  async close() {
    try {
      await this.fd.close();
    } catch {
      /* bỏ qua */
    }
  }

  async _read(pos, len) {
    const buf = Buffer.alloc(len);
    const { bytesRead } = await this.fd.read(buf, 0, len, pos);
    return buf.subarray(0, bytesRead);
  }

  async _findEocd() {
    const maxBack = Math.min(this.size, 66_000);
    const buf = await this._read(this.size - maxBack, maxBack);
    for (let i = buf.length - 22; i >= 0; i--) {
      if (buf.readUInt32LE(i) === EOCD_SIG) return { eocdOffset: this.size - maxBack + i, buf: buf.subarray(i) };
    }
    return null;
  }

  async _parse() {
    const found = await this._findEocd();
    if (!found) throw new Error('Không phải tệp ZIP/JAR hợp lệ (thiếu EOCD)');
    const e = found.buf;
    let count = e.readUInt16LE(10);
    let cdSize = e.readUInt32LE(12);
    let cdOffset = e.readUInt32LE(16);

    // ZIP64
    if (cdOffset === 0xffffffff || count === 0xffff) {
      const loc = await this._read(found.eocdOffset - 20, 20);
      if (loc.length === 20 && loc.readUInt32LE(0) === 0x07064b50) {
        const z64Offset = Number(loc.readBigUInt64LE(8));
        const z64 = await this._read(z64Offset, 56);
        if (z64.readUInt32LE(0) === ZIP64_EOCD_SIG) {
          count = Number(z64.readBigUInt64LE(32));
          cdSize = Number(z64.readBigUInt64LE(40));
          cdOffset = Number(z64.readBigUInt64LE(48));
        }
      }
    }

    if (cdOffset + cdSize > this.size) throw new Error('Central directory vượt quá kích thước tệp');
    const cd = await this._read(cdOffset, cdSize);

    let p = 0;
    let guard = 0;
    while (p + 46 <= cd.length && guard++ < count + 8) {
      if (cd.readUInt32LE(p) !== CD_SIG) break;
      const method = cd.readUInt16LE(p + 10);
      const crc = cd.readUInt32LE(p + 16);
      const compSize = cd.readUInt32LE(p + 20);
      const uncompSize = cd.readUInt32LE(p + 24);
      const nameLen = cd.readUInt16LE(p + 28);
      const extraLen = cd.readUInt16LE(p + 30);
      const commentLen = cd.readUInt16LE(p + 32);
      const localOffset = cd.readUInt32LE(p + 42);
      const name = cd.subarray(p + 46, p + 46 + nameLen).toString('utf8');
      this.entries.push({ name, method, crc, compSize, uncompSize, localOffset, dir: name.endsWith('/') });
      p += 46 + nameLen + extraLen + commentLen;
    }
  }

  /** Đọc nội dung (đã giải nén store) của một entry. Entry deflate được trả về raw. */
  async readEntry(entry, maxBytes = 4 * 1024 * 1024) {
    const head = await this._read(entry.localOffset, 30);
    if (head.length < 30 || head.readUInt32LE(0) !== LFH_SIG) throw new Error(`Local header hỏng: ${entry.name}`);
    const nameLen = head.readUInt16LE(26);
    const extraLen = head.readUInt16LE(28);
    const dataStart = entry.localOffset + 30 + nameLen + extraLen;
    const len = Math.min(entry.compSize, maxBytes);
    const raw = await this._read(dataStart, len);
    if (entry.method === 0) return raw;
    if (entry.method === 8) {
      try {
        const zlib = await import('node:zlib');
        return zlib.inflateRawSync(raw);
      } catch {
        return null; // deflate một phần / hỏng
      }
    }
    return null;
  }

  /** Lấy mẫu byte thô (kể cả khi nén) để tính entropy. */
  async sampleEntry(entry, bytes = 65536) {
    const head = await this._read(entry.localOffset, 30);
    if (head.length < 30) return Buffer.alloc(0);
    const nameLen = head.readUInt16LE(26);
    const extraLen = head.readUInt16LE(28);
    const dataStart = entry.localOffset + 30 + nameLen + extraLen;
    return this._read(dataStart, Math.min(entry.compSize, bytes));
  }
}

/** Shannon entropy (bits/byte) — >7.5 gần như chắc chắn là dữ liệu nén/mã hoá. */
export function entropy(buf) {
  if (!buf || !buf.length) return 0;
  const freq = new Array(256).fill(0);
  for (const b of buf) freq[b]++;
  let h = 0;
  const n = buf.length;
  for (const f of freq) {
    if (!f) continue;
    const p = f / n;
    h -= p * Math.log2(p);
  }
  return h;
}
