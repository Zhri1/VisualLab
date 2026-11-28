import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handler as qoderHandler } from "../../../functions/handler.ts";
import { assembleScene, buildMotion, type StagePlanDraft } from "../../physics/index.ts";
import { handlePlan } from "../plan.ts";

const stem = "宽 1 m 的匀强磁场区域下边界贴地面，B=1 T 垂直纸面向里。m=1×10^-3 kg、q=+1×10^-3 C 粒子以 2 m/s 沿地面水平向右进入，磁区内忽略重力；出场后仅受重力 g=10 m/s²。磁场右侧 x=1 m 处地面下方 h=0.2 m 有水平接收平台。求出射方向、飞行时间、落点距右边界的水平距离。";
const reading: StagePlanDraft = JSON.parse(readFileSync(new URL("../../../fixtures/magnetic-projectile.reading.json", import.meta.url), "utf8"));
const upstream = vi.fn<typeof fetch>();

function request(path: string, fields: Record<string, string>) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  return new Request(`http://local${path}`, { method: "POST", body: form });
}

function answer(payload: unknown) {
  return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(payload) } }] }), {
    headers: { "Content-Type": "application/json" },
  });
}

function build(reading: StagePlanDraft) {
  const assembled = assembleScene(reading);
  if (!assembled.ok) throw new Error(JSON.stringify(assembled));
  return buildMotion(assembled.scene).motion;
}

function sentMessages(call: number) {
  return JSON.parse(String(upstream.mock.calls[call][1]?.body)).messages as Array<{
    content: string | Array<{ text?: string }>;
  }>;
}

function messageText(content: ReturnType<typeof sentMessages>[number]["content"]) {
  return typeof content === "string" ? content : content.map((part) => part.text ?? "").join("\n");
}

beforeEach(() => {
  upstream.mockReset();
  vi.stubEnv("DASHSCOPE_API_KEY", "mock-only");
  vi.stubEnv("DASHSCOPE_VISION_MODEL", "qwen4-max");
  vi.stubEnv("DASHSCOPE_FALLBACK_MODEL", "");
  vi.stubEnv("VISION_REPAIR_RETRY", "1");
  vi.stubEnv("API_CONTRACT_MODE", "stage_plan");
  vi.stubGlobal("Deno", { env: { get: (key: string) => process.env[key] } });
  vi.stubGlobal("fetch", upstream);
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe.each([
  { name: "Node", run: handlePlan, path: "/api/animation/plan" },
  { name: "Qoder", run: qoderHandler, path: "/functions/v1/app" },
])("$name 磁场接抛体入口（模拟上游）", ({ run, path }) => {
  it("相似题推荐后用同一题干生成，保留出射位置、速度、最高点和平台世界坐标", async () => {
    upstream.mockResolvedValueOnce(answer({
      summary: "磁场接抛体变式",
      similarProblems: [{
        title: "磁场偏转后斜抛（出射后落到低处平台）",
        stem,
        focus: "出射切向速度及抛体落地",
        hint: "先找出射速度，再保留两个速度分量。",
      }],
    })).mockResolvedValueOnce(answer(reading));

    const recommended = await (await run(request(path, { chatMode: "similar", chatMessage: "推荐磁场后接抛体的相似题" }))).json();
    expect(recommended.status).toBe("ok");
    expect(recommended.similarProblems[0].stem).toBe(stem);
    expect(messageText(sentMessages(0)[0].content)).toContain("平台相对哪个基准的高度");

    const response = await run(request(path, { text: recommended.similarProblems[0].stem }));
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result).toEqual({ status: "ok", reading, message: "已按题面条件识别完成", assumptions: [] });
    expect(upstream).toHaveBeenCalledTimes(2);
    const [system, input] = sentMessages(1);
    const skill = messageText(system.content);
    expect(skill).toContain("## 20. 匀强磁场偏转及出射后抛体");
    expect(skill).toContain("magnetic_deflection → projectile");
    expect(skill).toContain("平台在这块地面下方 h 米，填 `landingPlaneYM: -h`");
    expect(skill).toContain("第 20、21、24 节以外的电磁模型");
    expect(skill).not.toContain("- 电磁学、");
    expect(messageText(input.content)).toContain(stem);

    const motion = build(result.reading);
    expect(motion.segments.map(({ kind }) => kind)).toEqual(["magnetic_deflection", "projectile"]);
    expect(motion.events.map(({ kind }) => kind)).toEqual(["release", "magnetic_enter", "magnetic_exit", "apex", "land"]);
    const [, , exit, apex, land] = motion.events;
    const flight = motion.segments[1];
    expect(motion.geometry.magnetic?.radiusM).toBeCloseTo(2, 12);
    expect(motion.geometry.magnetic?.direction).toBe("ccw");
    expect(exit.timeSeconds).toBeCloseTo(Math.PI / 6, 12);
    expect(flight.startSeconds).toBe(exit.timeSeconds);
    const exitState = motion.sampleAt(exit.timeSeconds);
    expect(exitState.xM).toBeCloseTo(1, 12);
    expect(exitState.yM).toBeCloseTo(2 - Math.sqrt(3), 12);
    expect(exitState.vxMps).toBeCloseTo(Math.sqrt(3), 12);
    expect(exitState.vyMps).toBeCloseTo(1, 12);
    expect(Math.atan2(exitState.vyMps, exitState.vxMps) * 180 / Math.PI).toBeCloseTo(30, 12);
    expect(motion.geometry.projectile).toEqual({
      launch: { xM: exitState.xM, yM: exitState.yM },
      landingPlane: { yM: -0.2 },
    });
    expect(apex.timeSeconds - exit.timeSeconds).toBeCloseTo(0.1, 12);
    expect(motion.sampleAt(apex.timeSeconds).yM).toBeCloseTo(2 - Math.sqrt(3) + 0.05, 12);
    expect(land.timeSeconds - exit.timeSeconds).toBeCloseTo(0.421853753257942, 12);
    expect(land.timeSeconds).toBeCloseTo(0.94545252885624, 12);
    expect(motion.sampleAt(land.timeSeconds).xM - 1).toBeCloseTo(0.73067213400638, 12);
    expect(motion.sampleAt(land.timeSeconds).yM).toBe(-0.2);
  });

  it("直接提交新参数，负电粒子和向外磁场仍得到真实斜向出射", async () => {
    const variant = {
      ...reading,
      gravityMps2: 9,
      massKg: 0.003,
      initial: { vxMps: 3, vyMps: 0 },
      stages: [
        { kind: "magnetic_deflection", magneticTeslaB: 1.5, chargeC: -0.002, regionWidthM: 1.8, fieldDirection: "out_of_page", exitKind: "region_edge" },
        { kind: "projectile", landingPlaneYM: -0.2 },
      ],
    };
    const variantStem = "带电粒子质量 3 g、电荷 -2 mC，以 3 m/s 水平向右擦地进入宽 1.8 m 的磁区。B=1.5 T 垂直纸面向外，区内不计重力。出界后只受重力（g=9 m/s²），落到比入射地面低 0.2 m 的平台。";
    upstream.mockResolvedValueOnce(answer(variant));
    const result = await (await run(request(path, { text: variantStem }))).json();
    expect(result).toMatchObject({ status: "ok", reading: variant });
    const motion = build(result.reading);
    const { startSeconds, endSeconds } = motion.segments[1];
    expect(startSeconds).toBeCloseTo(Math.asin(0.6), 12);
    expect(motion.sampleAt(startSeconds).yM).toBeCloseTo(0.6, 12);
    expect(motion.sampleAt(startSeconds).vxMps).toBeCloseTo(2.4, 12);
    expect(motion.sampleAt(startSeconds).vyMps).toBeCloseTo(1.8, 12);
    expect(endSeconds - startSeconds).toBeCloseTo(2 / 3, 12);
    expect(motion.sampleAt(endSeconds).xM).toBeCloseTo(3.4, 12);
  });

  it("高度互斥时给出磁场坐标修正提示并重试一次", async () => {
    upstream.mockResolvedValueOnce(answer({
      ...reading,
      stages: [reading.stages[0], { kind: "projectile", landingPlaneYM: -0.2, dropHeightM: 0.2 }],
    })).mockResolvedValueOnce(answer(reading));
    const result = await (await run(request(path, { text: stem }))).json();
    expect(result).toMatchObject({ status: "ok", reading });
    expect(upstream).toHaveBeenCalledTimes(2);
    const retry = messageText(sentMessages(1)[1].content);
    expect(retry).toContain("低于入射地面 h 的接收平台应写 landingPlaneYM = -h");
    expect(retry).not.toContain("圆弧后抛体修正指引");
  });

  it("电场与磁场同时作用仍为超范围", async () => {
    upstream.mockResolvedValueOnce(answer({
      kind: "stage_plan",
      schemaVersion: 1,
      gravityMps2: null,
      initial: { speedMps: null },
      stages: [],
      unsupportedReason: "电场与磁场共同作用，当前模型未覆盖",
    }));
    const response = await run(request(path, { text: "离子沿水平方向进入互相垂直的匀强电场和磁场构成的速度选择器。求能够沿直线通过的速度。" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "unsupported", message: "电场与磁场共同作用，当前模型未覆盖" });
    expect(upstream).toHaveBeenCalledOnce();
  });
});
