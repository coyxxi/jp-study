/* 일본어 공부방 · 시험 중 단어 찾기 */
'use strict';
const KANJI_RE = /[一-龯々]/;
function kanjiInfo(c) { return App.M.kanji.find(k => k.c === c); }
function findWords(q) {
  q = plainJa(q).trim().replace(/[。、．，,.!?！？「」『』（）()\s]/g, '');
  if (!q) return [];
  const all = allVocab();
  const norm = w => w.split(/[;；]/)[0].trim().replace(/^[～〜]/, '');
  const exact = all.filter(v => norm(v.w) === q || v.r === q);
  if (exact.length) return exact.concat(all.filter(v => !exact.includes(v) && norm(v.w).startsWith(q)).slice(0, 4));
  // 활용형(眠かった, 寝よう 등) → 앞의 한자 부분으로 사전형 찾기
  const stem = (q.match(/^[一-龯々]+[぀-ゟ]?/) || [])[0];
  if (stem) {
    for (let n = stem.length; n >= 1; n--) {
      const s = stem.slice(0, n);
      const hit = all.filter(v => norm(v.w).startsWith(s) && KANJI_RE.test(s));
      if (hit.length) return hit.sort((a, b) => norm(a.w).length - norm(b.w).length).slice(0, 6);
    }
  }
  const ko = all.filter(v => v.m && v.m.includes(q));
  if (ko.length) return ko.slice(0, 6);
  return all.filter(v => norm(v.w).includes(q) || (v.r || '').includes(q)).slice(0, 6);
}

function makeLookup() {
  const looked = []; // {id?, w, r, m, added}
  const input = h('input', { type: 'text', lang: 'ja', placeholder: '단어 검색 (일본어·한국어)', 'aria-label': '단어 검색' });
  const resBox = h('div', { class: 'lk-res' }, h('div', { class: 'lk-tip' }, '지문이나 문제에서 단어를 드래그하거나, 보기를 길게 누르면 바로 찾아요.'));
  const histBox = h('div', { class: 'lk-hist' });
  const panel = h('aside', { class: 'lookup' },
    h('div', { class: 'lk-head' }, h('b', {}, '단어 찾기'), h('button', { class: 'lk-close', 'aria-label': '닫기', onclick: () => panel.classList.remove('open') }, '✕')),
    h('div', { class: 'lk-search' }, h('span', {}, '🔍'), input, h('button', { class: 'lk-clr', 'aria-label': '지우기', onclick: () => { input.value = ''; render(''); input.focus(); } }, '✕')),
    resBox, histBox);
  const fab = h('button', { class: 'lk-fab', onclick: () => { panel.classList.add('open'); setTimeout(() => input.focus(), 50); } }, '🔍 단어 찾기');
  let t = null;
  input.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => render(input.value), 220); });
  input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) { clearTimeout(t); render(input.value); } });

  function addToReview(id) {
    const p = ensureP(id);
    if (p.s === 'n' || p.s === 'a') p.s = 'l';
    if (p.s === 'm') { p.s = 'l'; p.c = 0; }
    p.nx = addDays(App.today, 1);
    markDirty('prog:' + chunkOf(id));
    const hx = looked.find(x => x.id === id); if (hx) hx.added = true;
    drawHist();
  }
  function remember(it) {
    if (!looked.find(x => x.w === it.w)) looked.unshift({ id: it.id, w: it.w, r: it.r, m: it.m, added: false });
    drawHist();
  }
  function wordCard(it) {
    const st = it.id ? status(it.id) : 'n';
    const ex = it.id ? App.EX.find(e => e.j.includes(it.w)) : null;
    const ks = [...new Set([...(it.w || '')].filter(c => KANJI_RE.test(c)))].map(kanjiInfo).filter(Boolean);
    const add = h('button', { class: 'btn sm', onclick: () => { if (!it.id) return; addToReview(it.id); add.textContent = '복습에 추가됨'; add.disabled = true; flushSaves(); } }, '복습에 추가');
    return h('div', { class: 'lk-card' },
      h('div', { class: 'lk-w' }, h('b', { lang: 'ja' }, it.w), it.r && it.r !== it.w ? h('span', { lang: 'ja' }, it.r) : null, h('button', { class: 'say', onclick: () => TTS.speak([{ s: 'N', t: it.w }]) }, '🔈')),
      h('div', { class: 'lk-m' }, it.m),
      h('div', { class: 'chips' }, it.l ? h('span', { class: 'chip c-gray' }, 'N' + it.l) : null, h('span', { class: 'chip ' + STATUS_CLS[st] }, STATUS[st]), it.src ? h('span', { class: 'chip c-blue' }, it.src) : null),
      it.n ? h('div', { class: 'muted sm' }, it.n) : null,
      ex ? h('div', { class: 'lk-ex' }, h('span', { lang: 'ja' }, ex.j), h('small', {}, ex.k)) : null,
      ks.length ? h('div', { class: 'lk-kanji' }, ks.map(k => h('span', {}, h('b', { lang: 'ja' }, k.c), k.m))) : null,
      it.id ? h('div', { class: 'row tight gap' }, add, h('button', { class: 'btn ghost sm', onclick: () => itemDetail(App.byId[it.id]) }, '단어장에서 보기')) : null);
  }
  function render(q) {
    resBox.innerHTML = '';
    q = String(q || '').trim();
    if (!q) { resBox.append(h('div', { class: 'lk-tip' }, '지문이나 문제에서 단어를 드래그하거나, 보기를 길게 누르면 바로 찾아요.')); return; }
    const hits = findWords(q);
    if (hits.length) {
      resBox.append(wordCard(hits[0])); remember(hits[0]);
      if (hits.length > 1) resBox.append(h('div', { class: 'lk-more' }, '비슷한 단어', hits.slice(1, 5).map(v => h('button', { onclick: () => { input.value = v.w; render(v.w); } }, h('b', { lang: 'ja' }, v.w), ' ', h('span', { class: 'muted' }, v.m)))));
    } else resBox.append(h('div', { class: 'lk-tip' }, `"${plainJa(q)}"은(는) 단어장에 없어요.`));
    if (App.sample) {
      const ask = h('button', { class: 'linkbtn', onclick: async () => {
        const done = busy(ask, 'AI가 찾는 중…');
        try {
          const r = await aiJSON(`일본어 학습자가 문제를 풀다가 모르는 표현을 찾고 있어요: 「${plainJa(q)}」
사전형으로 바꿔 설명하세요. JSON만: {"w":"사전형 표기","r":"히라가나 읽기","m":"한국어 뜻(짧게)","level":"N5|N4|N3|N2|N1","note":"활용형이었다면 원래 형태와 쓰임 한 줄"}`, { modelTier: 'quick' });
          if (!r || !r.w) throw { code: 'invalid_json' };
          const m = matchVocab(r.w, r.r);
          const it = m || { w: String(r.w), r: String(r.r || ''), m: String(r.m || ''), l: +(String(r.level || '').replace(/\D/g, '')) || 0, n: String(r.note || '') };
          resBox.innerHTML = ''; resBox.append(wordCard(it));
          if (!m) {
            const save = h('button', { class: 'btn sm', onclick: () => { const id = addCustomVocab({ w: it.w, r: it.r, m: it.m, level: 'N' + it.l }); if (App.custom._dirty) { delete App.custom._dirty; saveCustom().catch(() => {}); } it.id = id; addToReview(id); flushSaves(); save.textContent = '단어장·복습에 추가됨'; save.disabled = true; } }, '단어장에 추가하고 복습');
            resBox.append(h('div', { class: 'row tight' }, save));
          }
          remember(it);
        } catch (e) { toast(aiErrorText(e), 'err'); done(); }
      } }, hits.length ? '원하는 단어가 아니면 AI에게 뜻 물어보기' : 'AI에게 뜻 물어보기');
      resBox.append(h('div', { class: 'lk-ai' }, ask));
    }
  }
  function drawHist() {
    histBox.innerHTML = '';
    if (!looked.length) return;
    histBox.append(h('div', { class: 'lk-hh' }, '이번 시험에서 찾아본 단어', h('span', {}, `${looked.length}개`)),
      ...looked.slice(0, 12).map(x => h('button', { class: 'lk-hrow', onclick: () => { input.value = x.w; render(x.w); } }, h('b', { lang: 'ja' }, x.w), h('span', {}, x.m + (x.added ? ' · 복습 추가됨' : '')))));
  }
  function search(text) {
    text = plainJa(text).trim();
    if (!text || text.length > 20 || !/[぀-ヿ一-龯]/.test(text)) return;
    input.value = text; render(text);
    if (window.matchMedia('(max-width: 900px)').matches) panel.classList.add('open');
  }
  function bindSelection(root) {
    const pickSel = () => {
      const sel = window.getSelection(); if (!sel || sel.isCollapsed) return;
      if (!root.contains(sel.anchorNode)) return;
      if (sel.anchorNode.parentElement?.closest('.lookup')) return;
      search(sel.toString().replace(/\s/g, ''));
    };
    root.addEventListener('mouseup', () => setTimeout(pickSel, 10));
    root.addEventListener('touchend', () => setTimeout(pickSel, 350));
  }
  return { panel, fab, search, bindSelection, looked, addToReview };
}
