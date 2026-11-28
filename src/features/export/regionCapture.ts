/**
 * 浏览器本地动画工作区框选截图工具：
 * 1. 零依赖、无需屏幕共享授权，直接在本地合成所见区域的 DOM 与实时 Canvas 为 PNG Blob；
 * 2. 排除选区遮罩及辅助提示（data-screenshot-exclude="true"）；
 * 3. 处理工作区滚动、嵌套滚动、窄屏媒体查询与设备像素比（DPR）；
 * 4. 复用 capture.ts 的 capturePng，并将 PNG 写入系统剪贴板（失败时提供明确错误供调用方回退保存）。
 */
import { capturePng } from "./capture";

export interface RegionRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface ViewportBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** 将任意方向（含反向拖动）的起止点归一化为边界内的矩形选区。 */
export function normalizeDragRect(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  bounds?: ViewportBounds,
): RegionRect {
  const clampX = (x: number) => (bounds ? Math.max(bounds.left, Math.min(bounds.right, x)) : x);
  const clampY = (y: number) => (bounds ? Math.max(bounds.top, Math.min(bounds.bottom, y)) : y);
  const x1 = clampX(startX);
  const y1 = clampY(startY);
  const x2 = clampX(endX);
  const y2 = clampY(endY);
  return {
    left: Math.min(x1, x2),
    top: Math.min(y1, y2),
    width: Math.abs(x2 - x1),
    height: Math.abs(y2 - y1),
  };
}

/** 计算容器在当前视口内实际可见的边界矩形。 */
export function getVisibleContainerBounds(container: HTMLElement): ViewportBounds {
  const r = container.getBoundingClientRect();
  const vw = window.innerWidth || document.documentElement.clientWidth || r.right;
  const vh = window.innerHeight || document.documentElement.clientHeight || r.bottom;
  return {
    left: Math.max(0, r.left),
    top: Math.max(0, r.top),
    right: Math.min(vw, r.right),
    bottom: Math.min(vh, r.bottom),
  };
}

/** 收集当前文档中对当前窗口生效的同源 CSS 规则（过滤 @media，防止窄选区误触发移动端样式）。 */
function collectActiveCssText(): string {
  const chunks: string[] = [];
  const walkRules = (rules: CSSRuleList) => {
    for (let i = 0; i < rules.length; i++) {
      const rule = rules[i];
      if (typeof CSSMediaRule !== "undefined" && rule instanceof CSSMediaRule) {
        try {
          if (window.matchMedia(rule.conditionText).matches) {
            walkRules(rule.cssRules);
          }
        } catch {
          // 忽略无法解析的媒体查询
        }
      } else if (typeof CSSSupportsRule !== "undefined" && rule instanceof CSSSupportsRule) {
        try {
          if (CSS.supports(rule.conditionText)) walkRules(rule.cssRules);
        } catch {
          // 忽略
        }
      } else {
        chunks.push(rule.cssText);
      }
    }
  };

  for (let i = 0; i < document.styleSheets.length; i++) {
    const sheet = document.styleSheets[i];
    try {
      if (sheet.cssRules) walkRules(sheet.cssRules);
    } catch {
      // 跨域样式表无法读取，跳过以免抛 SecurityError
    }
  }
  return chunks.join("\n");
}

/** 将源容器克隆为独立可渲染子树：剔除遮罩、同步表单实时值、将实时 Canvas 替换为 PNG 数据图。 */
function buildClonedSubtree(container: HTMLElement, rect: RegionRect): HTMLElement {
  const paneRect = container.getBoundingClientRect();
  const root = document.createElement("div");
  root.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
  const bodyStyle = window.getComputedStyle(document.body);
  root.style.position = "relative";
  root.style.width = `${rect.width}px`;
  root.style.height = `${rect.height}px`;
  root.style.overflow = "hidden";
  root.style.margin = "0";
  root.style.padding = "0";
  root.style.fontFamily = bodyStyle.fontFamily;
  root.style.fontSize = bodyStyle.fontSize;
  root.style.color = bodyStyle.color;
  root.style.background = window.getComputedStyle(container).backgroundColor || bodyStyle.backgroundColor || "#ffffff";

  // 把 :root 上声明的 CSS 变量复制到副本根节点，确保自定义变量在 foreignObject 中完整生效
  const rootStyle = window.getComputedStyle(document.documentElement);
  for (let i = 0; i < rootStyle.length; i++) {
    const prop = rootStyle[i];
    if (prop.startsWith("--")) {
      root.style.setProperty(prop, rootStyle.getPropertyValue(prop));
    }
  }

  const clone = container.cloneNode(true) as HTMLElement;

  // 剔除所有标记为截图排除的元素（遮罩、选框、提示条等）
  clone.querySelectorAll('[data-screenshot-exclude="true"]').forEach((el) => el.remove());

  // 同步 <input> / <select> / <textarea> 实时状态，使时间轴滑块与下拉框与屏幕上所见一致
  const origInputs = container.querySelectorAll("input, select, textarea");
  const cloneInputs = clone.querySelectorAll("input, select, textarea");
  origInputs.forEach((orig, idx) => {
    const target = cloneInputs[idx];
    if (!target) return;
    if (orig instanceof HTMLInputElement && target instanceof HTMLInputElement) {
      target.setAttribute("value", orig.value);
      if (orig.checked) target.setAttribute("checked", "checked");
      else target.removeAttribute("checked");
    } else if (orig instanceof HTMLSelectElement && target instanceof HTMLSelectElement) {
      Array.from(target.options).forEach((opt, oi) => {
        if (oi === orig.selectedIndex) opt.setAttribute("selected", "selected");
        else opt.removeAttribute("selected");
      });
    } else if (orig instanceof HTMLTextAreaElement && target instanceof HTMLTextAreaElement) {
      target.textContent = orig.value;
    }
  });

  // 将所有实时 <canvas> 替换为其当前像素的 PNG <img>，保留原样尺寸与层叠顺序
  const origCanvases = Array.from(container.querySelectorAll("canvas")).filter(
    (c) => !c.closest('[data-screenshot-exclude="true"]'),
  );
  const cloneCanvases = Array.from(clone.querySelectorAll("canvas"));
  origCanvases.forEach((origCanvas, idx) => {
    const cloneCanvas = cloneCanvases[idx];
    if (!cloneCanvas) return;
    const cRect = origCanvas.getBoundingClientRect();
    try {
      const dataUrl = origCanvas.toDataURL("image/png");
      const img = document.createElement("img");
      img.src = dataUrl;
      img.className = origCanvas.className;
      const computed = window.getComputedStyle(origCanvas);
      img.style.cssText = origCanvas.style.cssText;
      img.style.width = `${cRect.width}px`;
      img.style.height = `${cRect.height}px`;
      img.style.display = computed.display === "none" ? "none" : "block";
      img.style.position = computed.position;
      if (computed.position !== "static") {
        img.style.left = computed.left;
        img.style.top = computed.top;
        img.style.right = computed.right;
        img.style.bottom = computed.bottom;
        img.style.zIndex = computed.zIndex;
      }
      cloneCanvas.replaceWith(img);
    } catch {
      // 画布不可导出时保留占位
    }
  });

  // 处理嵌套可滚动子容器的滚动偏移
  const origAll = Array.from(container.querySelectorAll<HTMLElement>("*")).filter(
    (el) => !el.closest('[data-screenshot-exclude="true"]'),
  );
  const cloneAll = Array.from(clone.querySelectorAll<HTMLElement>("*"));
  origAll.forEach((origEl, idx) => {
    const cloneEl = cloneAll[idx];
    if (!cloneEl) return;
    if (origEl.scrollTop > 0 || origEl.scrollLeft > 0) {
      const inner = document.createElement("div");
      inner.style.transform = `translate(${-origEl.scrollLeft}px, ${-origEl.scrollTop}px)`;
      while (cloneEl.firstChild) inner.appendChild(cloneEl.firstChild);
      cloneEl.appendChild(inner);
      cloneEl.style.overflow = "hidden";
    }
  });

  // 将克隆后的工作区容器精确对齐到选区视口坐标，抵消外层滚动偏移
  clone.style.position = "absolute";
  clone.style.left = `${paneRect.left - rect.left}px`;
  clone.style.top = `${paneRect.top - rect.top}px`;
  clone.style.width = `${paneRect.width}px`;
  clone.style.height = `${Math.max(paneRect.height, container.scrollHeight)}px`;
  clone.style.margin = "0";
  clone.style.overflow = "visible";
  clone.style.boxSizing = "border-box";
  if (container.scrollLeft !== 0 || container.scrollTop !== 0) {
    clone.style.transform = `translate(${-container.scrollLeft}px, ${-container.scrollTop}px)`;
    clone.style.transformOrigin = "top left";
  }

  root.appendChild(clone);
  return root;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("SVG 截图图像解码失败"));
    img.src = src;
  });
}

/** 回退绘制：直接按视口交集把实时 Canvas 像素裁剪合成到输出画布。 */
function drawLiveCanvasesFallback(
  ctx: CanvasRenderingContext2D,
  container: HTMLElement,
  rect: RegionRect,
): void {
  const canvases = Array.from(container.querySelectorAll("canvas")).filter(
    (c) => !c.closest('[data-screenshot-exclude="true"]'),
  );
  for (const canvas of canvases) {
    const cRect = canvas.getBoundingClientRect();
    if (cRect.width <= 0 || cRect.height <= 0) continue;
    const ix1 = Math.max(rect.left, cRect.left);
    const iy1 = Math.max(rect.top, cRect.top);
    const ix2 = Math.min(rect.left + rect.width, cRect.right);
    const iy2 = Math.min(rect.top + rect.height, cRect.bottom);
    if (ix2 <= ix1 || iy2 <= iy1) continue;
    const scaleX = canvas.width / cRect.width;
    const scaleY = canvas.height / cRect.height;
    const sx = (ix1 - cRect.left) * scaleX;
    const sy = (iy1 - cRect.top) * scaleY;
    const sw = (ix2 - ix1) * scaleX;
    const sh = (iy2 - iy1) * scaleY;
    ctx.drawImage(canvas, sx, sy, sw, sh, ix1 - rect.left, iy1 - rect.top, ix2 - ix1, iy2 - iy1);
  }
}

/**
 * 截取动画工作区指定视口矩形为 PNG Blob（含实时 Canvas 与 DOM，不含遮罩和选框）。
 */
export async function captureRegionPng(container: HTMLElement, rect: RegionRect): Promise<Blob> {
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));
  const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 2));

  const out = document.createElement("canvas");
  out.width = Math.round(width * dpr);
  out.height = Math.round(height * dpr);
  const ctx = out.getContext("2d");
  if (!ctx) throw new Error("无法创建截图离屏画布");
  ctx.scale(dpr, dpr);

  const bg = window.getComputedStyle(container).backgroundColor || "#ffffff";
  ctx.fillStyle = bg === "rgba(0, 0, 0, 0)" ? "#ffffff" : bg;
  ctx.fillRect(0, 0, width, height);

  try {
    const cssText = collectActiveCssText().replace(/<\/style>/gi, "<\\/style>");
    const subtree = buildClonedSubtree(container, { ...rect, width, height });
    const serialized = new XMLSerializer().serializeToString(subtree);
    const svg = [
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
      `<foreignObject x="0" y="0" width="100%" height="100%">`,
      `<div xmlns="http://www.w3.org/1999/xhtml"><style>${cssText}</style>${serialized}</div>`,
      `</foreignObject>`,
      `</svg>`,
    ].join("");
    const dataUri = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    const img = await loadImage(dataUri);
    ctx.drawImage(img, 0, 0, width, height);
  } catch {
    // 极端环境下回退为实时 Canvas 直接裁剪合成
    drawLiveCanvasesFallback(ctx, container, { ...rect, width, height });
  }

  return capturePng(out);
}

/**
 * 将 PNG Blob 写入系统剪贴板；仅在实际写入完成后 resolve，失败时抛出清晰中文说明。
 */
export async function copyPngToClipboard(blob: Blob): Promise<void> {
  if (typeof navigator === "undefined" || !navigator.clipboard || typeof navigator.clipboard.write !== "function") {
    throw new Error("当前浏览器环境不支持图片剪贴板写入");
  }
  if (typeof ClipboardItem === "undefined") {
    throw new Error("当前浏览器不支持 ClipboardItem 图片复制");
  }
  try {
    const item = new ClipboardItem({ "image/png": blob });
    await navigator.clipboard.write([item]);
  } catch (err) {
    const detail = err instanceof Error && err.message ? `（${err.message}）` : "";
    throw new Error(`写入系统剪贴板失败${detail}，可直接保存 PNG`);
  }
}
