import { CircleHelp, Plus } from "lucide-react";
import { BrandMark } from "./ui/components/common/BrandMark";
import { DevBar } from "./ui/components/common/DevBar";
import { InitialScreen } from "./ui/components/home/InitialScreen";
import { WorkspaceLayout } from "./ui/components/workspace/WorkspaceLayout";
import { PRODUCT_NAME } from "./config/brand";
import { useWorkspace } from "./hooks/useWorkspace";

export default function App() {
  const ws = useWorkspace();

  return (
    <div className="app">
      <div className="app-wash" />

      <header className="topbar">
        <div className="topbar-left">
          <BrandMark size={30} />
          <span className="brand-name">{PRODUCT_NAME}</span>
        </div>

        <div className="topbar-right">
          {ws.phase === "workspace" && (
            <>
              <button className="icon-button" aria-label="帮助" title="帮助">
                <CircleHelp size={18} strokeWidth={1.7} />
              </button>
              <div className="divider-v" />
              <button className="ghost-button" onClick={ws.restartHome}>
                <Plus size={14} strokeWidth={2.2} />
                新建题目
              </button>
            </>
          )}
        </div>
      </header>

      {ws.phase === "home" ? (
        <InitialScreen
          busy={ws.isRecognizing}
          notice={ws.notice}
          onSubmit={({ file, text }) => {
            void ws.recognize({ file, text });
          }}
          onSample={() => ws.loadSample()}
        />
      ) : (
        <WorkspaceLayout ws={ws} />
      )}

      <DevBar
        hasImage={Boolean(ws.imageFile)}
        onReload={() => {
          if (ws.imageFile) void ws.recognize({ file: ws.imageFile });
          else void ws.recognize({ text: "文字输入", isSample: false });
        }}
        onSample={() => ws.loadSample()}
      />
    </div>
  );
}
