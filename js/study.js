/* 일본어 공부방 · 공부 탭 (단어장 · 한자 · 문법) */
'use strict';
const LV_OPTS = [['', '전 레벨'], ['5', 'N5'], ['4', 'N4'], ['3', 'N3'], ['2', 'N2'], ['0', '기타']];
const ST_OPTS = [['', '전 상태'], ['due', '오늘 복습'], ['learn', '외울 것 (배움·학습 중)'], ...Object.entries(STATUS)];
const sel = (opts, val) => h('select', {}, opts.map(([k, n]) => h('option', { value: k, selected: String(k) === String(val ?? '') }, n)));
const studyPrefs = (() => { try { return JSON.parse(localStorage.getItem('jp.study') || '{}'); } catch { return {}; } })();
const savePrefs = () => { try { localStorage.setItem('jp.study', JSON.stringify(studyPrefs)); } catch { } };
function statusMatch(id, f) {
  if (!f) return true;
  const p = P(id) || {};
  if (f === 'due') return p.nx && p.nx <= App.today;
  if (f === 'learn') return ['a', 'l'].includes(p.s || 'n');
  return (p.s || 'n') === f;
}
function priority(ids) {
  const rank = id => { const p = P(id) || {}; if (p.nx && p.nx <= App.today) return 0; return { l: 1, a: 2, n: 3, m: 4 }[p.s || 'n']; };
  return shuffle(ids).sort((a, b) => rank(a) - rank(b));
}
function grammarCore(p) {
  const s = String(p || '').replace(/[（(].*?[)）]/g, '').replace(/[〜～]/g, ' ');
  return s.split(/[\s・／/、]+/).filter(t => t.length >= 2).sort((a, b) => b.length - a.length)[0] || '';
}
function examplesFor(it, n = 4) {
  const key = it.t === 'v' ? it.w : it.t === 'k' ? it.c : grammarCore(it.p);
  if (!key) return [];
  return App.EX.filter(e => e.j.includes(key)).slice(0, n);
}
function sayBtn(text) { return h('button', { class: 'say', title: '듣기', onclick: e => { e.stopPropagation(); TTS.speak([{ s: 'N', t: text }]); } }, '🔈'); }

function renderStudy(v, sub = 'vocab') {
  v.append(pageHead('공부', '단어장 · 한자 · 문법을 보고, 카드로 외우고, 바로 확인해요',
    segTabs([['vocab', '단어장'], ['kanji', '한자'], ['grammar', '문법']], sub, k => nav('study', k))));
  ({ vocab: studyVocab, kanji: studyKanji, grammar: studyGrammar })[sub](v);
}

/* ---------- 단어장 ---------- */
function studyVocab(v) {
  const pf = studyPrefs.vocab = studyPrefs.vocab || { lv: String(targetLevel()), st: '', src: '' };
  const q = h('input', { placeholder: '단어, 읽기, 뜻 검색…', value: pf.q || '' });
  const fLv = sel(LV_OPTS, pf.lv), fSt = sel(ST_OPTS, pf.st);
  const srcOpts = [['', '전체 출처'], ['lesson-all', '학원 수업에서 나온 단어'], ['memo', '회화 모임에서 모른 단어'], ['sheet', '기존 시트 단어'], ...App.lessons.slice(0, 30).map(L => ['L:' + L.id, '수업 · ' + (L.unit || L.date)])];
  const fSrc = sel(srcOpts, pf.src);
  const info = h('div', { class: 'studybar' });
  const grid = h('div', { class: 'wgrid' });
  const more = h('button', { class: 'linkbtn' }, '더 보기');
  v.append(h('div', { class: 'card' }, h('div', { class: 'search' }, q, fLv, fSt, fSrc), info, grid, more));
  let rows = [], page = 0;
  const memoIds = () => new Set(App.memos.flatMap(m => (m.entries || []).map(e => e.id).filter(Boolean)));
  function compute() {
    Object.assign(pf, { q: q.value, lv: fLv.value, st: fSt.value, src: fSrc.value }); savePrefs();
    const s = q.value.trim().toLowerCase();
    let srcSet = null;
    if (fSrc.value === 'lesson-all') srcSet = new Set(App.lessons.flatMap(L => L.vocabIds || []));
    else if (fSrc.value === 'memo') srcSet = memoIds();
    else if (fSrc.value.startsWith('L:')) srcSet = new Set(App.lessons.find(L => 'L:' + L.id === fSrc.value)?.vocabIds || []);
    rows = allVocab().filter(it => (!fLv.value || String(it.l || 0) === fLv.value) && statusMatch(it.id, fSt.value)
      && (fSrc.value !== 'sheet' || it.src === '시트' || chunkOf(it.id) === 'WS') && (!srcSet || srcSet.has(it.id))
      && (!s || [it.w, it.r, it.m].some(x => x && String(x).toLowerCase().includes(s))));
    page = 0; draw(true);
  }
  function draw(reset) {
    if (reset) {
      grid.innerHTML = ''; info.innerHTML = '';
      const ids = rows.map(r => r.id);
      info.append(h('span', { class: 'muted' }, `${rows.length}개`),
        h('div', { class: 'row tight gap' },
          h('button', { class: 'btn sm', disabled: !rows.length, onclick: () => { const o = overlay('단어 카드'); flashcards(o.body, priority(ids).slice(0, 30), { onExit: o.close, onDone: () => { o.close(); nav('study', 'vocab'); } }); } }, '카드로 외우기'),
          h('button', { class: 'btn ghost sm', disabled: !rows.length, onclick: () => { const o = overlay('단어 카드 · 뜻 보고 떠올리기'); flashcards(o.body, priority(ids).slice(0, 30), { front: 'ko', onExit: o.close, onDone: () => { o.close(); nav('study', 'vocab'); } }); } }, '뜻 → 일본어'),
          h('button', { class: 'btn ghost sm', disabled: !rows.length, onclick: () => { const o = overlay('단어 퀴즈'); runQuiz(o.body, priority(ids).slice(0, 15).map(id => ruleQ(id)), { onExit: o.close, onDone: () => { o.close(); nav('study', 'vocab'); } }); } }, '퀴즈 15문항')));
      if (!rows.length) grid.append(h('div', { class: 'empty sm' }, '조건에 맞는 단어가 없어요.'));
    }
    for (const it of rows.slice(page * 60, page * 60 + 60)) {
      const st = status(it.id);
      grid.append(h('button', { class: 'wcard st-' + st, onclick: () => itemDetail(it, () => draw(true)) },
        h('div', { class: 'wtop' }, h('span', { class: 'ww', lang: 'ja' }, it.w), sayBtn(it.w)),
        it.r && it.r !== it.w ? h('div', { class: 'wr', lang: 'ja' }, it.r) : null,
        h('div', { class: 'wm' }, it.m),
        h('div', { class: 'wb' }, h('span', { class: 'chip ' + STATUS_CLS[st] }, STATUS[st]), h('span', { class: 'muted sm' }, it.l ? 'N' + it.l : ''))));
    }
    more.hidden = (page + 1) * 60 >= rows.length;
  }
  more.onclick = () => { page++; draw(false); };
  [q, fLv, fSt, fSrc].forEach(el => el.addEventListener('input', compute));
  compute();
}

/* ---------- 한자 ---------- */
function studyKanji(v) {
  const pf = studyPrefs.kanji = studyPrefs.kanji || { lv: String(targetLevel()), st: '' };
  const q = h('input', { placeholder: '한자, 뜻, 읽기 검색…', value: pf.q || '' });
  const fLv = sel([['', '전 레벨'], ['5', 'N5'], ['4', 'N4']], pf.lv), fSt = sel(ST_OPTS, pf.st);
  const info = h('div', { class: 'studybar' }); const grid = h('div', { class: 'kgrid' });
  v.append(h('div', { class: 'card' }, h('div', { class: 'search' }, q, fLv, fSt), info, grid));
  function compute() {
    Object.assign(pf, { q: q.value, lv: fLv.value, st: fSt.value }); savePrefs();
    const s = q.value.trim();
    const rows = App.M.kanji.filter(k => (!fLv.value || String(k.l) === fLv.value) && statusMatch(k.id, fSt.value) && (!s || [k.c, k.m, k.on, k.kun].some(x => x && x.includes(s))));
    info.innerHTML = ''; grid.innerHTML = '';
    const ids = rows.map(r => r.id);
    info.append(h('span', { class: 'muted' }, `${rows.length}자`), h('div', { class: 'row tight gap' },
      h('button', { class: 'btn sm', disabled: !rows.length, onclick: () => { const o = overlay('한자 카드'); flashcards(o.body, priority(ids).slice(0, 25), { onExit: o.close, onDone: () => { o.close(); nav('study', 'kanji'); } }); } }, '카드로 외우기'),
      h('button', { class: 'btn ghost sm', disabled: !rows.length, onclick: () => { const vids = priority(rows.flatMap(k => relatedWords(k.c).slice(0, 2).map(w => w.id))).slice(0, 15); const o = overlay('한자 읽기 퀴즈'); runQuiz(o.body, vids.map(id => ruleQ(id, 'read')).concat(pick(ids, 5).map(id => ruleQ(id))), { onExit: o.close, onDone: () => { o.close(); nav('study', 'kanji'); } }); } }, '읽기 퀴즈')));
    for (const k of rows) {
      const st = status(k.id);
      grid.append(h('button', { class: 'ktile st-' + st, onclick: () => kanjiDetail(k, compute) }, h('span', { class: 'kc jp-serif', lang: 'ja' }, k.c), h('span', { class: 'km' }, k.m)));
    }
    if (!rows.length) grid.append(h('div', { class: 'empty sm' }, '조건에 맞는 한자가 없어요.'));
  }
  [q, fLv, fSt].forEach(el => el.addEventListener('input', compute));
  compute();
}
function relatedWords(c) { return allVocab().filter(w => w.w.includes(c)).sort((a, b) => (b.l || 0) - (a.l || 0) || a.w.length - b.w.length); }
function kanjiDetail(k, after) {
  const words = relatedWords(k.c).slice(0, 24);
  const p = P(k.id) || {};
  const s = sel(Object.entries(STATUS), p.s || 'n');
  const m = modal(h('div', { class: 'kdetail' },
    h('div', { class: 'khead' }, h('div', { class: 'kbig jp-serif', lang: 'ja' }, k.c), h('div', {}, h('div', { class: 'big' }, k.m), h('div', { class: 'kv' }, h('span', {}, '음독'), h('b', { lang: 'ja' }, k.on || '-')), h('div', { class: 'kv' }, h('span', {}, '훈독'), h('b', { lang: 'ja' }, k.kun || '-')), h('span', { class: 'chip c-gray' }, 'N' + k.l))),
    h('h3', { class: 'mini' }, `이 한자가 들어간 단어 ${words.length}개`),
    words.length ? h('div', { class: 'rwords' }, words.map(w => h('div', { class: 'rw' }, h('span', { lang: 'ja', class: 'jpl' }, w.w), h('span', { lang: 'ja', class: 'muted' }, w.r), h('span', {}, w.m), h('span', { class: 'chip ' + STATUS_CLS[status(w.id)] }, STATUS[status(w.id)]), sayBtn(w.w)))) : h('div', { class: 'muted' }, '단어장에 아직 이 한자가 들어간 단어가 없어요.'),
    h('div', { class: 'row' }, h('label', {}, '상태 ', s), h('button', { class: 'btn sm', onclick: () => { const q = ensureP(k.id); q.s = s.value; if (s.value === 'm') q.c = Math.max(q.c || 0, 3); markDirty('prog:' + chunkOf(k.id)); flushSaves(); m.close(); after && after(); } }, '저장'),
      words.length ? h('button', { class: 'btn ghost sm', onclick: () => { m.close(); const o = overlay(k.c + ' 단어 퀴즈'); runQuiz(o.body, words.slice(0, 10).map(w => ruleQ(w.id, /[一-龯]/.test(w.w) ? 'read' : 'mean')), { onExit: o.close, onDone: o.close }); } }, '이 한자 단어 퀴즈') : null)));
}

/* ---------- 문법 ---------- */
function studyGrammar(v) {
  const pf = studyPrefs.grammar = studyPrefs.grammar || { lv: String(targetLevel()), st: '' };
  const q = h('input', { placeholder: '문형, 뜻 검색… (예: たことがある, ~한 적이)', value: pf.q || '' });
  const fLv = sel([['', '전 레벨'], ['5', 'N5'], ['4', 'N4'], ['3', 'N3'], ['2', 'N2'], ['0', '기타']], pf.lv), fSt = sel(ST_OPTS, pf.st);
  const info = h('div', { class: 'studybar' }); const list = h('div', { class: 'glist' });
  v.append(h('div', { class: 'card' }, h('div', { class: 'search' }, q, fLv, fSt), info, list));
  function compute() {
    Object.assign(pf, { q: q.value, lv: fLv.value, st: fSt.value }); savePrefs();
    const s = q.value.trim();
    const rows = allGrammar().filter(g => (!fLv.value || String(g.l || 0) === fLv.value) && statusMatch(g.id, fSt.value) && (!s || [g.p, g.m, g.f, g.ej].some(x => x && x.includes(s))));
    info.innerHTML = ''; list.innerHTML = '';
    const ids = rows.map(r => r.id);
    info.append(h('span', { class: 'muted' }, `${rows.length}개`), h('div', { class: 'row tight gap' },
      h('button', { class: 'btn sm', disabled: !rows.length, onclick: () => { const o = overlay('문법 카드'); flashcards(o.body, priority(ids).slice(0, 20), { onExit: o.close, onDone: () => { o.close(); nav('study', 'grammar'); } }); } }, '카드로 외우기'),
      h('button', { class: 'btn ghost sm', disabled: !rows.length, onclick: () => grammarQuiz(ids) }, '문제 풀기')));
    for (const g of rows) list.append(grammarCard(g, compute));
    if (!rows.length) list.append(h('div', { class: 'empty sm' }, '조건에 맞는 문법이 없어요.'));
  }
  [q, fLv, fSt].forEach(el => el.addEventListener('input', compute));
  compute();
}
function grammarCard(g, after) {
  const st = status(g.id);
  const body = h('div', { class: 'gbody', hidden: true });
  const el = h('div', { class: 'gcard st-' + st },
    h('button', { class: 'ghead', onclick: () => { body.hidden = !body.hidden; if (!body.hidden && !body.childElementCount) fill(); } },
      h('span', { class: 'gp', lang: 'ja' }, g.p), h('span', { class: 'gm' }, g.m), h('span', { class: 'chip c-gray' }, g.l ? 'N' + g.l : '-'), h('span', { class: 'chip ' + STATUS_CLS[st] }, STATUS[st])),
    body);
  function fill() {
    const ex = examplesFor(g, 5);
    const nb = bankQuestions(q => (q.items || []).includes(g.id)).length;
    body.append(g.f ? h('div', { class: 'box', lang: 'ja' }, g.f) : null,
      g.ej ? h('div', { class: 'ex' }, h('span', { lang: 'ja' }, g.ej), sayBtn(g.ej), h('small', {}, g.ek)) : null,
      ex.length ? h('h3', { class: 'mini' }, '내 예문에서 찾은 문장') : null,
      ...ex.map(e => h('div', { class: 'ex' }, h('span', { lang: 'ja' }, e.j), sayBtn(e.j), h('small', {}, e.k))),
      h('div', { class: 'row' },
        h('span', { class: 'muted sm' }, `이 문법 문제 ${nb}개`),
        h('div', { class: 'row tight gap' },
          h('button', { class: 'btn ghost sm', onclick: () => { const q = ensureP(g.id); q.s = q.s === 'm' ? 'l' : 'm'; if (q.s === 'm') q.c = Math.max(q.c || 0, 3); markDirty('prog:' + chunkOf(g.id)); flushSaves(); after && after(); } }, st === 'm' ? '익힘 해제' : '익힘 표시'),
          h('button', { class: 'btn sm', onclick: () => grammarQuiz([g.id]) }, '이 문법 문제 풀기'))));
  }
  return el;
}
function grammarQuiz(ids) {
  const set = new Set(ids);
  const bank = shuffle(bankQuestions(q => (q.items || []).some(id => set.has(id)))).sort((a, b) => (a.seen || 0) - (b.seen || 0)).slice(0, 12);
  const rule = priority(ids).slice(0, Math.max(3, 12 - bank.length)).map(id => ruleQ(id));
  const qs = shuffle(bank.concat(rule)).slice(0, 15);
  const o = overlay('문법 문제');
  const after = () => { o.close(); nav('study', 'grammar'); };
  runQuiz(o.body, qs, { onExit: o.close, onDone: after });
  if (bank.length < 3 && App.sample && ids.length <= 30) {
    const b = h('button', { class: 'btn ghost sm', onclick: async () => {
      const done = busy(b, 'AI가 문제 만드는 중…');
      try { const bk = await generateQuestions({ ids: ids.slice(0, 10), level: guessLevel(ids) || targetLevel(), source: 'grammar', title: '문법 연습', counts: { '文法形式の判断(g)': 6, '文の組み立て(g)': 3, '文脈規定(v)': 1 } }); toast(`문제 ${bk.qs.length}개를 만들었어요.`); runQuiz(o.body, bk.qs.map(q => ({ bank: bk.id, ...q })), { onExit: o.close, onDone: after }); }
      catch (e) { toast(aiErrorText(e), 'err'); done(); }
    } }, 'AI로 실전형 문제 만들기');
    $('.ovtitle', o.body.parentElement)?.append(' ', b);
  }
}

/* ---------- 플래시카드 ---------- */
function flashcards(root, ids, opts = {}) {
  let list = ids.map(id => App.byId[id]).filter(Boolean);
  const res = { ok: 0, no: 0, missed: [] };
  let i = 0, flipped = false;
  if (!list.length) { root.append(h('div', { class: 'empty' }, '외울 카드가 없어요.')); return; }
  const onKey = e => {
    if (!root.isConnected) { document.removeEventListener('keydown', onKey); return; }
    if (e.target.matches('input,textarea,select')) return;
    if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); flip(); }
    else if (flipped && e.key === '1') mark(false); else if (flipped && e.key === '2') later(); else if (flipped && e.key === '3') mark(true);
  };
  document.addEventListener('keydown', onKey);
  function front(it) {
    if (opts.front === 'ko') return h('div', { class: 'fc-front' }, h('div', { class: 'fc-ko' }, it.m), h('div', { class: 'muted sm' }, it.t === 'g' ? '이 뜻의 문형은?' : '일본어로 떠올려 보세요'));
    if (it.t === 'k') return h('div', { class: 'fc-front' }, h('div', { class: 'fc-k jp-serif', lang: 'ja' }, it.c));
    if (it.t === 'g') return h('div', { class: 'fc-front' }, h('div', { class: 'fc-g', lang: 'ja' }, it.p));
    return h('div', { class: 'fc-front' }, h('div', { class: 'fc-w', lang: 'ja' }, it.w));
  }
  function back(it) {
    const ex = examplesFor(it, 1)[0];
    if (it.t === 'k') {
      const ws = relatedWords(it.c).slice(0, 4);
      return h('div', { class: 'fc-back' }, h('div', { class: 'fc-m' }, it.m), h('div', { class: 'kv' }, h('span', {}, '음독'), h('b', { lang: 'ja' }, it.on || '-')), h('div', { class: 'kv' }, h('span', {}, '훈독'), h('b', { lang: 'ja' }, it.kun || '-')),
        ws.length ? h('div', { class: 'fc-rel' }, ws.map(w => h('div', {}, h('span', { lang: 'ja' }, `${w.w}（${w.r}）`), ' ', h('span', { class: 'muted' }, w.m)))) : null);
    }
    if (it.t === 'g') return h('div', { class: 'fc-back' }, opts.front === 'ko' ? h('div', { class: 'fc-g', lang: 'ja' }, it.p) : h('div', { class: 'fc-m' }, it.m), it.f ? h('div', { class: 'box', lang: 'ja' }, it.f) : null, it.ej ? h('div', { class: 'ex' }, h('span', { lang: 'ja' }, it.ej), sayBtn(it.ej), h('small', {}, it.ek)) : null);
    return h('div', { class: 'fc-back' },
      opts.front === 'ko' ? h('div', { class: 'fc-w', lang: 'ja' }, it.w) : null,
      h('div', { class: 'fc-r', lang: 'ja' }, it.r && it.r !== it.w ? it.r : '', sayBtn(it.w)),
      opts.front === 'ko' ? null : h('div', { class: 'fc-m' }, it.m),
      it.n ? h('div', { class: 'muted sm fc-n' }, it.n) : null,
      ex ? h('div', { class: 'ex' }, h('span', { lang: 'ja' }, ex.j), sayBtn(ex.j), h('small', {}, ex.k)) : null);
  }
  function show() {
    root.innerHTML = ''; flipped = false;
    const it = list[i];
    root.append(h('div', { class: 'qhead' }, opts.onExit ? h('button', { class: 'x', onclick: () => { document.removeEventListener('keydown', onKey); opts.onExit(); } }, '✕') : null,
      h('div', { class: 'qbar' }, h('div', { style: `width:${i / list.length * 100}%` })), h('span', { class: 'qn' }, `${i + 1} / ${list.length}`)));
    const st = status(it.id);
    const cardEl = h('button', { class: 'fcard', onclick: flip }, h('span', { class: 'chip ' + STATUS_CLS[st] + ' fc-st' }, STATUS[st]), front(it), h('div', { class: 'fc-hint muted sm' }, '눌러서 뒤집기 · Space'));
    root.append(cardEl, h('div', { class: 'fc-actions', hidden: true },
      h('button', { class: 'btn ghost', onclick: () => mark(false) }, '몰라요'),
      h('button', { class: 'btn ghost', onclick: later }, '다시 보기'),
      h('button', { class: 'btn', onclick: () => mark(true) }, '알아요')));
  }
  function flip() {
    if (flipped) return; flipped = true;
    const it = list[i]; const c = $('.fcard', root);
    $('.fc-hint', c)?.remove(); c.append(back(it)); c.classList.add('flipped');
    $('.fc-actions', root).hidden = false;
    if (it.t === 'v' && opts.front !== 'ko') TTS.speak([{ s: 'N', t: it.w }]);
  }
  function later() { list.push(list[i]); list.splice(i, 1); show(); }
  function mark(ok) {
    const it = list[i];
    recordAnswer([it.id], ok, it.t === 'g' ? 'g' : 'v', null);
    if (ok) res.ok++; else { res.no++; res.missed.push(it.id); }
    if (i < list.length - 1) { i++; show(); } else finish();
  }
  function finish() {
    document.removeEventListener('keydown', onKey); flushSaves();
    root.innerHTML = '';
    root.append(h('div', { class: 'result' }, h('div', { class: 'score' }, h('b', {}, `${res.ok} / ${res.ok + res.no}`), h('span', {}, '알아요')),
      res.missed.length ? h('div', {}, h('h3', { class: 'mini' }, '다시 볼 카드'), h('div', { class: 'chips' }, res.missed.map(id => h('span', { class: 'chip c-red', lang: 'ja' }, itemLabel(App.byId[id]))))) : h('p', {}, '모두 알았어요!'),
      h('div', { class: 'row end' },
        res.missed.length ? h('button', { class: 'btn ghost', onclick: () => flashcards(root, res.missed, opts) }, '모른 카드만 다시') : null,
        h('button', { class: 'btn', onclick: () => opts.onDone && opts.onDone(res) }, '완료'))));
  }
  show();
}
