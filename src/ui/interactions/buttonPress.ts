/**
 * 统一 VisualLab 常用按钮的按压手感：
 * - 显式限定常用按钮选择器，避免误套用到时间轴滑块、下拉框、输入框或普通列表项；
 * - 按下：以中心压至 scale(0.96)（90ms）并叠加深度内阴影（data-press="down"）；按住保持；
 * - 正常松手：从当前实际缩放值单次轻微过冲至 1.018 并于 200ms 收回 1（Web Animations 独立操作 CSS scale，不干扰既有 transform）；
 * - 快速点按仍保证可见按压回弹；首次渲染、悬停和仅键盘聚焦不触发回弹；
 * - 拖出按钮、手势取消或失焦时不触发过冲回弹；
 * - 尊重 prefers-reduced-motion：保留内阴影按压反馈，关闭缩放与回弹。
 */

export const PRESS_DOWN_SCALE = 0.96;
export const FAST_TAP_MIN_START_SCALE = 0.972;
export const REBOUND_PEAK_SCALE = 1.018;
export const REBOUND_DURATION_MS = 200;

export const PRESSABLE_BUTTON_SELECTOR = [
  "button.sample-button",
  "button.ghost-button",
  "button.icon-button",
  "button.tool-toggle",
  "button.tbtn",
  "button.transport-pill",
  "button.attach-button",
  "button.send-button",
  "button.chat-send",
  "button.chat-attach",
  "button.quick-chip",
  "button.favorites-cat-chip",
  "button.region-shot-cancel",
  "button.region-shot-save-btn",
  "button.mobile-tab",
].join(", ");

/** 解析 getComputedStyle(el).scale 为标量缩放值。 */
export function parseScaleValue(raw: string | null | undefined): number {
  if (!raw || raw === "none") return 1;
  const first = Number.parseFloat(raw.trim().split(/\s+/)[0] ?? "");
  return Number.isFinite(first) && first > 0 ? first : 1;
}

function isReducedMotion(): boolean {
  try {
    return typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
      : false;
  } catch {
    return false;
  }
}

function findPressableButton(target: EventTarget | null): HTMLButtonElement | null {
  if (!target || typeof (target as Element).closest !== "function") return null;
  const el = (target as Element).closest(PRESSABLE_BUTTON_SELECTOR);
  if (!el || el.tagName !== "BUTTON") return null;
  const btn = el as HTMLButtonElement;
  if (btn.disabled || btn.getAttribute("aria-disabled") === "true") return null;
  return btn;
}

function isPointInsideButton(btn: HTMLButtonElement, clientX: number, clientY: number): boolean {
  const rect = btn.getBoundingClientRect();
  return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
}

/**
 * 在文档上安装轻量事件委托，统一驱动所有常用按钮的按压与松手回弹手感。
 * 返回卸载函数以便测试清理。
 */
export function installButtonPressFeel(doc: Document = document): () => void {
  const activePointers = new Map<number, HTMLButtonElement>();
  const activeKeyButtons = new Set<HTMLButtonElement>();
  const runningAnimations = new WeakMap<HTMLButtonElement, Animation>();

  const cancelRebound = (btn: HTMLButtonElement) => {
    const prev = runningAnimations.get(btn);
    if (prev) {
      prev.cancel();
      runningAnimations.delete(btn);
    }
  };

  const pressDown = (btn: HTMLButtonElement) => {
    cancelRebound(btn);
    btn.setAttribute("data-press", "down");
  };

  const releaseButton = (btn: HTMLButtonElement, shouldRebound: boolean) => {
    const wasDown = btn.getAttribute("data-press") === "down";
    if (!wasDown) return;

    let currentScale = PRESS_DOWN_SCALE;
    try {
      if (typeof window !== "undefined" && typeof window.getComputedStyle === "function") {
        currentScale = parseScaleValue(window.getComputedStyle(btn).scale);
      }
    } catch {
      currentScale = PRESS_DOWN_SCALE;
    }

    btn.removeAttribute("data-press");

    if (!shouldRebound || isReducedMotion() || typeof btn.animate !== "function") {
      return;
    }

    // 快速点按时即使 CSS 过渡尚未到达 0.96，也从至少 0.972 起弹以保证清晰手感
    const startScale = Math.min(currentScale, FAST_TAP_MIN_START_SCALE);
    cancelRebound(btn);
    const anim = btn.animate(
      [
        { scale: String(startScale), offset: 0 },
        { scale: String(REBOUND_PEAK_SCALE), offset: 0.45 },
        { scale: "1", offset: 1 },
      ],
      {
        duration: REBOUND_DURATION_MS,
        easing: "cubic-bezier(0.22, 1, 0.36, 1)",
      },
    );
    runningAnimations.set(btn, anim);
    anim.onfinish = () => {
      if (runningAnimations.get(btn) === anim) runningAnimations.delete(btn);
    };
    anim.oncancel = () => {
      if (runningAnimations.get(btn) === anim) runningAnimations.delete(btn);
    };
  };

  const onPointerDown = (e: PointerEvent) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const btn = findPressableButton(e.target);
    if (!btn) return;
    activePointers.set(e.pointerId, btn);
    pressDown(btn);
  };

  const onPointerMove = (e: PointerEvent) => {
    const btn = activePointers.get(e.pointerId);
    if (!btn) return;
    if (!isPointInsideButton(btn, e.clientX, e.clientY)) {
      // 拖出按钮范围：取消按下态，不触发过冲回弹
      activePointers.delete(e.pointerId);
      releaseButton(btn, false);
    }
  };

  const onPointerUp = (e: PointerEvent) => {
    const btn = activePointers.get(e.pointerId);
    if (!btn) return;
    activePointers.delete(e.pointerId);
    const inside = isPointInsideButton(btn, e.clientX, e.clientY);
    releaseButton(btn, inside && !btn.disabled);
  };

  const onPointerCancel = (e: PointerEvent) => {
    const btn = activePointers.get(e.pointerId);
    if (!btn) return;
    activePointers.delete(e.pointerId);
    releaseButton(btn, false);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.repeat) return;
    if (e.key !== "Enter" && e.key !== " " && e.key !== "Spacebar") return;
    const btn = findPressableButton(e.target);
    if (!btn) return;
    activeKeyButtons.add(btn);
    pressDown(btn);
  };

  const onKeyUp = (e: KeyboardEvent) => {
    if (e.key !== "Enter" && e.key !== " " && e.key !== "Spacebar") return;
    const btn = findPressableButton(e.target);
    if (btn && activeKeyButtons.has(btn)) {
      activeKeyButtons.delete(btn);
      releaseButton(btn, !btn.disabled);
      return;
    }
    // 兜底释放所有处于键盘按下态的按钮
    for (const activeBtn of activeKeyButtons) {
      releaseButton(activeBtn, false);
    }
    activeKeyButtons.clear();
  };

  const onBlur = () => {
    for (const btn of activePointers.values()) releaseButton(btn, false);
    activePointers.clear();
    for (const btn of activeKeyButtons) releaseButton(btn, false);
    activeKeyButtons.clear();
  };

  doc.addEventListener("pointerdown", onPointerDown, true);
  doc.addEventListener("pointermove", onPointerMove, true);
  doc.addEventListener("pointerup", onPointerUp, true);
  doc.addEventListener("pointercancel", onPointerCancel, true);
  doc.addEventListener("keydown", onKeyDown, true);
  doc.addEventListener("keyup", onKeyUp, true);
  window.addEventListener("blur", onBlur);

  return () => {
    doc.removeEventListener("pointerdown", onPointerDown, true);
    doc.removeEventListener("pointermove", onPointerMove, true);
    doc.removeEventListener("pointerup", onPointerUp, true);
    doc.removeEventListener("pointercancel", onPointerCancel, true);
    doc.removeEventListener("keydown", onKeyDown, true);
    doc.removeEventListener("keyup", onKeyUp, true);
    window.removeEventListener("blur", onBlur);
    onBlur();
  };
}
