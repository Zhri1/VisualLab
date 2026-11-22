/**
 * 工作台状态机。整个应用只有这一处维护物理状态，
 * 动画、时间轴、字幕、AI 面板全部读同一份。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatErrors, motionLibrary } from "../adapters";
import { mockChatService } from "../services/chatService";
import { requestPlan, requestStageCommand } from "../services/imageRecognition";
import type { StagePlanDraft } from "../physics/stagePlan";
import { segmentAt } from "../ui/components/workspace/playback";
import { isStageReading } from "../types";
import type {
  ChatMessage,
  ConditionChange,
  Conditions,
  FieldError,
  Motion,
  MotionSegment,
  Reading,
  WorkspaceReading,
} from "../types";

export type Phase = "home" | "workspace";

export interface Notice {
  kind: "error" | "info";
  text: string;
  fieldErrors?: FieldError[];
  /** 提供内置示例入口 */
  showSample?: boolean;
}

let seq = 0;
const uid = () => `m${++seq}`;

export function useWorkspace() {
  const [phase, setPhase] = useState<Phase>("home");

  const [reading, setReading] = useState<WorkspaceReading | null>(null);
  const [motion, setMotion] = useState<Motion | null>(null);
  /** 当前有效 motion 对应的 reading，用于撤销 */
  const [appliedReading, setAppliedReading] = useState<WorkspaceReading | null>(null);

  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [autoPauseEvents, setAutoPauseEvents] = useState(false);
  const [segmentPlayback, setSegmentPlayback] = useState<MotionSegment | null>(null);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isRecognizing, setIsRecognizing] = useState(false);
  const [isChatLoading, setIsChatLoading] = useState(false);

  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);

  const [notice, setNotice] = useState<Notice | null>(null);
  /** 缺项：需要用户在核对表里补齐 */
  const [missingKeys, setMissingKeys] = useState<string[]>([]);

  const revRef = useRef(0);
  /** 连续对话改值时，必须基于「最新已生效」的 reading，而不是闭包里的旧值 */
  const latestAppliedRef = useRef<WorkspaceReading | null>(null);
  latestAppliedRef.current = appliedReading;

  /* ---------------- 浏览器历史：后退回到首页，前进恢复工作台 ---------------- */

  const motionRef = useRef<Motion | null>(null);
  motionRef.current = motion;

  // 首次加载若停在 #/work 但无 motion（如刷新），归一化回首页，避免假工作台。
  useEffect(() => {
    const homeUrl = window.location.pathname + window.location.search;
    if (window.location.hash === "#/work" && !motionRef.current) {
      window.history.replaceState(null, "", homeUrl);
    }
    const onPop = () => {
      if (window.location.hash === "#/work") {
        if (motionRef.current) {
          setPhase("workspace");
        } else {
          setPhase("home");
          window.history.replaceState(null, "", homeUrl);
        }
      } else {
        // 后退回首页：保留 motion 以便前进恢复，不清空状态。
        setPhase("home");
      }
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // phase 变化时写入历史，使浏览器后退/前进与页内视图一致。
  useEffect(() => {
    const homeUrl = window.location.pathname + window.location.search;
    if (phase === "workspace" && window.location.hash !== "#/work") {
      window.history.pushState(null, "", "#/work");
    } else if (phase === "home" && window.location.hash === "#/work") {
      window.history.pushState(null, "", homeUrl);
    }
  }, [phase]);

  /* ---------------- 核心：reading -> motion ---------------- */

  /** 装配 + 计算。成功返回 motion，失败返回错误，不改变已有状态。 */
  const compute = useCallback((r: WorkspaceReading) => {
    const assembled = motionLibrary.assembleScene(r);
    if (!assembled.ok) return { ok: false as const, errors: assembled.errors };

    const built = motionLibrary.buildMotion(assembled.scene);
    if (!built.ok) {
      return {
        ok: false as const,
        errors: [{ code: "PRECONDITION_CONFLICT" as const, message: built.message }],
      };
    }
    return { ok: true as const, motion: built.motion, reading: "kind" in assembled.scene ? assembled.scene.reading : r };
  }, []);

  /** 应用一份 reading：成功则整体切换并重置时间轴 */
  const applyReading = useCallback(
    (r: WorkspaceReading, opts?: { keepTime?: boolean; silent?: boolean }) => {
      const res = compute(r);
      if (!res.ok) {
        if (!opts?.silent) {
          setNotice({ kind: "error", text: formatErrors(res.errors), fieldErrors: res.errors });
        }
        return { ok: false as const, errors: res.errors };
      }
      setReading(res.reading);
      setAppliedReading(res.reading);
      setMotion(res.motion);
      setSegmentPlayback(null);
      if (segmentPlayback) setIsPlaying(false);
      setMissingKeys([]);
      if (!opts?.keepTime) setCurrentTime(0);
      if (!opts?.silent) setNotice(null);
      return { ok: true as const, motion: res.motion };
    },
    [compute, segmentPlayback]
  );

  /* ---------------- 识别 ---------------- */

  const recognize = useCallback(
    async (input: { file?: File | null; text?: string; isSample?: boolean }) => {
      setIsRecognizing(true);
      setNotice(null);

      if (input.file) {
        // 提到外层常量：类型收窄进不了 setState 的更新回调
        const file = input.file;
        setImageFile(file);
        setImageUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return URL.createObjectURL(file);
        });
      }

      const res = await requestPlan({
        file: input.file,
        text: input.text,
        isSample: input.isSample,
      });
      setIsRecognizing(false);

      if (res.status === "ok") {
        setPhase("workspace");
        applyReading(res.reading);
        // 假设不写在正文里重复：有假设时正文只报条数，条目交给对话胶囊；
        // 没有假设就退回回包 message（或通用开场白），离线 mock 与真实服务保持一致。
        const assumptions = res.assumptions ?? [];
        const summary =
          assumptions.length > 0
            ? `已识别题目，按以下 ${assumptions.length} 条假设计算`
            : res.message?.trim() || "已识别题目";
        setMessages([
          {
            id: uid(),
            role: "assistant",
            text: `${summary}。可以直接提问，也可以让我修改条件，比如「把劲度系数改成 100 N/m」。`,
            assumptions,
          },
        ]);
        return res;
      }

      if (res.status === "needs_input") {
        // 即使 reading 为 null，也给核对表一个可编辑的空壳，避免死路
        const shell: WorkspaceReading = res.reading ?? {
          templateId: "incline_spring",
          conditions: {
            gravityMps2: null,
            inclineAngleDeg: null,
            inclineLengthM: null,
            kineticFrictionCoefficient: null,
            initialSpeedMps: null,
            blockMassKg: null,
            springGapM: null,
            springConstantNpm: null,
          },
          facts: {
            slidesAfterRelease: null,
            losslessTurn: null,
            horizontalIsFrictionless: null,
            springIsUnattached: null,
          },
        };

        setPhase("workspace");
        setReading(shell);
        setMotion(null);
        setAppliedReading(null);
        setMissingKeys(res.missingKeys.length ? res.missingKeys : ["templateId"]);
        const hint =
          res.message || (res.reading ? "还有条件需要补齐，补全后即可生成动画。" : "没能识别出全部信息，请补齐条件。");
        setNotice({ kind: "info", text: hint, fieldErrors: res.fieldErrors ?? [] });
        // 缺项助手消息也挂 assumptions：页面复用同一套假设胶囊，不必区分 ok/needs_input
        setMessages([
          { id: uid(), role: "assistant", text: hint, assumptions: res.assumptions ?? [] },
        ]);
        return res;
      }

      if (res.status === "unsupported") {
        setNotice({ kind: "info", text: res.message, showSample: true });
        return res;
      }

      setNotice({ kind: "error", text: res.message });
      return res;
    },
    [applyReading]
  );

  /* ---------------- 内置示例 ---------------- */

  /** 内置示例：绕过联调开关，永远成功 */
  const loadSample = useCallback(
    (_scenario?: unknown) => {
      // 参数保留给 DevBar 的调用签名，示例本身不参与模拟失败
      void recognize({ text: "内置示例", isSample: true });
    },
    [recognize]
  );

  const restartHome = useCallback(() => {
    setSegmentPlayback(null);
    setPhase("home");
    setMotion(null);
    setReading(null);
    setAppliedReading(null);
    setMessages([]);
    setCurrentTime(0);
    setIsPlaying(false);
    setNotice(null);
    setMissingKeys([]);
    setImageFile(null);
    setImageUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
  }, []);

  /* ---------------- 播放 ---------------- */

  const seek = useCallback(
    (t: number) => {
      if (!motion) return;
      const time = Math.min(Math.max(t, 0), motion.durationSeconds);
      if (segmentPlayback && (time < segmentPlayback.startSeconds || time > segmentPlayback.endSeconds)) {
        setSegmentPlayback(null);
      }
      setCurrentTime(time);
    },
    [motion, segmentPlayback]
  );

  const seekEvent = useCallback(
    (eventId: string) => {
      if (!motion) return false;
      const ev = motion.events.find((e) => e.id === eventId);
      if (!ev) return false;
      seek(ev.timeSeconds);
      setIsPlaying(false);
      return true;
    },
    [motion, seek]
  );

  const nextEvent = useCallback(() => {
    if (!motion) return;
    const next = motion.events.find((e) => e.timeSeconds > currentTime + 1e-4);
    seek(next ? next.timeSeconds : motion.durationSeconds);
    setIsPlaying(false);
  }, [motion, currentTime, seek]);

  const togglePlay = useCallback(() => {
    if (!motion) return;
    if (segmentPlayback) {
      if (!isPlaying && (currentTime < segmentPlayback.startSeconds || currentTime >= segmentPlayback.endSeconds)) {
        setCurrentTime(segmentPlayback.startSeconds);
      }
    } else if (currentTime >= motion.durationSeconds - 1e-4) setCurrentTime(0);
    setIsPlaying((p) => !p);
  }, [motion, currentTime, isPlaying, segmentPlayback]);

  const replay = useCallback(() => {
    if (!motion) return;
    setSegmentPlayback(null);
    setCurrentTime(0);
    setIsPlaying(true);
  }, [motion]);

  const slowCurrentSegment = useCallback(() => {
    if (!motion) return;
    const segment = segmentAt(motion.segments, currentTime);
    if (!segment) return;
    setSegmentPlayback(segment);
    setPlaybackRate(0.25);
    setCurrentTime(segment.startSeconds);
    setIsPlaying(true);
  }, [motion, currentTime]);

  const exitSegmentPlayback = useCallback(() => {
    setSegmentPlayback(null);
    setPlaybackRate(1);
  }, []);

  /* ---------------- 对话 ---------------- */

  const pushMessage = useCallback((m: ChatMessage) => {
    setMessages((prev) => [...prev, m]);
  }, []);

  const sendChat = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || isChatLoading) return;

      pushMessage({ id: uid(), role: "user", text: trimmed });
      const pendingId = uid();
      pushMessage({ id: pendingId, role: "assistant", text: "", pending: true });
      setIsChatLoading(true);

      const dropPending = () => setMessages((prev) => prev.filter((m) => m.id !== pendingId));
      const isTruncateCommand = /只看|只算|只播|只显示|截断|截到|为止|停到|到坡底|到桌沿|前[一二两三四五六1-6]段/.test(trimmed);
      if (isStageReading(reading) && isTruncateCommand) {
        const base = latestAppliedRef.current;
        if (!isStageReading(base)) {
          setIsChatLoading(false);
          dropPending();
          pushMessage({ id: uid(), role: "assistant", text: "请先应用一组完整条件，再截取运动阶段。" });
          return;
        }
        const response = await requestStageCommand(trimmed, base);
        setIsChatLoading(false);
        dropPending();
        if (response.status !== "ok") {
          pushMessage({ id: uid(), role: "assistant", text: response.message, error: response.status === "error" });
          return;
        }
        const through = response.intent.throughStageIndex;
        if (!Number.isInteger(through) || through < 0 || through >= base.stages.length) {
          pushMessage({ id: uid(), role: "assistant", text: "返回的阶段下标无效，已保留原动画。", error: true });
          return;
        }
        const nextPlan: StagePlanDraft = { ...base, stages: base.stages.slice(0, through + 1) };
        const result = applyReading(nextPlan, { silent: true });
        if (!result.ok) {
          pushMessage({ id: uid(), role: "assistant", text: `截取失败：${formatErrors(result.errors)}。已保留原动画。`, error: true });
          return;
        }
        setIsPlaying(false);
        pushMessage({
          id: uid(),
          role: "assistant",
          text: `已保留前 ${through + 1} 个阶段，时间轴在 ${result.motion.durationSeconds.toFixed(2)} s 结束。`,
        });
        return;
      }

      const intent = await mockChatService.send(trimmed, {
        motion,
        conditions: (isStageReading(reading) ? {} : (reading?.conditions ?? {})) as Record<string, number | null>,
      });

      setIsChatLoading(false);

      if (intent.type === "answer") {
        dropPending();
        pushMessage({
          id: uid(),
          role: "assistant",
          text: intent.text,
          action: intent.action,
        });
        return;
      }

      if (intent.type === "seek_event") {
        dropPending();
        const ok = seekEvent(intent.event);
        const ev = motion?.events.find((e) => e.id === intent.event);
        pushMessage({
          id: uid(),
          role: "assistant",
          text: ok && ev ? `已跳到「${ev.label}」，t = ${ev.timeSeconds.toFixed(2)} s。` : "暂时没有找到这个事件。",
        });
        return;
      }

      if (intent.type === "play") {
        dropPending();
        if (!isPlaying) togglePlay();
        pushMessage({ id: uid(), role: "assistant", text: "已开始播放。" });
        return;
      }
      if (intent.type === "pause") {
        dropPending();
        setIsPlaying(false);
        pushMessage({ id: uid(), role: "assistant", text: "已暂停在当前位置。" });
        return;
      }
      if (intent.type === "replay") {
        dropPending();
        replay();
        pushMessage({ id: uid(), role: "assistant", text: "已从头重播。" });
        return;
      }

      if (intent.type === "clarify") {
        dropPending();
        pushMessage({ id: uid(), role: "assistant", text: intent.text });
        return;
      }

      // update_conditions
      dropPending();
      const base = latestAppliedRef.current;
      if (!base) {
        pushMessage({
          id: uid(),
          role: "assistant",
          text: "当前还没有可修改的题目，先上传或使用内置示例。",
        });
        return;
      }
      if (isStageReading(base)) {
        pushMessage({
          id: uid(),
          role: "assistant",
          text: "阶段计划的数值请在「查看原题」中修改；对话截断可输入「只看斜面」。",
        });
        return;
      }

      const nextConditions: Conditions = { ...base.conditions };
      const changes: ConditionChange[] = [];
      for (const [k, v] of Object.entries(intent.changes)) {
        if (v === undefined) continue;
        const key = k as keyof Conditions;
        changes.push({
          key: k as ConditionChange["key"],
          from: base.conditions[key] as number | null,
          to: v,
        });
        nextConditions[key] = v;
      }
      const nextReading: Reading = { ...base, conditions: nextConditions };

      const res = applyReading(nextReading, { silent: true });
      if (!res.ok) {
        // 失败不动现有场景（提示词 9.2 要求）
        pushMessage({
          id: uid(),
          role: "assistant",
          text: `这个修改无法应用：${formatErrors(res.errors)}。动画保持在原条件。`,
          error: true,
        });
        return;
      }

      const revisionId = `r${++revRef.current}`;
      pushMessage({
        id: uid(),
        role: "assistant",
        text: "",
        change: { changes, applied: true, revisionId },
      });
      pushMessage({
        id: uid(),
        role: "assistant",
        text: intent.text + "动画与时间轴已同步更新。",
      });
    },
    [applyReading, isChatLoading, motion, pushMessage, reading, replay, seekEvent, isPlaying, togglePlay]
  );

  /** 撤销某次参数修改：回到该次修改前的 conditions */
  const undoChange = useCallback(
    (messageId: string) => {
      const msg = messages.find((m) => m.id === messageId);
      const current = latestAppliedRef.current;
      if (!msg?.change || !current || isStageReading(current)) return;

      // 撤销只回退这一张卡片改动的字段，其余保持当前值
      const target = { ...current, conditions: { ...current.conditions } };
      for (const ch of msg.change.changes) {
        target.conditions[ch.key] = ch.from;
      }

      const res = applyReading(target, { silent: true, keepTime: true });
      if (!res.ok) {
        pushMessage({
          id: uid(),
          role: "assistant",
          text: `撤销失败：${formatErrors(res.errors)}`,
          error: true,
        });
        return;
      }

      setMessages((prev) =>
        prev.map((m) =>
          m.id === messageId && m.change
            ? { ...m, change: { ...m.change, applied: false } }
            : m
        )
      );
      pushMessage({ id: uid(), role: "assistant", text: "已撤销修改，恢复上一次有效的条件。" });
    },
    [applyReading, messages, pushMessage]
  );

  /* ---------------- 核对表提交 ---------------- */

  const applyConditions = useCallback(
    (next: WorkspaceReading) => {
      const res = applyReading(next);
      if (res.ok) {
        setNotice(null);
        if (messages.length === 0) {
          pushMessage({
            id: uid(),
            role: "assistant",
            text: "条件已应用，动画已重新计算。",
          });
        }
        return true;
      }
      return false;
    },
    [applyReading, messages.length, pushMessage]
  );

  return useMemo(
    () => ({
      // state
      phase,
      reading,
      appliedReading,
      motion,
      currentTime,
      isPlaying,
      playbackRate,
      autoPauseEvents,
      segmentPlayback,
      messages,
      isRecognizing,
      isChatLoading,
      imageUrl,
      imageFile,
      notice,
      missingKeys,
      // actions
      recognize,
      loadSample,
      restartHome,
      seek,
      seekEvent,
      nextEvent,
      togglePlay,
      replay,
      setIsPlaying,
      sendChat,
      undoChange,
      applyConditions,
      setNotice,
      setCurrentTime,
      setPlaybackRate,
      setAutoPauseEvents,
      slowCurrentSegment,
      exitSegmentPlayback,
    }),
    [
      phase, reading, appliedReading, motion, currentTime, isPlaying, playbackRate, autoPauseEvents, segmentPlayback, messages,
      isRecognizing, isChatLoading, imageUrl, imageFile, notice, missingKeys,
      recognize, loadSample, restartHome, seek, seekEvent, nextEvent, togglePlay,
      replay, sendChat, undoChange, applyConditions, slowCurrentSegment, exitSegmentPlayback,
    ]
  );
}

export type Workspace = ReturnType<typeof useWorkspace>;
