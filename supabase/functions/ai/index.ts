// 일본어 공부방 · AI 연결 (Supabase Edge Function "ai")
// 브라우저 대신 서버에서 Gemini API를 호출해, API 키가 사이트에 노출되지 않게 합니다.
// 필요한 Secret: GEMINI_API_KEY
// 선택 Secret: GEMINI_MODEL(문제 만들기), GEMINI_MODEL_QUICK(채점·단어 찾기), GEMINI_MODEL_VISION(사진 읽기)
//
// 두 가지 방식으로 동작해요.
// 1) 바로 받기: 짧은 작업(채점, 단어 찾기, 회화). 답을 그대로 돌려줘요.
// 2) 맡겨 두기(async): 긴 작업(사진 정리, 문제 만들기). 작업 번호만 바로 돌려주고,
//    뒤에서 처리한 결과를 docs 테이블의 jobs/<번호> 문서에 저장해요. 화면이 꺼져도 결과가 남아요.
import { createClient } from "jsr:@supabase/supabase-js@2";

const KEY = Deno.env.get("GEMINI_API_KEY") ?? "";
const SB_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

// 작업별 모델: 첫 번째가 붐비면 다음 모델로 넘어가요
const TIERS: Record<string, { models: string[]; thinking?: string }> = {
  default: { models: [Deno.env.get("GEMINI_MODEL") ?? "gemini-3.8-flash", "gemini-3.6-flash", "gemini-2.5-flash", "gemini-3.5-flash-lite"] },
  vision: { models: [Deno.env.get("GEMINI_MODEL_VISION") ?? "gemini-3.6-flash", "gemini-3.8-flash", "gemini-2.5-flash", "gemini-3.5-flash-lite"], thinking: "low" },
  quick: { models: [Deno.env.get("GEMINI_MODEL_QUICK") ?? "gemini-3.5-flash-lite", "gemini-2.5-flash-lite", "gemini-3.6-flash", "gemini-2.5-flash"], thinking: "low" },
};

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

type Turn = { role: string; content: string };
// deno-lint-ignore no-explicit-any
type Any = any;
type Result = { status: number; body: Any };

// Supabase 무료 플랜은 함수 하나가 약 150초 안에 끝나야 해요. 그 전에 반드시 결과를 남기도록 시간 예산을 둬요.
async function runModels(contents: Any[], json: boolean, tierName: string, budgetMs = 115_000): Promise<Result> {
  const tier = TIERS[tierName] ?? TIERS.default;
  const models = [...new Set(tier.models)];
  const started = Date.now();
  const left = () => budgetMs - (Date.now() - started);
  let lastErr = "no model available", lastCode = "upstream";
  for (const model of models) {
    if (left() < 8_000) { if (lastCode === "upstream") lastCode = "timeout"; break; }
    let thinking = tier.thinking;
    let r: Response | null = null, j: Any = {};
    for (let attempt = 0; attempt < 3; attempt++) {
      const gen: Any = { temperature: 0.8, maxOutputTokens: 32768, ...(json ? { responseMimeType: "application/json" } : {}) };
      if (thinking) gen.thinkingConfig = { thinkingLevel: thinking };
      try {
        r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": KEY },
          body: JSON.stringify({ contents, generationConfig: gen }),
          signal: AbortSignal.timeout(Math.max(5_000, left())),
        });
        j = await r.json().catch(() => ({}));
      } catch {
        r = null; lastErr = "AI 응답이 너무 오래 걸렸어요"; lastCode = "timeout"; break;
      }
      // 이 모델이 생각 수준 설정을 모르면, 설정 없이 다시
      if (r.status === 400 && thinking && /think/i.test(j?.error?.message ?? "")) { thinking = undefined; continue; }
      // 붐빌 때(503)는 시간이 남아 있으면 같은 모델로 한 번 더
      if ([500, 503].includes(r.status) && attempt === 0 && Date.now() - started < 30_000) { await new Promise((res) => setTimeout(res, 1500)); continue; }
      break;
    }
    if (!r) { if (left() < 8_000) break; continue; }
    const msg: string = j?.error?.message ?? `HTTP ${r.status}`;
    if (r.status === 404 || (r.status === 400 && /model/i.test(msg))) { lastErr = msg; continue; }
    if ([429, 500, 502, 503, 504].includes(r.status) || /overload|high demand|unavailable|quota/i.test(msg)) {
      lastErr = msg; lastCode = r.status === 429 && !/high demand/i.test(msg) ? "rate_limited" : "overloaded"; continue;
    }
    if (!r.ok) return { status: 502, body: { error: msg, code: "upstream" } };
    const cand = j?.candidates?.[0];
    const text = (cand?.content?.parts ?? []).filter((p: Any) => !p.thought).map((p: Any) => p.text ?? "").join("");
    const finish = cand?.finishReason ?? "";
    if (!text && j?.promptFeedback?.blockReason) return { status: 502, body: { error: "blocked: " + j.promptFeedback.blockReason, code: "upstream" } };
    if (finish === "MAX_TOKENS") return { status: 200, body: { error: "output too long", code: "truncated", text, model } };
    return { status: 200, body: { text, model, finish } };
  }
  return { status: lastCode === "rate_limited" ? 429 : lastCode === "timeout" ? 504 : 503, body: { error: lastErr, code: lastCode } };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (!KEY) return reply({ error: "GEMINI_API_KEY is not set", code: "no_key" }, 500);

  let payload: { input: string | Turn[]; json?: boolean; tier?: string; images?: { mime: string; data: string }[]; async?: boolean; kind?: string };
  try { payload = await req.json(); } catch { return reply({ error: "bad request", code: "invalid_request" }, 400); }

  const { input, json = false, tier = "default", images = [] } = payload;
  const contents = typeof input === "string"
    ? [{ role: "user", parts: [{ text: input }] as Record<string, unknown>[] }]
    : (input || []).map((t) => ({ role: t.role === "assistant" ? "model" : "user", parts: [{ text: String(t.content) }] as Record<string, unknown>[] }));
  if (!contents.length) return reply({ error: "empty input", code: "invalid_request" }, 400);
  for (const im of images.slice(0, 6)) contents[contents.length - 1].parts.push({ inline_data: { mime_type: im.mime, data: im.data } });

  // 1) 바로 받기
  if (!payload.async) {
    const r = await runModels(contents, json, tier);
    return reply(r.body, r.status);
  }

  // 2) 맡겨 두기: 로그인한 사용자를 확인하고 작업 문서를 만든 뒤 바로 응답
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const admin = createClient(SB_URL, SERVICE, { auth: { persistSession: false } });
  const { data: who } = await admin.auth.getUser(token);
  const uid = who?.user?.id;
  if (!uid) return reply({ error: "login required", code: "not_granted" }, 401);
  const jobId = "j" + crypto.randomUUID().replace(/-/g, "").slice(0, 14);
  const path = "jobs/" + jobId;
  const save = (data: Any) => admin.from("docs").upsert({ user_id: uid, path, data, updated_at: new Date().toISOString() }, { onConflict: "user_id,path" });
  const startedAt = Date.now();
  const { error } = await save({ status: "running", at: startedAt, tier, kind: payload.kind ?? "" });
  if (error) return reply({ error: error.message, code: "upstream" }, 500);

  const work = (async () => {
    try {
      const r = await runModels(contents, json, tier, 120_000);
      const ok = r.status === 200 && !r.body.error;
      await save({ status: ok ? "done" : "error", at: startedAt, doneAt: Date.now(), tier, kind: payload.kind ?? "", ...r.body });
    } catch (e) {
      await save({ status: "error", at: startedAt, doneAt: Date.now(), code: "upstream", error: String((e as Error)?.message ?? e).slice(0, 200) });
    }
  })();
  // deno-lint-ignore no-explicit-any
  const rt = (globalThis as any).EdgeRuntime;
  if (rt?.waitUntil) rt.waitUntil(work); else await work;
  return reply({ jobId });
});
