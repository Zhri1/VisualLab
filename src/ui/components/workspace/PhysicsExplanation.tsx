/**
 * 与播放时间同步的物理解释。
 * 优先展示当前阶段；若刚经过某个事件，则展示该事件的字幕。
 *
 * 排版分三层：交代「在第几段」（小标签）、「正在发生什么」（标题）、
 * 「为什么」（正文）；公式单独成栏，与正文之间只用一条分隔线区隔，
 * 避免公式框和正文框互相争抢边界。
 */
import type { Motion } from "../../../types";

interface Props {
  motion: Motion;
  time: number;
}

/**
 * 只做显示用的公式排版，不参与计算。
 * 数学惯例：变量斜体、函数名正体（sin / cos / tan / ln…），
 * 所以先排除函数名再做斜体，否则整串会斜成一片、失去可读的对比。
 */
const FUNCTIONS = new Set(["sin", "cos", "tan", "cot", "ln", "log", "exp", "min", "max"]);

function Formula({ text }: { text: string }) {
  const parts = text.split(/([A-Za-zα-ωΑ-Ωθμ]+)/g);
  return (
    <span>
      {parts.map((p, i) => {
        const isVar = /^[A-Za-zα-ωΑ-Ωθμ]+$/.test(p) && p.length <= 3;
        if (!isVar) return <span key={i}>{p}</span>;
        return FUNCTIONS.has(p) ? (
          <span className="fn" key={i}>
            {p}
          </span>
        ) : (
          <i key={i}>{p}</i>
        );
      })}
    </span>
  );
}

export function PhysicsExplanation({ motion, time }: Props) {
  const seg =
    [...motion.segments].reverse().find((s) => time >= s.startSeconds - 1e-6) ??
    motion.segments[0];

  // 末帧固定保留实际终止事件；停止、前缀结束不能被通用阶段说明覆盖。
  const terminal = time >= motion.durationSeconds - 1e-6
    ? motion.events.find((event) => event.id === motion.termination?.eventId) ?? motion.events[motion.events.length - 1]
    : undefined;
  const recent = terminal ?? [...motion.events]
    .reverse()
    .find((e) => time >= e.timeSeconds - 1e-6 && time - e.timeSeconds < 0.6);

  // 同刻叠加事件（如共速后省略匀速段并进入下一阶段）时，保留共速事件的摩擦功与滑痕读数，避免被后置同刻事件遮盖。
  const coConveyor = recent && recent.conveyorFrictionWorkJ === undefined && recent.conveyorSlipDistanceM === undefined
    ? motion.events.find(
        (e) =>
          Math.abs(e.timeSeconds - recent.timeSeconds) < 1e-6 &&
          (e.conveyorFrictionWorkJ !== undefined || e.conveyorSlipDistanceM !== undefined),
      )
    : undefined;
  const conveyorNote = coConveyor
    ? [
        coConveyor.conveyorFrictionWorkJ !== undefined ? `传送带摩擦对滑块做功 ${coConveyor.conveyorFrictionWorkJ.toFixed(4)} J` : null,
        coConveyor.conveyorSlipDistanceM !== undefined ? `累计滑痕长度 ${coConveyor.conveyorSlipDistanceM.toFixed(4)} m` : null,
      ]
        .filter(Boolean)
        .join("，")
    : null;

  // 同一种阶段可以重复出现，不能用 kind 反查阶段编号。
  const segIndex = seg ? motion.segments.indexOf(seg) + 1 : 0;

  return (
    <div className={"explain" + (recent ? " is-event" : "")}>
      <div className="explain-main">
        <div className="explain-meta">
          <span className="stage-pill">
            阶段 {segIndex}<span className="slash">/</span>{motion.segments.length}
          </span>
          {recent && <span className="event-flag">关键事件</span>}
          {!!motion.playbackGaps?.length && <span className="event-flag">{motion.playbackGaps.some((g) => g.reason.includes("阻力")) ? "含未知阻力播放缺口" : "含省略未知匀速段"}</span>}
        </div>
        <p className="stage-name">{recent?.label ?? seg?.name ?? "运动结束"}</p>
        <p className="stage-desc">
          {recent?.caption ?? seg?.summary ?? "当前计划没有正时长运动段。"}
          {conveyorNote ? `（${conveyorNote}）` : ""}
        </p>
      </div>
      <div className="formula" title={seg?.formula ?? "—"}>
        <Formula text={seg?.formula ?? "—"} />
      </div>
    </div>
  );
}
