/**
 * 分享链接编解码：把播放状态放进 URL hash（#s=...），刷新或转发后可恢复。
 * 编码链路：JSON → UTF-8 字节 → base64url（无 padding），中文等多字节字符二进制安全。
 * 解码全程容错：非法、截断、非 JSON、非对象、超过 200KB 一律返回 null，不抛异常。
 */

export interface ShareState {
  sampleId?: string;
  reading?: unknown;
  timeSeconds?: number;
  paceEnabled?: boolean;
  playbackRate?: number;
}

/** 解码后 UTF-8 字节数上限：200KB。 */
const MAX_DECODED_BYTES = 200 * 1024;

/** 分块拼接二进制字符串，避免大数组一次性 spread 触发调用栈上限。 */
function bytesToBinaryString(bytes: Uint8Array): string {
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return binary;
}

function toBase64Url(base64: string): string {
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

/** 只保留类型合法的已知字段，未知键与非法类型一律丢弃。 */
function sanitizeShareState(raw: Record<string, unknown>): ShareState {
  const out: ShareState = {};
  if (typeof raw.sampleId === 'string') out.sampleId = raw.sampleId;
  if ('reading' in raw) out.reading = raw.reading;
  if (typeof raw.timeSeconds === 'number' && Number.isFinite(raw.timeSeconds)) {
    out.timeSeconds = raw.timeSeconds;
  }
  if (typeof raw.paceEnabled === 'boolean') out.paceEnabled = raw.paceEnabled;
  if (typeof raw.playbackRate === 'number' && Number.isFinite(raw.playbackRate)) {
    out.playbackRate = raw.playbackRate;
  }
  return out;
}

/** JSON → UTF-8 → base64url（无 padding）。 */
export function encodeShareState(s: ShareState): string {
  const json = JSON.stringify(s);
  const bytes = new TextEncoder().encode(json);
  return toBase64Url(btoa(bytesToBinaryString(bytes)));
}

/**
 * 解码 hash 中的分享状态。
 * 接受 '#s=...'、's=...'、多参数 hash（'#a=1&s=...'）以及裸 base64url 载荷。
 * 非法 / 截断 / 非 JSON / 非对象 / 解码后超过 200KB 均返回 null。
 */
export function decodeShareState(hash: string): ShareState | null {
  try {
    if (typeof hash !== 'string' || hash.length === 0) return null;
    let payload = hash.startsWith('#') ? hash.slice(1) : hash;
    if (payload.startsWith('s=')) {
      payload = payload.slice(2).split('&')[0];
    } else {
      const marker = payload.indexOf('&s=');
      if (marker >= 0) payload = payload.slice(marker + 3).split('&')[0];
    }
    if (payload.length === 0) return null;
    // 只允许 base64 / base64url 字符（兼容带 padding 的旧链接）。
    if (!/^[A-Za-z0-9+/_=-]+$/.test(payload)) return null;
    // 提前拒绝超长输入：base64 约膨胀 4/3，200KB 对应约 273068 个字符。
    if (payload.length > Math.ceil(MAX_DECODED_BYTES / 3) * 4 + 4) return null;

    let base64 = payload.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/g, '');
    const remainder = base64.length % 4;
    if (remainder === 1) return null; // 非法 base64 长度
    if (remainder > 0) base64 += '='.repeat(4 - remainder);

    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    if (bytes.length > MAX_DECODED_BYTES) return null;

    // fatal: true 让截断的多字节 UTF-8 序列直接报错，而不是替换成 U+FFFD。
    const json = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const parsed: unknown = JSON.parse(json);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return sanitizeShareState(parsed as Record<string, unknown>);
  } catch {
    return null;
  }
}

/** 把编码结果放进 base 的 hash（形如 #s=...），替换 base 上已有的 hash。 */
export function buildShareUrl(base: string, s: ShareState): string {
  const encoded = encodeShareState(s);
  const hashStart = base.indexOf('#');
  const prefix = hashStart >= 0 ? base.slice(0, hashStart) : base;
  return `${prefix}#s=${encoded}`;
}

/** 从 location（或任何带 hash 的对象）读取分享状态。 */
export function readShareFromLocation(loc: { hash: string }): ShareState | null {
  if (!loc || typeof loc.hash !== 'string') return null;
  return decodeShareState(loc.hash);
}