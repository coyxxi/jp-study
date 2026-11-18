/* 일본어 공부방 · 한자 묶음 공부 · 문법 비교 묶음 (매일 하나씩, 묶음 단위 복습) */
'use strict';
const GROUP_TYPE = { sound: '같은 음', shape: '비슷한 모양', radical: '같은 부수', meaning: '같은 뜻' };
const GROUP_CLS = { sound: 'c-blue', shape: 'c-red', radical: 'c-amber', meaning: 'c-green' };
const G_INTERVALS = [1, 3, 7, 14, 30, 60];

/* ---------- 묶음 진도 (state/groups: { k: {묶음id: {c, nx, last, n, ok}}, g: {...} }) ---------- */
const gsOf = (kind, id) => (App.gs?.[kind] || {})[id] || null;
function saveGS(kind, id, entry) {
  App.gs = App.gs || { k: {}, g: {} };
  (App.gs[kind] = App.gs[kind] || {})[id] = entry;
  return mergeWrite('state/groups', cur => { const d = cur || {}; (d[kind] = d[kind] || {})[id] = entry; return d; }).catch(() => {});
}
function gsLabel(kind, id) {
  const e = gsOf(kind, id);
  if (!e) return ['새로', 'c-gray'];
  if (e.nx <= App.today) return ['복습할 때', 'c-amber'];
  if ((e.c || 0) >= 4) return ['익힘', 'c-green'];
  return [`${daysBetween(App.today, e.nx)}일 뒤 복습`, 'c-blue'];
}
/* 묶음 퀴즈 결과로 다음 복습일 정하기: 80% 이상 맞히면 간격을 늘리고, 아니면 내일 다시 */
function gradeGroup(kind, id, ok, n) {
  if (!n) return;
  const e = Object.assign({ c: 0, n: 0, ok: 0 }, gsOf(kind, id) || {});
  const good = ok / n >= 0.8;
  e.c = good ? Math.min((e.c || 0) + 1, G_INTERVALS.length) : 0;
  e.nx = addDays(App.today, good ? G_INTERVALS[e.c - 1] : 1);
  e.last = App.today; e.n = (e.n || 0) + n; e.ok = (e.ok || 0) + ok;
  saveGS(kind, id, e);
}

/* ---------- 순서: 시험 레벨(쉬운 것)부터, 학원에서 배운 한자·문법이 많은 묶음 먼저 ---------- */
function groupOrder(kind) {
  const list = kind === 'k' ? (App.G?.kanji || []) : (App.G?.grammar || []);
  const learned = g => g.ids.filter(id => ['a', 'l', 'm'].includes(status(id))).length / Math.max(1, g.ids.length);
  const tOrd = { meaning: 0, shape: 1, radical: 2, sound: 3 };
  return list.slice().sort((a, b) => (b.l - a.l) || (learned(b) - learned(a)) || ((tOrd[a.t] || 0) - (tOrd[b.t] || 0)));
}
function dueGroups(kind) {
  const list = kind === 'k' ? (App.G?.kanji || []) : (App.G?.grammar || []);
  return list.filter(g => { const e = gsOf(kind, g.id); return e && e.nx <= App.today; }).sort((a, b) => gsOf(kind, a.id).nx.localeCompare(gsOf(kind, b.id).nx));
}
/* 오늘 할 묶음: 새 묶음 1개 + 복습할 때가 된 묶음 (한자는 최대 2개 같이) */
function pickDailyGroup(kind, exclude = []) {
  const ex = new Set(exclude);
  const due = dueGroups(kind).filter(g => !ex.has(g.id));
  const fresh = groupOrder(kind).find(g => !gsOf(kind, g.id) && !ex.has(g.id));
  const main = fresh || due[0];
  if (!main) return null;
  const rev = due.filter(g => g.id !== main.id).slice(0, kind === 'k' ? 2 : 1).map(g => g.id);
  return { gid: main.id, rev, fresh: !!fresh && main === fresh };
}
const findGroup = (kind, id) => (kind === 'k' ? App.G?.kanji : App.G?.grammar)?.find(g => g.id === id) || null;

/* ---------- 한자 묶음 카드 ---------- */
let kLevel = null;
function groupWords(c, n = 2) {
  if (!kLevel) { kLevel = {}; for (const k of App.M.kanji) kLevel[k.c] = k.l; }
  // 다른 한자가 어렵지 않은 단어 (N5·N4 한자만)를 우선, ～가 붙은 접사는 빼요
  const easy = w => [...w.w].every(ch => !/[一-龯]/.test(ch) || ch === c || (kLevel[ch] || 0) >= 4);
  return allVocab().filter(w => w.w.includes(c) && w.w.length <= 4 && !/^[～〜]/.test(w.w) && w.r && !/[～〜]/.test(w.r)).sort((a, b) => {
    const la = ['a', 'l', 'm'].includes(status(a.id)) ? 1 : 0, lb = ['a', 'l', 'm'].includes(status(b.id)) ? 1 : 0;
    return (easy(b) - easy(a)) || (lb - la) || ((b.l || 0) - (a.l || 0)) || a.w.length - b.w.length;
  }).slice(0, n);
}
function kanjiGroupCard(g) {
  const ks = g.ids.map(id => App.byId[id]).filter(Boolean);
  const grid = h('div', { class: 'kggrid' });
  let panel = null, openC = null;
  // 한자를 누르면 그 줄 바로 아래에 획순이 펼쳐져요 (다시 누르면 접혀요)
  function toggle(k, tile) {
    $$('.kgk', grid).forEach(t => t.classList.remove('sel'));
    if (panel) { panel.remove(); panel = null; }
    if (openC === k.c) { openC = null; return; }
    openC = k.c; tile.classList.add('sel');
    const tiles = $$('.kgk', grid), cols = Math.max(1, getComputedStyle(grid).gridTemplateColumns.split(' ').length);
    const idx = tiles.indexOf(tile), last = tiles[Math.min(tiles.length - 1, Math.floor(idx / cols) * cols + cols - 1)];
    panel = h('div', { class: 'kgpanel' },
      h('div', { class: 'row' }, h('b', {}, h('span', { class: 'jp-serif', lang: 'ja' }, k.c), ' 획순 ', h('small', { class: 'muted' }, k.m)), h('button', { class: 'btn ghost sm', onclick: () => toggle(k, tile) }, '접기 ▲')),
      strokeBox(k, { size: Math.min(200, window.innerWidth - 90), strip: true }),
      h('p', { class: 'muted sm stk-credit' }, '획순 자료: KanjiVG (CC BY-SA 3.0)'));
    last.after(panel);
    panel.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
  for (const k of ks) {
    const cnt = h('b', { class: 'kcnt' });
    const tile = h('div', { class: 'kgk st-' + status(k.id), role: 'button', tabindex: 0, title: '눌러서 획순 보기' },
      h('span', { class: 'kghint' }, '눌러서 획순'),
      h('div', { class: 'kc jp-serif', lang: 'ja' }, k.c),
      h('div', { class: 'km' }, k.m),
      h('div', { class: 'kr', lang: 'ja' }, [k.on && '음 ' + k.on.split('・')[0], k.kun && '훈 ' + k.kun.split('・')[0].replace(/[.-]/g, '')].filter(Boolean).join(' · '), ' · ', cnt),
      h('div', { class: 'kw' }, groupWords(k.c).map(w => h('div', {}, h('span', { lang: 'ja' }, w.w), h('small', { lang: 'ja' }, w.r !== w.w ? ' ' + w.r : ''), h('small', {}, ' ' + w.m)))));
    tile.addEventListener('click', e => { if (e.target.closest('.kgpanel')) return; toggle(k, tile); });
    tile.addEventListener('keydown', e => { if (e.key === 'Enter') toggle(k, tile); });
    strokeData(k).then(d => { if (d) cnt.textContent = d.p.length + '획'; }).catch(() => {});
    grid.append(tile);
  }
  return h('div', { class: 'kgcard' },
    h('div', { class: 'row' }, h('div', {}, h('span', { class: 'chip ' + GROUP_CLS[g.t] }, GROUP_TYPE[g.t]), ' ', h('b', { class: 'kgtitle' }, g.title)), g.key ? h('span', { class: 'kgkey jp-serif', lang: 'ja', title: '공통 부분' }, g.key) : null),
    h('div', { class: 'kgtip' }, '💡 ', g.tip), grid);
}

/* ---------- 한자 묶음 퀴즈: 같은 묶음 안에서 고르게 해서 구별하는 힘을 길러요 ---------- */
function kanjiGroupQuestions(g, max = 8) {
  const ks = g.ids.map(id => App.byId[id]).filter(Boolean);
  const qs = [];
  const fill = (opts, pool) => { for (const x of shuffle(pool)) { if (opts.length >= 4) break; if (x && !opts.includes(x)) opts.push(x); } return opts; };
  const allMeanings = App.M.kanji.filter(k => k.l >= 2).map(k => k.m);
  for (const k of shuffle(ks)) {
    const others = ks.filter(x => x !== k);
    const word = groupWords(k.c, 3).find(w => /[一-龯]/.test(w.w));
    // ① 표기: 읽기를 보고 같은 묶음 한자 중 맞는 글자 고르기
    if (word) {
      const variants = [...new Set(others.map(o => word.w.split(k.c).join(o.c)))].filter(v => v !== word.w);
      if (variants.length >= 1) {
        const opts = fill([word.w, ...variants.slice(0, 3)], []);
        while (opts.length < 4) { const r = App.M.kanji[Math.random() * App.M.kanji.length | 0]; const v = word.w.split(k.c).join(r.c); if (!opts.includes(v)) opts.push(v); }
        const choices = shuffle(opts);
        qs.push({ id: 'kg' + k.id + 'W', area: 'v', sub: '表記 · 묶음', items: [k.id], prompt: `[u]${word.r}[/u]（${word.m}）를 한자로 쓰면?`, choices, ans: choices.indexOf(word.w), expl: `${word.w}（${word.r}）= ${word.m} · ${k.c} ${k.m}`, rule: 1, kg: g.id });
      }
    }
    // ② 뜻·음: 같은 묶음의 다른 한자 뜻을 오답으로
    const opts = fill([k.m, ...others.map(o => o.m)].filter((x, i, a) => a.indexOf(x) === i).slice(0, 4), allMeanings);
    const choices = shuffle(opts);
    qs.push({ id: 'kg' + k.id + 'M', area: 'v', sub: '漢字 훈음 · 묶음', items: [k.id], prompt: `한자 「${k.c}」의 뜻·음은?`, choices, ans: choices.indexOf(k.m), expl: `${k.c} ${k.m} · 음 ${k.on || '-'} / 훈 ${k.kun || '-'}`, rule: 1, kg: g.id });
    // ③ 읽기: 단어 읽기 (같은 묶음 단어 읽기를 오답으로)
    if (word && Math.random() < 0.6) {
      const rp = others.map(o => groupWords(o.c, 1)[0]?.r).filter(r => r && r !== word.r);
      const ro = fill([word.r, ...new Set(rp)].slice(0, 4), mutateReading(word.r).concat(allVocab().filter(v => Math.abs(v.r.length - word.r.length) <= 1).slice(0, 300).map(v => v.r)));
      const ch = shuffle(ro);
      qs.push({ id: 'kg' + k.id + 'R', area: 'v', sub: '漢字読み · 묶음', items: [k.id], prompt: `[u]${word.w}[/u]의 읽는 법은?`, choices: ch, ans: ch.indexOf(word.r), expl: `${word.w}（${word.r}）= ${word.m}`, rule: 1, kg: g.id });
    }
  }
  return shuffle(qs).slice(0, max);
}

/* ---------- 문법 비교 카드 · 문제 ---------- */
function grammarGroupCard(gg) {
  return h('div', { class: 'ggcard' },
    h('div', {}, h('span', { class: 'chip c-blue' }, '문법 비교'), ' ', h('b', { class: 'kgtitle' }, gg.title)),
    h('div', { class: 'ggrows' }, gg.rows.map(r => h('div', { class: 'ggrow' },
      h('div', { class: 'ggp', lang: 'ja' }, r.p),
      h('div', {}, h('div', { class: 'gguse' }, r.use), h('div', { class: 'ggex', lang: 'ja', html: fmtPrompt(r.ex) }), h('small', { class: 'muted' }, r.ko))))));
}
/* 예문을 조사 단위로 나눠 순서 맞추기(★) 문제 만들기 */
function chunkSentence(s) {
  s = String(s || '').replace(/[。！？]$/, '');
  const parts = s.match(/.+?(?:は|が|を|に|で|へ|と|も|から|まで|より|、|ので|のに|ても|たら|ば|て)(?=.)|.+$/g) || [];
  const out = [];
  for (const x of parts.map(x => x.replace(/^、/, '')).filter(Boolean)) { if (x.length < 2 && out.length) out[out.length - 1] += x; else out.push(x); } // 'す'처럼 한 글자는 앞에 붙여요
  while (out.length > 4) { let bi = 0, bl = 1e9; for (let i = 0; i < out.length - 1; i++) { const l = out[i].length + out[i + 1].length; if (l < bl) { bl = l; bi = i; } } out.splice(bi, 2, out[bi] + out[bi + 1]); }
  return out.length === 4 && new Set(out).size === 4 ? out : null;
}
function orderQuestion(gid, gram) {
  const ch = chunkSentence(gram.ej); if (!ch) return null;
  const star = 2; // ＿＿ ＿＿ ★ ＿＿
  const choices = shuffle(ch.slice());
  return { id: 'go' + gram.id, area: 'g', sub: '文の組み立て', items: [gram.id], prompt: `＿＿ ＿＿ ★ ＿＿ 。\n（${gram.ek}）\n★에 들어갈 것은?`, choices, ans: choices.indexOf(ch[star]), expl: `${gram.ej}\n${gram.ek}\n${gram.p}: ${gram.m}`, rule: 1, gg: gid };
}
function grammarGroupQuestions(gg) {
  const qs = gg.quiz.map((q, i) => {
    const order = shuffle([0, 1, 2, 3]);
    const choices = order.map(j => q.c[j]);
    return { id: 'gq' + gg.id + i, area: 'g', sub: '文法形式の判断', items: gg.ids, prompt: q.q, choices, ans: order.indexOf(q.a), expl: q.w, gg: gg.id };
  });
  for (const id of gg.ids.slice(0, 2)) { const g = App.byId[id]; const oq = g && orderQuestion(gg.id, g); if (oq) qs.push(oq); }
  return qs;
}

/* ---------- 결과 반영: 묶음별 정답률로 다음 복습일 ---------- */
function gradeFromResults(res, qs) {
  const acc = {};
  qs.forEach((q, i) => { if (q.retry) return; const key = q.kg ? 'k|' + q.kg : q.gg ? 'g|' + q.gg : null; if (!key) return; const a = acc[key] = acc[key] || [0, 0]; a[1]++; if (res[i]?.ok) a[0]++; });
  for (const [key, [ok, n]] of Object.entries(acc)) { const [kind, id] = key.split('|'); gradeGroup(kind, id, ok, n); }
}

/* ---------- 묶음 하나 공부 → 문제 ---------- */
function studyKanjiGroup(gid, opts = {}) {
  const g = findGroup('k', gid); if (!g) return toast('묶음을 찾지 못했어요.');
  const o = opts.overlay || overlay('한자 묶음');
  const revGroups = (opts.rev || []).map(id => findGroup('k', id)).filter(Boolean);
  const body = o.body; body.innerHTML = '';
  body.append(kanjiGroupCard(g));
  if (revGroups.length) body.append(h('p', { class: 'muted sm' }, `복습 묶음도 같이 나와요: ${revGroups.map(x => x.title).join(', ')}`));
  body.append(h('div', { class: 'row end' }, h('button', { class: 'btn ghost', onclick: () => { o.close(); opts.onExit && opts.onExit(); } }, '나중에'),
    h('button', { class: 'btn', onclick: () => {
      const qs = kanjiGroupQuestions(g, 8).concat(...revGroups.map(x => kanjiGroupQuestions(x, 3)));
      runQuiz(body, qs, { onExit: () => { o.close(); opts.onExit && opts.onExit(); }, onFinish: (res, list) => { gradeFromResults(res, list); opts.onFinish && opts.onFinish(); }, onDone: () => { o.close(); opts.onDone && opts.onDone(); }, doneText: opts.doneText });
    } }, '외웠어요, 문제 풀기 →')));
  return o;
}
function studyGrammarGroup(gid, opts = {}) {
  const gg = findGroup('g', gid); if (!gg) return toast('묶음을 찾지 못했어요.');
  const o = opts.overlay || overlay('문법 비교');
  const body = o.body; body.innerHTML = '';
  body.append(grammarGroupCard(gg));
  const items = gg.ids.map(id => App.byId[id]).filter(Boolean);
  if (items.length) body.append(h('details', { class: 'mean' }, h('summary', {}, '각 문법 자세히'), h('div', { class: 'mean-b' }, items.map(it => h('div', {}, h('b', { lang: 'ja' }, it.p), ' ', it.m, h('div', { class: 'muted sm' }, it.f), h('div', { class: 'sm', lang: 'ja' }, it.ej, h('small', { class: 'muted' }, ' — ' + it.ek)))))));
  body.append(h('div', { class: 'row end' }, h('button', { class: 'btn ghost', onclick: () => { o.close(); opts.onExit && opts.onExit(); } }, '나중에'),
    h('button', { class: 'btn', onclick: () => {
      runQuiz(body, grammarGroupQuestions(gg), { onExit: () => { o.close(); opts.onExit && opts.onExit(); }, onFinish: (res, list) => { gradeFromResults(res, list); opts.onFinish && opts.onFinish(); }, onDone: () => { o.close(); opts.onDone && opts.onDone(); }, doneText: opts.doneText });
    } }, '비교했어요, 문제 풀기 →')));
  return o;
}

/* ---------- 묶음 목록 (공부 탭) ---------- */
function groupList(kind) {
  const o = overlay(kind === 'k' ? '한자 묶음 공부' : '비슷한 문법 비교');
  const back = () => groupList(kind);
  const list = groupOrder(kind);
  const due = dueGroups(kind).length, done = list.filter(g => gsOf(kind, g.id)).length;
  o.body.append(h('p', { class: 'muted' }, `전체 ${list.length}묶음 · 공부한 묶음 ${done} · 오늘 복습할 묶음 ${due}`,
    kind === 'k' ? h('br') : null, kind === 'k' ? '매일 오늘 세트에 새 묶음 1개와 복습 묶음이 나와요. 여기서는 원하는 묶음을 골라 더 할 수 있어요.' : null));
  const types = kind === 'k' ? ['', 'sound', 'shape', 'radical', 'meaning'] : [''];
  let cur = '';
  const tabs = kind === 'k' ? h('div', { class: 'tabs' }, types.map(t => h('button', { class: t === cur ? 'on' : '', onclick: e => { cur = t; $$('.tabs button', o.body).forEach(b => b.classList.toggle('on', b === e.currentTarget)); draw(); } }, t ? GROUP_TYPE[t] : '전체'))) : null;
  const box = h('div', { class: 'glist' });
  if (tabs) o.body.append(tabs);
  o.body.append(box);
  function draw() {
    box.innerHTML = '';
    for (const g of list.filter(x => !cur || x.t === cur)) {
      const [lab, cls] = gsLabel(kind, g.id);
      const prev = kind === 'k' ? g.ids.map(id => App.byId[id]?.c).join('') : g.rows.map(r => r.p).join(' / ');
      box.append(h('button', { class: 'pickrow', onclick: () => { o.close(); (kind === 'k' ? studyKanjiGroup : studyGrammarGroup)(g.id, { onDone: back, onExit: back, doneText: '목록으로' }); } },
        h('b', {}, h('span', { class: 'chip ' + (kind === 'k' ? GROUP_CLS[g.t] : 'c-blue') }, kind === 'k' ? GROUP_TYPE[g.t] : 'N' + g.l), ' ', g.title),
        h('span', { class: 'gprev', lang: 'ja' }, prev), h('span', { class: 'chip ' + cls }, lab)));
    }
  }
  draw();
}
