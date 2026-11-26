import { useEffect, useMemo, useRef, useState } from "react";
import { BookOpen, Layers, SlidersHorizontal, Sparkles } from "lucide-react";
import type { Workspace } from "../../../hooks/useWorkspace";
import { getQuickParamSuggestions } from "../../../services/chatService";
import { ChatComposer } from "./ChatComposer";
import { ChatMessageRow } from "./ChatMessage";

interface Props {
  ws: Workspace;
  className?: string;
}

const ANALYZE_PROMPT =
  "请结合当前物理引擎实算数据，按「过程拆分 → 受力与守恒方程 → 关键数值结论」为我完整解析这道题。";

export function ChatPanel({ ws, className }: Props) {
  const [input, setInput] = useState("");
  const [quickOpen, setQuickOpen] = useState(false);
  const [showParamSuggestions, setShowParamSuggestions] = useState(false);
  const panelRef = useRef<HTMLElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const hasUserMessage = useMemo(
    () => ws.messages.some((m) => m.role === "user"),
    [ws.messages],
  );

  const paramSuggestions = useMemo(
    () => getQuickParamSuggestions(ws.appliedReading ?? ws.reading),
    [ws.appliedReading, ws.reading],
  );

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [ws.messages]);

  const focusComposer = () => {
    panelRef.current?.querySelector<HTMLTextAreaElement>(".chat-input")?.focus();
  };

  const send = () => {
    const text = input.trim();
    if (!text || ws.isChatLoading) return;
    setInput("");
    setQuickOpen(false);
    setShowParamSuggestions(false);
    void ws.sendChat(text);
  };

  const handleAnalyze = () => {
    if (ws.isChatLoading) return;
    setQuickOpen(false);
    setShowParamSuggestions(false);
    void ws.sendChat(ANALYZE_PROMPT);
  };

  const handleToggleParams = () => {
    setShowParamSuggestions((prev) => !prev);
    focusComposer();
  };

  const handlePickParam = (command: string) => {
    if (ws.isChatLoading) return;
    setQuickOpen(false);
    setShowParamSuggestions(false);
    void ws.sendChat(command);
  };

  const handleSimilar = () => {
    if (ws.isChatLoading) return;
    setQuickOpen(false);
    setShowParamSuggestions(false);
    ws.recommendSimilar();
  };

  const renderQuickActionList = (compact = false) => (
    <div className={"quick-actions" + (compact ? " compact" : "")} role="menu" aria-label="快捷入口">
      <button
        type="button"
        className="quick-action-row"
        onClick={handleAnalyze}
        disabled={ws.isChatLoading}
      >
        <span className="quick-action-icon" aria-hidden>
          <BookOpen size={15} strokeWidth={1.85} />
        </span>
        <span className="quick-action-title">解析题目</span>
      </button>

      <button
        type="button"
        className={"quick-action-row" + (showParamSuggestions ? " active" : "")}
        onClick={handleToggleParams}
        disabled={ws.isChatLoading}
      >
        <span className="quick-action-icon" aria-hidden>
          <SlidersHorizontal size={15} strokeWidth={1.85} />
        </span>
        <span className="quick-action-title">更改条件</span>
      </button>

      {showParamSuggestions && (
        <div className="param-suggestions">
          {paramSuggestions.map((item) => (
            <button
              key={item.command}
              type="button"
              className="param-suggestion-chip"
              onClick={() => handlePickParam(item.command)}
              disabled={ws.isChatLoading}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}

      <button
        type="button"
        className="quick-action-row"
        onClick={handleSimilar}
        disabled={ws.isChatLoading}
      >
        <span className="quick-action-icon" aria-hidden>
          <Layers size={15} strokeWidth={1.85} />
        </span>
        <span className="quick-action-title">推荐相似题目</span>
      </button>
    </div>
  );

  return (
    <section ref={panelRef} className={["panel", "chat-panel", className].filter(Boolean).join(" ")}>
      <div className="chat-head">
        <div>
          <h2 className="chat-title">AI Assistant</h2>
          <p className="chat-sub">提问、修改条件、推荐变式</p>
        </div>
        <button
          type="button"
          className={"quick-toggle-btn" + (quickOpen ? " active" : "")}
          aria-label="快捷入口"
          aria-expanded={quickOpen}
          title="快捷入口"
          onClick={() => {
            setQuickOpen((prev) => !prev);
            setShowParamSuggestions(false);
          }}
        >
          <Sparkles size={14} strokeWidth={1.9} />
          <span>快捷</span>
        </button>
      </div>

      <div className="chat-scroll scroll" ref={scrollRef}>
        {ws.messages.length === 0 && (
          <div className="msg">
            <div className="msg-avatar" aria-hidden>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="M6 18L18 6" />
                <path d="M9.5 6H18v8.5" />
              </svg>
            </div>
            <div className="msg-body">
              <p>可以直接问我这段运动的受力与守恒过程，也可以让我修改参数重新计算，或推荐相似变式题。</p>
            </div>
          </div>
        )}

        {ws.messages.map((m) => (
          <ChatMessageRow
            key={m.id}
            message={m}
            onUndo={ws.undoChange}
            onSeekEvent={ws.seekEvent}
            onTrySimilar={(stem) => {
              void ws.recognize({ text: stem });
            }}
          />
        ))}

        {!hasUserMessage && renderQuickActionList(false)}
      </div>

      {hasUserMessage && quickOpen && (
        <div className="quick-actions-drawer">{renderQuickActionList(true)}</div>
      )}

      <ChatComposer
        value={input}
        onChange={setInput}
        onSend={send}
        disabled={ws.isChatLoading}
        onImagePick={(file) => {
          void ws.recognize({ file });
        }}
      />
    </section>
  );
}
