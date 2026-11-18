import { Check, Undo2 } from "lucide-react";
import type { ChatMessage } from "../../../types";

interface Props {
  messageId: string;
  change: NonNullable<ChatMessage["change"]>;
  label: (key: string) => string;
  unit: (key: string) => string;
  onUndo: (id: string) => void;
}

export function ParameterChangeCard({ messageId, change, label, unit, onUndo }: Props) {
  return (
    <div className="change-card">
      {change.changes.map((c, i) => (
        <div className="change-row" key={`${c.key}-${i}`}>
          <div className="change-label">{label(c.key)}</div>
          <div className="change-diff">
            <span className="old">{c.from ?? "—"}</span>
            <span className="arrow">→</span>
            <span className="new">{c.to ?? "—"}</span>
            <span className="unit">{unit(c.key)}</span>
          </div>
        </div>
      ))}

      <div className="change-foot">
        <span className={"change-status" + (change.applied ? "" : " reverted")}>
          <Check size={12} strokeWidth={2.6} />
          {change.applied ? "已更新" : "已撤销"}
        </span>
        <button
          className="change-undo"
          onClick={() => onUndo(messageId)}
          disabled={!change.applied}
        >
          <Undo2 size={12} strokeWidth={2.2} />
          撤销
        </button>
      </div>
    </div>
  );
}
