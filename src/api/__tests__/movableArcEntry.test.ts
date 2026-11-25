import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { handlePlan } from "../plan.ts";
import { handler } from "../../../functions/handler.ts";
import { assembleScene, buildMotion } from "../../physics/index.ts";

const read = (name: string) => JSON.parse(readFileSync(new URL(`../../../fixtures/${name}`, import.meta.url), "utf8"));
const png = readFileSync(new URL("../../../fixtures/incline-spring-gap-2m.png", import.meta.url));
const answer = (payload: unknown) =>
  new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(payload) } }] }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
const upstream = vi.fn<typeof fetch>();

function makeReq(url: string, withImage: boolean) {
  const form = new FormData();
  form.set("text", "四分之一光滑圆弧槽静置光滑地面可自由滑动，M=3kg R=0.6m，m1=1kg 槽顶静止释放；m2 连轻质自由弹簧，m1 恰好不能再次滑上槽");
  if (withImage) form.set("image", new Blob([png], { type: "image/png" }), "q.png");
  return new Request(url, { method: "POST", body: form });
}

beforeEach(() => {
  upstream.mockReset();
  vi.stubEnv("DASHSCOPE_API_KEY", "mock-only");
  vi.stubEnv("DASHSCOPE_FALLBACK_MODEL", "");
  vi.stubEnv("API_CONTRACT_MODE", "stage_plan");
  vi.stubGlobal("Deno", { env: { get: (k: string) => process.env[k] } });
  vi.stubGlobal("fetch", upstream);
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("可移动圆弧槽 + 自由弹簧双球：Node 与 Qoder 真实图文入口（模拟上游）", () => {
  it("完整临界计划两端同源 ok，且反求 m2=2、Ep=3J、离槽 3/1 m/s", async () => {
    const fixture = read("movable-arc-spring.reading.json");
    upstream.mockResolvedValueOnce(answer(fixture)).mockResolvedValueOnce(answer(fixture));
    const nodeRes = await handlePlan(makeReq("http://local/api/animation/plan", true));
    const qoderRes = await handler(makeReq("http://local/functions/v1/app", true));
    const nodeBody = await nodeRes.json();
    const qoderBody = await qoderRes.json();
    expect(nodeRes.status).toBe(200);
    expect(qoderRes.status).toBe(200);
    expect(nodeBody.status).toBe("ok");
    expect(qoderBody).toEqual(nodeBody);
    const sent = JSON.parse(String(upstream.mock.calls[0][1]?.body));
    expect(sent.messages[0].content[0].text).toContain("movable_arc");
    expect(sent.messages[0].content[0].text).toContain("spring_pair");
    const assembled: any = assembleScene(nodeBody.reading);
    expect(assembled.ok).toBe(true);
    const motion: any = buildMotion(assembled.scene).motion;
    const exit = motion.events.find((e: any) => e.kind === "movable_arc_exit");
    expect(Math.abs(exit.velocityAfter.vxMps)).toBeCloseTo(3, 6);
    const sep = motion.events.find((e: any) => e.kind === "spring_pair_separate");
    expect(Math.abs(sep.velocityAfter.vxMps)).toBeCloseTo(1, 6);
    expect(motion.geometry.springPair.mass2Kg).toBeCloseTo(2, 9);
    const max = motion.events.find((e: any) => e.kind === "spring_pair_max_compression");
    expect(Math.abs(max.velocityAfter.vxMps)).toBeCloseTo(1, 6);
  });

  it("m2 与分离速度都缺时两端 needs_input，补 m2 后重算 ok", async () => {
    const missing = read("movable-arc-spring.reading.json");
    missing.stages[1].targetMassKg = null;
    missing.stages[1].separationSpeedMps = null;
    upstream.mockResolvedValueOnce(answer(missing)).mockResolvedValueOnce(answer(missing));
    const nodeBody = await (await handlePlan(makeReq("http://local/api/animation/plan", false))).json();
    const qoderBody = await (await handler(makeReq("http://local/functions/v1/app", false))).json();
    expect(nodeBody.status).toBe("needs_input");
    expect(nodeBody.missingKeys).toEqual(["/stages/1/targetMassKg"]);
    expect(qoderBody).toEqual(nodeBody);
    nodeBody.reading.stages[1].targetMassKg = 2;
    const assembled: any = assembleScene(nodeBody.reading);
    expect(assembled.ok).toBe(true);
    const motion: any = buildMotion(assembled.scene).motion;
    const sep = motion.events.find((e: any) => e.kind === "spring_pair_separate");
    expect(Math.abs(sep.velocityAfter.vxMps)).toBeCloseTo(1, 6);
  });
});
