import { useEffect, useRef, useState } from "react";
import type { CropRect } from "./imageTools";

interface Props {
  previewUrl: string;
  onCancel: () => void;
  onConfirm: (rect: CropRect) => void;
}

type DragMode = "move" | "resize";

const MIN_SIZE = 0.1;
const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

/** 轻量裁剪：拖动选框移动，右下角手柄缩放。 */
export function ImageCropDialog({ previewUrl, onCancel, onConfirm }: Props) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ mode: DragMode; startX: number; startY: number; rect: CropRect } | null>(
    null,
  );
  const [rect, setRect] = useState<CropRect>({ x: 0.06, y: 0.06, width: 0.88, height: 0.88 });

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const start = (mode: DragMode) => (event: React.PointerEvent) => {
    event.preventDefault();
    event.stopPropagation();
    (event.target as Element).setPointerCapture?.(event.pointerId);
    dragRef.current = { mode, startX: event.clientX, startY: event.clientY, rect };
  };

  const move = (event: React.PointerEvent) => {
    const drag = dragRef.current;
    const stage = stageRef.current;
    if (!drag || !stage) return;
    const box = stage.getBoundingClientRect();
    if (!box.width || !box.height) return;
    const dx = (event.clientX - drag.startX) / box.width;
    const dy = (event.clientY - drag.startY) / box.height;

    if (drag.mode === "move") {
      setRect({
        ...drag.rect,
        x: clamp(drag.rect.x + dx, 0, 1 - drag.rect.width),
        y: clamp(drag.rect.y + dy, 0, 1 - drag.rect.height),
      });
    } else {
      setRect({
        ...drag.rect,
        width: clamp(drag.rect.width + dx, MIN_SIZE, 1 - drag.rect.x),
        height: clamp(drag.rect.height + dy, MIN_SIZE, 1 - drag.rect.y),
      });
    }
  };

  const end = () => {
    dragRef.current = null;
  };

  return (
    <div className="crop-backdrop" onClick={onCancel}>
      <div
        className="crop-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="裁剪题图"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="crop-head">
          <strong>裁剪题图</strong>
          <span>拖动选框移动，拖右下角缩放；只保留要识别的题目。</span>
        </div>
        <div
          className="crop-stage"
          ref={stageRef}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
        >
          <img src={previewUrl} alt="待裁剪的题图" draggable={false} />
          <div
            className="crop-box"
            style={{
              left: `${rect.x * 100}%`,
              top: `${rect.y * 100}%`,
              width: `${rect.width * 100}%`,
              height: `${rect.height * 100}%`,
            }}
            onPointerDown={start("move")}
          >
            <span className="crop-handle" onPointerDown={start("resize")} aria-hidden="true" />
          </div>
        </div>
        <div className="crop-actions">
          <button type="button" className="ghost-button" onClick={onCancel}>
            取消
          </button>
          <button type="button" className="solid-button" onClick={() => onConfirm(rect)}>
            应用裁剪
          </button>
        </div>
      </div>
    </div>
  );
}