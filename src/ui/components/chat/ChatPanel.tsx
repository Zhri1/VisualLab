import { useEffect, useMemo, useRef, useState } from "react";
import {
  BookOpen,
  ChevronDown,
  Compass,
  FileText,
  HelpCircle,
  Layers,
  SlidersHorizontal,
  Sparkles,
  X,
} from "lucide-react";
import type { Workspace } from "../../../hooks/useWorkspace";
import { getLocalFollowupSuggestions, getQuickParamSuggestions } from "../../../services/chatService";
import { ChatComposer } from "./ChatComposer";
import { ChatMessageRow } from "./ChatMessage";

interface Props {
  ws: Workspace;
  className?: string;
}

const FULL_ANALYZE_PROMPT =
  "请结合当前动画的物理过程，分阶段给出这道题的完整受力分析、核心方程推导与关键数值结果。";

const SOCRATIC_START_PROMPT =
  "请像老师一样带我一步步做这道题，先从第一阶段开始引导我思考，先不要直接给最终答案。";

const LOCAL_QA_GUIDE_MESSAGE =
  "想弄懂哪个局部细节？比如某一段为什么满足守恒、临界条件怎么列，或者某个时刻受力为什么突变——直接在下方输入框告诉我，我专门拆这一步给你讲清楚。";

const LOCAL_QA_PLACEHOLDER = "输入你想追问的具体步骤，如：为什么共速时弹性势能最大？";
const SOCRATIC_PLACEHOLDER = "回复老师的引导问题，说出你的思路…";

export function ChatPanel({ ws, className }: Props) {
  const [input, setInput] = useState("");
  const [quickOpen, setQuickOpen] = useState(false);
  const [showAnalyzeOptions, setShowAnalyzeOptions] = useState(false);
  const [showParamSuggestions, setShowParamSuggestions] = useState(false);
  const [localQaActive, setLocalQaActive] = useState(false);
  const panelRef = useRef<HTMLElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const composerInputRef = useRef<HTMLTextAreaElement>(null);

  const hasUserMessage = useMemo(
    () => ws.messages.some((m) => m.role === "user"),
    [ws.messages],
  );

  const paramSuggestions = useMemo(
    () => getQuickParamSuggestions(ws.appliedReading ?? ws.reading),
    [ws.appliedReading, ws.reading],
  );

  const localFollowups = useMemo(
    () => getLocalFollowupSuggestions(ws.motion),
    [ws.motion],
  );

  const firstMessageId = ws.messages[0]?.id ?? null;
  useEffect(() => {
    setQuickOpen(false);
    setShowAnalyzeOptions(false);
    setShowParamSuggestions(false);
    setLocalQaActive(false);
  }, [firstMessageId]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [ws.messages]);

  const focusComposer = () => {
    if (composerInputRef.current) {
      composerInputRef.current.focus();
      return;
    }
    panelRef.current?.querySelector<HTMLTextAreaElement>(".chat-input")?.focus();
  };

  const send = () => {
    const text = input.trim();
    if (!text || ws.isChatLoading) return;
    setInput("");
    setQuickOpen(false);
    setShowAnalyzeOptions(false);
    setShowParamSuggestions(false);
    setLocalQaActive(false);
    void ws.sendChat(text, { mode: ws.tutorStyle });
  };

  const handleToggleAnalyze = () => {
    setShowAnalyzeOptions((prev) => !prev);
    setShowParamSuggestions(false);
  };

  const handleFullAnalyze = () => {
    if (ws.isChatLoading) return;
    setQuickOpen(false);
    setShowAnalyzeOptions(false);
    setShowParamSuggestions(false);
    setLocalQaActive(false);
    ws.setTutorStyle("tutor");
    void ws.sendChat(FULL_ANALYZE_PROMPT, { mode: "tutor" });
  };

  const handleSocraticAnalyze = () => {
    if (ws.isChatLoading) return;
    setQuickOpen(false);
    setShowAnalyzeOptions(false);
    setShowParamSuggestions(false);
    setLocalQaActive(false);
    ws.setTutorStyle("socratic");
    void ws.sendChat(SOCRATIC_START_PROMPT, { mode: "socratic" });
  };

  const handleLocalQa = () => {
    if (ws.isChatLoading) return;
    setQuickOpen(false);
    setShowAnalyzeOptions(false);
    setShowParamSuggestions(false);
    ws.setTutorStyle("tutor");
    ws.pushAssistantMessage(LOCAL_QA_GUIDE_MESSAGE);
    setLocalQaActive(true);
    requestAnimationFrame(() => focusComposer());
  };

  const handlePickLocalFollowup = (question: string) => {
    if (ws.isChatLoading) return;
    setLocalQaActive(false);
    setQuickOpen(false);
    setShowAnalyzeOptions(false);
    setShowParamSuggestions(false);
    void ws.sendChat(question, { mode: "tutor" });
  };

  const handleToggleParams = () => {
    setShowParamSuggestions((prev) => !prev);
    setShowAnalyzeOptions(false);
    focusComposer();
  };

  const handlePickParam = (command: string) => {
    if (ws.isChatLoading) return;
    setQuickOpen(false);
    setShowAnalyzeOptions(false);
    setShowParamSuggestions(false);
    setLocalQaActive(false);
    void ws.sendChat(command);
  };

  const handleSimilar = () => {
    if (ws.isChatLoading) return;
    setQuickOpen(false);
    setShowAnalyzeOptions(false);
    setShowParamSuggestions(false);
    setLocalQaActive(false);
    ws.recommendSimilar();
  };

  const composerPlaceholder =
    ws.tutorStyle === "socratic"
      ? SOCRATIC_PLACEHOLDER
      : localQaActive
        ? LOCAL_QA_PLACEHOLDER
        : "提问或修改物理条件…";

  const renderQuickActionList = (compact = false) => (
    <div className={"quick-actions" + (compact ? " compact" : "")} role="menu" aria-label="快捷入口">
      <button
        type="button"
        className={"quick-action-row" + (showAnalyzeOptions ? " active" : "")}
        onClick={handleToggleAnalyze}
        disabled={ws.isChatLoading}
        aria-expanded={showAnalyzeOptions}
      >
        <span className="quick-action-icon" aria-hidden>
          <BookOpen size={15} strokeWidth={1.85} />
        </span>
        <span className="quick-action-title">解析题目</span>
        <ChevronDown
          size={14}
          strokeWidth={1.9}
          className={"quick-action-chev" + (showAnalyzeOptions ? " open" : "")}
          aria-hidden
        />
      </button>

      {showAnalyzeOptions && (
        <div className="analyze-options" role="group" aria-label="选择解析方式">
          <button
            type="button"
            className="analyze-option"
            onClick={handleFullAnalyze}
            disabled={ws.isChatLoading}
          >
            <span className="analyze-option-icon" aria-hidden>
              <FileText size={14} strokeWidth={1.85} />
            </span>
            <span className="analyze-option-copy">
              <span className="analyze-option-title">完整解析</span>
              <span className="analyze-option-sub">直接给出分阶段受力、方程与最终答案</span>
            </span>
          </button>

          <button
            type="button"
            className={"analyze-option" + (ws.tutorStyle === "socratic" ? " active" : "")}
            onClick={handleSocraticAnalyze}
            disabled={ws.isChatLoading}
          >
            <span className="analyze-option-icon" aria-hidden>
              <Compass size={14} strokeWidth={1.85} />
            </span>
            <span className="analyze-option-copy">
              <span className="analyze-option-title">分步带练</span>
              <span className="analyze-option-sub">像老师一样一步步启发思考、边问边推</span>
            </span>
          </button>

          <button
            type="button"
            className={"analyze-option" + (localQaActive ? " active" : "")}
            onClick={handleLocalQa}
            disabled={ws.isChatLoading}
          >
            <span className="analyze-option-icon" aria-hidden>
              <HelpCircle size={14} strokeWidth={1.85} />
            </span>
            <span className="analyze-option-copy">
              <span className="analyze-option-title">局部答疑</span>
              <span className="analyze-option-sub">针对某一步骤、临界点或公式追问原因</span>
            </span>
          </button>
        </div>
      )}

      <button
        type="button"
        className={"quick-action-row" + (showParamSuggestions ? " active" : "")}
        onClick={handleToggleParams}
        disabled={ws.isChatLoading}
        aria-expanded={showParamSuggestions}
      >
        <span className="quick-action-icon" aria-hidden>
          <SlidersHorizontal size={15} strokeWidth={1.85} />
        </span>
        <span className="quick-action-title">更改条件</span>
        <ChevronDown
          size={14}
          strokeWidth={1.9}
          className={"quick-action-chev" + (showParamSuggestions ? " open" : "")}
          aria-hidden
        />
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
            setShowAnalyzeOptions(false);
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
            generatingSimilarId={ws.generatingSimilarId}
            isRecognizing={ws.isRecognizing}
            onCancelGenerate={ws.cancelRecognize}
            onTrySimilar={(stem, similarId) => {
              void ws.recognize({ text: stem, similarId });
            }}
          />
        ))}

        {!hasUserMessage && renderQuickActionList(false)}
      </div>

      {hasUserMessage && quickOpen && (
        <div className="quick-actions-drawer">{renderQuickActionList(true)}</div>
      )}

      {ws.tutorStyle === "socratic" && (
        <div className="tutor-mode-bar" role="status" aria-live="polite">
          <span className="tutor-mode-label">
            <Compass size={12} strokeWidth={2} aria-hidden />
            <span>分步带练模式</span>
          </span>
          <button
            type="button"
            className="tutor-mode-exit"
            onClick={() => ws.setTutorStyle("tutor")}
          >
            退出
          </button>
        </div>
      )}

      {localQaActive && ws.tutorStyle !== "socratic" && localFollowups.length > 0 && (
        <div className="local-qa-bar" aria-label="局部追问快捷问题">
          <div className="local-qa-head">
            <span>点选关键节点直接追问</span>
            <button
              type="button"
              className="local-qa-close"
              onClick={() => setLocalQaActive(false)}
              aria-label="关闭局部追问建议"
              title="收起"
            >
              <X size={12} strokeWidth={2} />
            </button>
          </div>
          <div className="local-qa-chips">
            {localFollowups.map((q) => (
              <button
                key={q}
                type="button"
                className="local-qa-chip"
                onClick={() => handlePickLocalFollowup(q)}
                disabled={ws.isChatLoading}
              >
                {q}
              </button>
            ))}
          </div>
        </div>
      )}

      <ChatComposer
        value={input}
        onChange={setInput}
        onSend={send}
        disabled={ws.isChatLoading}
        placeholder={composerPlaceholder}
        inputRef={composerInputRef}
        onImagePick={(file) => {
          void ws.recognize({ file });
        }}
      />
    </section>
  );
}
