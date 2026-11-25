import { useMemo, useState } from "react";
import { buildFromReading, defaultScanPath, findCriticals, outcomeOf, paramLabel, scanBounds, scanRange, withParam } from "./scanner";

interface Props {
  reading: unknown;
  variantValue: number | null;
  onApply: (value: number) => void;
  onVariant: (value: number) => void;
  onClearVariant: () => void;
  path?: (string | number)[] | null;
}

/** 临界探索：滑杆重算结局 + 自动二分临界值 + 并排对照入口。 */
export function CriticalPanel({ reading, variantValue, onApply, onVariant, onClearVariant, path: pathProp }: Props) {
  const path = useMemo(() => pathProp ?? defaultScanPath(reading), [reading, pathProp]);
  const bounds = useMemo(() => (path ? scanBounds(reading, path) : null), [reading, path]);
  const [value, setValue] = useState<number | null>(null);
  const points = useMemo(() => (path && bounds ? scanRange(reading, path, bounds.lo, bounds.hi, 24) : []), [reading, path, bounds]);
  const criticals = useMemo(() => (path ? findCriticals(reading, path, points) : []), [reading, path, points]);
  if (!path || !bounds) return null;
  const current = value ?? bounds.current;
  const motion = buildFromReading(withParam(reading, path, current));
  const outcome = motion ? outcomeOf(motion) : null;
  const step = (bounds.hi - bounds.lo) / 200;
  return (
    <section className="critical-panel" aria-label="临界参数探索">
      <div className="critical-head">
        <b>临界探索</b>
        <span className="critical-param">{paramLabel(path)} {current.toFixed(2)}</span>
      </div>
      <input
        className="critical-slider"
        type="range"
        min={bounds.lo}
        max={bounds.hi}
        step={step}
        value={current}
        aria-label={`${paramLabel(path)}滑杆`}
        onChange={(e) => setValue(Number(e.target.value))}
      />
      <div className="critical-outcome" role="status">
        {outcome ? outcome.label : "该初值下无法装配"}
      </div>
      {criticals.length > 0 && (
        <div className="critical-points">
          {criticals.map((c) => (
            <button key={c.value} type="button" className="critical-point" title={`${c.left.label} → ${c.right.label}`} onClick={() => setValue(c.value)}>
              临界 ≈ {c.value.toFixed(2)}
            </button>
          ))}
        </div>
      )}
      <div className="critical-actions">
        <button type="button" className="ghost-button" onClick={() => onApply(current)}>应用到主题</button>
        {variantValue == null ? (
          <button type="button" className="ghost-button" onClick={() => onVariant(current)}>并排对照</button>
        ) : (
          <button type="button" className="ghost-button" aria-pressed="true" onClick={onClearVariant}>退出对照（{variantValue.toFixed(2)}）</button>
        )}
      </div>
    </section>
  );
}
