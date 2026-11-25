import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { handlePlan } from "../plan.ts";
import { handler } from "../../../functions/handler.ts";
import { assembleScene, buildMotion } from "../../physics/index.ts";

const read = (name: string) => JSON.parse(readFileSync(new URL(`../../../fixtures/${name}`, import.meta.url), "utf8"));
const acceptance = read("block-plank.acceptance.json");
const png = readFileSync(new URL("../../../fixtures/incline-spring-gap-2m.png", import.meta.url));
const answer = (payload: unknown) =>
  new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(payload) } }] }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
const upstream = vi.fn<typeof fetch>();

function makeReq(url: string, withImage: boolean) {
  const form = new FormData();
  form.set("text", "光滑地面上 1kg 滑块以 4m/s 滑上 3kg 静止木板");
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

describe("滑块与可移动木板：Node 与 Qoder 真实图文入口（模拟上游）", () => {
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

  it("共速后施力缺 μs 时，两端同源返回 needs_input 并支持补值重算", async () => {
    const missing = read("block-plank-force-reslide.reading.json");
    missing.stages[0].staticFrictionCoefficient = null;
    upstream.mockResolvedValueOnce(answer(missing)).mockResolvedValueOnce(answer(missing));
    const nodeBody = await (await handlePlan(makeReq("http://local/api/animation/plan", false))).json();
    const qoderBody = await (await handler(makeReq("http://local/functions/v1/app", false))).json();
    expect(nodeBody.status).toBe("needs_input");
    expect(nodeBody.missingKeys).toEqual(["/stages/0/staticFrictionCoefficient"]);
    expect(qoderBody).toEqual(nodeBody);
    nodeBody.reading.stages[0].staticFrictionCoefficient = 0.4;
    const assembled: any = assembleScene(nodeBody.reading);
    expect(assembled.ok).toBe(true);
    expect(buildMotion(assembled.scene).motion.endReason).toBe("plank_edge_leave");
  });
});
