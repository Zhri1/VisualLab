/** Web Speech API 可用性检测与中文语音挑选（纯函数，SSR 安全）。 */

/** 浏览器（或注入的假 window）是否提供 speechSynthesis。 */
export function speechSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

/** 最小结构化接口：任何带 getVoices() 的对象都可传入，便于测试注入。 */
export interface SpeechSynthesisLike {
  getVoices(): { lang: string; name: string }[];
}

/**
 * 挑选中文语音：优先 lang === "zh-CN" 精确匹配，其次任意 zh 前缀（如 zh-TW、zh-HK）。
 * 返回语音 name；没有中文语音时返回 undefined。
 * 不传参时读取 window.speechSynthesis（不可用则返回 undefined）。
 */
export function pickZhVoice(speechSynthesisLike?: SpeechSynthesisLike): string | undefined {
  const synth =
    speechSynthesisLike ?? (speechSupported() ? window.speechSynthesis : undefined);
  if (!synth) return undefined;
  const voices = synth.getVoices();
  const exact = voices.find((v) => v.lang === "zh-CN");
  if (exact) return exact.name;
  const prefix = voices.find((v) => v.lang.toLowerCase().startsWith("zh"));
  return prefix ? prefix.name : undefined;
}
