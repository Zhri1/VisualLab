import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { handlePlan } from "../plan.ts";
import { handler } from "../../../functions/handler.ts";
import { assembleScene, buildMotion } from "../../physics/index.ts";

const read = (name: string) => JSON.parse(readFileSync(new URL(`../../../fixtures/${name}`, import.meta.url), "utf8"));
const acceptance = read("constant-force.acceptance.json");
const png = readFileSync(new URL("../../../fixtures/incline-spring-gap-2m.png", import.meta.url));
const answer = (payload: unknown) =>
  new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(payload) } }] }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
const upstream = vi.fn<typeof fetch>();

function makeReq(url: string, withImage: boolean) {
  const form = new FormData();
  form.set("text", "2kg物体从静止先受4N作用2s再受-2N直至静止");
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

describe("常力与分段匀变速：Node 与 Qoder 真实图文入口（模拟上游）", () => {
  for (const c of acceptance.cases) {
    it(`${c.id} 两端同源返回 ok 且公开计算入口匹配基准`, async () => {
      const fixture = read(c.readingFile);
      upstream.mockResolvedValueOnce(answer(fixture)).mockResolvedValueOnce(answer(fixture));
      const nodeRes = await handlePlan(makeReq("http://local/api/animation/plan", true));
      const qoderRes = await handler(makeReq("http://local/functions/v1/app", true));
      const nodeBody = await nodeRes.json();
      const qoderBody = await qoderRes.json();
      expect(nodeRes.status).toBe(200);
      expect(qoderRes.status).toBe(200);
      expect(nodeBody.status).toBe("ok");
      expect(qoderBody).toEqual(nodeBody);
      const assembled: any = assembleScene(nodeBody.reading);
      expect(assembled.ok).toBe(true);
      const motion: any = buildMotion(assembled.scene).motion;
      expect(motion.durationSeconds).toBeCloseTo(c.durationSeconds, 9);
    });
  }

  it("合成匀变速约束两端保留推导依据，回包改值再装配", async () => {
    const fixture=read("uniform-constraints.reading.json");
    upstream.mockResolvedValueOnce(answer(fixture)).mockResolvedValueOnce(answer(fixture));
    const nodeBody=await (await handlePlan(makeReq("http://local/api/animation/plan",false))).json();
    const cloudBody=await (await handler(makeReq("http://local/functions/v1/app",false))).json();
    expect(nodeBody.status).toBe("ok");expect(cloudBody).toEqual(nodeBody);
    expect(nodeBody.reading.stages[2].resistanceN).toBeCloseTo(9,9);
    expect(nodeBody.reading.derivedCalculations).toHaveLength(2);
    nodeBody.reading.stages[2].kinematics.elapsedSeconds=6.5;
    const a:any=assembleScene(nodeBody.reading);expect(a.ok).toBe(true);
    const motion:any=buildMotion(a.scene).motion;expect(motion.durationSeconds).toBeCloseTo(6.5,9);
  });

  it("无法减速至零时，两端同源返回 needs_input 与 PRECONDITION_CONFLICT", async () => {
    vi.stubEnv("VISION_REPAIR_RETRY", "0");
    const bad = read("constant-force-benchmark.reading.json");
    bad.stages[1].netForceXN = 2;
    upstream.mockResolvedValueOnce(answer(bad)).mockResolvedValueOnce(answer(bad));
    const nodeBody = await (await handlePlan(makeReq("http://local/api/animation/plan", false))).json();
    const qoderBody = await (await handler(makeReq("http://local/functions/v1/app", false))).json();
    expect(nodeBody.status).toBe("needs_input");
    expect(nodeBody.fieldErrors[0]).toMatchObject({ path: "/stages/1/end", code: "PRECONDITION_CONFLICT" });
    expect(qoderBody).toEqual(nodeBody);
  });
});
