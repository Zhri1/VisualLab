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

function makeReq(url: string, text: string) {
  const form = new FormData();
  form.set("text", text);
  form.set("image", new Blob([png], { type: "image/png" }), "q.png");
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

const SQ21 = Math.sqrt(21);
const AX = (15 + 5 * Math.sqrt(5)) / 6;

describe("组合磁场场景：Node 与 Qoder 真实图文入口（模拟上游）", () => {
  it("原题正演两端同源 ok：b 首过 √21/3、返回 4√21/3、a 回轴 (15+5√5)/6", async () => {
    const fixture = read("field-scene-two-particle.reading.json");
    upstream.mockResolvedValueOnce(answer(fixture)).mockResolvedValueOnce(answer(fixture));
    const req = () => makeReq("http://local/api/animation/plan", "双粒子跨反向磁场：负电 a、b 沿 +x、+y 从 O 入射，I 区向里 II 区向外，b 首过虚线 cosθ=2/5，经 II 偏转从 P(d,4√21d/3) 返回 I 区");
    const nodeBody = await (await handlePlan(req())).json();
    const qoderBody = await (await handler(makeReq("http://local/functions/v1/app", "同上"))).json();
    expect(nodeBody.status).toBe("ok");
    expect(qoderBody).toEqual(nodeBody);
    const sent = JSON.parse(String(upstream.mock.calls[0][1]?.body));
    expect(sent.messages[0].content[0].text).toContain("field_scene");
    expect(sent.messages[0].content[0].text).toContain("constraints");
    const assembled: any = assembleScene(nodeBody.reading);
    expect(assembled.ok).toBe(true);
    const motion: any = buildMotion(assembled.scene).motion;
    const obs = (label: string) => motion.events.find((e: any) => e.kind === "field_observer" && e.label === label);
    expect(obs("b 首次过虚线").position.yM).toBeCloseTo(SQ21 / 3, 6);
    expect(obs("b 返回 I 区").position.yM).toBeCloseTo((4 * SQ21) / 3, 6);
    expect(obs("a 首次回 x 轴").position.xM).toBeCloseTo(AX, 6);
    expect(motion.geometry.fieldScene.regions).toHaveLength(2);
    expect(motion.fieldSceneAt(motion.durationSeconds).fired).toHaveLength(3);
  });

  it("反求计划两端同源 ok：B_I=−0.6、B_II=+0.4（比值 3:2）", async () => {
    const fixture = read("field-scene-reverse-b.reading.json");
    upstream.mockResolvedValueOnce(answer(fixture)).mockResolvedValueOnce(answer(fixture));
    const text = "双粒子跨反向磁场，只给 b 首过虚线角度余弦 2/5 与返回点 P(d,4√21d/3)，反求两区 B";
    const nodeBody = await (await handlePlan(makeReq("http://local/api/animation/plan", text))).json();
    const qoderBody = await (await handler(makeReq("http://local/functions/v1/app", text))).json();
    expect(nodeBody.status).toBe("ok");
    expect(qoderBody).toEqual(nodeBody);
    const assembled: any = assembleScene(nodeBody.reading);
    expect(assembled.ok).toBe(true);
    const motion: any = buildMotion(assembled.scene).motion;
    const bs = motion.calculations.filter((c: any) => c.quantity.startsWith("反求 B")).map((c: any) => c.value).sort((a: number, b: number) => a - b);
    expect(bs[0]).toBeCloseTo(-0.6, 5);
    expect(bs[1]).toBeCloseTo(0.4, 5);
  });

  it("缺粒子初态：needs_input 且带字段路径", async () => {
    const broken = read("field-scene-two-particle.reading.json");
    broken.stages[0].particles = [];
    upstream.mockResolvedValueOnce(answer(broken));
    const body = await (await handlePlan(makeReq("http://local/api/animation/plan", "组合磁场场景"))).json();
    expect(body.status).toBe("needs_input");
    expect(JSON.stringify(body)).toContain("particles");
  });
});
