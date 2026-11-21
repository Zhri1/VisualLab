/**
 * 「查看原题」抽屉：原图 + 识别参数 + 前提 + 编辑入口。
 * 参数表只在这里出现，工作台主界面不常驻。
 */
import { useEffect, useMemo, useState } from "react";
import { AlertCircle, Check, RotateCcw, X } from "lucide-react";
import {
  CONDITION_META,
  FACT_META,
  type Conditions,
  type FactKey,
  type FieldError,
  type WorkspaceReading,
  isStageReading,
} from "../../../types";
import { StagePlanEditor } from "./StagePlanEditor";

interface Props {
  open: boolean;
  onClose: () => void;
  reading: WorkspaceReading | null;
  imageUrl: string | null;
  missingKeys: string[];
  fieldErrors: FieldError[];
  onApply: (next: WorkspaceReading) => boolean;
}

export function OriginalProblemViewer({
  open,
  onClose,
  reading,
  imageUrl,
  missingKeys,
  fieldErrors,
  onApply,
}: Props) {
  const [draft, setDraft] = useState<WorkspaceReading | null>(reading);
  const [localErrors, setLocalErrors] = useState<FieldError[]>([]);

  useEffect(() => {
    if (open) {
      setDraft(reading);
      setLocalErrors([]);
    }
  }, [open, reading]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const errorsByField = useMemo(() => {
    const map = new Map<string, string>();
    [...fieldErrors, ...localErrors].forEach((e) => {
      const key = e.path ?? e.field;
      if (key && !map.has(key)) map.set(key, e.message);
    });
    return map;
  }, [fieldErrors, localErrors]);

  if (!open) return null;

  const setNum = (key: keyof Conditions, raw: string) => {
    if (!draft || isStageReading(draft)) return;
    const trimmed = raw.trim();
    const value = trimmed === "" ? null : Number(trimmed);
    setDraft({
      ...draft,
      conditions: {
        ...draft.conditions,
        [key]: Number.isNaN(value as number) ? null : value,
      },
    });
  };

  const setFact = (key: FactKey, value: boolean | null) => {
    if (!draft || isStageReading(draft)) return;
    setDraft({ ...draft, facts: { ...draft.facts, [key]: value } });
  };

  const reset = () => {
    setDraft(reading);
    setLocalErrors([]);
  };

  const apply = () => {
    if (!draft) {
      onClose();
      return;
    }
    const ok = onApply(draft);
    if (ok) {
      setLocalErrors([]);
      onClose();
    } else {
      // 具体错误由父层回填到 fieldErrors
      setLocalErrors([]);
    }
  };

  const missingCount = isStageReading(reading)
    ? missingKeys.length
    : CONDITION_META.filter((m) => {
        const v = reading?.conditions?.[m.key];
        return v === null || v === undefined;
      }).length;

  return (
    <div className="drawer-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="drawer" role="dialog" aria-modal="true" aria-label="查看原题与识别条件">
        <div className="drawer-head">
          <div>
            <h2 className="drawer-title">原题与识别条件</h2>
            <p className="drawer-sub">
              核对每一项后再应用，动画与时间轴会按新条件重算。
              {missingCount > 0 && ` 当前有 ${missingCount} 个条件缺失。`}
            </p>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="关闭">
            <X size={18} />
          </button>
        </div>

        <div className="drawer-body scroll">
          <div className="problem-thumb">
            {imageUrl ? (
              <img src={imageUrl} alt="原始题目图片" />
            ) : (
              <div className="placeholder">本题来自内置示例，没有原始图片</div>
            )}
          </div>

          {(fieldErrors.length > 0 || localErrors.length > 0) && (
            <div className="field-error">
              <AlertCircle size={15} style={{ flex: "none", marginTop: 2 }} />
              <div>
                {(fieldErrors.length ? fieldErrors : localErrors).map((e, i) => (
                  <div key={i}>{e.message}</div>
                ))}
              </div>
            </div>
          )}

          {isStageReading(draft) ? (
            <StagePlanEditor
              draft={draft}
              onChange={setDraft}
              missingKeys={missingKeys}
              fieldErrors={[...fieldErrors, ...localErrors]}
            />
          ) : (
            <>
          <p className="section-label">物理前提</p>
          <div className="fact-row">
            {FACT_META.map((f) => {
              const v = draft?.facts?.[f.key];
              const cls = v === true ? "" : v === false ? "false" : "unknown";
              return (
                <button
                  key={f.key}
                  className={`fact-chip ${cls}`}
                  onClick={() => setFact(f.key, v === true ? null : true)}
                  title="点击切换：已确认 / 待确认"
                >
                  {v === true ? <Check size={12} /> : v === false ? <X size={12} /> : <span>?</span>}
                  {f.label}
                </button>
              );
            })}
          </div>

          <p className="section-label">题设条件</p>
          <table className="cond-table">
            <tbody>
              {CONDITION_META.map((meta) => {
                const val = draft?.conditions?.[meta.key];
                const err = errorsByField.get(meta.key);
                const missing = val === null || val === undefined;
                const flagged = missing || Boolean(err) || missingKeys.includes(meta.key);
                return (
                  <tr key={meta.key}>
                    <td className="name">
                      {meta.label}
                      {meta.hint && <span className="hint">{meta.hint}</span>}
                    </td>
                    <td className="val">
                      <input
                        className={"num-input" + (flagged ? " invalid" : "")}
                        type="number"
                        step={meta.step ?? 0.1}
                        inputMode="decimal"
                        value={val === null || val === undefined ? "" : String(val)}
                        placeholder="待补"
                        onChange={(e) => setNum(meta.key, e.target.value)}
                      />
                      <span className="unit-tag">{meta.unit || "—"}</span>
                    </td>
                    <td style={{ fontSize: 12, color: err ? "#8a4b4b" : "var(--text-tertiary)" }}>
                      {err ? "需修正" : missing ? "缺失" : ""}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
            </>
          )}
        </div>

        <div className="drawer-foot">
          <div className="drawer-note">
            <RotateCcw
              size={14}
              style={{ cursor: "pointer" }}
              onClick={reset}
              aria-label="恢复识别值"
            />
            <span>恢复识别值</span>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <button className="text-button" onClick={onClose}>
              取消
            </button>
            <button className="solid-button" onClick={apply} disabled={!draft}>
              应用条件
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
