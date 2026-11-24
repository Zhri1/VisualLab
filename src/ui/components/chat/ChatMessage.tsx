/**
 * 单条消息。支持极简 Markdown 子集（段落、**粗体**、`代码`、$公式$）
 * 与内嵌操作入口，不引入第三方解析库。
 */
import type { ReactNode } from "react";
import { ArrowRight, ChevronRight, CornerDownRight, Sparkles } from "lucide-react";
import type { ChatMessage as ChatMessageType } from "../../../types";
import { ParameterChangeCard } from "./ParameterChangeCard";
import { CONDITION_META } from "../../../types";

interface Props {
  message: ChatMessageType;
  onUndo: (id: string) => void;
  onSeekEvent: (eventId: string) => void;
}

/** 把 **x**、`x`、$x$ 转成 React 节点 */
function renderInline(text: string, keyBase: string) {
  const tokens = text.split(/(\*\*[^*]+\*\*|`[^`]+`|\$[^$]+\$)/g).filter(Boolean);
  return tokens.map((tok, i) => {
    const key = `${keyBase}-${i}`;
    if (tok.startsWith("**") && tok.endsWith("**")) {
      return <strong key={key}>{tok.slice(2, -2)}</strong>;
    }
    if (tok.startsWith("`") && tok.endsWith("`")) {
      return <code key={key}>{tok.slice(1, -1)}</code>;
    }
    if (tok.startsWith("$") && tok.endsWith("$")) {
      return (
        <span className="inline-math" key={key}>
          {tok.slice(1, -1)}
        </span>
      );
    }
    return <span key={key}>{tok}</span>;
  });
}

function renderText(text: string) {
  const blocks: ReactNode[] = [];
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  let para: string[] = [];
  let list: string[] = [];

  const flushPara = () => {
    if (!para.length) return;
    const idx = blocks.length;
    const snap = para;
    para = [];
    blocks.push(
      <p key={`p-${idx}`}>
        {snap.map((line, j) => (
          <span key={j}>
            {renderInline(line, `p-${idx}-${j}`)}
            {j < snap.length - 1 && <br />}
          </span>
        ))}
      </p>
    );
  };

  const flushList = () => {
    if (!list.length) return;
    const idx = blocks.length;
    const snap = list;
    list = [];
    blocks.push(
      <ul className="msg-list" key={`ul-${idx}`}>
        {snap.map((item, j) => (
          <li key={j}>{renderInline(item, `li-${idx}-${j}`)}</li>
        ))}
      </ul>
    );
  };

  for (const raw of lines) {
    const trimmed = raw.trim();
    if (!trimmed) {
      flushPara();
      flushList();
      continue;
    }
    if (/^[-_*]{3,}$/.test(trimmed)) {
      flushPara();
      flushList();
      continue;
    }
    const heading = /^#{1,4}\s+(.+)$/.exec(trimmed);
    if (heading) {
      flushPara();
      flushList();
      const idx = blocks.length;
      blocks.push(
        <p className="msg-heading" key={`h-${idx}`}>
          <strong>{renderInline(heading[1], `h-${idx}`)}</strong>
        </p>
      );
      continue;
    }
    const bullet = /^(?:[-*•])\s+(.+)$/.exec(trimmed);
    if (bullet) {
      flushPara();
      list.push(bullet[1]);
      continue;
    }
    flushList();
    para.push(raw);
  }
  flushPara();
  flushList();
  return blocks;
}

/** 假设胶囊：用原生 details 收起条目，键盘可达、无需额外状态 */
function AssumptionChip({ items }: { items: string[] }) {
  return (
    <details className="assumption">
      <summary>
        <Sparkles size={12} strokeWidth={1.8} />
        <span>假设 {items.length} 条</span>
        <ChevronRight className="chev" size={12} strokeWidth={2} />
      </summary>
      <ul className="assumption-list">
        {items.map((t, i) => (
          <li key={i}>{t}</li>
        ))}
      </ul>
    </details>
  );
}

export function ChatMessageRow({ message, onUndo, onSeekEvent }: Props) {
  if (message.role === "user") {
    return (
      <div className="msg user">
        <div className="msg-body">{message.text}</div>
      </div>
    );
  }

  return (
    <div className={"msg" + (message.error ? " error" : "")}>
      <div className="msg-avatar" aria-hidden>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 18L18 6" />
          <path d="M9.5 6H18v8.5" />
        </svg>
      </div>
      <div className="msg-body">
        {message.pending ? (
          <span className="typing" aria-label="正在生成">
            <i />
            <i />
            <i />
          </span>
        ) : message.change ? (
          <ParameterChangeCard
            messageId={message.id}
            change={message.change}
            label={(key) =>
              CONDITION_META.find((m) => m.key === key)?.label ?? String(key)
            }
            unit={(key) => CONDITION_META.find((m) => m.key === key)?.unit ?? ""}
            onUndo={onUndo}
          />
        ) : (
          <>
            {message.text ? renderText(message.text) : null}
            {message.assumptions?.length ? <AssumptionChip items={message.assumptions} /> : null}
            {message.action?.type === "seek" && (
              <div className="msg-action">
                <button onClick={() => onSeekEvent(message.action!.eventId)}>
                  <CornerDownRight size={13} strokeWidth={1.9} />
                  {message.action.label}
                  <ArrowRight size={12} strokeWidth={2} style={{ marginLeft: 2 }} />
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
