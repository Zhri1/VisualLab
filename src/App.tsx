import { ArrowLeft, CircleHelp } from "lucide-react";
import { BrandMark } from "./ui/components/common/BrandMark";
import { DevBar } from "./ui/components/common/DevBar";
import { InitialScreen } from "./ui/components/home/InitialScreen";
import { WorkspaceLayout } from "./ui/components/workspace/WorkspaceLayout";
import { PRODUCT_NAME } from "./config/brand";
import { useWorkspace } from "./hooks/useWorkspace";

/** 联调条默认隐藏，只有开发环境且 URL 带 ?dev=1 时才显示，避免遮挡演示画面 */
const SHOW_DEV_BAR =
  import.meta.env.DEV && new URLSearchParams(window.location.search).get("dev") === "1";

export default function App() {
  const ws = useWorkspace();

  return (
    <div className="app">
      <div className="app-wash" />

      <header className="topbar">
        <button
          type="button"
          className="topbar-left brand-button"
          aria-label="返回首页"
          title="返回首页"
          onClick={() => {
            if (ws.phase === "workspace") ws.restartHome();
          }}
        >
          <BrandMark size={30} />
          <span className="brand-name">{PRODUCT_NAME}</span>
        </button>

        <div className="topbar-right">
          {ws.phase === "workspace" && (
            <>
              <button className="icon-button" aria-label="帮助" title="帮助">
                <CircleHelp size={18} strokeWidth={1.7} />
              </button>
              <div className="divider-v" />
              <button className="ghost-button" onClick={ws.restartHome}>
                <ArrowLeft size={14} strokeWidth={2.2} />
                返回首页
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
          onSample={(id) => ws.loadSample(id)}
        />
      ) : (
        <WorkspaceLayout ws={ws} />
      )}

      {SHOW_DEV_BAR && (
        <DevBar
          hasImage={Boolean(ws.imageFile)}
          onReload={() => {
            if (ws.imageFile) void ws.recognize({ file: ws.imageFile });
            else void ws.recognize({ text: "文字输入", isSample: false });
          }}
          onSample={() => ws.loadSample()}
        />
      )}
    </div>
  );
}
