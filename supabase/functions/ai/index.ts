// 일본어 공부방 · AI 연결 (Supabase Edge Function "ai")
// 브라우저 대신 서버에서 Gemini API를 호출해, API 키가 사이트에 노출되지 않게 합니다.
// 필요한 Secret: GEMINI_API_KEY
// 선택 Secret: GEMINI_MODEL(문제 만들기), GEMINI_MODEL_QUICK(채점·단어 찾기), GEMINI_MODEL_VISION(사진 읽기)
//            GEMINI_MODEL_TTS(청해 음성), TTS_VOICE_F / TTS_VOICE_M(여자·남자 목소리 이름)
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
  default: { models: [Deno.env.get("GEMINI_MODEL") ?? "gemini-3.8-flash", "gemini-3.6-flash", "gemini-2.5-flash", "gemini-3.5-flash-lite"], thinking: "medium" }, // 생각을 너무 길게 하면 시간 초과가 나서 중간으로
  vision: { models: [Deno.env.get("GEMINI_MODEL_VISION") ?? "gemini-3.6-flash", "gemini-3.8-flash", "gemini-2.5-flash", "gemini-3.5-flash-lite"], thinking: "low" },
  quick: { models: [Deno.env.get("GEMINI_MODEL_QUICK") ?? "gemini-3.5-flash-lite", "gemini-2.5-flash-lite", "gemini-3.6-flash", "gemini-2.5-flash"], thinking: "low" },
};

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
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
  const skipped: string[] = []; // 기본 모델이 안 될 때 이유 기록 (설정의 AI 연결 테스트에서 보여요)
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
    if (!r) { skipped.push(`${model}: 시간 초과`); if (left() < 8_000) break; continue; }
    const msg: string = j?.error?.message ?? `HTTP ${r.status}`;
    if (!r.ok) skipped.push(`${model}: ${r.status} ${msg.slice(0, 80)}`);
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
    return { status: 200, body: { text, model, finish, primary: models[0], ...(skipped.length ? { skipped } : {}) } };
  }
  return { status: lastCode === "rate_limited" ? 429 : lastCode === "timeout" ? 504 : 503, body: { error: lastErr, code: lastCode } };
}

// 어떤 오류가 나도 CORS 헤더가 붙은 답을 돌려줘요. (헤더 없이 죽으면 브라우저에는 "연결 끊김"으로만 보여서 원인을 알 수 없어요)
Deno.serve(async (req) => {
  try { return await handle(req); }
  catch (e) { return reply({ error: "server error: " + String((e as Error)?.message ?? e).slice(0, 200), code: "upstream" }, 500); }
});
async function handle(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method === "GET") return reply({ ok: true, version: "2026-11-19", key: !!KEY, tts: true });
  if (!KEY) return reply({ error: "GEMINI_API_KEY is not set", code: "no_key" }, 500);

  let payload: { input: string | Turn[]; json?: boolean; tier?: string; images?: { mime: string; data: string }[]; async?: boolean; kind?: string };
  try { payload = await req.json(); } catch { return reply({ error: "bad request", code: "invalid_request" }, 400); }

  // deno-lint-ignore no-explicit-any
  if ((payload as any).kind === "tts") return await handleTTS(req, payload as Any);
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
}

/* ---------- 청해 음성 (Gemini TTS) ----------
   대본 [{s:"男|女|N", t:"대사"}]을 남녀 두 목소리 대화 음성(WAV)으로 만들어
   사진 저장소(photos)의 <사용자>/tts/<key>.wav 에 저장하고 경로를 돌려줘요. (한 번 만든 음성은 다시 만들지 않아요) */
const TTS_MODELS = [Deno.env.get("GEMINI_MODEL_TTS") ?? "gemini-3.8-flash-tts", "gemini-3.8-flash-lite-tts", "gemini-3.1-flash-tts"];
const VOICE_SETS = [
  [Deno.env.get("TTS_VOICE_F") ?? "Fola", Deno.env.get("TTS_VOICE_M") ?? "Rami"], // AI Studio에서 고른 목소리
  ["Kore", "Charon"], // 위 이름을 못 쓰는 경우 기본 목소리
];
function b64ToBytes(b64: string) { const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; }
// 헤더 없는 PCM(16bit, mono)이 오면 WAV 헤더를 붙여요
function pcmToWav(pcm: Uint8Array, rate = 24000) {
  const h = new ArrayBuffer(44), v = new DataView(h);
  const w = (o: number, str: string) => { for (let i = 0; i < str.length; i++) v.setUint8(o + i, str.charCodeAt(i)); };
  w(0, "RIFF"); v.setUint32(4, 36 + pcm.length, true); w(8, "WAVE"); w(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, "data"); v.setUint32(40, pcm.length, true);
  const out = new Uint8Array(44 + pcm.length); out.set(new Uint8Array(h), 0); out.set(pcm, 44); return out;
}
async function handleTTS(req: Request, p: Any): Promise<Response> {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const admin = createClient(SB_URL, SERVICE, { auth: { persistSession: false } });
  const { data: who } = await admin.auth.getUser(token);
  const uid = who?.user?.id;
  if (!uid) return reply({ error: "login required", code: "not_granted" }, 401);
  const lines: { s: string; t: string }[] = (Array.isArray(p.lines) ? p.lines : []).slice(0, 20).map((l: Any) => ({ s: String(l?.s ?? "N"), t: String(l?.t ?? "").slice(0, 400) })).filter((l: Any) => l.t.trim());
  if (!lines.length) return reply({ error: "empty script", code: "invalid_request" }, 400);
  const style = String(p.style ?? "").slice(0, 300);
  const save = p.save !== false;
  const key = String(p.key ?? "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 60) || ("t" + Date.now());
  // 男 → 남자 목소리, 女·N(내레이션) → 여자 목소리
  const who2 = (s: string) => (s === "男" || /^m/i.test(s) ? "M" : "F");
  const used = [...new Set(lines.map((l) => who2(l.s)))];
  const parts = lines.map((l) => ({ text: l.t, speech_metadata: { speaker: who2(l.s), ...(style ? { style: l.s === "N" ? style + "（ナレーション）" : style } : {}) } }));
  const started = Date.now();
  const skipped: string[] = [];
  for (const model of TTS_MODELS) {
    for (const [vf, vm] of VOICE_SETS) {
      if (Date.now() - started > 100_000) break;
      const voice = (n: string) => ({ prebuiltVoiceConfig: { voiceName: n } });
      const speechConfig = used.length === 2
        ? { multiSpeakerVoiceConfig: { speakerVoiceConfigs: [{ speaker: "F", voiceConfig: voice(vf) }, { speaker: "M", voiceConfig: voice(vm) }] } }
        : { voiceConfig: voice(used[0] === "M" ? vm : vf) };
      let r: Response, j: Any;
      try {
        r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
          method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": KEY },
          body: JSON.stringify({ contents: [{ role: "user", parts }], generationConfig: { responseModalities: ["AUDIO"], speechConfig } }),
          signal: AbortSignal.timeout(90_000),
        });
        j = await r.json().catch(() => ({}));
      } catch { skipped.push(`${model}: 시간 초과`); break; }
      const msg: string = j?.error?.message ?? `HTTP ${r.status}`;
      if (!r.ok) {
        skipped.push(`${model}/${vf},${vm}: ${r.status} ${msg.slice(0, 90)}`);
        if (r.status === 400 && /voice|speaker/i.test(msg)) continue; // 목소리 이름 문제 → 기본 목소리로
        if (r.status === 404 || (r.status === 400 && /model/i.test(msg))) break; // 이 모델 없음 → 다음 모델
        if (r.status === 429 || r.status === 403 || /billing|quota|free tier|prepay|balance|credit/i.test(msg) || r.status === 402)
          return reply({ error: msg, code: /billing|prepay|balance|credit|free tier/i.test(msg) || r.status === 402 || r.status === 403 ? "billing" : "rate_limited", skipped }, r.status === 429 ? 429 : 402);
        break;
      }
      const part = (j?.candidates?.[0]?.content?.parts ?? []).find((x: Any) => x.inlineData || x.inline_data);
      const inl = part?.inlineData ?? part?.inline_data;
      if (!inl?.data) { skipped.push(`${model}: 음성 없음`); break; }
      let bytes = b64ToBytes(inl.data);
      const mime = String(inl.mimeType ?? inl.mime_type ?? "");
      const isWav = bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46; // "RIFF"
      if (!isWav) { const rate = Number(/rate=(\d+)/.exec(mime)?.[1] ?? 24000); bytes = pcmToWav(bytes, rate); }
      const sec = Math.round((bytes.length - 44) / 48000 * 10) / 10;
      if (!save) {
        // 테스트용: 저장하지 않고 바로 돌려줘요
        let bin = ""; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        return reply({ audio: btoa(bin), sec, model, voices: [vf, vm] });
      }
      const path = `${uid}/tts/${key}.wav`;
      const { error } = await admin.storage.from("photos").upload(path, bytes, { contentType: "audio/wav", upsert: true });
      if (error) return reply({ error: "저장 실패: " + error.message, code: "upstream" }, 500);
      return reply({ path, sec, model, voices: [vf, vm], ...(skipped.length ? { skipped } : {}) });
    }
  }
  return reply({ error: "음성을 만들지 못했어요", code: "upstream", skipped }, 503);
}
