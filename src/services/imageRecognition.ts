/**
 * 识别服务适配层。契约见 CONTRACTS.md 第 2 节。
 *
 * 真实通路：POST /api/animation/plan，multipart/form-data，图片字段 image。
 * 开发期由 vite proxy 转发到成员 C 的本地服务。
 *
 * —— 接入方式 ——
 * 把 USE_MOCK_API 改为 false，或在 .env 里设 VITE_USE_MOCK_API=false。
 * 回包四种状态（ok / needs_input / unsupported / 400·502·504）都已在此归一。
 */
import { MOCK_LATENCY_MS, PLAN_ENDPOINT } from "../config/endpoints";
import { getSample } from "../data/samples";
import { parseCommand, type CommandResult } from "../api/command";
import type { StagePlanDraft } from "../physics/stagePlan";
import type { FieldError, PlanResponse, Reading, WorkspaceReading } from "../types";

/** 默认为 true，便于离线开发；接真实服务时设为 "false" */
export const USE_MOCK_API =
  (import.meta.env.VITE_USE_MOCK_API ?? "true").toString() !== "false";

export const ENDPOINT = PLAN_ENDPOINT;

/** 与 fixtures/incline-spring.reading.json 完全一致 */
export const SAMPLE_READING: Reading = {
  templateId: "incline_spring",
  conditions: {
    gravityMps2: 10,
    inclineAngleDeg: 37,
    inclineLengthM: 4,
    kineticFrictionCoefficient: 0.5,
    initialSpeedMps: 0,
    blockMassKg: 1,
    springGapM: 1,
    springConstantNpm: 400,
  },
  facts: {
    slidesAfterRelease: true,
    losslessTurn: true,
    horizontalIsFrictionless: true,
    springIsUnattached: true,
  },
};

/** 缺项样例：留一个弹簧间距待补，用于走查 needs_input */
export const SAMPLE_READING_MISSING: Reading = {
  ...SAMPLE_READING,
  conditions: { ...SAMPLE_READING.conditions, springGapM: null },
};

/**
 * 与 SAMPLE_READING 对应的三条假设（g、μ、倾角）。
 * ok 与 needs_input 回包共用同一份文案，缺项时胶囊里展示的条目不会和成功路径漂移。
 */
const SAMPLE_ASSUMPTIONS = ["g=10 m/s²", "μ=0.5", "倾角 37°"];

export type MockScenario = "ok" | "needs_input" | "unsupported" | "error";

/** 联调时强制切换回包类型，方便走查四种页面状态 */
let forcedScenario: MockScenario | null = null;
export function setMockScenario(s: MockScenario | null) {
  forcedScenario = s;
}
export function getMockScenario(): MockScenario | null {
  return forcedScenario;
}

export function mockPlan(hasImage: boolean, isSample = false, sampleId?: string): PlanResponse {
  // 内置示例是兜底路径：不受联调开关影响，也不受「无图即缺项」影响，永远成功。
  // message/assumptions 与真实服务 ok 回包同一形状（CONTRACTS.md 第 2 节），
  // 这样演示时的开场白和接真模型时完全一致。
  if (isSample) {
    const sample = getSample(sampleId);
    return {
      status: "ok",
      reading: sample.reading,
      message: sample.message,
      assumptions: [...sample.assumptions],
      problemText: sample.problemText,
    };
  }
  const scenario = forcedScenario ?? "ok";
  if (scenario === "needs_input") {
    return {
      status: "needs_input",
      reading: SAMPLE_READING_MISSING,
      missingKeys: ["springGapM"],
      message: "请确认弹簧接触端与斜面底端的距离",
      // 缺项回包与 ok 同形状：已识别的部分照样带假设，页面复用它渲染胶囊
      assumptions: [...SAMPLE_ASSUMPTIONS],
    };
  }
  if (scenario === "unsupported") {
    return {
      status: "unsupported",
      message: "当前版本支持斜面接光滑水平面与弹簧的运动",
    };
  }
  if (scenario === "error") {
    return { status: "error", message: "识别服务暂时不可用，请稍后重试", httpStatus: 502 };
  }
  // 只有文字没有图片时，模拟「读不全」：留一个缺项让用户补，
  // 这样首页直接点发送也能走到核对表的补值路径。
  if (!hasImage) {
    return {
      status: "needs_input",
      reading: SAMPLE_READING_MISSING,
      missingKeys: ["springGapM"],
      message: "已识别出主要条件，但坡底到弹簧的距离需要你确认",
      // 两条 needs_input 支路都要带假设条目，否则离线走查时胶囊会凭空消失
      assumptions: [...SAMPLE_ASSUMPTIONS],
    };
  }
  return {
    status: "ok",
    reading: SAMPLE_READING,
    message: "已按 g=10 m/s²、μ=0.5、倾角 37° 计算",
    assumptions: [...SAMPLE_ASSUMPTIONS],
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * 上传题图或提交文字，换取 reading。
 * 永不抛异常：所有失败都归一成 { status: "error" }。
 */
export async function requestPlan(input: {
  file?: File | null;
  text?: string;
  /** 内置示例：跳过所有模拟失败 */
  isSample?: boolean;
  /** 内置示例 id；缺省用第一道。 */
  sampleId?: string;
}): Promise<PlanResponse> {
  // 内置示例是兜底路径：不打网络，也不受联调开关影响。
  // 线上 VITE_USE_MOCK_API=false 时，示例若走 fetch 就会被网关拦截，整页演示失败。
  if (input.isSample) {
    const [lo, hi] = MOCK_LATENCY_MS;
    await sleep((lo + Math.random() * (hi - lo)) * 0.35);
    return mockPlan(Boolean(input.file), true, input.sampleId);
  }

  if (USE_MOCK_API) {
    const [lo, hi] = MOCK_LATENCY_MS;
    await sleep(lo + Math.random() * (hi - lo));
    return mockPlan(Boolean(input.file), false);
  }

  const form = new FormData();
  if (input.file) form.append("image", input.file);
  if (input.text) form.append("text", input.text);

  try {
    const res = await fetch(ENDPOINT, { method: "POST", body: form });
    const body = await res.json().catch(() => ({}));

    if (res.ok && body?.status === "ok" && body.reading) {
      return {
        status: "ok",
        reading: body.reading as WorkspaceReading,
        message: typeof body.message === "string" ? body.message : undefined,
        assumptions: Array.isArray(body.assumptions) ? (body.assumptions as string[]) : undefined,
      };
    }
    if (res.ok && body?.status === "needs_input") {
      return {
        status: "needs_input",
        reading: (body.reading ?? null) as WorkspaceReading | null,
        missingKeys: (body.missingKeys ?? []) as string[],
        fieldErrors: Array.isArray(body.fieldErrors) ? (body.fieldErrors as FieldError[]) : [],
        message: body.message ?? "请补全识别条件",
        // 与 ok 一致地透传假设条目；非数组视为旧服务，按「没有假设」处理
        assumptions: Array.isArray(body.assumptions) ? (body.assumptions as string[]) : undefined,
      };
    }
    if (res.ok && body?.status === "unsupported") {
      return { status: "unsupported", message: body.message ?? "当前题型暂不支持" };
    }

    const fallback =
      res.status === 400
        ? "图片格式无效，请上传 JPG 或 PNG"
        : res.status === 403
          ? "平台网关拦截了本次请求，请用普通浏览器窗口打开页面重试"
          : res.status === 504
            ? "识别超时，请重试"
            : "识别服务异常，请稍后重试";
    return { status: "error", httpStatus: res.status, message: body?.message ?? fallback };
  } catch {
    return { status: "error", message: "网络异常，请检查连接后重试" };
  }
}

export type StageCommandResponse = CommandResult | { status: "error"; message: string; httpStatus?: number };

/** 修改当前阶段计划。command 与识别新题的 text 严格分开，currentPlan 使用完整 JSON。 */
export async function requestStageCommand(command: string, currentPlan: StagePlanDraft): Promise<StageCommandResponse> {
  if (USE_MOCK_API) {
    const [lo, hi] = MOCK_LATENCY_MS;
    await sleep(lo + Math.random() * (hi - lo));
    return parseCommand(command, {
      stages: currentPlan.stages.map((stage) => ({ kind: String(stage.kind ?? "") })),
    });
  }

  const form = new FormData();
  form.append("command", command);
  form.append("currentPlan", JSON.stringify(currentPlan));
  try {
    const res = await fetch(ENDPOINT, { method: "POST", body: form });
    const body = await res.json().catch(() => ({}));
    if (res.ok && body?.status === "ok" && body.intent?.type === "truncate_stages") {
      return { status: "ok", intent: { type: "truncate_stages", throughStageIndex: Number(body.intent.throughStageIndex) } };
    }
    if (res.ok && body?.status === "needs_input") {
      return {
        status: "needs_input",
        message: body.message ?? "请说明要保留到哪一段",
        missingKeys: Array.isArray(body.missingKeys) ? body.missingKeys : [],
      };
    }
    if (res.ok && body?.status === "unsupported") {
      return { status: "unsupported", message: body.message ?? "当前指令暂不支持" };
    }
    return {
      status: "error",
      httpStatus: res.status,
      message: body?.message ?? (res.status === 504 ? "指令处理超时，请重试" : "指令服务异常，请稍后重试"),
    };
  } catch {
    return { status: "error", message: "网络异常，请检查连接后重试" };
  }
}
