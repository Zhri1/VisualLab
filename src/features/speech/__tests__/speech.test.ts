/**
 * useEventSpeech / speechSupport 单元测试。
 *
 * 仓库没有 @testing-library/react、react-test-renderer、jsdom/happy-dom，
 * 因此按交接要求实现最小 harness：react-dom/client createRoot + react act，
 * 配合一个仅覆盖 React 18 渲染 null 组件所需 API 的假 DOM（node 环境）。
 * 假 speechSynthesis 通过 vi.stubGlobal 注入，speak/cancel/getVoices 记录调用。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { useEventSpeech } from "../useEventSpeech.ts";
import type { EventSpeechCue } from "../useEventSpeech.ts";
import { pickZhVoice, speechSupported } from "../speechSupport.ts";

// ---------------------------------------------------------------------------
// 最小假 DOM：必须在 import react-dom/client 之前就位（模块初始化会读 window）。
// ---------------------------------------------------------------------------
function makeNode(nodeType = 1, nodeName = "DIV"): any {
  const node: any = {
    nodeType,
    nodeName,
    tagName: nodeName,
    namespaceURI: "http://www.w3.org/1999/xhtml",
    childNodes: [] as any[],
    parentNode: null,
    ownerDocument: null as any,
    style: {},
    textContent: "",
    setAttribute() {},
    removeAttribute() {},
    getAttribute() {
      return null;
    },
    addEventListener() {},
    removeEventListener() {},
    appendChild(child: any) {
      node.childNodes.push(child);
      child.parentNode = node;
      return child;
    },
    removeChild(child: any) {
      node.childNodes = node.childNodes.filter((c: any) => c !== child);
      child.parentNode = null;
      return child;
    },
    insertBefore(child: any) {
      node.childNodes.push(child);
      child.parentNode = node;
      return child;
    },
    contains() {
      return false;
    },
  };
  return node;
}

const fakeDocument: any = makeNode(9, "#document");
fakeDocument.createElement = (tag: string) => {
  const n = makeNode(1, String(tag).toUpperCase());
  n.ownerDocument = fakeDocument;
  return n;
};
fakeDocument.createTextNode = (text: string) => {
  const n = makeNode(3, "#text");
  n.textContent = text;
  n.ownerDocument = fakeDocument;
  return n;
};
fakeDocument.body = makeNode(1, "BODY");
fakeDocument.body.ownerDocument = fakeDocument;
fakeDocument.documentElement = fakeDocument.body;
fakeDocument.activeElement = null;

const fakeWindow: any = {
  document: fakeDocument,
  // react-dom getActiveElementDeep 会做 `element instanceof win.HTMLIFrameElement`。
  HTMLIFrameElement: class HTMLIFrameElement {},
  addEventListener() {},
  removeEventListener() {},
  getComputedStyle() {
    return {};
  },
};
fakeDocument.defaultView = fakeWindow;

(globalThis as any).window = fakeWindow;
(globalThis as any).document = fakeDocument;
// Node 自带只读 navigator（无 scheduling），react-dom/scheduler 已对其做保护，无需覆盖。
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// 假 DOM 就位后再加载 react-dom/client。
const { createRoot } = await import("react-dom/client");

// ---------------------------------------------------------------------------
// 假 speechSynthesis / SpeechSynthesisUtterance（vi.stubGlobal 注入）。
// ---------------------------------------------------------------------------
const speak = vi.fn();
const cancel = vi.fn();
const voices = [
  { lang: "en-US", name: "Alex" },
  { lang: "zh-TW", name: "Meijia" },
  { lang: "zh-CN", name: "Tingting" },
];
const getVoices = vi.fn(() => voices);
const fakeSynth = { speak, cancel, getVoices, speaking: false, pending: false, paused: false };

const utterances: FakeUtterance[] = [];
class FakeUtterance {
  text: string;
  lang = "";
  rate = 1;
  voice: { lang: string; name: string } | null = null;
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(text: string) {
    this.text = text;
    utterances.push(this);
  }
}

// ---------------------------------------------------------------------------
// 最小 renderHook harness：createRoot + act，Probe 组件渲染 null 只跑 hook。
// ---------------------------------------------------------------------------
interface ProbeProps {
  events: readonly EventSpeechCue[];
  time: number;
  enabled: boolean;
  opts?: { lang?: string; rate?: number };
}

let latest: { supported: boolean; speaking: boolean } = { supported: false, speaking: false };
function Probe(props: ProbeProps) {
  latest = useEventSpeech(props.events, props.time, props.enabled, props.opts);
  return null;
}

let root: ReturnType<typeof createRoot> | null = null;
function render(props: ProbeProps) {
  if (!root) {
    const container = makeNode();
    container.ownerDocument = fakeDocument;
    root = createRoot(container);
  }
  const r = root;
  act(() => {
    r.render(createElement(Probe, props));
  });
}
function unmount() {
  if (!root) return;
  const r = root;
  root = null;
  act(() => {
    r.unmount();
  });
}

beforeEach(() => {
  vi.stubGlobal("speechSynthesis", fakeSynth);
  vi.stubGlobal("SpeechSynthesisUtterance", FakeUtterance);
  fakeWindow.speechSynthesis = fakeSynth;
  utterances.length = 0;
  speak.mockClear();
  cancel.mockClear();
  getVoices.mockClear();
});
afterEach(() => {
  unmount();
  vi.unstubAllGlobals();
  delete fakeWindow.speechSynthesis;
});

const cues: EventSpeechCue[] = [
  { timeSeconds: 2, label: "碰撞", caption: "两滑块速度交换" },
  { timeSeconds: 5, label: "共速", caption: "摩擦力使两者共速" },
];

describe("useEventSpeech", () => {
  it("跨事件触发 speak 一次（边界 prev < t <= now，zh-CN / rate 1.05）", () => {
    render({ events: cues, time: 1, enabled: true });
    expect(speak).not.toHaveBeenCalled();
    render({ events: cues, time: 2, enabled: true }); // 恰好落在事件时刻
    expect(speak).toHaveBeenCalledTimes(1);
    expect(utterances[0].text).toBe("碰撞。两滑块速度交换");
    expect(utterances[0].lang).toBe("zh-CN");
    expect(utterances[0].rate).toBe(1.05);
    expect(utterances[0].voice?.name).toBe("Tingting");
    expect(latest.supported).toBe(true);
    expect(latest.speaking).toBe(true);
  });

  it("重复渲染不重复朗读", () => {
    render({ events: cues, time: 1, enabled: true });
    render({ events: cues, time: 3, enabled: true });
    render({ events: cues, time: 3, enabled: true });
    render({ events: [...cues], time: 3, enabled: true }); // 新数组引用
    expect(speak).toHaveBeenCalledTimes(1);
  });

  it("一次跨过多个事件时各朗读一次", () => {
    render({ events: cues, time: 1, enabled: true });
    render({ events: cues, time: 6, enabled: true });
    expect(speak).toHaveBeenCalledTimes(2);
    expect(utterances.map((u) => u.text)).toEqual([
      "碰撞。两滑块速度交换",
      "共速。摩擦力使两者共速",
    ]);
  });

  it("enabled 变 false 时 cancel", () => {
    render({ events: cues, time: 1, enabled: true });
    render({ events: cues, time: 3, enabled: true });
    expect(cancel).not.toHaveBeenCalled();
    render({ events: cues, time: 3, enabled: false });
    expect(cancel).toHaveBeenCalled();
    expect(latest.speaking).toBe(false);
  });

  it("卸载时 cancel", () => {
    render({ events: cues, time: 1, enabled: true });
    render({ events: cues, time: 3, enabled: true });
    unmount();
    expect(cancel).toHaveBeenCalled();
  });

  it("time 回跳后重置已读集合，重新可読", () => {
    render({ events: cues, time: 1, enabled: true });
    render({ events: cues, time: 3, enabled: true });
    expect(speak).toHaveBeenCalledTimes(1);
    render({ events: cues, time: 0.5, enabled: true }); // seek backward
    render({ events: cues, time: 3, enabled: true });
    expect(speak).toHaveBeenCalledTimes(2);
  });

  it("无 speechSynthesis 时 supported=false 且不抛错", () => {
    delete fakeWindow.speechSynthesis;
    vi.stubGlobal("speechSynthesis", undefined);
    expect(speechSupported()).toBe(false);
    expect(() => {
      render({ events: cues, time: 1, enabled: true });
      render({ events: cues, time: 3, enabled: true });
      render({ events: cues, time: 3, enabled: false });
      unmount();
    }).not.toThrow();
    expect(latest.supported).toBe(false);
    expect(latest.speaking).toBe(false);
    expect(speak).not.toHaveBeenCalled();
    expect(cancel).not.toHaveBeenCalled();
  });
});

describe("speechSupport", () => {
  it("speechSupported 取决于 window 是否有 speechSynthesis", () => {
    expect(speechSupported()).toBe(true);
    delete fakeWindow.speechSynthesis;
    expect(speechSupported()).toBe(false);
  });

  it("pickZhVoice 优先 zh-CN 精确匹配", () => {
    expect(
      pickZhVoice({
        getVoices: () => [
          { lang: "zh-TW", name: "Meijia" },
          { lang: "zh-CN", name: "Tingting" },
        ],
      }),
    ).toBe("Tingting");
  });

  it("pickZhVoice 无精确匹配时取 zh 前缀", () => {
    expect(
      pickZhVoice({
        getVoices: () => [
          { lang: "en-US", name: "Alex" },
          { lang: "zh-TW", name: "Meijia" },
        ],
      }),
    ).toBe("Meijia");
  });

  it("pickZhVoice 无中文语音返回 undefined", () => {
    expect(pickZhVoice({ getVoices: () => [{ lang: "en-US", name: "Alex" }] })).toBeUndefined();
    expect(pickZhVoice({ getVoices: () => [] })).toBeUndefined();
  });

  it("pickZhVoice 缺省读取 window.speechSynthesis", () => {
    expect(pickZhVoice()).toBe("Tingting");
  });
});
