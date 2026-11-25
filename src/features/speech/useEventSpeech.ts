import { useEffect, useRef, useState } from "react";
import { pickZhVoice, speechSupported } from "./speechSupport.ts";

/** 可讲解的时间轴事件。 */
export interface EventSpeechCue {
  timeSeconds: number;
  label: string;
  caption: string;
}

export interface UseEventSpeechOptions {
  /** BCP-47 语言，默认 "zh-CN"。 */
  lang?: string;
  /** 语速，默认 1.05。 */
  rate?: number;
}

export interface UseEventSpeechResult {
  supported: boolean;
  speaking: boolean;
}

/**
 * TTS 事件讲解：当 time 跨过某事件（prev < e.timeSeconds <= now）时朗读
 * `${label}。${caption}`；同一事件不重复读；seek 回跳重置已读集合；
 * enabled 变 false 或卸载时 cancel。supported=false 时完全静默。
 */
export function useEventSpeech(
  events: readonly { timeSeconds: number; label: string; caption: string }[],
  time: number,
  enabled: boolean,
  opts?: UseEventSpeechOptions,
): UseEventSpeechResult {
  const supported = speechSupported();
  const lang = opts?.lang ?? "zh-CN";
  const rate = opts?.rate ?? 1.05;

  const prevTimeRef = useRef<number>(time);
  const spokenRef = useRef<Set<number>>(new Set());
  // 用 ref 持有 utterance 引用，防止 Chrome 在播放中途 GC 掉导致静音。
  const utterancesRef = useRef<SpeechSynthesisUtterance[]>([]);
  const [speaking, setSpeaking] = useState(false);

  // 跨事件检测与朗读。
  useEffect(() => {
    if (!supported) return;
    const prev = prevTimeRef.current;
    prevTimeRef.current = time;
    // seek backward：重置已读集合，回跳后重新可読。
    if (time < prev) spokenRef.current.clear();
    if (!enabled) return;
    if (typeof SpeechSynthesisUtterance === "undefined") return;
    const synth = speechSynthesis;
    events.forEach((e, index) => {
      if (!(prev < e.timeSeconds && e.timeSeconds <= time)) return;
      if (spokenRef.current.has(index)) return;
      spokenRef.current.add(index);
      const utterance = new SpeechSynthesisUtterance(`${e.label}。${e.caption}`);
      utterance.lang = lang;
      utterance.rate = rate;
      if (lang.toLowerCase().startsWith("zh")) {
        const voiceName = pickZhVoice(synth);
        if (voiceName !== undefined) {
          const voice = synth.getVoices().find((v) => v.name === voiceName);
          if (voice) utterance.voice = voice;
        }
      }
      utterancesRef.current.push(utterance);
      const release = () => {
        utterancesRef.current = utterancesRef.current.filter((u) => u !== utterance);
        if (utterancesRef.current.length === 0) setSpeaking(false);
      };
      utterance.onend = release;
      utterance.onerror = release;
      setSpeaking(true);
      synth.speak(utterance);
    });
  }, [events, time, enabled, supported, lang, rate]);

  // enabled 变 false：立即取消播放。
  useEffect(() => {
    if (!supported || enabled) return;
    speechSynthesis.cancel();
    utterancesRef.current = [];
    setSpeaking(false);
  }, [enabled, supported]);

  // 卸载时取消播放。
  useEffect(() => {
    if (!supported) return;
    return () => {
      speechSynthesis.cancel();
      utterancesRef.current = [];
    };
  }, [supported]);

  return { supported, speaking };
}
