// 일본어 공부방 · 매일 아침 자동 문제 만들기 (Supabase Edge Function "daily")
// Supabase Cron이 매시 정각에 이 함수를 부르면, 설정한 시각(한국 시간)인 사용자만 문제를 만들어 문제 은행에 넣어요.
// 필요한 Secret: GEMINI_API_KEY (ai 함수와 같은 값), CRON_SECRET (아무 긴 문자열, Cron 헤더와 같은 값)
// 이 함수는 "Verify JWT"를 꺼 두고, 대신 x-cron-secret 헤더로 확인해요.
import { createClient } from "jsr:@supabase/supabase-js@2";

const SB_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const KEY = Deno.env.get("GEMINI_API_KEY") ?? "";
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";
const MODEL = Deno.env.get("GEMINI_MODEL") ?? "gemini-3.8-flash";
const FALLBACKS = ["gemini-3.6-flash", "gemini-2.5-flash", "gemini-3.5-flash-lite", "gemini-2.5-flash-lite"];
const UNSEEN_LIMIT = 40; // 안 푼 문제가 이만큼 쌓여 있으면 그날은 건너뜀

// deno-lint-ignore no-explicit-any
type Any = any;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const READ_LEN: Record<number, string> = {
  5: "짧은 글(短文): 4~6문장, 80~150자 / 중간 글(中文): 8~12문장, 약 250자",
  4: "짧은 글(短文): 5~7문장, 100~200자 / 중간 글(中文): 10~15문장, 약 350자",
  3: "짧은 글(短文): 약 150~200자 / 중간 글(中文): 약 350자",
  2: "짧은 글(短文): 약 200자 / 중간 글(中文): 약 500자 / 긴 글(長文): 약 900자",
  1: "짧은 글(短文): 약 200자 / 중간 글(中文): 약 500자 / 긴 글(長文): 약 1000자",
};
const qSpec = (level: number) => `각 문제는 이 JSON 형태를 따르세요:
{"area":"v|g|r|l","sub":"유형 이름(일본어, 예: 文脈規定)","items":["관련 항목 id"],"prompt":"문제 문장(일본어). 밑줄 대상은 [u]단어[/u], 빈칸은 （　　）, 文の組み立て는 ＿＿ ＿＿ ★ ＿＿ 형태","passage":"독해 지문(일본어, 독해만)","script":[{"s":"男|女|N","t":"대사(일본어, 청해만)"}],"choices":["보기1","보기2","보기3","보기4"],"ans":0,"expl":"한국어 해설 1~2문장","ko":"정답을 넣은 문제 문장(독해·청해는 질문)의 자연스러운 한국어 뜻","cko":["보기1의 한국어 뜻","보기2","보기3","보기4"]}
규칙: choices는 정확히 4개, ans는 0~3 정답 위치(위치를 고르게 섞기), 오답 보기는 그럴듯하지만 명확히 틀려야 함, 정답은 오직 하나. 청해는 prompt에 질문을 쓰고 script에 대화를 쓰며, 보기는 짧게. 문맥이 자연스러운 실제 생활 장면 문장을 쓰고, 같은 문형을 반복하지 마세요.
독해 지문 길이(JLPT N${level} 기준): ${READ_LEN[level] ?? READ_LEN[5]}. 유형 이름에 短文/中文을 맞춰 쓰세요.
후리가나: prompt, passage, choices, script의 대사에 나오는 모든 한자 단어에 {漢字|よみ} 형식으로 히라가나 읽기를 붙이세요. 예: {毎朝|まいあさ}{起|お}きます. 단, 漢字読み 유형에서 [u]밑줄[/u] 대상 단어와 表記 유형의 보기처럼 읽기 자체가 정답인 곳에는 붙이지 마세요.
설명 외의 텍스트 없이 JSON 배열만 답하세요.`;

function kstNow() {
  const d = new Date(Date.now() + 9 * 3600e3);
  return { hour: d.getUTCHours(), today: d.toISOString().slice(0, 10), hm: d.toISOString().slice(11, 16) };
}
const addDays = (s: string, n: number) => { const d = new Date(s + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const shuffle = <T>(a: T[]) => { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

async function gemini(prompt: string): Promise<string> {
  const body = JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: { temperature: 0.8, maxOutputTokens: 32768, responseMimeType: "application/json" } });
  let last = "no model";
  for (const model of [MODEL, ...FALLBACKS.filter((m) => m !== MODEL)]) {
    let r: Response | null = null, j: Any = {};
    for (let attempt = 0; attempt < 2; attempt++) {
      r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, { method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": KEY }, body });
      j = await r.json().catch(() => ({}));
      if (![500, 503].includes(r.status) || attempt === 1) break;
      await new Promise((res) => setTimeout(res, 2000));
    }
    if (!r) continue;
    const msg: string = j?.error?.message ?? `HTTP ${r.status}`;
    if (r.status === 404 || (r.status === 400 && /model/i.test(msg))) { last = msg; continue; }
    if ([429, 500, 502, 503, 504].includes(r.status) || /overload|high demand|unavailable|quota/i.test(msg)) { last = msg; continue; }
    if (!r.ok) throw new Error(msg);
    return (j?.candidates?.[0]?.content?.parts ?? []).filter((p: Any) => !p.thought).map((p: Any) => p.text ?? "").join("");
  }
  throw new Error(last);
}
function parseLoose(t: string): Any {
  t = String(t || "").trim();
  try { return JSON.parse(t); } catch { /* next */ }
  const f = t.match(/```(?:json)?\s*([\s\S]*?)```/); if (f) { try { return JSON.parse(f[1]); } catch { /* next */ } }
  const a = t.search(/[[{]/), b = Math.max(t.lastIndexOf("}"), t.lastIndexOf("]"));
  if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch { /* fail */ } }
  return undefined;
}
function unwrap(v: Any): Any[] {
  if (Array.isArray(v)) return v;
  if (v && typeof v === "object") {
    for (const k of ["questions", "items", "data", "result", "problems"]) if (Array.isArray(v[k])) return v[k];
    const arrs = Object.values(v).filter(Array.isArray) as Any[][]; if (arrs.length === 1) return arrs[0];
  }
  return [];
}
function validate(arr: Any, known: Set<string>, fix: (s: string) => string) {
  const out: Any[] = [];
  for (const raw of unwrap(arr)) {
    if (!raw || typeof raw !== "object") continue;
    let choices = raw.choices ?? raw.options;
    if (Array.isArray(choices)) choices = choices.map((c: Any) => (c && typeof c === "object") ? (c.text ?? Object.values(c)[0]) : c);
    if (!Array.isArray(choices) || choices.length !== 4) continue;
    let ans: Any = raw.ans ?? raw.answer ?? raw.correct;
    if (typeof ans === "string" && !/^\d+$/.test(ans.trim())) ans = choices.indexOf(ans);
    ans = Number(ans); if (!(ans >= 0 && ans <= 3)) continue;
    let area = String(raw.area || "").toLowerCase()[0]; if (!["v", "g", "r", "l"].includes(area)) area = "g";
    let script = Array.isArray(raw.script) ? raw.script.map((l: Any) => typeof l === "string" ? { s: "N", t: l } : l) : undefined;
    if (area === "l" && !script?.length) continue;
    if (area === "r" && !raw.passage) area = "g";
    if (area !== "l") script = undefined;
    out.push({
      id: "q" + crypto.randomUUID().slice(0, 12), area, sub: String(raw.sub || "").slice(0, 20),
      items: (Array.isArray(raw.items) ? raw.items : []).filter((id: string) => known.has(id)).slice(0, 4),
      prompt: fix(String(raw.prompt || "").slice(0, 600)),
      passage: raw.passage ? fix(String(raw.passage).slice(0, 2400)) : undefined,
      script: script ? script.slice(0, 14).map((l: Any) => ({ s: String(l.s || "N").slice(0, 2), t: fix(String(l.t || "").slice(0, 300)) })) : undefined,
      choices: choices.map((c: Any) => fix(String(c).slice(0, 160))), ans, expl: String(raw.expl || "").slice(0, 300), ko: raw.ko ? String(raw.ko).slice(0, 300) : undefined, cko: Array.isArray(raw.cko) && raw.cko.length === 4 ? raw.cko.map((x: Any) => String(x ?? "").slice(0, 80)) : undefined,
    });
  }
  return out;
}

async function runFor(admin: Any, uid: string, state: Any, today: string, hm: string) {
  const setResult = async (r: Any) => {
    const { data } = await admin.from("docs").select("data").eq("user_id", uid).eq("path", "state/main").maybeSingle();
    const st = data?.data ?? state;
    st.autoGen = { on: true, hour: 7, ...(st.autoGen ?? {}), last: today, lastResult: { date: today, at: hm, ...r } };
    await admin.from("docs").upsert({ user_id: uid, path: "state/main", data: st, updated_at: new Date().toISOString() }, { onConflict: "user_id,path" });
  };
  try {
    const rows: Any[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await admin.from("docs").select("path,data").eq("user_id", uid).range(from, from + 999);
      if (error) throw error; rows.push(...data); if (data.length < 1000) break;
    }
    const pick = (pre: string) => rows.filter((r) => r.path.startsWith(pre));
    const banks = pick("qbank/").map((r) => r.data);
    const unseen = banks.reduce((n, b) => n + (b.qs ?? []).filter((q: Any) => !q.seen && !q.bad).length, 0);
    if (unseen >= UNSEEN_LIMIT) { await setResult({ ok: true, n: 0, msg: `안 푼 문제가 ${unseen}개 있어서 오늘은 건너뛰었어요` }); return; }
    if (!state.site) throw new Error("사이트 주소가 아직 저장되지 않았어요. 공부방을 한 번 열어 주세요.");
    const master: Any = await (await fetch(new URL("data/master.json", state.site).href)).json();
    const custom = rows.find((r) => r.path === "custom/items")?.data ?? {};
    const vocab = [...master.vocab, ...(custom.vocab ?? [])], grammar = [...master.grammar, ...(custom.grammar ?? [])];
    const byId = new Map<string, Any>(); for (const v of vocab) byId.set(v.id, { ...v, t: "v" }); for (const g of grammar) byId.set(g.id, { ...g, t: "g" }); for (const k of master.kanji) byId.set(k.id, { ...k, t: "k" });
    const prog: Record<string, Any> = {}; for (const r of pick("prog/")) Object.assign(prog, r.data.items ?? {});
    const st = (id: string) => prog[id]?.s ?? "n";
    // 다음 시험 → 목표 레벨
    const exams: Any[] = (state.exams?.length ? state.exams : [{ date: "2026-12-06", level: 5 }, { date: "2027-07-04", level: 2 }]).slice().sort((a: Any, b: Any) => a.date.localeCompare(b.date));
    const level = +((exams.find((e) => e.date >= today) ?? exams[exams.length - 1])?.level ?? 5);
    // 출제 항목 고르기: 최근 수업 → 복습일 → 최근 오답 → 레벨 범위
    const lessons = pick("lessons/").map((r) => r.data).sort((a, b) => String(b.date).localeCompare(String(a.date)));
    const L = lessons[0] && lessons[0].date >= addDays(today, -14) ? lessons[0] : null;
    const ids = new Set<string>();
    if (L) for (const id of shuffle([...(L.grammarIds ?? []), ...(L.vocabIds ?? [])]).slice(0, 8)) ids.add(id);
    const due = Object.entries(prog).filter(([id, p]: Any) => byId.has(id) && p.nx && p.nx <= today && p.s !== "n").map(([id]) => id);
    for (const id of shuffle(due).slice(0, 5)) ids.add(id);
    const wrong = Object.entries(prog).filter(([id, p]: Any) => byId.has(id) && p.lw && p.lw >= addDays(today, -7)).map(([id]) => id);
    for (const id of shuffle(wrong).slice(0, 4)) ids.add(id);
    const lv = [...grammar, ...vocab].filter((i) => (i.l || level) === level);
    for (const i of shuffle(lv.filter((i) => ["a", "l"].includes(st(i.id))))) { if (ids.size >= 15) break; ids.add(i.id); }
    for (const i of shuffle(lv.filter((i) => st(i.id) === "n")).slice(0, 3)) ids.add(i.id);
    const idList = [...ids].filter((id) => byId.has(id));
    const itemsText = idList.map((id) => { const it = byId.get(id); return it.t === "g" ? `${id}: 문법 ${it.p} (${it.m})` : it.t === "k" ? `${id}: 한자 ${it.c} (${it.m})` : `${id}: 단어 ${it.w}[${it.r}] (${it.m})`; }).join("\n");
    const learned = grammar.filter((g) => ["a", "l", "m"].includes(st(g.id))).slice(-60).map((g) => g.p).join(" / ");
    // 약한 영역에 2문항 더
    const acc: Record<string, number[]> = { v: [0, 0], g: [0, 0], r: [0, 0], l: [0, 0] };
    const from = addDays(today, -14);
    for (const r of pick("log/")) for (const [d, arr] of Object.entries(r.data.days ?? {})) { if (d < from) continue; for (const [a, ok] of arr as Any[]) if (acc[a]) { acc[a][0] += ok; acc[a][1]++; } }
    const measured = Object.entries(acc).filter(([, [, n]]) => n >= 5);
    const weak = measured.length ? measured.sort((a, b) => a[1][0] / a[1][1] - b[1][0] / b[1][1])[0][0] : "l";
    const counts: Record<string, number> = { "文脈規定(v)": 3, "言い換え類義(v)": 2, "文法形式の判断(g)": 4, "文の組み立て(g)": 2, "読解 短文(r)": 2, "聴解 課題理解/ポイント理解(l)": 3 };
    const extra: Record<string, string> = { v: "文脈規定(v)", g: "文法形式の判断(g)", r: "読解 短文(r)", l: "聴解 課題理解/ポイント理解(l)" };
    counts[extra[weak]] += 2;
    // 후리가나 읽기 맞추기 (단어장에 읽기가 하나뿐인 단어)
    const rm = new Map<string, Set<string>>();
    for (const v of vocab) { if (!/[一-龯]/.test(v.w) || !v.r) continue; const k = String(v.w).split(/[;；]/)[0].trim(); if (!rm.has(k)) rm.set(k, new Set()); rm.get(k)!.add(String(v.r).split(/[;；]/)[0].trim()); }
    const fix = (t: string) => t.replace(/\{([^{}|]+)\|([^{}|]+)\}/g, (all, k, r) => { const s = rm.get(k); if (s && s.size === 1) { const only = [...s][0]; if (only !== r && /^[぀-ゟ]+$/.test(only)) return `{${k}|${only}}`; } return all; });
    // 6문항씩 나눠 동시에 요청
    const batches: Record<string, number>[] = []; let cur: Record<string, number> = {}, n = 0;
    for (const [k, c0] of Object.entries(counts)) { let c = c0; while (c > 0) { const t = Math.min(c, 6 - n); cur[k] = (cur[k] ?? 0) + t; n += t; c -= t; if (n >= 6) { batches.push(cur); cur = {}; n = 0; } } }
    if (n) batches.push(cur);
    const known = new Set(idList);
    const results = await Promise.all(batches.map(async (b) => {
      const total = Object.values(b).reduce((a, x) => a + x, 0);
      const prompt = `당신은 JLPT N${level} 출제위원입니다. 한국인 학습자를 위한 실전형 문제를 만드세요.
학습 대상 항목 (id: 내용):
${shuffle(itemsText.split("\n")).slice(0, 14).join("\n")}

학습자가 이미 배운 문법(이 범위를 넘는 문법은 쓰지 마세요): ${learned}
어휘·문법 수준: N${level} 범위 안에서만.
만들 문제 (총 ${total}개): ${Object.entries(b).map(([k, v]) => `${k} ${v}개`).join(", ")}
각 문제의 items에는 위 목록의 id 중 실제로 묻는 항목을 넣으세요.
${qSpec(level)}`;
      try { return validate(parseLoose(await gemini(prompt)), known, fix); } catch (e) { console.error("batch", e); return []; }
    }));
    const qs = results.flat();
    if (!qs.length) throw new Error("AI가 쓸 수 있는 문제를 만들지 못했어요");
    const id = "b" + crypto.randomUUID().slice(0, 12);
    await admin.from("docs").upsert({ user_id: uid, path: "qbank/" + id, data: { id, created: today, source: "daily", title: "아침 자동 문제", level, qs }, updated_at: new Date().toISOString() }, { onConflict: "user_id,path" });
    await setResult({ ok: true, n: qs.length, weak });
  } catch (e) {
    console.error(uid, e);
    await setResult({ ok: false, n: 0, msg: String((e as Error)?.message ?? e).slice(0, 200) }).catch(() => {});
  }
}

Deno.serve(async (req) => {
  if (!CRON_SECRET || req.headers.get("x-cron-secret") !== CRON_SECRET) return json({ error: "unauthorized" }, 401);
  if (!KEY) return json({ error: "GEMINI_API_KEY is not set" }, 500);
  const force = new URL(req.url).searchParams.get("force") === "1";
  const { hour, today, hm } = kstNow();
  const admin = createClient(SB_URL, SERVICE, { auth: { persistSession: false } });
  const { data: states, error } = await admin.from("docs").select("user_id,data").eq("path", "state/main");
  if (error) return json({ error: error.message }, 500);
  const jobs: Promise<void>[] = [];
  for (const s of states ?? []) {
    const ag = { on: true, hour: 7, ...(s.data?.autoGen ?? {}) };
    if (!ag.on) continue;
    if (!force && (hour !== +ag.hour || ag.last === today)) continue;
    jobs.push(runFor(admin, s.user_id, s.data ?? {}, today, hm));
  }
  const all = Promise.all(jobs);
  // 응답은 바로 보내고, 문제 만들기는 뒤에서 계속 진행
  // deno-lint-ignore no-explicit-any
  const rt = (globalThis as any).EdgeRuntime;
  if (rt?.waitUntil) rt.waitUntil(all); else await all;
  return json({ ok: true, kstHour: hour, today, started: jobs.length });
});
