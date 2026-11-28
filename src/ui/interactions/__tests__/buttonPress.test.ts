import { describe, it, expect, vi, afterEach } from "vitest";
import {
  FAST_TAP_MIN_START_SCALE,
  installButtonPressFeel,
  parseScaleValue,
  PRESSABLE_BUTTON_SELECTOR,
  REBOUND_DURATION_MS,
  REBOUND_PEAK_SCALE,
} from "../buttonPress";

type Listener = (e: unknown) => void;

function createMockDoc(reducedMotion = false) {
  const listeners = new Map<string, Set<Listener>>();
  const doc = {
    addEventListener(type: string, fn: Listener) {
      let set = listeners.get(type);
      if (!set) { set = new Set(); listeners.set(type, set); }
      set.add(fn);
    },
    removeEventListener(type: string, fn: Listener) {
      listeners.get(type)?.delete(fn);
    },
    dispatch(type: string, event: Record<string, unknown>) {
      for (const fn of listeners.get(type) ?? []) fn(event);
    },
  };
  const winListeners = new Map<string, Set<Listener>>();
  const mockWin = {
    addEventListener(type: string, fn: Listener) {
      let set = winListeners.get(type);
      if (!set) { set = new Set(); winListeners.set(type, set); }
      set.add(fn);
    },
    removeEventListener(type: string, fn: Listener) {
      winListeners.get(type)?.delete(fn);
    },
    matchMedia: () => ({ matches: reducedMotion }),
    getComputedStyle: (el: { _computedScale?: string }) => ({ scale: el._computedScale ?? "1" }),
  };
  Object.defineProperty(globalThis, "window", { value: mockWin, configurable: true });
  return { doc, mockWin };
}

function createMockButton(opts: { pressable?: boolean; disabled?: boolean; computedScale?: string } = {}) {
  const attrs = new Map<string, string>();
  const animateMock = vi.fn(() => ({ cancel: vi.fn(), onfinish: null, oncancel: null }));
  const btn = {
    tagName: "BUTTON",
    disabled: Boolean(opts.disabled),
    _computedScale: opts.computedScale ?? "0.96",
    closest: (sel: string) => (opts.pressable !== false && sel === PRESSABLE_BUTTON_SELECTOR ? btn : null),
    getAttribute: (k: string) => attrs.get(k) ?? null,
    setAttribute: (k: string, v: string) => { attrs.set(k, v); },
    removeAttribute: (k: string) => { attrs.delete(k); },
    getBoundingClientRect: () => ({ left: 100, top: 100, right: 200, bottom: 140 }),
    animate: animateMock,
  };
  return { btn, animateMock };
}

describe("统一按钮按压手感 buttonPress", () => {
  const origWindow = (globalThis as { window?: unknown }).window;

  afterEach(() => {
    if (origWindow === undefined) delete (globalThis as { window?: unknown }).window;
    else Object.defineProperty(globalThis, "window", { value: origWindow, configurable: true });
    vi.restoreAllMocks();
  });

  it("parseScaleValue 正确解析 none 与数值", () => {
    expect(parseScaleValue("none")).toBe(1);
    expect(parseScaleValue(null)).toBe(1);
    expect(parseScaleValue("0.96")).toBeCloseTo(0.96, 6);
    expect(parseScaleValue("0.975 0.975")).toBeCloseTo(0.975, 6);
  });

  it("鼠标按下保持 data-press=down，内侧松手触发单次过冲回弹（1.018 → 1，200ms）", () => {
    const { doc } = createMockDoc(false);
    const uninstall = installButtonPressFeel(doc as unknown as Document);
    const { btn, animateMock } = createMockButton({ computedScale: "0.96" });

    doc.dispatch("pointerdown", { pointerType: "mouse", button: 0, pointerId: 1, target: btn });
    expect(btn.getAttribute("data-press")).toBe("down");
    expect(animateMock).not.toHaveBeenCalled();

    doc.dispatch("pointerup", { pointerType: "mouse", pointerId: 1, clientX: 150, clientY: 120, target: btn });
    expect(btn.getAttribute("data-press")).toBeNull();
    expect(animateMock).toHaveBeenCalledTimes(1);
    const [frames, timing] = animateMock.mock.calls[0] as unknown as [Array<{ scale: string; offset: number }>, { duration: number }];
    expect(Number(frames[0].scale)).toBeCloseTo(0.96, 6);
    expect(Number(frames[1].scale)).toBeCloseTo(REBOUND_PEAK_SCALE, 6);
    expect(Number(frames[2].scale)).toBe(1);
    expect(timing.duration).toBe(REBOUND_DURATION_MS);
    uninstall();
  });

  it("快速点按时起弹缩放钳制至 <= 0.972，确保快按仍有清晰手感", () => {
    const { doc } = createMockDoc(false);
    const uninstall = installButtonPressFeel(doc as unknown as Document);
    const { btn, animateMock } = createMockButton({ computedScale: "0.995" });

    doc.dispatch("pointerdown", { pointerType: "touch", button: 0, pointerId: 2, target: btn });
    doc.dispatch("pointerup", { pointerType: "touch", pointerId: 2, clientX: 120, clientY: 110, target: btn });
    expect(animateMock).toHaveBeenCalledTimes(1);
    const [frames] = animateMock.mock.calls[0] as unknown as [Array<{ scale: string }>];
    expect(Number(frames[0].scale)).toBeLessThanOrEqual(FAST_TAP_MIN_START_SCALE);
    uninstall();
  });

  it("拖出按钮或 pointercancel 仅撤回按压态，不触发过冲回弹", () => {
    const { doc } = createMockDoc(false);
    const uninstall = installButtonPressFeel(doc as unknown as Document);
    const { btn, animateMock } = createMockButton();

    doc.dispatch("pointerdown", { pointerType: "mouse", button: 0, pointerId: 3, target: btn });
    expect(btn.getAttribute("data-press")).toBe("down");
    doc.dispatch("pointermove", { pointerId: 3, clientX: 250, clientY: 120 });
    expect(btn.getAttribute("data-press")).toBeNull();
    expect(animateMock).not.toHaveBeenCalled();

    doc.dispatch("pointerdown", { pointerType: "touch", button: 0, pointerId: 4, target: btn });
    doc.dispatch("pointercancel", { pointerId: 4 });
    expect(btn.getAttribute("data-press")).toBeNull();
    expect(animateMock).not.toHaveBeenCalled();
    uninstall();
  });

  it("键盘 Space/Enter 触发按压与回弹，repeat 不重复触发；禁用按钮完全忽略", () => {
    const { doc } = createMockDoc(false);
    const uninstall = installButtonPressFeel(doc as unknown as Document);
    const { btn, animateMock } = createMockButton();
    const { btn: disabledBtn, animateMock: disabledAnim } = createMockButton({ disabled: true });

    doc.dispatch("keydown", { key: " ", repeat: false, target: btn });
    expect(btn.getAttribute("data-press")).toBe("down");
    doc.dispatch("keydown", { key: " ", repeat: true, target: btn });
    doc.dispatch("keyup", { key: " ", target: btn });
    expect(btn.getAttribute("data-press")).toBeNull();
    expect(animateMock).toHaveBeenCalledTimes(1);

    doc.dispatch("pointerdown", { pointerType: "mouse", button: 0, pointerId: 5, target: disabledBtn });
    expect(disabledBtn.getAttribute("data-press")).toBeNull();
    expect(disabledAnim).not.toHaveBeenCalled();
    uninstall();
  });

  it("prefers-reduced-motion: reduce 保留 data-press 阴影态但跳过缩放回弹动画", () => {
    const { doc } = createMockDoc(true);
    const uninstall = installButtonPressFeel(doc as unknown as Document);
    const { btn, animateMock } = createMockButton();

    doc.dispatch("pointerdown", { pointerType: "mouse", button: 0, pointerId: 6, target: btn });
    expect(btn.getAttribute("data-press")).toBe("down");
    doc.dispatch("pointerup", { pointerType: "mouse", pointerId: 6, clientX: 150, clientY: 120, target: btn });
    expect(btn.getAttribute("data-press")).toBeNull();
    expect(animateMock).not.toHaveBeenCalled();
    uninstall();
  });

  it("label.transport-pill（如关键点暂停 / 自动调速）同样支持按压与松手回弹", () => {
    expect(PRESSABLE_BUTTON_SELECTOR).toContain("label.transport-pill");
    const { doc } = createMockDoc(false);
    const uninstall = installButtonPressFeel(doc as unknown as Document);
    const attrs = new Map<string, string>();
    const animateMock = vi.fn(() => ({ cancel: vi.fn(), onfinish: null, oncancel: null }));
    const labelEl = {
      tagName: "LABEL",
      _computedScale: "0.96",
      closest: (sel: string) => (sel === PRESSABLE_BUTTON_SELECTOR ? labelEl : null),
      querySelector: () => ({ disabled: false }),
      getAttribute: (k: string) => attrs.get(k) ?? null,
      setAttribute: (k: string, v: string) => { attrs.set(k, v); },
      removeAttribute: (k: string) => { attrs.delete(k); },
      getBoundingClientRect: () => ({ left: 100, top: 100, right: 200, bottom: 136 }),
      animate: animateMock,
    };

    doc.dispatch("pointerdown", { pointerType: "mouse", button: 0, pointerId: 7, target: labelEl });
    expect(labelEl.getAttribute("data-press")).toBe("down");
    doc.dispatch("pointerup", { pointerType: "mouse", pointerId: 7, clientX: 150, clientY: 118, target: labelEl });
    expect(labelEl.getAttribute("data-press")).toBeNull();
    expect(animateMock).toHaveBeenCalledTimes(1);
    uninstall();
  });
});
