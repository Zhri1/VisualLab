import { useEffect, useRef, useState } from 'react';
import type { AnnotationMode, AnnotationPoint, AnnotationStroke } from './types';
import {
  DEFAULT_LASER_HOLD_SECONDS,
  LASER_ID_PREFIX,
  isLaserStroke,
  strokeToPath,
  strokesVisibleAt,
} from './annotationMath';

export interface AnnotationLayerProps {
  width: number;
  height: number;
  time: number;
  mode: AnnotationMode;
  strokes: AnnotationStroke[];
  onChange: (s: AnnotationStroke[]) => void;
  color?: string;
}

export const ANNOTATION_COLOR_OPTIONS = [
  { value: '#ff3b30', label: '红色' },
  { value: '#0a84ff', label: '蓝色' },
  { value: '#000000', label: '黑色' },
] as const;

export interface AnnotationPaletteProps {
  mode: AnnotationMode;
  color: string;
  onColorChange: (color: string) => void;
  onClear: () => void;
  canClear?: boolean;
}

/** 画布外标注调色与清除操作条：仅在绘图模式（mode === 'draw'）可见，避免遮挡画布读数或误触画笔。 */
export function AnnotationPalette({
  mode,
  color,
  onColorChange,
  onClear,
  canClear = true,
}: AnnotationPaletteProps) {
  if (mode !== 'draw') return null;
  return (
    <div className="annotation-palette" role="group" aria-label="标注画笔颜色与清除">
      {ANNOTATION_COLOR_OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          className="annotation-color"
          aria-label={option.label}
          aria-pressed={color === option.value}
          onClick={() => onColorChange(option.value)}
          style={{ backgroundColor: option.value }}
        />
      ))}
      <button
        type="button"
        className="annotation-clear"
        aria-label="清除标注"
        disabled={!canClear}
        onClick={onClear}
      >
        清除
      </button>
    </div>
  );
}

const LASER_RGB = '255,59,48';

let strokeCounter = 0;

function nextStrokeId(mode: AnnotationMode): string {
  strokeCounter += 1;
  const prefix = mode === 'laser' ? LASER_ID_PREFIX : 'draw-';
  return `${prefix}${Date.now().toString(36)}-${strokeCounter.toString(36)}`;
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

/**
 * 标注教鞭覆盖层：绝对定位覆盖在目标 canvas 上方。
 * 受控组件：笔画数据完全由 props.strokes / props.onChange 管理，自身不持有 strokes 状态。
 * mode === 'off' 时整层 pointer-events: none，不拦截下层交互。
 */
export function AnnotationLayer({
  width,
  height,
  time,
  mode,
  strokes,
  onChange,
  color,
}: AnnotationLayerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const activeIdRef = useRef<string | null>(null);
  const strokesRef = useRef(strokes);
  strokesRef.current = strokes;
  const timeRef = useRef(time);
  timeRef.current = time;

  const [selectedColor, setSelectedColor] = useState<string>(
    color ?? ANNOTATION_COLOR_OPTIONS[0].value,
  );
  useEffect(() => {
    if (color) setSelectedColor(color);
  }, [color]);

  // 渲染：draw 圆头折线；laser 半透明红点 + 随时间衰减的尾迹。
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, width, height);
    const visible = strokesVisibleAt(strokes, time, DEFAULT_LASER_HOLD_SECONDS);
    for (const stroke of visible) {
      const pts = strokeToPath(stroke.points, width, height);
      if (pts.length === 0) continue;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      if (isLaserStroke(stroke)) {
        // 尾迹：越新的线段越不透明。
        ctx.lineWidth = stroke.width;
        for (let i = 1; i < pts.length; i += 1) {
          const age = time - stroke.points[i].t;
          const alpha =
            Math.max(0, Math.min(1, 1 - age / DEFAULT_LASER_HOLD_SECONDS)) * 0.5;
          ctx.strokeStyle = `rgba(${LASER_RGB},${alpha.toFixed(3)})`;
          ctx.beginPath();
          ctx.moveTo(pts[i - 1].x, pts[i - 1].y);
          ctx.lineTo(pts[i].x, pts[i].y);
          ctx.stroke();
        }
        // 头部：半透明光晕 + 红点。
        const head = pts[pts.length - 1];
        ctx.fillStyle = `rgba(${LASER_RGB},0.3)`;
        ctx.beginPath();
        ctx.arc(head.x, head.y, 10, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = `rgba(${LASER_RGB},0.85)`;
        ctx.beginPath();
        ctx.arc(head.x, head.y, 4, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.strokeStyle = stroke.color;
        ctx.lineWidth = stroke.width;
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        if (pts.length === 1) {
          // 单点也画出一个圆点。
          ctx.lineTo(pts[0].x + 0.01, pts[0].y);
        }
        for (let i = 1; i < pts.length; i += 1) {
          ctx.lineTo(pts[i].x, pts[i].y);
        }
        ctx.stroke();
      }
    }
  }, [strokes, time, width, height]);

  function pointFromEvent(
    e: React.PointerEvent<HTMLCanvasElement>,
  ): AnnotationPoint | null {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    return {
      x: clamp01((e.clientX - rect.left) / rect.width),
      y: clamp01((e.clientY - rect.top) / rect.height),
      t: timeRef.current,
    };
  }

  function handlePointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (mode === 'off') return;
    const point = pointFromEvent(e);
    if (!point) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const stroke: AnnotationStroke = {
      id: nextStrokeId(mode),
      color: selectedColor,
      width: mode === 'laser' ? 6 : 3,
      points: [point],
    };
    activeIdRef.current = stroke.id;
    // laser 模式同一时刻只保留一条临时笔画；draw 模式累积。
    const base =
      mode === 'laser'
        ? strokesRef.current.filter((s) => !isLaserStroke(s))
        : strokesRef.current;
    onChange([...base, stroke]);
  }

  function handlePointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    const activeId = activeIdRef.current;
    if (activeId === null) return;
    const point = pointFromEvent(e);
    if (!point) return;
    onChange(
      strokesRef.current.map((s) =>
        s.id === activeId ? { ...s, points: [...s.points, point] } : s,
      ),
    );
  }

  function endStroke(e: React.PointerEvent<HTMLCanvasElement>) {
    activeIdRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  }

  const interactive = mode !== 'off';

  return (
    <div
      className="annotation-layer"
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width,
        height,
        pointerEvents: interactive ? 'auto' : 'none',
      }}
    >
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        style={{
          display: 'block',
          width: '100%',
          height: '100%',
          touchAction: 'none',
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endStroke}
        onPointerCancel={endStroke}
      />
    </div>
  );
}
