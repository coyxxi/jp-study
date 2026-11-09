// 일본어 공부방 · AI 연결 (Supabase Edge Function "ai")
// 브라우저 대신 서버에서 Gemini API를 호출해, API 키가 사이트에 노출되지 않게 합니다.
// 필요한 Secret: GEMINI_API_KEY  (선택: GEMINI_MODEL, GEMINI_MODEL_QUICK)

const KEY = Deno.env.get("GEMINI_API_KEY") ?? "";
const MODEL_DEFAULT = Deno.env.get("GEMINI_MODEL") ?? "gemini-3.8-flash";
const MODEL_QUICK = Deno.env.get("GEMINI_MODEL_QUICK") ?? "gemini-3.5-flash-lite";
const FALLBACKS = ["gemini-3.6-flash", "gemini-2.5-flash", "gemini-3.5-flash-lite", "gemini-2.5-flash-lite"];

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

type Turn = { role: string; content: string };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (!KEY) return reply({ error: "GEMINI_API_KEY is not set", code: "no_key" }, 500);

  let payload: { input: string | Turn[]; json?: boolean; tier?: string; images?: { mime: string; data: string }[] };
  try { payload = await req.json(); } catch { return reply({ error: "bad request", code: "invalid_request" }, 400); }

  const { input, json = false, tier = "default", images = [] } = payload;
  const contents = typeof input === "string"
    ? [{ role: "user", parts: [{ text: input }] as Record<string, unknown>[] }]
    : (input || []).map((t) => ({ role: t.role === "assistant" ? "model" : "user", parts: [{ text: String(t.content) }] as Record<string, unknown>[] }));
  if (!contents.length) return reply({ error: "empty input", code: "invalid_request" }, 400);
  for (const im of images.slice(0, 6)) contents[contents.length - 1].parts.push({ inline_data: { mime_type: im.mime, data: im.data } });

  const body = JSON.stringify({
    contents,
    generationConfig: { temperature: 0.8, maxOutputTokens: 32768, ...(json ? { responseMimeType: "application/json" } : {}) },
  });
  const first = tier === "quick" ? MODEL_QUICK : MODEL_DEFAULT;
  const models = [first, ...FALLBACKS.filter((m) => m !== first)];

  // Supabase 무료 플랜은 함수 하나가 약 150초 안에 끝나야 해요. 그 전에 반드시 답을 돌려주도록 시간 예산을 둬요.
  const started = Date.now(), BUDGET = 115_000;
  const left = () => BUDGET - (Date.now() - started);
  let lastErr = "no model available", lastCode = "upstream";
  for (const model of models) {
    if (left() < 8_000) { lastCode = lastCode === "upstream" ? "timeout" : lastCode; break; }
    let r: Response | null = null, j: any = {};
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": KEY },
          body,
          signal: AbortSignal.timeout(Math.max(5_000, left())),
        });
        j = await r.json().catch(() => ({}));
      } catch {
        r = null; lastErr = "AI 응답이 너무 오래 걸렸어요"; lastCode = "timeout"; break;
      }
      // 붐빌 때(503)는 시간이 남아 있으면 같은 모델로 한 번 더
      if (![500, 503].includes(r.status) || attempt === 1 || Date.now() - started > 30_000) break;
      await new Promise((res) => setTimeout(res, 1500));
    }
    if (!r) { if (left() < 8_000) break; continue; }
    const msg: string = j?.error?.message ?? `HTTP ${r.status}`;
    if (r.status === 404 || (r.status === 400 && /model/i.test(msg))) { lastErr = msg; continue; }
    if ([429, 500, 502, 503, 504].includes(r.status) || /overload|high demand|unavailable|quota/i.test(msg)) {
      lastErr = msg; lastCode = r.status === 429 && !/high demand/i.test(msg) ? "rate_limited" : "overloaded"; continue;
    }
    if (!r.ok) return reply({ error: msg, code: "upstream" }, 502);
    const cand = j?.candidates?.[0];
    const text = (cand?.content?.parts ?? []).filter((p: { thought?: boolean }) => !p.thought).map((p: { text?: string }) => p.text ?? "").join("");
    const finish = cand?.finishReason ?? "";
    if (!text && j?.promptFeedback?.blockReason) return reply({ error: "blocked: " + j.promptFeedback.blockReason, code: "upstream" }, 502);
    if (finish === "MAX_TOKENS") return reply({ error: "output too long", code: "truncated", text, model }, 200);
    return reply({ text, model, finish });
  }
  return reply({ error: lastErr, code: lastCode }, lastCode === "rate_limited" ? 429 : lastCode === "timeout" ? 504 : 503);
});
