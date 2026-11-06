/* 일본어 공부방 · quiz runner */
'use strict';
function fmtPrompt(s) {
  return esc(s).replace(/\[u\]([\s\S]*?)\[\/u\]/g, '<u class="tgt">$1</u>').replace(/★/g, '<span class="star">★</span>').replace(/\n/g, '<br>');
}
function qRef(q) { return q.bank ? { bank: q.bank, id: q.id } : { ...q }; }
function resolveRef(r) {
  if (!r) return null;
  if (r.bank) { const b = App.banks.find(x => x.id === r.bank); const q = b?.qs.find(x => x.id === r.id); return q ? { bank: b.id, ...q } : null; }
  if (r.rule && r.items?.[0]) return ruleQ(r.items[0]) || r;
  return r.choices ? r : null;
}

function player(q, { exam = false } = {}) {
  const wrap = h('div', { class: 'player' });
  let played = 0, rate = 1, playing = false;
  const btn = h('button', { class: 'play', 'aria-label': '재생' }, '▶');
  const wave = h('div', { class: 'wave' }, Array.from({ length: 34 }, () => h('i', { style: `height:${8 + Math.random() * 22 | 0}px` })));
  const info = h('span', { class: 'pinfo' }, exam ? '한 번만 재생' : '');
  const sp = h('div', { class: 'speed' });
  const mk = r => h('button', { class: r === rate ? 'on' : '', onclick: e => { rate = r; $$('button', sp).forEach(b => b.classList.toggle('on', b === e.currentTarget)); } }, r + '×');
  if (!exam) sp.append(mk(0.8), mk(1));
  btn.onclick = () => {
    if (playing) { TTS.stop(); playing = false; btn.textContent = '▶'; wrap.classList.remove('on'); return; }
    if (exam && played) return;
    if (!TTS.available() || !TTS.voices.length) { info.textContent = '이 기기에서는 일본어 음성을 낼 수 없어요. 스크립트를 보고 풀어 주세요.'; wrap.after(scriptBox(q)); return; }
    played++; playing = true; btn.textContent = '❚❚'; wrap.classList.add('on');
    TTS.speak(q.script, rate, () => { playing = false; btn.textContent = '▶'; wrap.classList.remove('on'); if (exam) { btn.disabled = true; info.textContent = '재생 완료'; } });
  };
  wrap.append(btn, wave, h('div', { class: 'pside' }, info, sp));
  return wrap;
}
function scriptBox(q) {
  return h('div', { class: 'script' }, h('b', {}, '스크립트'), ...(q.script || []).map(l => h('div', { lang: 'ja' }, (l.s && l.s !== 'N' ? l.s + '：' : '') + l.t)));
}

function runQuiz(root, qs, opts = {}) {
  const mode = opts.mode || 'practice';
  qs = qs.filter(Boolean);
  const res = []; let i = 0, startAt = Date.now(), timerId = null;
  root.innerHTML = '';
  const box = h('div', { class: 'quiz' });
  root.append(box);
  if (!qs.length) { box.append(h('div', { class: 'empty' }, opts.emptyText || '풀 문제가 없어요.')); return; }
  if (opts.timerMin) {
    const end = startAt + opts.timerMin * 60000;
    timerId = setInterval(() => {
      const left = Math.max(0, end - Date.now());
      const t = $('.qtimer', root); if (t) t.textContent = `${pad(left / 60000 | 0)}:${pad((left / 1000 | 0) % 60)}`;
      if (!left) { clearInterval(timerId); finish(); }
    }, 1000);
  }
  function show() {
    TTS.stop();
    const q = qs[i];
    box.innerHTML = '';
    const head = h('div', { class: 'qhead' },
      opts.onExit ? h('button', { class: 'x', onclick: () => { TTS.stop(); clearInterval(timerId); opts.onExit(); }, title: '나가기' }, '✕') : null,
      h('div', { class: 'qbar' }, h('div', { style: `width:${i / qs.length * 100}%` })),
      h('span', { class: 'qn' }, `${i + 1} / ${qs.length}`),
      opts.timerMin ? h('span', { class: 'qtimer' }, '') : null);
    const chips = h('div', { class: 'qchips' }, h('span', { class: 'chip ' + (q.area === 'l' ? 'c-red' : q.area === 'g' ? 'c-blue' : q.area === 'r' ? 'c-amber' : 'c-green') }, AREA[q.area] || ''), q.sub ? h('span', { class: 'chip c-gray', lang: 'ja' }, q.sub) : null);
    box.append(head, chips);
    if (q.passage) box.append(h('div', { class: 'passage', lang: 'ja', html: fmtPrompt(q.passage) }));
    box.append(h('div', { class: 'qprompt', lang: 'ja', html: fmtPrompt(q.prompt) }));
    if (q.area === 'l' && q.script) box.append(player(q, { exam: mode === 'exam' }));
    const list = h('div', { class: 'opts' });
    q.choices.forEach((c, k) => list.append(h('button', { class: 'opt', lang: 'ja', onclick: () => choose(k) }, h('span', { class: 'k' }, String(k + 1)), h('span', { class: 'ot' }, c))));
    box.append(list);
    const foot = h('div', { class: 'qfoot' });
    box.append(foot);
    if (mode === 'exam') {
      const prev = res[i];
      if (prev) $$('.opt', list)[prev.pick]?.classList.add('sel');
      foot.append(h('span', { class: 'muted' }, q.area === 'l' ? '실전 모드: 음성은 한 번만 들을 수 있어요' : ''),
        h('div', { class: 'row' }, i > 0 ? h('button', { class: 'btn ghost', onclick: () => { i--; show(); } }, '이전') : null,
          h('button', { class: 'btn', onclick: () => { if (res[i] == null) { toast('답을 골라 주세요.'); return; } next(); } }, i === qs.length - 1 ? '제출하고 채점' : '다음 →')));
    }
    function choose(k) {
      if (mode === 'exam') { res[i] = { pick: k }; $$('.opt', list).forEach((b, j) => b.classList.toggle('sel', j === k)); return; }
      if (res[i]) return;
      const ok = k === q.ans; res[i] = { pick: k, ok };
      recordAnswer(q.items, ok, q.area, ok ? null : qRef(q)); markSeen(q, ok);
      $$('.opt', list).forEach((b, j) => { b.disabled = true; if (j === q.ans) b.classList.add('right'); else if (j === k) b.classList.add('wrong'); });
      foot.innerHTML = '';
      const fb = h('div', { class: 'fb ' + (ok ? 'ok' : 'no') }, h('b', {}, ok ? '정답이에요.' : '아쉬워요. 정답은 ' + (q.ans + 1) + '번.'), h('div', { lang: 'ja' }, q.expl || ''));
      foot.append(fb);
      if (q.area === 'l' && q.script) foot.append(scriptBox(q));
      foot.append(h('div', { class: 'row' },
        q.bank ? h('button', { class: 'btn ghost sm', onclick: e => { reportBad(q); e.currentTarget.disabled = true; } }, '이상한 문제 신고') : h('span'),
        h('button', { class: 'btn', onclick: next }, i === qs.length - 1 ? '결과 보기' : '다음 →')));
      fb.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }
  function next() { if (i < qs.length - 1) { i++; show(); } else finish(); }
  function finish() {
    TTS.stop(); clearInterval(timerId);
    if (mode === 'exam') qs.forEach((q, k) => { const r = res[k] || { pick: -1 }; r.ok = r.pick === q.ans; res[k] = r; recordAnswer(q.items, r.ok, q.area, r.ok ? null : qRef(q)); markSeen(q, r.ok); });
    const by = {};
    qs.forEach((q, k) => { const a = by[q.area] = by[q.area] || [0, 0]; a[1]++; if (res[k]?.ok) a[0]++; });
    const right = res.filter(r => r?.ok).length;
    box.innerHTML = '';
    box.append(h('div', { class: 'result' },
      h('div', { class: 'score' }, h('b', {}, `${right} / ${qs.length}`), h('span', {}, `${Math.round(right / qs.length * 100)}%`)),
      h('div', { class: 'areas' }, Object.entries(by).map(([a, [o, n]]) => h('div', {}, h('span', {}, AREA[a]), h('div', { class: 'tr' }, h('div', { style: `width:${o / n * 100}%` })), h('b', {}, `${o}/${n}`))))));
    const wrongs = qs.map((q, k) => [q, res[k]]).filter(([, r]) => !r?.ok);
    if (wrongs.length) {
      box.append(h('h3', { class: 'sub' }, '틀린 문제 다시 보기'));
      for (const [q, r] of wrongs) box.append(h('div', { class: 'wrongcard' },
        q.passage ? h('div', { class: 'passage sm', lang: 'ja', html: fmtPrompt(q.passage) }) : null,
        h('div', { class: 'qprompt sm', lang: 'ja', html: fmtPrompt(q.prompt) }),
        h('div', { class: 'wa', lang: 'ja' }, h('span', { class: 'no' }, '내 답: ' + (r && r.pick >= 0 ? q.choices[r.pick] : '무응답')), h('span', { class: 'ok' }, '정답: ' + q.choices[q.ans])),
        q.expl ? h('div', { class: 'muted', lang: 'ja' }, q.expl) : null,
        q.script ? scriptBox(q) : null));
    }
    box.append(h('div', { class: 'row end' }, h('button', { class: 'btn', onclick: () => opts.onDone ? opts.onDone(res, qs) : null }, opts.doneText || '완료')));
    flushSaves();
    opts.onFinish && opts.onFinish(res, qs, by);
  }
  show();
}
