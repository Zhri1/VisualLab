import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import {
  getVisibleContainerBounds,
  normalizeDragRect,
  type RegionRect,
  type ViewportBounds,
} from "./regionCapture";
import "./regionScreenshot.css";

interface Props {
  active: boolean;
  containerRef: React.RefObject<HTMLElement | null>;
  onCancel: () => void;
  onSelect: (rect: RegionRect) => void;
}

const MIN_SELECTION_PX = 8;

/**
 * 动画工作区框选截图遮罩层：
 * - 覆盖当前可见的动画工作区，拦截指针事件防止误触播放器；
 * - 支持任意方向拖动（含反向拖选）；
 * - Esc 或点击「取消」直接退出且不写入剪贴板；
 * - 标记 data-screenshot-exclude="true"，不会被截入成图。
 */
export function RegionScreenshotOverlay({ active, containerRef, onCancel, onSelect }: Props) {
  const [bounds, setBounds] = useState<ViewportBounds | null>(null);
  const [dragRect, setDragRect] = useState<RegionRect | null>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!active) {
      setDragRect(null);
      startRef.current = null;
      return;
    }
    const updateBounds = () => {
      if (containerRef.current) {
        setBounds(getVisibleContainerBounds(containerRef.current));
      }
    };
    updateBounds();
    window.addEventListener("resize", updateBounds);
    window.addEventListener("scroll", updateBounds, true);

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        startRef.current = null;
        setDragRect(null);
        onCancel();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("resize", updateBounds);
      window.removeEventListener("scroll", updateBounds, true);
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [active, containerRef, onCancel]);

  if (!active || !bounds) return null;

  const overlayW = Math.max(0, bounds.right - bounds.left);
  const overlayH = Math.max(0, bounds.bottom - bounds.top);
  if (overlayW < 2 || overlayH < 2) return null;

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    const liveBounds = containerRef.current ? getVisibleContainerBounds(containerRef.current) : bounds;
    setBounds(liveBounds);
    startRef.current = { x: e.clientX, y: e.clientY };
    setDragRect(normalizeDragRect(e.clientX, e.clientY, e.clientX, e.clientY, liveBounds));
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!startRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    const liveBounds = containerRef.current ? getVisibleContainerBounds(containerRef.current) : bounds;
    setDragRect(normalizeDragRect(startRef.current.x, startRef.current.y, e.clientX, e.clientY, liveBounds));
  };

  const finishDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!startRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // 忽略未捕获状态
    }
    const liveBounds = containerRef.current ? getVisibleContainerBounds(containerRef.current) : bounds;
    const rect = normalizeDragRect(startRef.current.x, startRef.current.y, e.clientX, e.clientY, liveBounds);
    startRef.current = null;
    setDragRect(null);
    if (rect.width < MIN_SELECTION_PX || rect.height < MIN_SELECTION_PX) {
      onCancel();
      return;
    }
    onSelect(rect);
  };

  return (
    <div
      className="region-shot-overlay"
      data-screenshot-exclude="true"
      role="dialog"
      aria-label="框选截图区域"
      style={{
        left: `${bounds.left}px`,
        top: `${bounds.top}px`,
        width: `${overlayW}px`,
        height: `${overlayH}px`,
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishDrag}
      onPointerCancel={() => {
        startRef.current = null;
        setDragRect(null);
        onCancel();
      }}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      {!dragRect && <div className="region-shot-dim" />}
      {dragRect && (
        <div
          className="region-shot-box"
          style={{
            left: `${dragRect.left - bounds.left}px`,
            top: `${dragRect.top - bounds.top}px`,
            width: `${dragRect.width}px`,
            height: `${dragRect.height}px`,
          }}
        >
          <span className="region-shot-size">
            {Math.round(dragRect.width)} × {Math.round(dragRect.height)}
          </span>
        </div>
      )}
      <div
        className="region-shot-toolbar"
        onPointerDown={(e) => e.stopPropagation()}
        onPointerUp={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        <span>拖动框选截图区域，松手自动复制到剪贴板</span>
        <button
          type="button"
          className="region-shot-cancel"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onCancel();
          }}
        >
          <X size={13} strokeWidth={2.2} />
          <span>取消 (Esc)</span>
        </button>
      </div>
    </div>
  );
}
