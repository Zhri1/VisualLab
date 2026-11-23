import { useEffect, useRef, useState } from "react";
import { MoreHorizontal } from "lucide-react";
import type { Workspace } from "../../../hooks/useWorkspace";
import { ChatComposer } from "./ChatComposer";
import { ChatMessageRow } from "./ChatMessage";

interface Props {
  ws: Workspace;
  className?: string;
}

export function ChatPanel({ ws, className }: Props) {
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [ws.messages]);

  const send = () => {
    const text = input.trim();
    if (!text || ws.isChatLoading) return;
    setInput("");
    void ws.sendChat(text);
  };

  return (
    <section className={["panel", "chat-panel", className].filter(Boolean).join(" ")}>
      <div className="chat-head">
        <div>
          <h2 className="chat-title">AI Assistant</h2>
          <p className="chat-sub">提问、修改条件、控制播放</p>
        </div>
        <button className="icon-button" aria-label="更多">
          <MoreHorizontal size={18} />
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
              <p>可以直接问我这段运动为什么这样，也可以说「把劲度系数改成 100 N/m」让我重新算。</p>
            </div>
          </div>
        )}

        {ws.messages.map((m) => (
          <ChatMessageRow
            key={m.id}
            message={m}
            onUndo={ws.undoChange}
            onSeekEvent={ws.seekEvent}
          />
        ))}
      </div>

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
