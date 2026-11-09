/* 일본어 공부방 · core: data, progress, db, AI helpers */
'use strict';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(String(c)));
  return el;
};
const jp = (t, cls = '') => h('span', { lang: 'ja', class: cls }, t);
const pad = n => String(n).padStart(2, '0');
const ymd = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (s, n) => { const d = new Date(s + 'T00:00:00'); d.setDate(d.getDate() + n); return ymd(d); };
const daysBetween = (a, b) => Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 864e5);
const shuffle = a => { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.random() * (i + 1) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; };
const pick = (a, n) => shuffle(a).slice(0, n);
const uid = (p = '') => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const sleep = ms => new Promise(r => setTimeout(r, ms));

const AREA = { v: '문자·어휘', g: '문법', r: '독해', l: '청해' };
const STATUS = { n: '미학습', a: '학원에서 배움', l: '학습 중', m: '익힘' };
const STATUS_CLS = { n: 'c-gray', a: 'c-blue', l: 'c-amber', m: 'c-green' };
const INTERVALS = [1, 2, 4, 7, 15, 30];

const App = {
  db: null, sample: null, assets: null, ready: false, aiOk: true,
  M: { vocab: [], kanji: [], grammar: [] }, byId: {}, EX: [],
  prog: {}, custom: { vocab: [], grammar: [] }, state: {}, wrong: [], drill: [],
  today: ymd(), lessons: [], memos: [], banks: [], logs: {}, listeners: [],
};

/* ---------- toasts ---------- */
function toast(msg, kind = '') {
  const t = h('div', { class: 'toast ' + kind }, msg);
  $('#toasts').append(t);
  setTimeout(() => t.classList.add('out'), 3200);
  setTimeout(() => t.remove(), 3700);
}

/* ---------- master data ---------- */
async function loadMaster() {
  const [m, ex] = await Promise.all([
    fetch('data/master.json').then(r => r.json()),
    fetch('data/examples.json').then(r => r.json()).catch(() => []),
  ]);
  App.M = m; App.EX = ex;
  for (const v of m.vocab) { v.t = 'v'; App.byId[v.id] = v; }
  for (const k of m.kanji) { k.t = 'k'; App.byId[k.id] = k; }
  for (const g of m.grammar) { g.t = 'g'; App.byId[g.id] = g; }
}
function registerCustom() {
  for (const v of App.custom.vocab) { v.t = 'v'; App.byId[v.id] = v; }
  for (const g of App.custom.grammar) { g.t = 'g'; App.byId[g.id] = g; }
}
const allVocab = () => App.M.vocab.concat(App.custom.vocab);
const allGrammar = () => App.M.grammar.concat(App.custom.grammar);
const itemLabel = it => !it ? '?' : it.t === 'v' ? it.w : it.t === 'k' ? it.c : it.p;
const itemMeaning = it => !it ? '' : it.m;
const chunkOf = id => id.split('-')[0];

/* ---------- progress ---------- */
function P(id) { const c = App.prog[chunkOf(id)]; return (c && c[id]) || null; }
function status(id) { return P(id)?.s || 'n'; }
function ensureP(id) {
  const k = chunkOf(id);
  App.prog[k] = App.prog[k] || {};
  return (App.prog[k][id] = App.prog[k][id] || { s: 'n', c: 0, r: 0, w: 0 });
}
const dirty = new Set();
let saveTimer = null;
function markDirty(key) { dirty.add(key); clearTimeout(saveTimer); saveTimer = setTimeout(flushSaves, 900); }
const clone = v => v === undefined ? undefined : JSON.parse(JSON.stringify(v));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
// 마지막으로 서버와 맞춘 상태. 저장할 때는 이것과 달라진 부분만 서버 최신 내용 위에 합쳐요.
// (휴대폰과 PC를 같이 열어 둬도 한쪽이 다른 쪽 기록을 덮어쓰지 않게)
App.base = { prog: {}, logs: {}, state: {}, wrongLen: 0, drill: {}, banks: {} };
const writeChain = {};
function chain(path, job) {
  const prev = writeChain[path] || Promise.resolve();
  const next = prev.catch(() => {}).then(job);
  writeChain[path] = next;
  return next;
}
function saveError(e) {
  if (e?.code === 'quota_exceeded') toast('저장 공간이 가득 찼어요. 오래된 기록을 정리해 주세요.', 'err');
  else toast('저장에 실패했어요 (' + (e?.code || 'error') + '). 잠시 후 다시 저장할게요.', 'err');
}
function writeDoc(path, data) {
  if (!App.db) return Promise.resolve();
  return chain(path, async () => {
    const ref = App.db.doc(path);
    try { return await ref.set(data); }
    catch (e) {
      if (e?.code === 'unavailable') { await sleep(600 + Math.random() * 800); return ref.set(data); }
      saveError(e); throw e;
    }
  });
}
// 서버의 최신 내용을 읽고 → 합치고 → 저장 (같은 문서는 차례대로)
function mergeWrite(path, fn) {
  if (!App.db) return Promise.resolve(null);
  return chain(path, async () => {
    const ref = App.db.doc(path);
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const s = await ref.get();
        const merged = fn(s.exists ? clone(s.data()) : null);
        if (merged) await ref.set(merged);
        return merged;
      } catch (e) {
        if (attempt === 0 && (e?.code === 'unavailable' || e?.code === 'invalid_argument')) { await sleep(800); continue; }
        saveError(e); throw e;
      }
    }
  });
}
async function flushProg(c) {
  const local = App.prog[c] || {}, base = App.base.prog[c] || {};
  const snap = clone(local);
  const changed = Object.keys(snap).filter(id => !same(snap[id], base[id]));
  if (!changed.length) return;
  const merged = await mergeWrite('prog/' + c, cur => { const items = cur?.items || {}; for (const id of changed) items[id] = snap[id]; return { items }; });
  if (!merged) return;
  App.base.prog[c] = clone(merged.items);
  const now = App.prog[c] || (App.prog[c] = {});
  for (const [id, v] of Object.entries(merged.items)) if (same(now[id], snap[id])) now[id] = clone(v); // 그사이 바뀐 건 그대로 두고 다음에 저장
}
async function flushLog(m) {
  const local = App.logs[m] || {}, base = App.base.logs[m] || {};
  const add = {};
  for (const [d, arr] of Object.entries(local)) { const n = (base[d] || []).length; if (arr.length > n) add[d] = clone(arr.slice(n)); }
  if (!Object.keys(add).length) return;
  const merged = await mergeWrite('log/' + m, cur => { const days = cur?.days || {}; for (const [d, arr] of Object.entries(add)) days[d] = (days[d] || []).concat(arr); return { days }; });
  if (!merged) return;
  const after = App.logs[m] || {};
  const extra = {}; // 저장하는 사이 새로 푼 기록
  for (const [d, arr] of Object.entries(after)) { const sent = (base[d] || []).length + (add[d] || []).length; if (arr.length > sent) extra[d] = arr.slice(sent); }
  App.base.logs[m] = clone(merged.days);
  const view = clone(merged.days);
  for (const [d, arr] of Object.entries(extra)) view[d] = (view[d] || []).concat(arr);
  App.logs[m] = view;
}
async function flushWrong() {
  const add = clone(App.wrong.slice(App.base.wrongLen));
  if (!add.length) return;
  const merged = await mergeWrite('state/wrong', cur => ({ list: (cur?.list || []).concat(add).slice(-300) }));
  if (!merged) return;
  const extra = App.wrong.slice(App.base.wrongLen + add.length);
  App.wrong = clone(merged.list).concat(extra);
  App.base.wrongLen = merged.list.length;
}
async function flushDrill() {
  const base = App.base.drill;
  const snap = clone(App.drill);
  const changed = snap.filter(d => !same(d, base[d.id]));
  if (!changed.length) return;
  const merged = await mergeWrite('state/drill', cur => {
    const list = cur?.list || [];
    for (const d of changed) { const i = list.findIndex(x => x.id === d.id); if (i >= 0) list[i] = d; else list.push(d); }
    return { list: list.slice(-400) };
  });
  if (!merged) return;
  const snapById = Object.fromEntries(snap.map(d => [d.id, d]));
  const later = App.drill.filter(d => !same(d, snapById[d.id]));
  App.base.drill = Object.fromEntries(merged.list.map(d => [d.id, clone(d)]));
  const list = clone(merged.list);
  for (const d of later) { const i = list.findIndex(x => x.id === d.id); if (i >= 0) list[i] = d; else list.push(d); }
  App.drill = list;
}
async function flushState() {
  const base = App.base.state, snap = clone(App.state);
  const keys = [...new Set([...Object.keys(snap), ...Object.keys(base)])].filter(k => !same(snap[k], base[k]));
  if (!keys.length) return;
  const merged = await mergeWrite('state/main', cur => { const st = cur || {}; for (const k of keys) { if (k in snap) st[k] = snap[k]; else delete st[k]; } return st; });
  if (!merged) return;
  App.base.state = clone(merged);
  for (const k of new Set([...Object.keys(merged), ...Object.keys(App.state)])) {
    if (!same(App.state[k], snap[k])) continue; // 그사이 바뀐 값은 유지
    if (k in merged) App.state[k] = clone(merged[k]); else delete App.state[k];
  }
}
async function flushSaves() {
  const keys = [...dirty]; dirty.clear();
  for (const k of keys) {
    try {
      if (k.startsWith('prog:')) await flushProg(k.slice(5));
      else if (k.startsWith('log:')) await flushLog(k.slice(4));
      else if (k === 'wrong') await flushWrong();
      else if (k === 'drill') await flushDrill();
      else if (k === 'state') await flushState();
    } catch { dirty.add(k); clearTimeout(saveTimer); saveTimer = setTimeout(flushSaves, 5000); }
  }
}
window.addEventListener('pagehide', () => { if (dirty.size) flushSaves(); });

function setStatus(id, s) {
  const p = ensureP(id);
  if (s === 'a' && p.s !== 'n') return; // never downgrade
  p.s = s; markDirty('prog:' + chunkOf(id));
}
function recordAnswer(ids, ok, area, qref) {
  const t = App.today;
  for (const id of ids || []) {
    if (!App.byId[id]) continue;
    const p = ensureP(id);
    if (ok) {
      p.r = (p.r || 0) + 1;
      if (p.d !== t) { p.c = (p.c || 0) + 1; p.d = t; }
      p.s = p.c >= 3 ? 'm' : 'l';
      p.nx = addDays(t, INTERVALS[Math.min(p.c, INTERVALS.length - 1)]);
    } else {
      p.w = (p.w || 0) + 1; p.c = 0; p.s = 'l'; p.nx = addDays(t, 1); p.lw = t;
    }
    p.h = ((p.h || '') + (ok ? 'o' : 'x')).slice(-6);
    markDirty('prog:' + chunkOf(id));
  }
  const mon = t.slice(0, 7);
  App.logs[mon] = App.logs[mon] || {};
  (App.logs[mon][t] = App.logs[mon][t] || []).push([area || 'v', ok ? 1 : 0, (ids || []).join(',')]);
  markDirty('log:' + mon);
  if (!ok && qref) {
    App.wrong.push({ at: t, area, ids, q: qref });
    markDirty('wrong');
  }
}

/* ---------- stats ---------- */
function levelStats(level) {
  const items = [...allVocab(), ...App.M.kanji, ...allGrammar()].filter(i => i.l === level);
  const c = { n: 0, a: 0, l: 0, m: 0 };
  for (const i of items) c[status(i.id)]++;
  return { total: items.length, ...c };
}
function areaAccuracy(days = 14) {
  const from = addDays(App.today, -days + 1);
  const acc = { v: [0, 0], g: [0, 0], r: [0, 0], l: [0, 0] };
  for (const m of Object.values(App.logs)) for (const [d, arr] of Object.entries(m)) {
    if (d < from) continue;
    for (const [a, ok] of arr) { if (!acc[a]) continue; acc[a][0] += ok; acc[a][1]++; }
  }
  return acc;
}
function weeklyAccuracy(weeks = 6) {
  const out = [];
  for (let w = weeks - 1; w >= 0; w--) {
    const end = addDays(App.today, -w * 7), start = addDays(end, -6);
    const acc = { v: [0, 0], g: [0, 0], r: [0, 0], l: [0, 0] };
    for (const m of Object.values(App.logs)) for (const [d, arr] of Object.entries(m)) {
      if (d < start || d > end) continue;
      for (const [a, ok] of arr) if (acc[a]) { acc[a][0] += ok; acc[a][1]++; }
    }
    out.push({ label: start.slice(5).replace('-', '/'), acc });
  }
  return out;
}
function dueItems(limit = 12) {
  const t = App.today, out = [];
  for (const chunk of Object.values(App.prog)) for (const [id, p] of Object.entries(chunk)) {
    if (p.nx && p.nx <= t && p.s !== 'n' && App.byId[id]) out.push(id);
  }
  out.sort((a, b) => (P(a).nx || '').localeCompare(P(b).nx || ''));
  return out.slice(0, limit);
}
function weakItems(n = 5) {
  const from = addDays(App.today, -14), cnt = {};
  for (const m of Object.values(App.logs)) for (const [d, arr] of Object.entries(m)) {
    if (d < from) continue;
    for (const [, ok, ids] of arr) if (!ok) for (const id of String(ids).split(',')) if (id) cnt[id] = (cnt[id] || 0) + 1;
  }
  return Object.entries(cnt).filter(([id]) => App.byId[id]).sort((a, b) => b[1] - a[1]).slice(0, n);
}

/* ---------- AI ---------- */
function aiErrorText(e) {
  const c = e?.code;
  if (c === 'not_granted') return 'AI 연결이 설정되지 않았거나 로그인이 만료됐어요.';
  if (c === 'no_key') return 'Supabase에 GEMINI_API_KEY가 설정되지 않았어요. 설치 안내서 4단계를 확인해 주세요.';
  if (c === 'network') return '연결이 끊겨서 AI 답을 받지 못했어요. 정리하는 동안 화면을 켜 둔 채 이 페이지에서 기다려 주세요. 사진이 많으면 2~3장씩 나눠서 해 보세요.';
  if (c === 'timeout') return 'AI 답이 너무 오래 걸려 중간에 멈췄어요. 사진을 2~3장씩 나눠서 다시 해 보세요.';
  if (c === 'overloaded') return '지금 AI 서버에 사용자가 몰려서 모든 모델이 바빠요. 1~2분 뒤 다시 눌러 주세요.';
  if (c === 'upstream') return 'AI 서버가 응답하지 않았어요. 잠시 후 다시 시도해 주세요. (' + (e?.message || '').slice(0, 80) + ')';
  if (c === 'rate_limited') return '요청이 많아 잠시 쉬어야 해요. 조금 뒤에 다시 시도해 주세요.';
  if (c === 'invalid_json') return 'AI 응답을 읽지 못했어요. 다시 시도해 주세요. (설정 → AI 연결 테스트에서 원문을 볼 수 있어요)';
  if (c === 'truncated') return 'AI 답이 너무 길어 중간에 잘렸어요. 문항 수를 줄여 다시 시도해 주세요.';
  if (c === 'empty') return 'AI가 쓸 수 있는 문제를 만들지 못했어요. 다시 시도해 주세요.';
  if (c === 'cancelled') return '취소했어요.';
  if (c === 'images_unavailable' || c === 'image_rejected') return '이 사진은 AI에 보낼 수 없어요. 다른 사진으로 해 주세요.';
  return 'AI 요청에 실패했어요 (' + (c || 'error') + ').';
}
async function ai(prompt, opts = {}) {
  if (!App.sample) throw { code: 'not_granted' };
  return App.sample(prompt, opts);
}
async function aiJSON(prompt, opts = {}) {
  if (!App.sample) throw { code: 'not_granted' };
  return App.sample.json(prompt, opts);
}
function learnedContext(level = 5, max = 60) {
  const gs = allGrammar().filter(g => ['a', 'l', 'm'].includes(status(g.id)));
  return gs.slice(-max).map(g => g.p).join(' / ');
}

/* ---------- question bank ---------- */
function bankQuestions(filter = () => true) {
  const out = [];
  for (const b of App.banks) for (const q of b.qs || []) if (!q.bad && filter(q, b)) out.push(Object.assign({ bank: b.id }, q));
  return out;
}
function markSeen(q, ok) {
  if (!q.bank) return;
  const b = App.banks.find(x => x.id === q.bank); if (!b) return;
  const bq = b.qs.find(x => x.id === q.id); if (!bq) return;
  bq.seen = (bq.seen || 0) + 1; if (ok) bq.ok = (bq.ok || 0) + 1;
  b._dirty = true; scheduleBankSave();
}
let bankTimer = null;
function scheduleBankSave() {
  clearTimeout(bankTimer);
  bankTimer = setTimeout(() => {
    for (const b of App.banks) if (b._dirty) {
      b._dirty = false;
      const { _dirty, ...data } = b; const local = clone(data); const base = App.base.banks[b.id] || {};
      const baseQ = Object.fromEntries((base.qs || []).map(q => [q.id, q]));
      mergeWrite('qbank/' + b.id, cur => {
        if (!cur) return local;
        if (local.title !== base.title) cur.title = local.title;
        for (const q of local.qs || []) {
          if (same(q, baseQ[q.id])) continue;
          const rq = (cur.qs || []).find(x => x.id === q.id);
          if (rq) { for (const f of ['seen', 'ok', 'bad']) if (q[f] !== undefined) rq[f] = q[f]; } else (cur.qs = cur.qs || []).push(q);
        }
        return cur;
      }).then(m => { if (m) App.base.banks[b.id] = clone(m); }).catch(() => { b._dirty = true; });
    }
  }, 1200);
}
function reportBad(q) {
  if (!q.bank) return;
  const b = App.banks.find(x => x.id === q.bank); const bq = b?.qs.find(x => x.id === q.id);
  if (bq) { bq.bad = true; b._dirty = true; scheduleBankSave(); toast('이 문제를 은행에서 뺐어요.'); }
}

const READ_LEN = {
  5: '짧은 글(短文): 4~6문장, 80~150자 / 중간 글(中文): 8~12문장, 약 250자',
  4: '짧은 글(短文): 5~7문장, 100~200자 / 중간 글(中文): 10~15문장, 약 350자',
  3: '짧은 글(短文): 약 150~200자 / 중간 글(中文): 약 350자',
  2: '짧은 글(短文): 약 200자 / 중간 글(中文): 약 500자 / 긴 글(長文): 약 900자',
  1: '짧은 글(短文): 약 200자 / 중간 글(中文): 약 500자 / 긴 글(長文): 약 1000자',
};
const qSpec = (level = 5) => `각 문제는 이 JSON 형태를 따르세요:
{"area":"v|g|r|l","sub":"유형 이름(일본어, 예: 文脈規定)","items":["관련 항목 id"],"prompt":"문제 문장(일본어). 밑줄 대상은 [u]단어[/u], 빈칸은 （　　）, 文の組み立て는 ＿＿ ＿＿ ★ ＿＿ 형태","passage":"독해 지문(일본어, 독해만)","script":[{"s":"男|女|N","t":"대사(일본어, 청해만)"}],"choices":["보기1","보기2","보기3","보기4"],"ans":0,"expl":"한국어 해설 1~2문장"}
규칙: choices는 정확히 4개, ans는 0~3 정답 위치(위치를 고르게 섞기), 오답 보기는 그럴듯하지만 명확히 틀려야 함, 정답은 오직 하나. 청해는 prompt에 질문을 쓰고 script에 대화를 쓰며, 보기는 짧게. 문맥이 자연스러운 실제 생활 장면 문장을 쓰고, 같은 문형을 반복하지 마세요.
독해 지문 길이(JLPT N${level} 기준): ${READ_LEN[level] || READ_LEN[5]}. 유형 이름에 短文/中文을 맞춰 쓰세요.
후리가나: prompt, passage, choices, script의 대사에 나오는 모든 한자 단어에 {漢字|よみ} 형식으로 히라가나 읽기를 붙이세요. 예: {毎朝|まいあさ}{起|お}きます. 단, 漢字読み 유형에서 [u]밑줄[/u] 대상 단어와 表記 유형의 보기처럼 읽기 자체가 정답인 곳에는 붙이지 마세요.
설명 외의 텍스트 없이 JSON 배열만 답하세요.`;
const Q_SPEC = qSpec(5);

/* 후리가나: {漢字|よみ} 표기. 단어장에 한 가지 읽기만 있는 단어는 그 읽기로 맞춰요 */
const FURI_RE = /\{([^{}|]+)\|([^{}|]+)\}/g;
let _readMap = null;
function readMap() {
  if (_readMap) return _readMap;
  const m = new Map();
  for (const v of allVocab()) { if (!/[\u4e00-\u9faf]/.test(v.w) || !v.r) continue; const k = v.w.split(/[;；]/)[0].trim(); if (!m.has(k)) m.set(k, new Set()); m.get(k).add(v.r.split(/[;；]/)[0].trim()); }
  return (_readMap = m);
}
function fixFuri(t) {
  return String(t || '').replace(FURI_RE, (all, k, r) => { const set = readMap().get(k); if (set && set.size === 1) { const only = [...set][0]; if (only !== r && /^[\u3040-\u309f]+$/.test(only)) return `{${k}|${only}}`; } return all; });
}
// 후리가나가 없는 예전 문제에도 단어장 읽기로 자동 표시 (읽기가 한 가지뿐인 한자 묶음만)
let _kanjiRead = null;
function kanjiReadMap() {
  if (_kanjiRead) return _kanjiRead;
  const m = new Map();
  const add = (k, r) => { if (!k || !r || !/^[぀-ゟ]+$/.test(r)) return; if (!m.has(k)) m.set(k, new Set()); m.get(k).add(r); };
  for (const v of allVocab()) {
    const w = String(v.w || '').split(/[;；]/)[0].trim().replace(/^[～〜]/, ''), r = String(v.r || '').split(/[;；]/)[0].trim().replace(/^[～〜]/, '');
    const mm = w.match(/^([一-龯々]+)([぀-ゟ]*)$/);
    if (!mm) continue;
    const [, kan, oku] = mm;
    if (oku && r.endsWith(oku)) add(kan, r.slice(0, r.length - oku.length));
    else if (!oku) add(kan, r);
  }
  return (_kanjiRead = m);
}
function autoFuri(t) {
  t = String(t ?? '');
  if (!/[一-龯]/.test(t)) return t;
  const map = kanjiReadMap();
  // 이미 후리가나가 있는 부분과 [u]밑줄[/u] 부분은 그대로 두기
  return t.split(/(\{[^{}|]+\|[^{}|]+\}|\[u\][\s\S]*?\[\/u\])/).map((seg, i) => {
    if (i % 2) return seg;
    let out = '', j = 0;
    while (j < seg.length) {
      if (!/[一-龯々]/.test(seg[j])) { out += seg[j++]; continue; }
      let end = j; while (end < seg.length && /[一-龯々]/.test(seg[end])) end++;
      const blockLen = end - j;
      let hit = false;
      for (let n = Math.min(blockLen, 6); n >= 1; n--) {
        if (n === 1 && blockLen > 1) break; // 한 글자 읽기는 그 한자가 혼자 쓰일 때만 (日本人의 人 같은 오독 방지)
        const k = seg.slice(j, j + n), set = map.get(k);
        if (set && set.size === 1) { out += `{${k}|${[...set][0]}}`; j += n; hit = true; break; }
      }
      if (!hit) { out += seg.slice(j, end); j = end; } // 모르는 한자 묶음은 통째로 그대로
    }
    return out;
  }).join('');
}
const plainJa = t => String(t || '').replace(FURI_RE, '$1').replace(/\[\/?u\]/g, '');
function unwrapArray(v) {
  if (Array.isArray(v)) return v;
  if (v && typeof v === 'object') {
    for (const k of ['questions', 'items', 'data', 'result', 'problems', '문제']) if (Array.isArray(v[k])) return v[k];
    const arrs = Object.values(v).filter(Array.isArray);
    if (arrs.length === 1) return arrs[0];
    if (v.choices) return [v];
  }
  return [];
}
function validateQs(arr, allowIds) {
  arr = unwrapArray(arr);
  const ok = [];
  for (const raw of arr) {
    if (!raw || typeof raw !== 'object') continue;
    const q = { ...raw };
    q.choices = q.choices || q.options || q.opts;
    if (Array.isArray(q.choices)) q.choices = q.choices.map(c => (c && typeof c === 'object') ? (c.text ?? c.t ?? c.label ?? Object.values(c)[0]) : c);
    if (!Array.isArray(q.choices) || q.choices.length !== 4) continue;
    let ans = q.ans ?? q.answer ?? q.correct ?? q.answerIndex;
    if (typeof ans === 'string' && !/^\d+$/.test(ans.trim())) ans = q.choices.indexOf(ans);
    ans = Number(ans);
    if (!(ans >= 0 && ans <= 3)) continue;
    q.area = String(q.area || '').toLowerCase()[0];
    q.script = Array.isArray(q.script) ? q.script.map(l => typeof l === 'string' ? { s: 'N', t: l } : l) : q.script;
    if (!['v', 'g', 'r', 'l'].includes(q.area)) q.area = 'g';
    if (q.area === 'l' && (!Array.isArray(q.script) || !q.script.length)) continue;
    if (q.area === 'r' && !q.passage) q.area = 'g';
    q.items = (Array.isArray(q.items) ? q.items : []).filter(id => App.byId[id] && (!allowIds || allowIds.has(id))).slice(0, 4);
    ok.push({ id: uid('q'), area: q.area, sub: String(q.sub || '').slice(0, 20), items: q.items, prompt: fixFuri(String(q.prompt || '').slice(0, 600)), passage: q.passage ? fixFuri(String(q.passage).slice(0, 2400)) : undefined, script: q.area === 'l' ? q.script.slice(0, 14).map(l => ({ s: String(l.s || 'N').slice(0, 2), t: fixFuri(String(l.t || '').slice(0, 300)) })) : undefined, choices: q.choices.map(c => fixFuri(String(c).slice(0, 160))), ans, expl: String(q.expl || '').slice(0, 300) });
  }
  return ok;
}
function itemsForPrompt(ids) {
  return ids.map(id => { const it = App.byId[id]; if (!it) return ''; return it.t === 'g' ? `${id}: 문법 ${it.p} (${it.m})` : it.t === 'k' ? `${id}: 한자 ${it.c} (${it.m})` : `${id}: 단어 ${it.w}[${it.r}] (${it.m})`; }).filter(Boolean).join('\n');
}
const BG = { tasks: 0, set(text) { const el = document.getElementById('bgTask'); if (!el) return; if (text) { el.textContent = text; el.hidden = false; } else el.hidden = true; } };
async function generateQuestions({ ids, level = 5, counts, source, title, signal, onProgress }) {
  const want = counts || { '文脈規定(v)': 4, '言い換え類義(v)': 2, '文法形式の判断(g)': 6, '文の組み立て(g)': 3, '読解 短文(r)': 2, '聴解 課題理解/ポイント理解(l)': 3 };
  // 한 번에 많이 만들면 답이 잘리므로 6문항 안팎으로 나눠 동시에 요청
  const entries = Object.entries(want).filter(([, n]) => n > 0);
  const batches = []; let cur = {}, curN = 0;
  for (const [k, n0] of entries) {
    let n = n0;
    while (n > 0) { const take = Math.min(n, 6 - curN); cur[k] = (cur[k] || 0) + take; curN += take; n -= take; if (curN >= 6) { batches.push(cur); cur = {}; curN = 0; } }
  }
  if (curN) batches.push(cur);
  let done = 0; const total = batches.length;
  BG.tasks++; BG.set(`문제 만드는 중… 0/${total}`);
  const one = async b => {
    const n = Object.values(b).reduce((a, x) => a + x, 0);
    const prompt = `당신은 JLPT N${level} 출제위원입니다. 한국인 학습자를 위한 실전형 문제를 만드세요.
학습 대상 항목 (id: 내용):
${itemsForPrompt(shuffle(ids).slice(0, 14))}

학습자가 이미 배운 문법(이 범위를 넘는 문법은 쓰지 마세요): ${learnedContext(level)}
어휘·문법 수준: N${level} 범위 안에서만.
만들 문제 (총 ${n}개): ${Object.entries(b).map(([k, v]) => `${k} ${v}개`).join(', ')}
각 문제의 items에는 위 목록의 id 중 실제로 묻는 항목을 넣으세요.
${qSpec(level)}`;
    try { const arr = await aiJSON(prompt, { signal, modelTier: 'default', async: true, kind: 'questions' }); return validateQs(arr, null); }
    catch (e) { if (e?.code === 'cancelled' || e?.code === 'not_granted' || e?.code === 'no_key') throw e; console.warn('batch failed', e); App.lastAIError = e; return []; }
    finally { done++; BG.set(`문제 만드는 중… ${done}/${total}`); onProgress && onProgress(done, total); }
  };
  let qs = [];
  try {
    for (let i = 0; i < batches.length; i += 3) qs = qs.concat(...await Promise.all(batches.slice(i, i + 3).map(one)));
  } finally { if (--BG.tasks <= 0) { BG.tasks = 0; BG.set(''); } }
  if (!qs.length) throw (App.lastAIError?.code ? App.lastAIError : { code: 'empty' });
  const bank = { id: uid('b'), created: App.today, source: source || 'manual', title: title || '', level, qs };
  App.banks.push(bank);
  await writeDoc('qbank/' + bank.id, bank);
  App.base.banks[bank.id] = clone(bank);
  return bank;
}

/* ---------- rule-based vocab questions ---------- */
function vocabQuestion(id, mode) {
  const it = App.byId[id]; if (!it) return null;
  if (it.t === 'g') {
    return { id: 'r' + id, area: 'g', sub: '문법 의미', items: [id], prompt: `「${it.p}」의 뜻으로 알맞은 것은?`, choices: null, _pool: allGrammar().filter(g => g.id !== id && g.m !== it.m).map(g => g.m), _ans: it.m, expl: `${it.f}\n예) ${it.ej} — ${it.ek}` };
  }
  if (it.t === 'k') {
    const pool = App.M.kanji.filter(k => k.id !== id && k.m !== it.m).map(k => k.m);
    return finishRule({ id: 'r' + id, area: 'v', sub: '漢字 훈음', items: [id], prompt: `한자 「${it.c}」의 뜻·음은?`, _pool: pool, _ans: it.m, expl: `음독 ${it.on || '-'} / 훈독 ${it.kun || '-'}` });
  }
  const hasKanji = /[一-龯]/.test(it.w);
  const modes = hasKanji ? ['read', 'mean', 'write', 'ko'] : ['mean', 'ko'];
  mode = mode && modes.includes(mode) ? mode : modes[Math.random() * modes.length | 0];
  const same = allVocab().filter(v => v.id !== id && v.w !== it.w && Math.abs((v.l || 5) - (it.l || 5)) <= 1);
  const note = it.n ? '\n' + it.n : '';
  if (mode === 'read') {
    const pool = same.filter(v => v.r !== it.r && Math.abs(v.r.length - it.r.length) <= 1).map(v => v.r);
    return finishRule({ id: 'r' + id + 'R', area: 'v', sub: '漢字読み', items: [id], prompt: `[u]${it.w}[/u]의 읽는 법은?`, _pool: pool.concat(mutateReading(it.r)), _ans: it.r, expl: `${it.w}（${it.r}）= ${it.m}${note}` });
  }
  if (mode === 'write') {
    const pool = same.filter(v => /[一-龯]/.test(v.w) && v.w.length === it.w.length).map(v => v.w);
    return finishRule({ id: 'r' + id + 'W', area: 'v', sub: '表記', items: [id], prompt: `[u]${it.r}[/u]를 한자로 쓰면?`, _pool: pool, _ans: it.w, expl: `${it.r} → ${it.w} = ${it.m}${note}` });
  }
  if (mode === 'ko') {
    const pool = same.map(v => v.w);
    return finishRule({ id: 'r' + id + 'K', area: 'v', sub: '한→일', items: [id], prompt: `「${it.m}」에 해당하는 일본어는?`, _pool: pool, _ans: it.w, expl: `${it.w}（${it.r}）${note}` });
  }
  const pool = same.map(v => v.m);
  return finishRule({ id: 'r' + id + 'M', area: 'v', sub: '뜻 고르기', items: [id], prompt: `[u]${it.w}[/u]（${it.r}）의 뜻은?`, _pool: pool, _ans: it.m, expl: `${it.w}（${it.r}）= ${it.m}${note}` });
}
function mutateReading(r) {
  const swaps = [['う', ''], ['ょう', 'よう'], ['っ', ''], ['ん', ''], ['じ', 'し'], ['が', 'か'], ['ぶ', 'ふ'], ['ゅう', 'ゆう'], ['お', 'う']];
  const out = new Set();
  for (const [a, b] of shuffle(swaps)) { if (r.includes(a)) out.add(r.replace(a, b)); if (b && r.includes(b)) out.add(r.replace(b, a)); }
  out.delete(r); return [...out].filter(Boolean);
}
function finishRule(q) {
  const opts = shuffle([...new Set(q._pool)].filter(x => x && x !== q._ans)).slice(0, 3);
  while (opts.length < 3) opts.push('—');
  const choices = shuffle([q._ans, ...opts]);
  const out = { id: q.id, area: q.area, sub: q.sub, items: q.items, prompt: q.prompt, choices, ans: choices.indexOf(q._ans), expl: q.expl, rule: 1 };
  return out;
}
function ruleQ(id, mode) {
  const q = vocabQuestion(id, mode);
  if (q && !q.choices && q._pool) return finishRule(q);
  return q;
}

/* ---------- TTS ---------- */
const TTS = {
  voices: [], ready: false,
  init() {
    if (!('speechSynthesis' in window)) return;
    const load = () => { this.voices = speechSynthesis.getVoices().filter(v => /ja/i.test(v.lang)); this.ready = true; };
    load(); speechSynthesis.onvoiceschanged = load;
  },
  available() { return 'speechSynthesis' in window; },
  stop() { try { speechSynthesis.cancel(); } catch { } },
  speak(lines, rate = 1, onDone) {
    this.stop();
    if (!this.available()) { onDone && onDone(false); return; }
    const vs = this.voices;
    const female = vs.find(v => /kyoko|haruka|nanami|ayumi|female|女/i.test(v.name)) || vs[0];
    const male = vs.find(v => /otoya|ichiro|keita|male|男/i.test(v.name) && v !== female) || vs[1] || vs[0];
    let i = 0;
    const next = () => {
      if (i >= lines.length) { onDone && onDone(true); return; }
      const l = lines[i++];
      const u = new SpeechSynthesisUtterance(plainJa(l.t));
      u.lang = 'ja-JP'; u.rate = rate;
      const v = l.s === '男' ? male : l.s === '女' ? female : (female || male);
      if (v) u.voice = v;
      if (l.s === '男' && male === female) u.pitch = 0.75;
      if (l.s === '女' && male === female) u.pitch = 1.2;
      u.onend = () => setTimeout(next, 350);
      u.onerror = () => setTimeout(next, 50);
      speechSynthesis.speak(u);
    };
    next();
  },
};

/* ---------- db load ---------- */
async function loadAll() {
  const db = App.db; if (!db) return;
  const timeout = setTimeout(() => { $('#netNote')?.classList.add('show'); }, 10000);
  try {
    const [st, wr, dr, cu, progSnap, lessons, memos, banks, logs] = await Promise.all([
      db.doc('state/main').get(), db.doc('state/wrong').get(), db.doc('state/drill').get(), db.doc('custom/items').get(),
      db.collection('prog').get(), db.collection('lessons').orderBy('date', 'desc').limit(200).get(),
      db.collection('memos').orderBy('at', 'desc').limit(200).get(), db.collection('qbank').get(),
      db.collection('log').get(),
    ]);
    App.state = st.exists ? clone(st.data()) : {};
    App.wrong = wr.exists ? clone(wr.data().list || []) : [];
    App.drill = dr.exists ? clone(dr.data().list || []) : [];
    App.base.state = clone(App.state); App.base.wrongLen = App.wrong.length;
    App.base.drill = Object.fromEntries(App.drill.map(d => [d.id, clone(d)]));
    if (cu.exists) { const d = cu.data(); App.custom = { vocab: [...(d.vocab || [])], grammar: [...(d.grammar || [])] }; registerCustom(); }
    for (const d of progSnap.docs) { App.prog[d.id] = clone(d.data().items || {}); App.base.prog[d.id] = clone(d.data().items || {}); }
    App.lessons = lessons.docs.map(d => ({ id: d.id, ...JSON.parse(JSON.stringify(d.data())) }));
    App.memos = memos.docs.map(d => ({ id: d.id, ...JSON.parse(JSON.stringify(d.data())) }));
    App.banks = banks.docs.map(d => ({ id: d.id, ...clone(d.data()) }));
    App.base.banks = Object.fromEntries(banks.docs.map(d => [d.id, clone(d.data())]));
    for (const d of logs.docs) { App.logs[d.id] = clone(d.data().days || {}); App.base.logs[d.id] = clone(d.data().days || {}); }
    App.loadedAt = Date.now(); App.loadFailed = false;
  } catch (e) { App.loadFailed = true; throw e; } finally { clearTimeout(timeout); $('#netNote')?.classList.remove('show'); }
}
function saveCustom() {
  const local = clone({ vocab: App.custom.vocab, grammar: App.custom.grammar });
  return mergeWrite('custom/items', cur => {
    const out = { vocab: cur?.vocab || [], grammar: cur?.grammar || [] };
    for (const k of ['vocab', 'grammar']) for (const it of local[k]) { const i = out[k].findIndex(x => x.id === it.id); if (i >= 0) out[k][i] = it; else out[k].push(it); }
    return out;
  }).then(m => { if (m) { App.custom = { vocab: m.vocab, grammar: m.grammar }; registerCustom(); } return m; });
}
function saveState() { markDirty('state'); }
