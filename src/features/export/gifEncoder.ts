/**
 * 零依赖 GIF89a 编码器。
 *
 * 结构：Header + 逻辑屏幕描述 + 全局调色板（固定 6x7x6 web-safe，252 色补零到 256）
 *      + NETSCAPE2.0 循环扩展（可选）+ 每帧 [图形控制扩展 GCE + 图像描述 + LZW 码流] + Trailer。
 *
 * LZW 为真压缩：可变码宽 9..12，clear=256、EOI=257，字典满 4096 后停止加表（omggif 风格），
 * 码宽增长时机与标准 GIF 解码器一致（在分配码值 2^w 之前把宽度升到 w+1）。
 *
 * 像素为 RGBA；alpha<255 时按白底合成后再做最近色量化（web-safe 网格是乘积网格，
 * 逐通道取最近级即欧氏距离全局最近色）。
 */

export interface GifFrame {
  /** RGBA 像素，长度至少 width*height*4 */
  data: Uint8ClampedArray;
  width: number;
  height: number;
  /** 帧时长（毫秒），写入 GCE 时换算为 1/100s */
  delayMs: number;
}

/** 6 级通道（R/B） */
const LEVELS_6 = [0, 51, 102, 153, 204, 255];
/** 7 级通道（G），round(i*255/6) */
const LEVELS_7 = [0, 43, 85, 128, 170, 213, 255];

const CLEAR_CODE = 256;
const EOI_CODE = 257;
const MAX_CODE = 4095;
const MIN_CODE_SIZE = 8;

function buildPalette(): Uint8Array {
  const palette = new Uint8Array(256 * 3);
  let i = 0;
  for (let r = 0; r < 6; r++) {
    for (let g = 0; g < 7; g++) {
      for (let b = 0; b < 6; b++) {
        palette[i++] = LEVELS_6[r];
        palette[i++] = LEVELS_7[g];
        palette[i++] = LEVELS_6[b];
      }
    }
  }
  // 剩余 4 项保持 0（黑色占位），调色板共 256 项。
  return palette;
}

/** 0..255 → 最近调色级下标 的查找表 */
function buildNearestTable(levels: number[]): Uint8Array {
  const table = new Uint8Array(256);
  for (let v = 0; v < 256; v++) {
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < levels.length; i++) {
      const dist = Math.abs(v - levels[i]);
      if (dist < bestDist) {
        bestDist = dist;
        best = i;
      }
    }
    table[v] = best;
  }
  return table;
}

const PALETTE = buildPalette();
const NEAREST_6 = buildNearestTable(LEVELS_6);
const NEAREST_7 = buildNearestTable(LEVELS_7);

/** RGBA → 调色板下标（alpha 按白底合成） */
function quantizeFrame(frame: GifFrame): Uint8Array {
  const { data, width, height } = frame;
  const indices = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < indices.length; i++, p += 4) {
    const a = data[p + 3];
    let r = data[p];
    let g = data[p + 1];
    let b = data[p + 2];
    if (a < 255) {
      const inv = 255 - a;
      r = Math.round((r * a + 255 * inv) / 255);
      g = Math.round((g * a + 255 * inv) / 255);
      b = Math.round((b * a + 255 * inv) / 255);
    }
    indices[i] = (NEAREST_6[r] * 7 + NEAREST_7[g]) * 6 + NEAREST_6[b];
  }
  return indices;
}

/**
 * GIF 变体 LZW：LSB-first 位打包，码宽 9..12。
 * 返回未分块的裸码流字节。
 */
function lzwEncode(indices: Uint8Array): Uint8Array {
  const out: number[] = [];
  let acc = 0;
  let bits = 0;
  let codeSize = MIN_CODE_SIZE + 1; // 9
  let next = EOI_CODE + 1; // 258
  const dict = new Map<number, number>();

  const emit = (code: number): void => {
    acc |= code << bits;
    bits += codeSize;
    while (bits >= 8) {
      out.push(acc & 0xff);
      acc >>>= 8;
      bits -= 8;
    }
  };

  emit(CLEAR_CODE);
  if (indices.length > 0) {
    let prefix = indices[0];
    for (let i = 1; i < indices.length; i++) {
      const k = indices[i];
      const key = (prefix << 8) | k;
      const found = dict.get(key);
      if (found !== undefined) {
        prefix = found;
        continue;
      }
      emit(prefix);
      // 与解码器同步：即将分配的码值达到 2^w 时，后续输出改用 w+1 位。
      if (next === 1 << codeSize && codeSize < 12) codeSize++;
      if (next <= MAX_CODE) dict.set(key, next++);
      prefix = k;
    }
    emit(prefix);
  }
  emit(EOI_CODE);
  if (bits > 0) out.push(acc & 0xff);
  return Uint8Array.from(out);
}

/** 把裸字节切成 GIF 子块（长度前缀，≤255），以 0x00 结束 */
function pushSubBlocks(bytes: number[], data: Uint8Array): void {
  for (let off = 0; off < data.length; off += 255) {
    const len = Math.min(255, data.length - off);
    bytes.push(len);
    for (let i = 0; i < len; i++) bytes.push(data[off + i]);
  }
  bytes.push(0);
}

function pushU16(bytes: number[], value: number): void {
  bytes.push(value & 0xff, (value >> 8) & 0xff);
}

/**
 * 编码多帧 GIF。opts.loop 默认 true（NETSCAPE 循环计数 0 = 无限循环）；
 * loop:false 时不写 NETSCAPE 扩展（播放一次）。
 */
export function encodeGif(frames: GifFrame[], opts?: { loop?: boolean }): Uint8Array {
  if (frames.length === 0) {
    throw new Error("encodeGif：至少需要一帧");
  }
  frames.forEach((frame, i) => {
    const { width, height, data } = frame;
    if (
      !Number.isInteger(width) ||
      !Number.isInteger(height) ||
      width <= 0 ||
      height <= 0 ||
      width > 0xffff ||
      height > 0xffff
    ) {
      throw new Error(`encodeGif：第 ${i + 1} 帧尺寸非法（${width}x${height}）`);
    }
    if (data.length < width * height * 4) {
      throw new Error(`encodeGif：第 ${i + 1} 帧像素数据不足（需要 ${width * height * 4} 字节）`);
    }
  });

  const bytes: number[] = [];

  // Header
  for (const ch of "GIF89a") bytes.push(ch.charCodeAt(0));

  // 逻辑屏幕描述：尺寸取首帧；全局调色板 256 色（2^(7+1)）
  pushU16(bytes, frames[0].width);
  pushU16(bytes, frames[0].height);
  bytes.push(0xf7); // GCT 标志 | 颜色分辨率 7 | GCT 大小指数 7
  bytes.push(0); // 背景色下标
  bytes.push(0); // 像素宽高比

  for (let i = 0; i < PALETTE.length; i++) bytes.push(PALETTE[i]);

  // NETSCAPE2.0 循环扩展
  if (opts?.loop !== false) {
    bytes.push(0x21, 0xff, 0x0b);
    for (const ch of "NETSCAPE2.0") bytes.push(ch.charCodeAt(0));
    bytes.push(0x03, 0x01);
    pushU16(bytes, 0); // 0 = 无限循环
    bytes.push(0);
  }

  for (const frame of frames) {
    // 图形控制扩展：disposal=1（保留原位），无透明色
    const delayCs = Math.max(0, Math.min(0xffff, Math.round(frame.delayMs / 10)));
    bytes.push(0x21, 0xf9, 0x04, 0x04);
    pushU16(bytes, delayCs);
    bytes.push(0, 0);

    // 图像描述符
    bytes.push(0x2c);
    pushU16(bytes, 0); // left
    pushU16(bytes, 0); // top
    pushU16(bytes, frame.width);
    pushU16(bytes, frame.height);
    bytes.push(0); // 无局部调色板、非隔行

    // LZW 最小码长 + 子块码流
    bytes.push(MIN_CODE_SIZE);
    pushSubBlocks(bytes, lzwEncode(quantizeFrame(frame)));
  }

  bytes.push(0x3b); // Trailer
  return Uint8Array.from(bytes);
}
