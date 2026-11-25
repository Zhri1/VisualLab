import { describe, expect, it } from "vitest";
import { encodeGif, type GifFrame } from "../gifEncoder";

/* ------------------------------------------------------------------ */
/* 最小 GIF 解析器（测试专用）：读 header / 逻辑屏幕描述 / 扩展 / 图像块， */
/* 并对每帧 LZW 码流做完整解码（可变码宽 9..12，clear/EOI），校验块结构。 */
/* ------------------------------------------------------------------ */

interface ParsedFrame {
  left: number;
  top: number;
  width: number;
  height: number;
  delayCs: number;
  disposal: number;
  minCodeSize: number;
  lzwByteLength: number;
  indices: number[];
}

interface ParsedGif {
  version: string;
  width: number;
  height: number;
  gctSize: number;
  palette: Uint8Array;
  /** NETSCAPE 循环计数；null 表示没有该扩展 */
  loopCount: number | null;
  frames: ParsedFrame[];
  trailer: boolean;
  consumed: number;
}

/** LSB-first 位读取 + 完整 LZW 解码，要求走到 EOI 且像素数恰好等于 w*h */
function decodeLzw(data: Uint8Array, minCodeSize: number, pixelCount: number): number[] {
  const clear = 1 << minCodeSize;
  const eoi = clear + 1;
  let width = minCodeSize + 1;
  let next = eoi + 1;
  let dict: number[][] = [];
  const reset = (): void => {
    dict = [];
    for (let i = 0; i < clear; i++) dict.push([i]);
    dict.push([], []); // clear / eoi 占位
    next = eoi + 1;
    width = minCodeSize + 1;
  };
  reset();

  let bitPos = 0;
  const readCode = (): number => {
    let code = 0;
    for (let i = 0; i < width; i++) {
      const byte = data[bitPos >> 3];
      if (byte === undefined) throw new Error("LZW 码流越界：块结构不完整");
      code |= ((byte >> (bitPos & 7)) & 1) << i;
      bitPos++;
    }
    return code;
  };

  const out: number[] = [];
  let prev: number[] | null = null;
  let sawEoi = false;
  for (;;) {
    const code = readCode();
    if (code === clear) {
      reset();
      prev = null;
      continue;
    }
    if (code === eoi) {
      sawEoi = true;
      break;
    }
    let entry: number[];
    if (code < dict.length && dict[code].length > 0) {
      entry = dict[code];
    } else if (code === next && next <= 4095 && prev !== null) {
      entry = [...prev, prev[0]]; // KwKwK 情形
    } else {
      throw new Error(`非法 LZW 码 ${code}（next=${next}, width=${width}）`);
    }
    for (const v of entry) out.push(v);
    if (prev !== null && next <= 4095) {
      dict[next] = [...prev, entry[0]];
      next++;
      if (next === 1 << width && width < 12) width++;
    }
    prev = entry;
  }
  if (!sawEoi) throw new Error("LZW 码流未以 EOI 结束");
  if (out.length !== pixelCount) {
    throw new Error(`LZW 解码像素数 ${out.length} ≠ 期望 ${pixelCount}`);
  }
  if (data.length * 8 - bitPos >= 8) {
    throw new Error("EOI 之后仍有多余整字节，码流结构异常");
  }
  return out;
}

function parseGif(bytes: Uint8Array): ParsedGif {
  let pos = 0;
  const u8 = (): number => {
    if (pos >= bytes.length) throw new Error("GIF 数据意外截断");
    return bytes[pos++];
  };
  const u16 = (): number => {
    const v = u8() | (u8() << 8);
    return v;
  };
  const take = (n: number): Uint8Array => {
    if (pos + n > bytes.length) throw new Error("GIF 数据意外截断");
    const slice = bytes.subarray(pos, pos + n);
    pos += n;
    return slice;
  };
  const text = (n: number): string => String.fromCharCode(...take(n));
  const subBlocks = (): Uint8Array => {
    const parts: number[] = [];
    for (;;) {
      const len = u8();
      if (len === 0) break;
      for (const b of take(len)) parts.push(b);
    }
    return Uint8Array.from(parts);
  };

  const version = text(6);
  const width = u16();
  const height = u16();
  const packed = u8();
  u8(); // 背景色下标
  u8(); // 像素宽高比
  let gctSize = 0;
  let palette: Uint8Array = new Uint8Array(0);
  if (packed & 0x80) {
    gctSize = 2 ** ((packed & 7) + 1);
    palette = take(gctSize * 3);
  }

  let loopCount: number | null = null;
  let pendingDelay = 0;
  let pendingDisposal = 0;
  const frames: ParsedFrame[] = [];
  let trailer = false;

  for (;;) {
    const marker = u8();
    if (marker === 0x3b) {
      trailer = true;
      break;
    }
    if (marker === 0x21) {
      const label = u8();
      if (label === 0xf9) {
        const size = u8();
        if (size !== 4) throw new Error(`GCE 块长应为 4，实际 ${size}`);
        const gcePacked = u8();
        pendingDisposal = (gcePacked >> 2) & 7;
        pendingDelay = u16();
        u8(); // 透明色下标
        if (u8() !== 0) throw new Error("GCE 缺少块终结符");
      } else if (label === 0xff) {
        const nameLen = u8();
        const name = text(nameLen);
        const data = subBlocks();
        if (name.startsWith("NETSCAPE") && data.length >= 3 && data[0] === 1) {
          loopCount = data[1] | (data[2] << 8);
        }
      } else {
        subBlocks(); // 跳过未知扩展
      }
      continue;
    }
    if (marker === 0x2c) {
      const left = u16();
      const top = u16();
      const w = u16();
      const h = u16();
      const imgPacked = u8();
      if (imgPacked & 0x80) take(3 * 2 ** ((imgPacked & 7) + 1)); // 局部调色板
      const minCodeSize = u8();
      const lzw = subBlocks();
      const indices = decodeLzw(lzw, minCodeSize, w * h);
      frames.push({
        left,
        top,
        width: w,
        height: h,
        delayCs: pendingDelay,
        disposal: pendingDisposal,
        minCodeSize,
        lzwByteLength: lzw.length,
        indices,
      });
      pendingDelay = 0;
      pendingDisposal = 0;
      continue;
    }
    throw new Error(`未知块标记 0x${marker.toString(16)}（pos=${pos - 1}）`);
  }

  return { version, width, height, gctSize, palette, loopCount, frames, trailer, consumed: pos };
}

/* ------------------------------------------------------------------ */
/* 测试数据构造                                                        */
/* ------------------------------------------------------------------ */

function solidFrame(
  width: number,
  height: number,
  r: number,
  g: number,
  b: number,
  delayMs: number,
): GifFrame {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let p = 0; p < data.length; p += 4) {
    data[p] = r;
    data[p + 1] = g;
    data[p + 2] = b;
    data[p + 3] = 255;
  }
  return { data, width, height, delayMs };
}

/** 确定性 PRNG（mulberry32），保证噪声用例可复现 */
function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function noiseFrame(width: number, height: number, seed: number, delayMs: number): GifFrame {
  const rand = mulberry32(seed);
  const data = new Uint8ClampedArray(width * height * 4);
  for (let p = 0; p < data.length; p += 4) {
    data[p] = Math.floor(rand() * 256);
    data[p + 1] = Math.floor(rand() * 256);
    data[p + 2] = Math.floor(rand() * 256);
    data[p + 3] = 255;
  }
  return { data, width, height, delayMs };
}

function paletteColor(parsed: ParsedGif, index: number): [number, number, number] {
  return [
    parsed.palette[index * 3],
    parsed.palette[index * 3 + 1],
    parsed.palette[index * 3 + 2],
  ];
}

/* ------------------------------------------------------------------ */
/* 用例                                                                */
/* ------------------------------------------------------------------ */

describe("encodeGif", () => {
  it("两帧 4x4 纯色：GIF89a 头、trailer 0x3B、帧数与 delay 正确", () => {
    const gif = encodeGif([
      solidFrame(4, 4, 255, 0, 0, 100),
      solidFrame(4, 4, 0, 0, 255, 200),
    ]);
    expect(gif.length).toBeGreaterThan(0);
    expect(String.fromCharCode(...gif.subarray(0, 6))).toBe("GIF89a");
    expect(gif[gif.length - 1]).toBe(0x3b);

    const parsed = parseGif(gif);
    expect(parsed.version).toBe("GIF89a");
    expect(parsed.trailer).toBe(true);
    expect(parsed.consumed).toBe(gif.length); // 无多余尾部字节
    expect(parsed.width).toBe(4);
    expect(parsed.height).toBe(4);
    expect(parsed.gctSize).toBe(256);
    expect(parsed.frames.length).toBe(2);
    expect(parsed.frames.map((f) => f.delayCs)).toEqual([10, 20]); // 1/100s
    expect(parsed.frames.map((f) => f.minCodeSize)).toEqual([8, 8]);
    expect(parsed.loopCount).toBe(0); // 默认无限循环

    // 完整解码后的像素应为纯色，且调色板颜色精确
    for (const frame of parsed.frames) {
      expect(frame.indices.length).toBe(16);
      expect(new Set(frame.indices).size).toBe(1);
    }
    expect(paletteColor(parsed, parsed.frames[0].indices[0])).toEqual([255, 0, 0]);
    expect(paletteColor(parsed, parsed.frames[1].indices[0])).toEqual([0, 0, 255]);
  });

  it("1x1 单帧可编码并被解析器完整走完", () => {
    const gif = encodeGif([solidFrame(1, 1, 0, 255, 0, 50)]);
    expect(gif.length).toBeGreaterThan(0);
    expect(gif[gif.length - 1]).toBe(0x3b);
    const parsed = parseGif(gif);
    expect(parsed.frames.length).toBe(1);
    expect(parsed.frames[0].delayCs).toBe(5);
    expect(parsed.frames[0].indices.length).toBe(1);
    expect(paletteColor(parsed, parsed.frames[0].indices[0])).toEqual([0, 255, 0]);
    expect(parsed.consumed).toBe(gif.length);
  });

  it("300x200 随机噪声帧不抛错，LZW 码流可被完整解码（码宽升至 12、字典满）", () => {
    const frame = noiseFrame(300, 200, 20240601, 40);
    let gif!: Uint8Array;
    expect(() => {
      gif = encodeGif([frame]);
    }).not.toThrow();
    expect(gif.length).toBeGreaterThan(0);
    expect(gif[gif.length - 1]).toBe(0x3b);

    const parsed = parseGif(gif);
    expect(parsed.frames.length).toBe(1);
    expect(parsed.frames[0].width).toBe(300);
    expect(parsed.frames[0].height).toBe(200);
    expect(parsed.frames[0].delayCs).toBe(4);
    // decodeLzw 内部已校验：走到 EOI、像素数恰为 60000、无多余整字节
    expect(parsed.frames[0].indices.length).toBe(300 * 200);
    expect(parsed.consumed).toBe(gif.length);
  });

  it("loop:false 时不写 NETSCAPE 扩展", () => {
    const gif = encodeGif([solidFrame(2, 2, 10, 20, 30, 100)], { loop: false });
    const parsed = parseGif(gif);
    expect(parsed.loopCount).toBeNull();
    expect(parsed.frames.length).toBe(1);
    expect(parsed.consumed).toBe(gif.length);
  });

  it("delay 按 1/100s 四舍五入（125ms → 13）", () => {
    const gif = encodeGif([solidFrame(1, 1, 0, 0, 0, 125)]);
    expect(parseGif(gif).frames[0].delayCs).toBe(13);
  });

  it("空帧数组抛错", () => {
    expect(() => encodeGif([])).toThrow();
  });
});
