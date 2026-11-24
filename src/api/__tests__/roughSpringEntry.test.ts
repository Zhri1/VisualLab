import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { handlePlan } from "../plan.ts";
import { handler } from "../../../functions/handler.ts";
import { assembleScene, buildMotion } from "../../physics/index.ts";

const read = (name: string) => JSON.parse(readFileSync(new URL(`../../../fixtures/${name}`, import.meta.url), "utf8"));
const acceptance = read("rough-spring.acceptance.json");
const png = readFileSync(new URL("../../../fixtures/incline-spring-gap-2m.png", import.meta.url));
const answer = (payload: unknown) =>
  new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(payload) } }] }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
const upstream = vi.fn<typeof fetch>();

function makeReq(url: string, withImage: boolean) {
  const form = new FormData();
  form.set("text", "滑块在粗糙水平面上压缩弹簧");
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

describe("粗糙弹簧接触：Node 与 Qoder 真实图文入口（模拟上游）", () => {
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
      expect(motion.energyAt(motion.durationSeconds).frictionHeatJ).toBeCloseTo(c.frictionHeatJ, 9);
    });
  }

  it("缺静摩擦因数且无回弹事实时，两端返回 needs_input 指向 staticFrictionCoefficient，不默认 μs=μk", async () => {
    const missing = read("rough-spring-detach.reading.json");
    missing.stages[0].staticFrictionCoefficient = null;
    upstream.mockResolvedValueOnce(answer(missing)).mockResolvedValueOnce(answer(missing));
    const nodeBody = await (await handlePlan(makeReq("http://local/api/animation/plan", false))).json();
    const qoderBody = await (await handler(makeReq("http://local/functions/v1/app", false))).json();
    expect(nodeBody.status).toBe("needs_input");
    expect(nodeBody.missingKeys).toEqual(["/stages/0/staticFrictionCoefficient"]);
    expect(qoderBody).toEqual(nodeBody);
    // 补入题给事实后可直接装配计算
    nodeBody.reading.stages[0].reboundAtMaxCompression = true;
    const assembled: any = assembleScene(nodeBody.reading);
    expect(assembled.ok).toBe(true);
    expect(buildMotion(assembled.scene).motion.endReason).toBe("spring_detached");
  });

  it("静摩擦与回弹事实矛盾时，两端返回 needs_input 并标记 PRECONDITION_CONFLICT", async () => {
    const conflict = read("rough-spring-detach.reading.json");
    conflict.stages[0].reboundAtMaxCompression = false;
    upstream.mockResolvedValueOnce(answer(conflict)).mockResolvedValueOnce(answer(conflict));
    const nodeBody = await (await handlePlan(makeReq("http://local/api/animation/plan", false))).json();
    const qoderBody = await (await handler(makeReq("http://local/functions/v1/app", false))).json();
    expect(nodeBody.status).toBe("needs_input");
    expect(nodeBody.fieldErrors[0]).toMatchObject({ path: "/stages/0/reboundAtMaxCompression", code: "PRECONDITION_CONFLICT" });
    expect(qoderBody).toEqual(nodeBody);
  });

  it("回归：光滑弹簧与旧预压题经两端入口仍正常通过", async () => {
    const smooth = { kind: "stage_plan", schemaVersion: 1, massKg: 2, initial: { speedMps: 3 }, stages: [{ kind: "spring_contact", springConstantNpm: 200, frictionless: true, unattached: true }] };
    const pre = read("precompressed-spring-critical.reading.json");
    for (const plan of [smooth, pre]) {
      upstream.mockResolvedValueOnce(answer(plan)).mockResolvedValueOnce(answer(plan));
      const nodeBody = await (await handlePlan(makeReq("http://local/api/animation/plan", false))).json();
      const qoderBody = await (await handler(makeReq("http://local/functions/v1/app", false))).json();
      expect(nodeBody.status).toBe("ok");
      expect(qoderBody).toEqual(nodeBody);
    }
  });
});
