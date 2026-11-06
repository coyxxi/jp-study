// 일본어 공부방 · AI 연결 (Supabase Edge Function "ai")
// 브라우저 대신 서버에서 Gemini API를 호출해, API 키가 사이트에 노출되지 않게 합니다.
// 필요한 Secret: GEMINI_API_KEY  (선택: GEMINI_MODEL, GEMINI_MODEL_QUICK)

const KEY = Deno.env.get("GEMINI_API_KEY") ?? "";
const MODEL_DEFAULT = Deno.env.get("GEMINI_MODEL") ?? "gemini-3.8-flash";
const MODEL_QUICK = Deno.env.get("GEMINI_MODEL_QUICK") ?? "gemini-3.5-flash-lite";
const FALLBACKS = ["gemini-3.6-flash", "gemini-2.5-flash"];

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

  let lastErr = "no model available";
  for (const model of models) {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": KEY },
      body,
    });
    const j = await r.json().catch(() => ({}));
    if (r.status === 404 || (r.status === 400 && /model/i.test(j?.error?.message ?? ""))) { lastErr = j?.error?.message ?? "model not found"; continue; }
    if (r.status === 429) return reply({ error: j?.error?.message ?? "rate limited", code: "rate_limited" }, 429);
    if (!r.ok) return reply({ error: j?.error?.message ?? `HTTP ${r.status}`, code: "upstream" }, 502);
    const cand = j?.candidates?.[0];
    const text = (cand?.content?.parts ?? []).filter((p: { thought?: boolean }) => !p.thought).map((p: { text?: string }) => p.text ?? "").join("");
    const finish = cand?.finishReason ?? "";
    if (!text && j?.promptFeedback?.blockReason) return reply({ error: "blocked: " + j.promptFeedback.blockReason, code: "upstream" }, 502);
    if (finish === "MAX_TOKENS") return reply({ error: "output too long", code: "truncated", text, model }, 200);
    return reply({ text, model, finish });
  }
  return reply({ error: lastErr, code: "upstream" }, 502);
});
