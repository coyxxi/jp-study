/* 일본어 공부방 · core: data, progress, db, AI helpers */
'use strict';
// 화면에 "null"·"undefined"가 글자로 찍히지 않게: 빈 값은 그냥 건너뛰어요
for (const P of [Element.prototype, DocumentFragment.prototype]) for (const fn of ['append', 'prepend']) {
  const orig = P[fn]; P[fn] = function (...a) { return orig.apply(this, a.filter(x => x != null && x !== false)); };
}
const $ = (s, r = document) => r.querySelector(s);
// 받침에 따라 이/가, 을/를, 은/는 붙이기
const josa = (w, a, b) => { const c = String(w).trim().slice(-1).charCodeAt(0); const has = c >= 0xAC00 && c <= 0xD7A3 ? (c - 0xAC00) % 28 > 0 : /[0-9lmnr]$/i.test(w); return w + (has ? a : b); };
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
const STATUS = { n: '미학습', l: '학습 중', m: '익힘' };
const STATUS_CLS = { n: 'c-gray', a: 'c-amber', l: 'c-amber', m: 'c-green' };
const INTERVALS = [1, 2, 4, 7, 15, 30];

const App = {
  db: null, sample: null, assets: null, ready: false, aiOk: true,
  M: { vocab: [], kanji: [], grammar: [] }, byId: {}, EX: [],
  prog: {}, custom: { vocab: [], grammar: [] }, state: {}, wrong: [], drill: [],
  today: ymd(), lessons: [], memos: [], banks: [], logs: {}, listeners: [],
};

/* 날짜 넘어감 확인: 화면을 켜 둔 채 자정을 넘겨도 오늘 날짜로 맞춰요 */
function ensureToday() {
  const t = ymd();
  if (t === App.today) return false;
  App.today = t; App.dayDoc = null;
  return true;
}
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
    fetch('data/groups.json').then(r => r.json()).catch(() => ({ kanji: [], grammar: [] })),
    fetch('data/related.json').then(r => r.json()).catch(() => ({ ant: [], syn: [] })),
  ]).then(([m, ex, gr, rel]) => { App.G = gr; App.RELDATA = rel; return [m, ex]; });
  App.M = m; App.EX = ex;
  for (const v of m.vocab) { v.t = 'v'; App.byId[v.id] = v; }
  for (const k of m.kanji) { k.t = 'k'; App.byId[k.id] = k; }
  for (const g of m.grammar) { g.t = 'g'; App.byId[g.id] = g; }
}
function registerCustom() {
  for (const v of App.custom.vocab) { v.t = 'v'; App.byId[v.id] = v; }
  for (const g of App.custom.grammar) { g.t = 'g'; App.byId[g.id] = g; }
}
const allVocab = () => App.M.vocab.concat(App.custom.vocab).filter(v => !App.alias[v.id]);
const allGrammar = () => App.M.grammar.concat(App.custom.grammar).filter(g => !App.alias[g.id]);

/* ---------- 중복 정리: 같은 단어가 두 번 있으면 하나로 합쳐요 (기록은 합쳐서 남겨요) ---------- */
App.alias = {};
const canon = id => App.alias[id] || id;
const ST_RANK = { n: 0, a: 1, l: 2, m: 3 };
function mergeProg(a, b) { // 여러 번 실행해도 결과가 같게 (큰 값·앞선 날짜 기준)
  const o = Object.assign({}, a);
  if ((ST_RANK[b.s || 'n'] || 0) > (ST_RANK[o.s || 'n'] || 0)) o.s = b.s;
  for (const f of ['c', 'r', 'w', 'qa']) if ((b[f] || 0) > (o[f] || 0)) o[f] = b[f];
  for (const f of ['d', 'lw']) if (b[f] && (!o[f] || b[f] > o[f])) o[f] = b[f];
  if (b.nx && (!o.nx || b.nx < o.nx)) o.nx = b.nx;
  if ((b.h || '').length > (o.h || '').length) o.h = b.h;
  return o;
}
function buildAliases() {
  const al = Object.assign({}, App.custom.alias || {});
  // 기본 데이터 안의 중복: 시트에서 온 단어(WS)가 같은 표기·읽기의 기본 단어와 겹치면 기본 단어로
  const byW = {};
  for (const v of App.M.vocab) (byW[v.w] = byW[v.w] || []).push(v);
  for (const list of Object.values(byW)) if (list.length > 1) {
    const main = list.find(v => !v.id.startsWith('WS'));
    if (main) for (const v of list) if (v !== main && v.id.startsWith('WS') && v.r === main.r) al[v.id] = main.id;
  }
  // 수업·메모에서 추가한 단어가 기본 데이터(또는 먼저 추가한 단어)와 같으면 합쳐요
  const seen = {};
  for (const v of App.M.vocab) if (!al[v.id]) seen[v.w + '|' + v.r] = seen[v.w + '|' + v.r] || v.id, seen[v.w] = seen[v.w] || v.id;
  for (const v of App.custom.vocab) {
    if (al[v.id]) continue;
    const hit = seen[v.w + '|' + (v.r || '')] || (!v.r ? seen[v.w] : null) || (seen[v.w] && App.byId[seen[v.w]]?.r === v.r ? seen[v.w] : null);
    if (hit && hit !== v.id) al[v.id] = hit; else { seen[v.w + '|' + (v.r || '')] = v.id; seen[v.w] = seen[v.w] || v.id; }
  }
  const gp = {};
  for (const g of App.M.grammar) gp[g.p] = gp[g.p] || g.id;
  for (const g of App.custom.grammar) { if (al[g.id]) continue; if (gp[g.p] && gp[g.p] !== g.id) al[g.id] = gp[g.p]; else gp[g.p] = g.id; }
  for (const k of Object.keys(al)) { let t = al[k], n = 0; while (al[t] && n++ < 5) t = al[t]; al[k] = t; } // 연결 정리
  App.alias = al;
  for (const [d, c] of Object.entries(al)) if (App.byId[c]) App.byId[d] = App.byId[c];
  // 중복 쪽에 쌓인 기록은 남는 쪽으로 합쳐요
  const touched = new Set();
  for (const d of Object.keys(al)) {
    const dp = (App.prog[chunkOf(d)] || {})[d]; if (!dp) continue;
    const c = al[d], ck = chunkOf(c);
    App.prog[ck] = App.prog[ck] || {};
    const cur = App.prog[ck][c] || { s: 'n', c: 0, r: 0, w: 0 };
    const m = mergeProg(cur, dp);
    if (!same(m, App.prog[ck][c])) { App.prog[ck][c] = m; touched.add(ck); }
  }
  touched.forEach(ck => markDirty('prog:' + ck));
  return touched.size;
}
/* 서버의 사용자 단어 목록에서도 중복을 빼요 (기록이 저장된 뒤에, 참조는 alias로 계속 연결) */
async function cleanupCustomDups() {
  const dupCustom = [...App.custom.vocab, ...App.custom.grammar].filter(x => App.alias[x.id]);
  if (!dupCustom.length || !App.db) return;
  await flushSaves();
  const ids = new Set(dupCustom.map(x => x.id)), al = {};
  for (const id of ids) al[id] = App.alias[id];
  const m = await mergeWrite('custom/items', cur => {
    if (!cur) return null;
    return { vocab: (cur.vocab || []).filter(x => !ids.has(x.id)), grammar: (cur.grammar || []).filter(x => !ids.has(x.id)), alias: Object.assign({}, cur.alias || {}, al) };
  }).catch(() => null);
  if (m) { App.custom = { vocab: m.vocab, grammar: m.grammar, alias: m.alias }; registerCustom(); buildAliases(); }
}
const itemLabel = it => !it ? '?' : it.t === 'v' ? it.w : it.t === 'k' ? it.c : it.p;
const itemMeaning = it => !it ? '' : it.m;
const chunkOf = id => id.split('-')[0];

/* ---------- progress ---------- */
function P(id) { id = canon(id); const c = App.prog[chunkOf(id)]; return (c && c[id]) || null; }
// 학원에서 배움(a)은 화면에서 학습 중(l)으로 합쳐 보여요 (저장된 값은 그대로)
function status(id) { const s = P(id)?.s || 'n'; return s === 'a' ? 'l' : s; }
function ensureP(id) {
  id = canon(id);
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
/* 순간 작문: 연속이든 띄엄띄엄이든 모두 3번 맞히면 '익힘' → 출제에서 빠져요 (okt = 맞힌 횟수 합계, 예전 기록은 ok로 계산) */
const DRILL_DONE = 3;
function drillOk(d) { return d.okt ?? d.ok ?? 0; }
function drillDone(d) { return drillOk(d) >= DRILL_DONE; }
/* 순간 작문 목록이 400개를 넘으면: 두 번 맞힌(외운) 문장 중 오래된 것부터 정리, 못 맞힌 문장은 남겨요 */
function trimDrill(list, max = 400) {
  if (list.length <= max) return list;
  let over = list.length - max;
  const drop = new Set();
  for (const d of list) { if (over <= 0) break; if (drillDone(d)) { drop.add(d.id); over--; } }
  const kept = list.filter(d => !drop.has(d.id));
  return kept.length > max * 1.5 ? kept.slice(-max * 1.5) : kept; // 그래도 너무 많으면(600개 초과) 오래된 것부터
}
async function flushDrill() {
  const base = App.base.drill;
  const snap = clone(App.drill);
  const changed = snap.filter(d => !same(d, base[d.id]));
  if (!changed.length) return;
  const merged = await mergeWrite('state/drill', cur => {
    const list = cur?.list || [];
    for (const d of changed) { const i = list.findIndex(x => x.id === d.id); if (i >= 0) list[i] = d; else list.push(d); }
    return { list: trimDrill(list) };
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
/* 익힘 규칙
   - 서로 다른 시험(2시간 이상 떨어진 시험)에서 3번 연속 맞히면 익힘 (아침·점심·저녁 세 번이면 그날 익힘)
   - 익힘이 된 항목은 더 이상 문제로 나오지 않아요 (잊었으면 단어장에서 미학습·학습 중으로 바꾸면 다시 나와요)
   - 같은 시험 안에서 다시 맞힌 건 세지 않아요 */
const SESSION_GAP = 2 * 3600e3; const L_INTERVALS = [1, 2, 4];
const M_INTERVALS = [3, 7, 15, 30];
function recordAnswer(ids, ok, area, qref, sub) {
  const t = App.today, now = Date.now();
  ids = [...new Set((ids || []).map(canon))];
  for (const id of ids) {
    if (!App.byId[id]) continue;
    const p = ensureP(id);
    const newSession = !p.ls || now - p.ls >= SESSION_GAP;
    if (ok) {
      p.r = (p.r || 0) + 1;
      if (p.d !== t) { p.c = (p.c || 0) + 1; p.d = t; }
      if (newSession) { p.cs = (p.cs || 0) + 1; p.ls = now; }
      if (p.s === 'm') {
        // 확인 문제를 맞히면 다음 확인까지 간격을 늘려요
        if (newSession && (!p.nx || p.nx <= t)) { p.ms = Math.min((p.ms || 0) + 1, M_INTERVALS.length - 1); p.nx = addDays(t, M_INTERVALS[p.ms]); }
      } else if ((p.cs || 0) >= 3) {
        p.s = 'm'; p.ms = 0; p.md = t; p.nx = addDays(t, M_INTERVALS[0]);
      } else {
        // 학습 중: 맞힐수록 간격을 늘려요 (1일 → 2일 → 4일). 같은 시간대에 또 맞힌 건 간격을 줄이지 않아요
        p.s = 'l';
        if (newSession) p.nx = addDays(t, L_INTERVALS[Math.min(Math.max((p.cs || 1) - 1, 0), L_INTERVALS.length - 1)]);
        else if (!p.nx || p.nx <= t) p.nx = addDays(t, 1);
      }
    } else {
      p.w = (p.w || 0) + 1; p.c = 0; p.cs = 0; p.ms = 0; p.ls = now; p.s = 'l'; p.nx = addDays(t, 1); p.lw = t;
    }
    p.h = ((p.h || '') + (ok ? 'o' : 'x')).slice(-6);
    p.qa = now; // 마지막으로 문제에 나온 때 (골고루 내기용)
    delete p.add; // '복습에 추가'한 단어는 한 번 나오면 일반 복습으로
    markDirty('prog:' + chunkOf(id));
  }
  const mon = t.slice(0, 7);
  App.logs[mon] = App.logs[mon] || {};
  const row = [area || 'v', ok ? 1 : 0, (ids || []).join(',')]; if (sub) row.push(String(sub).slice(0, 20));
  (App.logs[mon][t] = App.logs[mon][t] || []).push(row);
  markDirty('log:' + mon);
  if (!ok && qref) {
    App.wrong.push({ at: t, area, ids, q: qref });
    markDirty('wrong');
  }
}

/* 외울 단어 풀: 학원에서 배움·학습 중인 단어 (익힘은 빼요. 익힘은 확인할 날이 되면 복습으로 나와요) */
function learnVocab() { return allVocab().filter(v => ['a', 'l'].includes(status(v.id))).map(v => v.id); }
/* 단어장에서 직접 익힘으로 바꾸기 / 되돌리기 */
/* 카드에서 바로 상태 바꾸기: n(미학습) · l(학습 중) · m(익힘) */
function setStatus(id, to) {
  if (to === 'm') return setMastered(id, true);
  const p = ensureP(id);
  if (to === 'l') { if (p.s === 'm') { p.cs = 0; p.ms = 0; } p.s = 'l'; p.nx = App.today; p.add = App.today; }
  else { p.s = 'n'; p.cs = 0; p.ms = 0; delete p.nx; }
  markDirty('prog:' + chunkOf(canon(id)));
}
function setMastered(id, on) {
  const p = ensureP(id);
  if (on) { p.s = 'm'; p.md = App.today; p.cs = Math.max(p.cs || 0, 3); p.ms = 1; p.nx = addDays(App.today, M_INTERVALS[1]); }
  else { p.s = 'l'; p.cs = 0; p.ms = 0; p.nx = App.today; }
  markDirty('prog:' + chunkOf(canon(id)));
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
function dueCount() {
  const t = App.today; let n = 0;
  for (const chunk of Object.values(App.prog)) for (const [id, p] of Object.entries(chunk)) if (p.nx && p.nx <= t && p.s !== 'n' && p.s !== 'm' && App.byId[id] && !App.alias[id]) n++;
  return n;
}
function dueItems(limit = 12) {
  const t = App.today, out = [];
  for (const chunk of Object.values(App.prog)) for (const [id, p] of Object.entries(chunk)) {
    if (p.nx && p.nx <= t && p.s !== 'n' && p.s !== 'm' && App.byId[id] && !App.alias[id]) out.push(id);
  }
  out.sort((a, b) => (P(a).nx || '').localeCompare(P(b).nx || ''));
  return out.slice(0, limit);
}
/* 골고루 뽑기: 오래 안 나온 것 우선, 복습할 때 된 것·학습 중은 조금 더 자주, 방금 나온 건 뒤로 */
function balancedPick(ids, n) {
  const now = Date.now(), H = 3600e3, t = App.today;
  const scored = [...new Set(ids)].map(id => {
    const p = P(id) || {};
    const hrs = p.qa ? Math.min((now - p.qa) / H, 24 * 30) : 24 * 30;
    let w = hrs + 1;
    if (p.nx && p.nx <= t) w *= 2;
    if (p.s === 'l') w *= 1.5; else if (p.s === 'm') w *= 0.5;
    if (p.qa && now - p.qa < 2 * H) w *= 0.05; // 2시간 안에 나온 건 거의 안 나오게
    return [id, w * (0.6 + Math.random() * 0.8)];
  });
  scored.sort((a, b) => b[1] - a[1]);
  return scored.slice(0, n == null ? scored.length : n).map(x => x[0]);
}
/* 뜻이 겹치는지 (보기에 정답이 두 개 생기지 않게) */
const meanTok = m => String(m || '').replace(/[（(].*?[)）]/g, '').split(/[,，、·/;；]+/).map(x => x.trim()).filter(Boolean);
const meanOverlap = (a, b) => { const A = new Set(meanTok(a)); return meanTok(b).some(x => A.has(x)); };
function weakItems(n = 5) {
  const from = addDays(App.today, -14), cnt = {};
  for (const m of Object.values(App.logs)) for (const [d, arr] of Object.entries(m)) {
    if (d < from) continue;
    for (const [, ok, ids] of arr) if (!ok) for (const id of String(ids).split(',')) if (id) cnt[canon(id)] = (cnt[canon(id)] || 0) + 1;
  }
  return Object.entries(cnt).filter(([id]) => App.byId[id]).sort((a, b) => b[1] - a[1]).slice(0, n);
}

/* ---------- AI ---------- */
function aiErrorText(e) {
  const c = e?.code;
  if (c === 'not_granted') return 'AI 연결이 설정되지 않았거나 로그인이 만료됐어요.';
  if (c === 'no_key') return 'Supabase에 GEMINI_API_KEY가 설정되지 않았어요. 설치 안내서 4단계를 확인해 주세요.';
  if (c === 'network') return '연결이 잠깐 끊겨서 AI 답을 받지 못했어요 (자동으로 3번 시도했어요). 다시 눌러 주세요. 계속 이러면 설정 → AI 연결 테스트를 눌러 보세요.';
  if (c === 'timeout') return 'AI 답이 너무 오래 걸려 중간에 멈췄어요. 사진을 2~3장씩 나눠서 다시 해 보세요.';
  if (c === 'overloaded') return '지금 AI 서버에 사용자가 몰려서 모든 모델이 바빠요. 1~2분 뒤 다시 눌러 주세요.';
  if (c === 'upstream') return 'AI 서버가 응답하지 않았어요. 잠시 후 다시 시도해 주세요. (' + (e?.message || '').slice(0, 80) + ')';
  if (c === 'rate_limited') return '요청이 많아 잠시 쉬어야 해요. 조금 뒤에 다시 시도해 주세요.';
  if (c === 'invalid_json') return 'AI 응답을 읽지 못했어요. 다시 시도해 주세요. (설정 → AI 연결 테스트에서 원문을 볼 수 있어요)';
  if (c === 'truncated') return 'AI 답이 너무 길어 중간에 잘렸어요. 문항 수를 줄여 다시 시도해 주세요.';
  if (c === 'empty') return 'AI가 쓸 수 있는 문제를 만들지 못했어요. 다시 시도해 주세요.';
  if (c === 'billing') return 'Gemini 선불 잔액이 0원이에요. AI Studio → 결제에서 크레딧을 충전하면 바로 다시 돼요. (충전 후 반영까지 10분쯤 걸릴 수 있어요)';
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
function learnedContext(level = 5, max = 80) {
  // 최근 공부한 문법을 앞에 두어서, 목록이 길어도 빠지지 않게
  const recent = recentGrammar(30);
  const rest = allGrammar().filter(g => ['a', 'l', 'm'].includes(status(g.id)) && !recent.includes(g.id)).map(g => g.id);
  return [...recent, ...rest].slice(0, max).map(id => App.byId[id]?.p).filter(Boolean).join(' / ');
}
/* 최근 공부한 문법: 문제로 풀었거나(문법 문제·비교 묶음·카드) 직접 표시한 문법, 최근 것부터 */
function recentGrammar(days = 14) {
  const from = Date.now() - days * 864e5, fromDay = addDays(App.today, -days), sc = {};
  for (const g of allGrammar()) {
    const p = P(g.id); if (!p) continue;
    let t = 0;
    if (p.qa && p.qa >= from) t = p.qa;
    if (p.md && p.md >= fromDay) t = Math.max(t, new Date(p.md + 'T12:00:00').getTime());
    if (p.add && p.add >= fromDay) t = Math.max(t, new Date(p.add + 'T12:00:00').getTime());
    if (p.sv && p.sv >= fromDay) t = Math.max(t, new Date(p.sv + 'T12:00:00').getTime());
    if (t) sc[g.id] = t;
  }
  for (const [gid, e] of Object.entries(App.gs?.g || {})) {
    if (!e?.last || e.last < fromDay) continue;
    const gg = (App.G?.grammar || []).find(x => x.id === gid);
    for (const id of gg?.ids || []) sc[id] = Math.max(sc[id] || 0, new Date(e.last + 'T12:00:00').getTime());
  }
  return Object.entries(sc).filter(([id]) => App.byId[id]).sort((a, b) => b[1] - a[1]).map(([id]) => id);
}
/* ---------- 일괄 '학습 중'으로 (미학습만 바꾸고 익힘·학습 중은 그대로) ---------- */
function bulkLearn(ids) {
  let n = 0;
  for (const id of ids) {
    const p = ensureP(id);
    if ((p.s || 'n') !== 'n') continue;
    p.s = 'l'; n++; // 복습 날짜는 안 잡아요 → 오늘 세트의 '새 단어'로 조금씩 나와요
    markDirty('prog:' + chunkOf(canon(id)));
  }
  if (n) flushSaves();
  return n;
}
/* 처음 한 번: N5·N4 단어를 학습 중으로 (요청하신 일괄 변경) */
function migrateN45() {
  if (App.state.bulk45) return 0;
  const n = bulkLearn(allVocab().filter(v => v.l === 5 || v.l === 4).map(v => v.id));
  App.state.bulk45 = App.today; saveState(); flushSaves();
  if (n) toast(`N5·N4 단어 ${n}개를 학습 중으로 바꿨어요.`);
  return n;
}
/* ---------- 약점 노트 (state/focus) ----------
   내가 약한 문법 목록 + 헷갈리는 짝 → 오늘 세트 '약점 문법', 시험 탭 '약점 집중', AI 새 문제에 반영 */
App.focus = null;
async function loadFocus() {
  if (!App.db) return null;
  try {
    const s = await App.db.doc('state/focus').get();
    if (s?.exists) {
      App.focus = clone(s.data());
      // 기본 약점 목록이 새로 늘었으면(버전 업) 내 목록에 더해요 — 내가 해제한 건 다시 넣지 않아요
      try {
        const d = await fetch('data/focus.json').then(r => r.json());
        if ((App.focus.v || 1) < (d.v || 1)) {
          const off = new Set(App.focus.off || []);
          App.focus.items = [...new Set([...(App.focus.items || []), ...(d.items || []).filter(id => !off.has(id))])];
          App.focus.groups = App.focus.groups?.length ? App.focus.groups : d.groups;
          App.focus.v = d.v; saveFocus();
        }
      } catch { }
      return App.focus;
    }
  } catch { }
  // 처음: 기본 약점 노트(N5~N4 핵심 문법)로 시작
  try { const d = await fetch('data/focus.json').then(r => r.json()); App.focus = d; writeDoc('state/focus', d).catch(() => {}); } catch { App.focus = null; }
  return App.focus;
}
function saveFocus() { if (!App.focus) return; App.focus.at = App.today; return writeDoc('state/focus', clone(App.focus)).catch(() => {}); }
const focusIds = () => (App.focus?.items || []).filter(id => App.byId[id]);
const isWeak = id => (App.focus?.items || []).includes(id);
function setWeak(id, on) {
  App.focus = App.focus || { v: 1, title: '내 약점 문법', items: [], star: [], groups: [], weak: [] };
  const f = App.focus;
  f.items = on ? [...new Set([...(f.items || []), id])] : (f.items || []).filter(x => x !== id);
  f.off = on ? (f.off || []).filter(x => x !== id) : [...new Set([...(f.off || []), id])]; // 직접 해제한 건 기본 목록이 늘어도 다시 안 넣어요
  f.star = (f.star || []).filter(x => x !== id).concat(on ? [id] : []);
  f.marked = Object.assign({}, f.marked || {}, { [id]: on ? App.today : undefined }); // 언제 약점으로 표시했는지 (다음 날 아침 문제용)
  if (!on) delete f.marked[id];
  saveFocus(); App.dayDoc = null;
}
function focusGuide() {
  const ids = focusIds(); if (!ids.length) return '';
  const star = new Set(App.focus.star || []);
  const list = [...ids.filter(id => star.has(id)), ...ids.filter(id => !star.has(id))].slice(0, 24).map(id => App.byId[id].p);
  return `학습자의 약점 문법(문법 문제에 우선 출제하고, 헷갈리는 짝은 서로 오답 보기로 섞어 주세요): ${list.join(' / ')}` + ((App.focus.groups || []).length ? `\n헷갈리는 짝: ${App.focus.groups.map(g => g.join('·')).join(' / ')}` : '');
}
/* 기본 약점 문제 60개(data/focus-qs.json)를 문제 은행에 한 번만 넣어요 */
async function ensureFocusBank() {
  if (!App.db || App.banks.some(b => b.id === 'focus-n5')) return;
  try {
    const d = await fetch('data/focus-qs.json').then(r => r.json());
    const bank = { id: 'focus-n5', created: App.today, source: 'focus', title: d.title || '약점 노트', level: 5, qs: d.qs || [] };
    const cur = await App.db.doc('qbank/focus-n5').get().catch(() => null);
    if (cur?.exists) return; // 다른 기기에서 이미 넣었으면 그대로
    await writeDoc('qbank/focus-n5', bank);
    App.banks.push(bank); App.base.banks[bank.id] = clone(bank);
  } catch { }
}
/* 약점 문제 고르기: 약점 노트 문제 + 약점 문법이 들어간 문제 → 안 푼 것, 틀린 것, 오래된 것 순 */
function focusQuestions(n = 5, exclude = new Set()) {
  const set = new Set(focusIds());
  const pool = bankQuestions((q, b) => q.area === 'g' && !exclude.has(q.id) && (b.source === 'focus' || q.focus || (q.items || []).some(id => set.has(id))));
  const score = q => (q.seen ? 0 : 100) + (q.seen && (q.ok || 0) < q.seen ? 30 : 0) - (q.seen || 0) * 3 + Math.random() * 10;
  const out = pool.map(q => [q, score(q)]).sort((a, b) => b[1] - a[1]).slice(0, n).map(x => x[0]);
  return out;
}

/* 바꿔 말하기 다양화: 매번 다른 유형으로 */
const PARA_TYPES = ['반대말+부정 (広いです ＝ 狭くないです)', '반대 동작 (出かけませんでした ＝ 家にいました)', '주고받기 (友達に本を貸しました ＝ 友達は私に本を借りました)', '시간 표현 (先月 ＝ 一か月前, おととい ＝ 二日前)', '가족·관계 (父の兄 ＝ おじ)', '상태·이유 (忙しいです ＝ 時間がありません)', '쉬운 말로 풀기 (綺麗な部屋 ＝ 掃除してある部屋)', '비슷한 말 (準備 ＝ 用意)'];
function paraGuide() {
  return `言い換え類義 규칙: prompt에 문장 하나를 쓰고 바꿔 말할 부분에 [u]밑줄[/u]을 긋고, 보기 4개는 '뜻이 가장 가까운 문장(전체 문장)'으로 만드세요. 이번에는 이 유형들로 골고루: ${shuffle(PARA_TYPES.slice()).slice(0, 3).join(' / ')}. 단순한 유의어 바꾸기만 반복하지 마세요.`;
}
/* 독해 다양화: 글 종류·질문 종류를 돌려가며, 최근 지문과 비슷한 주제는 피해요 */
const READ_GENRES = ['친구에게 보낸 메모', '선생님에게 보낸 이메일', '편지', '일기', '학교·회사 안내문', '가게 광고', '아파트 게시판 공지', 'SNS 글', '여행 안내 팸플릿', '도서관 이용 안내', '아르바이트 모집 공고', '식당 메뉴와 안내', '버스·전철 시간표 안내', '자기소개 글', '날씨와 일정 알림'];
const READ_TYPES = ['밑줄 친 말(それ·これ)이 가리키는 것', '글쓴이가 그렇게 한 이유', '글의 내용과 맞는 것', '숫자·요일·시간 찾기', '글쓴이가 다음에 할 일', '정보 찾기: 조건에 맞는 것 고르기(안내문·광고·시간표)'];
function readGuide(level = 5) {
  const g = shuffle(READ_GENRES.slice()).slice(0, 3), t = shuffle(READ_TYPES.slice()).slice(0, 3);
  const recent = bankQuestions(q => q.area === 'r' && q.passage).slice(-12).map(q => plainJa(q.passage).replace(/\s/g, '').slice(0, 24)).filter(Boolean);
  return `독해 문제 규칙: 지문마다 글 종류를 다르게 하세요 (이번에 쓸 글 종류: ${g.join(', ')}). 질문도 매번 다른 종류로 (${t.join(' / ')}).
'정보 찾기(情報検索)'는 안내문·광고·시간표처럼 표나 항목이 있는 글을 passage에 쓰고, 조건에 맞는 답을 고르게 하세요.
'中文(중간 글)'을 만들면 같은 passage로 서로 다른 질문 2개를 연속으로 만들어도 좋아요.
매일 아침 일과·산책 같은 흔한 주제는 피하세요.` + (recent.length ? `\n최근에 낸 지문(이런 주제·내용은 피하세요): ${recent.join(' / ')}` : '');
}

/* ---------- question bank ---------- */
/* 문제 은행 보관: 다 풀었고 30일 지난 묶음은 qarch/로 옮겨 평소엔 안 불러와요 (단원 테스트·오답·문법 문제에서는 필요할 때 불러와요) */
let archP = null;
function loadArchive() {
  if (!App.db) return Promise.resolve();
  if (!archP) archP = App.db.collection('qarch').get().then(snap => {
    const have = new Set(App.banks.map(b => b.id));
    for (const d of snap.docs) { const b = clone(d.data()); if (b && !have.has(b.id)) { b._arch = true; App.banks.push(b); App.base.banks[b.id] = clone(d.data()); } }
  }).catch(() => { archP = null; });
  return archP;
}
async function archiveOldBanks() {
  if (!App.db) return;
  const cut = addDays(App.today, -30);
  const old = App.banks.filter(b => !b._arch && b.source !== 'focus' && b.created && b.created < cut && (b.qs || []).every(q => q.seen || q.bad)).slice(0, 10);
  for (const b of old) {
    try {
      const { _dirty, _arch, ...data } = b;
      await writeDoc('qarch/' + b.id, clone(data));
      await App.db.doc('qbank/' + b.id).delete();
      b._arch = true;
    } catch { break; }
  }
}
/* 익힘 항목만 묻는 문제는 빼요 (문법·단어 섞인 문제는 하나라도 익힘이 아니면 그대로) */
const isMastered = id => status(canon(id)) === 'm';
const onlyMastered = q => Array.isArray(q.items) && q.items.length > 0 && q.items.every(isMastered);
function bankQuestions(filter = () => true) {
  const out = [];
  for (const b of App.banks) for (const q of b.qs || []) if (!q.bad && !onlyMastered(q) && filter(q, b)) out.push(Object.assign({ bank: b.id }, q));
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
      const { _dirty, _arch, ...data } = b; const local = clone(data); const base = App.base.banks[b.id] || {};
      const baseQ = Object.fromEntries((base.qs || []).map(q => [q.id, q]));
      mergeWrite((b._arch ? 'qarch/' : 'qbank/') + b.id, cur => {
        if (!cur) return local;
        if (local.title !== base.title) cur.title = local.title;
        for (const q of local.qs || []) {
          if (same(q, baseQ[q.id])) continue;
          const rq = (cur.qs || []).find(x => x.id === q.id);
          if (rq) { for (const f of ['seen', 'ok', 'bad', 'ko', 'cko', 'chk', 'fixed', 'prompt', 'choices', 'ans', 'expl']) if (q[f] !== undefined) rq[f] = q[f]; } else (cur.qs = cur.qs || []).push(q);
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
{"area":"v|g|r|l","sub":"유형 이름(일본어, 예: 文脈規定)","items":["관련 항목 id"],"prompt":"문제 문장(일본어). 밑줄 대상은 [u]단어[/u], 빈칸은 （　　）, 文の組み立て는 ＿＿ ＿＿ ★ ＿＿ 형태","passage":"독해 지문(일본어, 독해만)","script":[{"s":"男|女|N","t":"대사(일본어, 청해만)"}],"choices":["보기1","보기2","보기3","보기4"],"ans":0,"expl":"한국어 해설 1~2문장","ko":"정답을 넣은 문제 문장(독해·청해는 질문)의 자연스러운 한국어 뜻","cko":["보기1의 한국어 뜻","보기2","보기3","보기4"]}
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
// 한 글자 한자는 문맥에 따라 읽기가 달라서(一日中의 中=じゅう, 授業中=ちゅう) 단어장 읽기로 바꾸지 않아요
const AMBIG_K = new Set([...'中日月年人間前後上下方分時生物家所内外目気行入出来']);
function fixFuri(t) {
  return cleanFuri(String(t || '').replace(FURI_RE, (all, k, r) => { if (k.length === 1) return all; const set = readMap().get(k); if (set && set.size === 1) { const only = [...set][0]; if (only !== r && /^[\u3040-\u309f]+$/.test(only)) return `{${k}|${only}}`; } return all; }));
}
/* 이미 저장된 문제의 잘못된 한 글자 읽기 정리: 빈칸·다른 한자·숫자 바로 뒤에 붙은 中·日·間 같은 접미 한자는
   읽기가 달라질 수 있어서(一日中=じゅう) 후리가나를 떼고 한자만 보여줘요 */
function cleanFuri(t) {
  return String(t || '').replace(/(（[^（）]*）|\([^()]*\)|[一-龯々〇0-9０-９]|\})\{([^{}|])\|[^{}|]+\}/g, (all, pre, k) => AMBIG_K.has(k) ? pre + k : all);
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
        if (n === 1 && AMBIG_K.has(seg[j]) && /[）)一-龯々〇0-9０-９}]/.test(j > 0 ? seg[j - 1] : (i > 0 ? '}' : ''))) break; // （　）中·一日中처럼 앞말에 붙는 中·日 등은 읽기가 달라져서 안 붙여요
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
    ok.push({ id: uid('q'), area: q.area, sub: String(q.sub || '').slice(0, 20), items: q.items, prompt: fixFuri(String(q.prompt || '').slice(0, 600)), passage: q.passage ? fixFuri(String(q.passage).slice(0, 2400)) : undefined, script: q.area === 'l' ? q.script.slice(0, 14).map(l => ({ s: String(l.s || 'N').slice(0, 2), t: fixFuri(String(l.t || '').slice(0, 300)) })) : undefined, choices: q.choices.map(c => fixFuri(String(c).slice(0, 160))), ans, expl: String(q.expl || '').slice(0, 300), ko: q.ko ? String(q.ko).slice(0, 300) : undefined, cko: Array.isArray(q.cko) && q.cko.length === 4 ? q.cko.map(x => String(x || '').slice(0, 80)) : undefined });
  }
  return ok;
}
function itemsForPrompt(ids) {
  return ids.map(id => { const it = App.byId[id]; if (!it) return ''; return it.t === 'g' ? `${id}: 문법 ${it.p} (${it.m})` : it.t === 'k' ? `${id}: 한자 ${it.c} (${it.m})` : `${id}: 단어 ${it.w}[${it.r}] (${it.m})`; }).filter(Boolean).join('\n');
}
const BG = { tasks: 0, set(text) { const el = document.getElementById('bgTask'); if (!el) return; if (text) { el.textContent = text; el.hidden = false; } else el.hidden = true; } };
async function generateQuestions({ ids, level = 5, counts, source, title, signal, onProgress }) {
  const want = counts || { '文脈規定(v)': 4, '言い換え類義(v)': 2, '文法形式の判断(g)': 6, '文の組み立て(g)': 3, '読解 内容理解 短文(r)': 2, '読解 情報検索(r)': 1, '聴解 課題理解/ポイント理解(l)': 3 };
  // 최근 공부한 문법은 꼭 출제 대상에 넣어요
  const recentG = recentGrammar(14);
  if (Object.keys(want).some(k => /\(g\)/.test(k))) ids = [...new Set([...recentG.slice(0, 4), ...shuffle(focusIds()).slice(0, 3), ...(ids || [])])];
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
${recentG.length && Object.keys(b).some(k => /\(g\)/.test(k)) ? `최근 공부한 문법(문법 문제에 우선해서 써 주세요): ${recentG.slice(0, 8).map(id => App.byId[id]?.p).filter(Boolean).join(' / ')}\n` : ''}어휘·문법 수준: N${level} 범위 안에서만.
만들 문제 (총 ${n}개): ${Object.entries(b).map(([k, v]) => `${k} ${v}개`).join(', ')}
${Object.keys(b).some(k => /\(r\)/.test(k)) ? readGuide(level) : ''}
${Object.keys(b).some(k => /言い換え/.test(k)) ? paraGuide() : ''}
${Object.keys(b).some(k => /\(g\)/.test(k)) ? focusGuide() : ''}
각 문제의 items에는 위 목록의 id 중 실제로 묻는 항목을 넣으세요.
${qSpec(level)}`;
    try {
      const arr = validateQs(await aiJSON(prompt, { signal, modelTier: 'default', async: true, kind: 'questions' }), null);
      // 만든 문제를 한 번 더 검수해서, 정답을 넣으면 문장이 틀어지는 문제 등을 고치거나 빼요
      try { return await verifyQs(arr, level, signal); } catch (e) { if (e?.code === 'cancelled') throw e; return arr; }
    }
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

/* ---------- 문제 검수: 정답을 빈칸에 넣으면 완전한 문장이 되는지, 정답이 하나뿐인지, 해설이 맞는지 ---------- */
async function verifyQs(qs, level = 5, signal) {
  qs.forEach(ruleFixQ);
  if (!qs.length || !App.sample) return qs;
  const out = [];
  for (let b = 0; b < qs.length; b += 8) {
    const chunk = qs.slice(b, b + 8);
    const list = chunk.map((q, i) => JSON.stringify({ i, type: q.sub, area: q.area, passage: q.passage ? plainJa(q.passage).slice(0, 500) : undefined, script: q.script ? q.script.map(l => l.s + ': ' + plainJa(l.t)).join(' / ').slice(0, 500) : undefined, prompt: plainJa(q.prompt), choices: q.choices.map(plainJa), ans: q.ans, expl: q.expl })).join('\n');
    const res = await aiJSON(`당신은 JLPT N${level} 문제 검수자입니다. 아래 문제를 하나씩 엄격하게 확인하세요.
확인할 것:
1) 정답 보기(ans는 0부터 시작하는 번호)를 빈칸에 넣으면 문법적으로 완전하고 자연스러운 문장이 되는가 (예: 「写真を（　）でください」에 「撮ら」를 넣으면 「撮らでください」로 틀림 → 빈칸 뒤가 「ないでください」여야 함)
2) 정답이 정확히 하나뿐인가 (다른 보기도 정답이 될 수 있으면 문제)
3) 해설(expl)이 실제 정답과 맞는가
4) 文の組み立て(★)는 네 조각을 바른 순서로 놓을 수 있고 ★ 위치의 답이 맞는가
문제가 없으면 {"i":번호,"ok":true}.
문제가 있으면 최소한으로 고친 문제를 주세요: {"i":번호,"ok":false,"why":"한국어로 짧게","fix":{"prompt":"고친 문제 문장","choices":["","","",""],"ans":0,"expl":"한국어 해설"}} (바꾼 필드만 넣어도 됨).
고칠 수 없으면 {"i":번호,"ok":false,"drop":true,"why":"..."}.
JSON 배열만 답하세요.
${list}`, { signal, modelTier: 'default', async: true, kind: 'verify' });
    const by = {}; for (const r of Array.isArray(res) ? res : []) if (r && r.i != null) by[+r.i] = r;
    chunk.forEach((q, i) => {
      const r = by[i];
      if (!r || r.ok) { out.push(Object.assign(q, { chk: 1 })); return; }
      if (r.drop || !r.fix) { if (r.drop) return; out.push(Object.assign(q, { chk: 1 })); return; }
      const fixed = applyQFix(q, r.fix);
      if (fixed) out.push(Object.assign(fixed, { chk: 1, fixed: String(r.why || '').slice(0, 100) }));
    });
  }
  return out;
}
/* 검수 결과의 수정 내용을 원래 문제에 적용 (형식이 맞지 않으면 null) */
function applyQFix(q, fix) {
  const n = Object.assign({}, q);
  if (fix.prompt) n.prompt = fixFuri(String(fix.prompt).slice(0, 600));
  if (Array.isArray(fix.choices)) { if (fix.choices.length !== 4) return null; n.choices = fix.choices.map(c => fixFuri(String(c).slice(0, 160))); }
  if (fix.ans != null) { const a = Number(fix.ans); if (!(a >= 0 && a <= 3)) return null; n.ans = a; }
  if (fix.expl) n.expl = String(fix.expl).slice(0, 300);
  if (fix.prompt || fix.choices) { delete n.ko; delete n.cko; } // 문장이 바뀌면 뜻 풀이는 다시 받아요
  return n;
}
/* 규칙으로 바로 고치는 흔한 오류: 「（　）でください」에 ない형 어간(撮ら 등)이 정답이면 빈칸 뒤에 ない가 빠진 것 */
const BLANK_NAIDE = /([（(][\s　_＿]*[）)])(\s*)(でください|で下さい|でほしい|でくれ|でね)/;
function ruleFixQ(q) {
  if (!q || !q.prompt || !Array.isArray(q.choices) || q.ans == null) return false;
  const m = String(q.prompt).match(BLANK_NAIDE); if (!m) return false;
  const a = plainJa(q.choices[q.ans]).trim(); if (!a || /(ない|ず|ん|い)$/.test(a)) return false;
  const aDan = /[あかがさざただなはばぱまやらわ]$/.test(a);
  if (!aDan && !/ない/.test(String(q.expl || ''))) return false;
  q.prompt = String(q.prompt).replace(BLANK_NAIDE, (all, b, sp, tail) => b + sp + 'ない' + tail);
  delete q.ko; delete q.cko; q.fixed = q.fixed || '빈칸 뒤에 ない가 빠져 있어서 고쳤어요'; return true;
}
/* 저장된 모든 문제에 규칙 수정 적용 (기록·진도는 그대로) */
function ruleFixBanks() {
  let n = 0;
  for (const b of App.banks) for (const q of b.qs || []) if (ruleFixQ(q)) { b._dirty = true; n++; }
  if (n) scheduleBankSave();
  return n;
}
/* 문제 은행 검수: 아직 검수하지 않은 문제를 8개씩 확인해서 고치거나 빼요 */
async function checkBank({ onProgress, all = false, limit = 0 } = {}) {
  let targets = [];
  for (const b of App.banks) for (const q of b.qs || []) if (!q.bad && (all || !q.chk)) targets.push([b, q]);
  if (limit) targets = targets.slice(-limit); // 최근 문제부터
  let fixed = 0, dropped = 0, done = 0;
  for (let i = 0; i < targets.length; i += 8) {
    const part = targets.slice(i, i + 8);
    const lv = part[0][0].level || targetLevel();
    let res;
    try { res = await verifyQs(part.map(([, q]) => clone(q)), lv); } catch (e) { if (done === 0) throw e; break; }
    const keep = new Map(res.map(q => [q.id, q]));
    for (const [b, q] of part) {
      const r = keep.get(q.id);
      if (!r) { q.bad = true; dropped++; }
      else { if (r.fixed) { Object.assign(q, { prompt: r.prompt, choices: r.choices, ans: r.ans, expl: r.expl, fixed: r.fixed }); delete q.ko; delete q.cko; fixed++; } q.chk = 1; }
      b._dirty = true;
    }
    done += part.length; scheduleBankSave(); onProgress && onProgress(done, targets.length, fixed, dropped);
  }
  return { total: targets.length, checked: done, fixed, dropped };
}

/* ---------- rule-based vocab questions ---------- */
function vocabQuestion(id, mode) {
  const it = App.byId[id]; if (!it) return null;
  if (it.t === 'g') {
    return { id: 'r' + id, area: 'g', sub: '문법 의미', items: [id], prompt: `「${it.p}」의 뜻으로 알맞은 것은?`, choices: null, _pool: allGrammar().filter(g => g.id !== id && g.m !== it.m).map(g => g.m), _ans: it.m, expl: `${it.f}\n예) ${it.ej} — ${it.ek}` };
  }
  if (it.t === 'k') {
    const pool = App.M.kanji.filter(k => k.id !== id && k.m !== it.m && (k.l >= 2 || it.l === 1)).map(k => k.m);
    return finishRule({ id: 'r' + id, area: 'v', sub: '漢字 훈음', items: [id], prompt: `한자 「${it.c}」의 뜻·음은?`, _pool: pool, _ans: it.m, expl: `음독 ${it.on || '-'} / 훈독 ${it.kun || '-'}` });
  }
  const hasKanji = /[一-龯]/.test(it.w);
  const modes = hasKanji ? ['read', 'mean', 'write', 'ko'] : ['mean', 'ko'];
  if (!(mode && modes.includes(mode))) {
    // 지난번과 다른 유형으로
    const last = (P(id) || {}).qm, rest = modes.filter(m => m !== last);
    mode = rest[Math.random() * rest.length | 0];
  }
  const same = allVocab().filter(v => v.id !== id && v.w !== it.w && v.r !== it.r && Math.abs((v.l || 5) - (it.l || 5)) <= 1 && !meanOverlap(v.m, it.m));
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
/* 문제에 나온 유형 기록 (다음엔 다른 유형으로) */
function noteMode(q) {
  if (!q?.rule || !q.items?.[0]) return;
  const m = { R: 'read', W: 'write', K: 'ko', M: 'mean' }[String(q.id).slice(-1)];
  const p = P(q.items[0]); if (m && p) p.qm = m;
}
function ruleQ(id, mode) {
  if (isMastered(id)) return null; // 익힘은 문제로 안 내요
  const q = vocabQuestion(id, mode);
  if (q && !q.choices && q._pool) return finishRule(q);
  return q;
}

/* ---------- TTS ---------- */
const TTS = {
  voices: [], ready: false, cur: null,
  init() {
    if (!('speechSynthesis' in window)) return;
    const load = () => { this.voices = speechSynthesis.getVoices().filter(v => /ja/i.test(v.lang)); this.ready = true; };
    load(); speechSynthesis.onvoiceschanged = load;
  },
  available() { return 'speechSynthesis' in window; },
  stop() { try { speechSynthesis.cancel(); } catch { } try { if (this.cur) { this.cur.pause(); this.cur = null; } } catch { } },
  // 자연스러운 음성(Natural·Online·Neural·Google)을 먼저 골라요. 설정에서 직접 고른 목소리가 있으면 그걸로
  score(v) { const n = v.name || ''; return (/natural|online|neural/i.test(n) ? 4 : 0) + (/google/i.test(n) ? 2 : 0) + (/nanami|keita|aoi|daichi|mayu|naoki|shiori/i.test(n) ? 1 : 0) + (v.localService === false ? 1 : 0); },
  isMale(v) { return /otoya|ichiro|keita|daichi|naoki|male|男/i.test(v.name || '') && !/female/i.test(v.name || ''); },
  ranked(male) { return this.voices.filter(v => male ? this.isMale(v) : !this.isMale(v)).sort((a, b) => this.score(b) - this.score(a)); },
  pick(male) {
    const want = (App.state?.voice || {})[male ? 'm' : 'f'];
    return (want && this.voices.find(v => v.name === want)) || this.ranked(male)[0] || null;
  },
  speak(lines, rate = 1, onDone) {
    this.stop();
    if (!this.available()) { onDone && onDone(false); return; }
    const vs = this.voices;
    const female = this.pick(false) || vs[0];
    const male = this.pick(true) || vs.find(v => v !== female) || vs[0];
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

/* ---------- 청해 AI 음성 (Gemini TTS) ----------
   처음 재생할 때 한 번만 만들고, 저장소에 보관해서 다음부터는 바로 재생해요. (state/audio 에 목록) */
const VOICE_SPEED = {
  5: 'JLPT N5の聴解問題のように、ゆっくり、はっきりと話す',
  4: 'JLPT N4の聴解問題のように、少しゆっくり、はっきりと話す',
  3: 'JLPT N3の聴解問題のように、自然な会話の速さで、はっきりと話す',
  2: 'JLPT N2の聴解問題のように、ふつうの会話の速さで自然に話す',
};
function voicePrefs() { return Object.assign({ mode: 'ai', speed: 3 }, App.state?.voice || {}); }
function ttsStyle() { return VOICE_SPEED[voicePrefs().speed] || VOICE_SPEED[3]; }
function hashStr(str) { let a = 0x811c9dc5, b = 5381; for (const ch of str) { const x = ch.codePointAt(0); a = Math.imul(a ^ x, 16777619) >>> 0; b = (Math.imul(b, 33) ^ x) >>> 0; } return a.toString(36) + b.toString(36); }
function ttsKey(script) { return 'v1n' + voicePrefs().speed + '_' + hashStr(JSON.stringify(script.map(l => [l.s, plainJa(l.t)]))); }
let audioIdxP = null;
function audioIndex() {
  if (!audioIdxP) audioIdxP = App.db ? App.db.doc('state/audio').get().then(sn => (sn.exists ? (sn.data().items || {}) : {})).catch(() => { audioIdxP = null; return {}; }) : Promise.resolve({});
  return audioIdxP;
}
const audioMaking = {};
async function aiAudioFor(script) {
  if (!App.sample?.tts) throw { code: 'not_granted' };
  const key = ttsKey(script);
  const idx = await audioIndex();
  let rec = idx[key], fresh = false;
  if (!rec) {
    // 같은 문제를 동시에 두 번 만들지 않게
    if (!audioMaking[key]) audioMaking[key] = App.sample.tts(script.map(l => ({ s: l.s, t: plainJa(l.t) })), { key, style: ttsStyle() })
      .then(r => { const x = { p: r.path, s: r.sec || 0, at: App.today, m: r.model || '' }; idx[key] = x; mergeWrite('state/audio', cur => ({ items: Object.assign({}, cur?.items || {}, { [key]: x }) })).catch(() => {}); return x; })
      .finally(() => { delete audioMaking[key]; });
    rec = await audioMaking[key]; fresh = true;
  }
  return { url: await App.sample.audioUrl(rec.p), fresh, sec: rec.s };
}
async function audioUsage(month) {
  month = month || App.today.slice(0, 7);
  const idx = await audioIndex();
  const list = Object.values(idx).filter(r => String(r.at || '').startsWith(month));
  const sec = list.reduce((a, r) => a + (r.s || 0), 0);
  const rate = App.today < '2027-01-01' ? 0.0135 : 0.027; // 1분당 대략 (2027년부터 2배)
  return { n: list.length, sec, cost: sec / 60 * rate, total: Object.keys(idx).length };
}

/* ---------- 숫자 페이지 넘기기: ‹ 1 2 3 … 9 › ---------- */
function pager(total, per, cur, onGo, label = '개') {
  const pages = Math.ceil(total / per);
  if (pages <= 1) return null;
  const go = p => { if (p < 0 || p >= pages || p === cur) return; onGo(p); };
  const nums = new Set([0, pages - 1, cur - 1, cur, cur + 1].filter(p => p >= 0 && p < pages));
  if (cur <= 2) [1, 2, 3].forEach(p => p < pages && nums.add(p));
  if (cur >= pages - 3) [pages - 2, pages - 3, pages - 4].forEach(p => p >= 0 && nums.add(p));
  const list = [...nums].sort((a, b) => a - b);
  const btns = []; let prev = -1;
  for (const p of list) { if (p - prev > 1) btns.push(h('span', { class: 'pg-gap' }, '…')); btns.push(h('button', { class: 'pg-n' + (p === cur ? ' on' : ''), onclick: () => go(p) }, String(p + 1))); prev = p; }
  const from = cur * per + 1, to = Math.min(total, (cur + 1) * per);
  return h('div', { class: 'pager' },
    h('button', { class: 'pg-a', disabled: cur === 0, 'aria-label': '이전', onclick: () => go(cur - 1) }, '‹'), ...btns,
    h('button', { class: 'pg-a', disabled: cur === pages - 1, 'aria-label': '다음', onclick: () => go(cur + 1) }, '›'),
    h('span', { class: 'pg-info' }, `${total}${label} 중 ${from}–${to}`));
}
const scrollTop = el => { try { const y = el.getBoundingClientRect().top + window.scrollY - 16; if (y < window.scrollY) window.scrollTo({ top: y, behavior: 'smooth' }); } catch { } };

/* ---------- 유의어·반대말 ----------
   기본 자료(data/related.json, N5·N4 핵심) + AI가 찾아 저장한 것(custom/related) */
let _rel = null;
function relIndex() {
  if (_rel) return _rel;
  const m = {}; const add = (a, k, b, extra) => { (m[a] = m[a] || { ant: [], syn: [], pairs: [] })[k].includes(b) || m[a][k].push(b); if (extra) m[a].pairs.push(extra); };
  for (const p of App.RELDATA?.ant || []) { add(p.a, 'ant', p.b, p); add(p.b, 'ant', p.a, p); }
  for (const [a, b] of App.RELDATA?.syn || []) { add(a, 'syn', b); add(b, 'syn', a); }
  return (_rel = m);
}
App.relAI = null; // { id: { syn:[{w,r,m}], ant:[{w,r,m}] } }
async function loadRelAI() {
  if (App.relAI) return App.relAI;
  App.relAI = {};
  try { const s = await App.db?.doc('custom/related').get(); if (s?.exists) App.relAI = clone(s.data().items || {}); } catch { }
  return App.relAI;
}
/* 한 단어의 비슷한 말·반대말 → [{id?, w, r, m}] */
function relatedOf(id) {
  const r = relIndex()[canon(id)] || { ant: [], syn: [] }, ai = App.relAI?.[canon(id)] || {};
  const fromIds = ids => ids.map(x => App.byId[x]).filter(Boolean).map(v => ({ id: v.id, w: v.w.split(/[;；]/)[0], r: v.r, m: v.m }));
  const merge = (a, b) => { const out = [...a]; for (const x of b || []) if (x?.w && !out.some(y => y.w === x.w)) out.push(x); return out.slice(0, 4); };
  return { syn: merge(fromIds(r.syn), ai.syn), ant: merge(fromIds(r.ant), ai.ant) };
}
async function fetchRelAI(it) {
  const r = await aiJSON(`일본어 단어 「${it.w}」(${it.r}, 뜻: ${it.m})의 비슷한 말과 반대말을 JLPT N5~N3 수준 단어로 알려 주세요. 자연스럽게 바꿔 쓸 수 있는 것만, 없으면 빈 배열.
JSON만: {"syn":[{"w":"표기","r":"히라가나","m":"한국어 뜻"}],"ant":[{"w":"표기","r":"히라가나","m":"한국어 뜻"}]} (각 최대 3개)`, { modelTier: 'quick' });
  const clean = a => (Array.isArray(a) ? a : []).filter(x => x && x.w && x.w !== it.w).slice(0, 3).map(x => { const v = matchVocab(String(x.w), String(x.r || '')); return v ? { id: v.id, w: v.w.split(/[;；]/)[0], r: v.r, m: v.m } : { w: String(x.w).slice(0, 20), r: String(x.r || '').slice(0, 30), m: String(x.m || '').slice(0, 40) }; });
  const entry = { syn: clean(r?.syn), ant: clean(r?.ant), at: App.today };
  await loadRelAI(); App.relAI[canon(it.id)] = entry;
  mergeWrite('custom/related', cur => { const d = cur || { items: {} }; (d.items = d.items || {})[canon(it.id)] = entry; return d; }).catch(() => {});
  return entry;
}
/* 후리가나: 広い(ひろい) → {広|ひろ}い */
function furiOf(w, r) {
  w = String(w).split(/[;；]/)[0]; r = String(r || '').split(/[;；]/)[0];
  if (!/[一-龯々]/.test(w) || !r) return w;
  let k = 0; while (k < w.length && k < r.length && w[w.length - 1 - k] === r[r.length - 1 - k] && /[ぁ-ん]/.test(w[w.length - 1 - k])) k++;
  const kan = w.slice(0, w.length - k), rd = r.slice(0, r.length - k), tail = w.slice(w.length - k);
  return /^[一-龯々]+$/.test(kan) ? `{${kan}|${rd}}${tail}` : w;
}
/* 형용사 부정형: 広い→広くない, いい→よくない, 静か→静かじゃない */
function adjNeg(v, kind) {
  const w = v.w.split(/[;；]/)[0], r = v.r.split(/[;；]/)[0];
  if (kind === 'na') return furiOf(w, r) + 'じゃない';
  if (w === 'いい') return 'よくない';
  return furiOf(w.slice(0, -1), r.slice(0, -1)) + 'くない';
}
const adjKind = (p, id) => p.t === 'i' || p.t === 'na' ? p.t : p.t === 'i-na' ? (id === p.a ? 'i' : 'na') : p.t === 'na-i' ? (id === p.a ? 'na' : 'i') : null;
const PARA_DOMAINS = [['広い', '狭い', '大きい', '小さい'], ['暑い', '寒い', '熱い', '冷たい', '温かい', '涼しい'], ['早い', '遅い', '速い'], ['易しい', '難しい', '簡単'], ['楽しい', 'つまらない', '面白い'], ['多い', '少ない'], ['高い', '安い', '低い'], ['静か', 'にぎやか', 'うるさい'], ['いい', '悪い', '綺麗', '汚い'], ['忙しい', '暇']];
/* 바꿔 말하기(言い換え類義) 문제: 반대말 + ない = 같은 뜻 (広いです ＝ 狭くないです) */
function paraQuestion(id) {
  id = canon(id);
  const pairs = (relIndex()[id]?.pairs || []).filter(p => p.f && adjKind(p, id));
  if (!pairs.length) return synQuestion(id);
  const p = pairs[Math.random() * pairs.length | 0];
  const oid = p.a === id ? p.b : p.a, X = App.byId[id], Y = App.byId[oid];
  if (!X || !Y) return null;
  const kx = adjKind(p, id), ky = adjKind(p, oid);
  const pos = (v, k) => furiOf(v.w, v.r) + (k === 'na' ? '' : '');
  // 헷갈리게 하되 정답이 둘이 되지 않게: 뜻이 가까운 영역(크기·온도·속도 등)의 형용사는 오답으로 안 써요
  const dom = x => { const w = App.byId[x]?.w.split(/[;；]/)[0] || ''; return PARA_DOMAINS.findIndex(d => d.includes(w)); };
  const myDom = new Set([dom(id), dom(oid)].filter(d => d >= 0));
  const others = (App.RELDATA?.ant || []).filter(q => q.f && q !== p && q.a !== id && q.b !== id && !myDom.has(dom(q.a)) && !myDom.has(dom(q.b)));
  const z = others[Math.random() * others.length | 0]; const zid = z ? (Math.random() < .5 ? z.a : z.b) : null; const Z = App.byId[zid];
  const right = p.f + adjNeg(Y, ky) + 'です。';
  const wrong = [p.f + pos(Y, ky) + 'です。', p.f + adjNeg(X, kx) + 'です。', Z ? p.f + adjNeg(Z, adjKind(z, zid)) + 'です。' : null].filter(Boolean);
  const choices = shuffle([right, ...wrong]).slice(0, 4);
  while (choices.length < 4) choices.push('—');
  const wy = Y.w.split(/[;；]/)[0], wx = X.w.split(/[;；]/)[0];
  return { id: 'pq' + id + oid, area: 'v', sub: '言い換え類義', items: [id, oid], rule: 1,
    prompt: p.f + '[u]' + pos(X, kx) + 'です[/u]。\n밑줄 친 부분과 뜻이 가장 가까운 것은?', choices, ans: choices.indexOf(right),
    expl: `${wx}(${X.m}) = ${wy}(${Y.m})의 반대 → 「${wy}」에 ない를 붙이면 「${wx}」와 같은 뜻이에요.` };
}
/* 비슷한 말 고르기 (문장 틀이 없는 단어) */
function synQuestion(id) {
  const X = App.byId[id]; if (!X || X.t !== 'v') return null;
  const syn = relatedOf(id).syn.filter(s => s.id && App.byId[s.id]); if (!syn.length) return null;
  const S = App.byId[syn[Math.random() * syn.length | 0].id];
  const pool = shuffle(allVocab().filter(v => v.id !== X.id && v.id !== S.id && Math.abs((v.l || 0) - (X.l || 0)) <= 1 && v.m !== S.m)).slice(0, 3);
  const cs = shuffle([S, ...pool]);
  return { id: 'sq' + id, area: 'v', sub: '言い換え類義', items: [id], rule: 1, prompt: `[u]${furiOf(X.w, X.r)}[/u]와 뜻이 가장 가까운 말은?`,
    choices: cs.map(v => furiOf(v.w, v.r)), ans: 0 + cs.indexOf(S), expl: `${X.w.split(/[;；]/)[0]}(${X.m}) ≒ ${S.w.split(/[;；]/)[0]}(${S.m})` };
}
/* 문제 묶음 안의 단어 일부를 바꿔 말하기 문제로 (최대 n개) */
function mixPara(qs, n = 3) {
  let left = n;
  return qs.map(q => {
    if (left <= 0 || !q || q.area !== 'v' || !q.rule || !q.items?.length) return q;
    const id = q.items[0]; if (!relIndex()[canon(id)] || isMastered(id)) return q;
    const pq = paraQuestion(id); if (!pq) return q;
    left--; return pq;
  });
}

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
    const gsSnap = await db.doc('state/groups').get().catch(() => null);
    App.gs = gsSnap?.exists ? clone(gsSnap.data()) : { k: {}, g: {} };
    App.state = st.exists ? clone(st.data()) : {};
    App.wrong = wr.exists ? clone(wr.data().list || []) : [];
    App.drill = dr.exists ? clone(dr.data().list || []) : [];
    App.base.state = clone(App.state); App.base.wrongLen = App.wrong.length;
    App.base.drill = Object.fromEntries(App.drill.map(d => [d.id, clone(d)]));
    if (cu.exists) { const d = cu.data(); App.custom = { vocab: [...(d.vocab || [])], grammar: [...(d.grammar || [])], alias: d.alias || {} }; registerCustom(); }
    for (const d of progSnap.docs) { App.prog[d.id] = clone(d.data().items || {}); App.base.prog[d.id] = clone(d.data().items || {}); }
    App.lessons = lessons.docs.map(d => ({ id: d.id, ...JSON.parse(JSON.stringify(d.data())) }));
    App.memos = memos.docs.map(d => ({ id: d.id, ...JSON.parse(JSON.stringify(d.data())) }));
    const arch = App.banks.filter(b => b._arch && !banks.docs.some(d => d.id === b.id));
    App.banks = banks.docs.map(d => ({ id: d.id, ...clone(d.data()) })).concat(arch);
    App.base.banks = Object.assign(Object.fromEntries(arch.map(b => [b.id, App.base.banks?.[b.id] || clone(b)])), Object.fromEntries(banks.docs.map(d => [d.id, clone(d.data())])));
    for (const d of logs.docs) { App.logs[d.id] = clone(d.data().days || {}); App.base.logs[d.id] = clone(d.data().days || {}); }
    buildAliases();
    App.loadedAt = Date.now(); App.loadFailed = false;
  } catch (e) { App.loadFailed = true; throw e; } finally { clearTimeout(timeout); $('#netNote')?.classList.remove('show'); }
}
function saveCustom() {
  const local = clone({ vocab: App.custom.vocab, grammar: App.custom.grammar });
  return mergeWrite('custom/items', cur => {
    const out = { vocab: cur?.vocab || [], grammar: cur?.grammar || [], alias: cur?.alias || {} };
    for (const k of ['vocab', 'grammar']) for (const it of local[k]) { const i = out[k].findIndex(x => x.id === it.id); if (i >= 0) out[k][i] = it; else out[k].push(it); }
    return out;
  }).then(m => { if (m) { App.custom = { vocab: m.vocab, grammar: m.grammar, alias: m.alias || {} }; registerCustom(); buildAliases(); } return m; });
}
function saveState() { markDirty('state'); }
