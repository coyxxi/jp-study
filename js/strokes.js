/* 일본어 공부방 · 한자 획순 (데이터: KanjiVG, CC BY-SA 3.0 · kanjivg.tagaini.net) */
'use strict';
const STROKE_CACHE = {};
function loadStrokes(level) {
  const l = [5, 4, 3, 2, 1].includes(level) ? level : 1;
  if (!STROKE_CACHE[l]) STROKE_CACHE[l] = fetch(`data/strokes-${l}.json`).then(r => { if (!r.ok) throw 0; return r.json(); }).catch(e => { delete STROKE_CACHE[l]; throw e; });
  return STROKE_CACHE[l];
}
async function strokeData(k) {
  for (const l of [k.l, 5, 4, 3, 2, 1]) { try { const d = await loadStrokes(l); if (d[k.c]) return d[k.c]; } catch { } }
  return null;
}
const SVGNS = 'http://www.w3.org/2000/svg';
const svgEl = (tag, attrs = {}) => { const e = document.createElementNS(SVGNS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };

/* 획순 보기: 한 획씩 그려지는 애니메이션 + 한 획씩 넘기기 + 따라 쓰기 */
function strokeBox(k, { size = 220, autoplay = true, practice = true, strip = false } = {}) {
  const wrap = h('div', { class: 'stroke' });
  const stage = h('div', { class: 'stk-stage', style: `width:${size}px;height:${size}px` }, h('div', { class: 'muted sm stk-load' }, '획순 불러오는 중…'));
  const info = h('div', { class: 'stk-info muted sm' });
  const ctrl = h('div', { class: 'stk-ctrl' });
  wrap.append(stage, info, ctrl);
  strokeData(k).then(d => {
    stage.innerHTML = '';
    if (!d) { stage.append(h('div', { class: 'muted sm stk-load' }, '이 한자는 획순 자료가 없어요.')); return; }
    const n = d.p.length;
    const svg = svgEl('svg', { viewBox: '0 0 109 109', width: size, height: size, class: 'stk-svg' });
    // 십자 안내선
    const guide = svgEl('g', { class: 'stk-guide' });
    guide.append(svgEl('line', { x1: 54.5, y1: 2, x2: 54.5, y2: 107 }), svgEl('line', { x1: 2, y1: 54.5, x2: 107, y2: 54.5 }));
    const ghost = svgEl('g', { class: 'stk-ghost' });
    const ink = svgEl('g', { class: 'stk-ink' });
    const nums = svgEl('g', { class: 'stk-nums' });
    const paths = d.p.map((pd, i) => { ghost.append(svgEl('path', { d: pd })); const p = svgEl('path', { d: pd, class: d.r?.includes(i) ? 'rad' : '' }); ink.append(p); return p; });
    d.n.forEach(([x, y], i) => { const t = svgEl('text', { x, y }); t.textContent = i + 1; nums.append(t); });
    svg.append(guide, ghost, ink, nums);
    stage.append(svg);
    const lens = paths.map(p => { const L = p.getTotalLength ? p.getTotalLength() : 200; p.style.strokeDasharray = L; return L; });
    let shown = 0, timer = null, playing = false;
    const numEls = [...nums.children];
    function render(animIdx = -1) {
      paths.forEach((p, i) => {
        p.style.transition = 'none';
        p.style.strokeDashoffset = i < shown ? 0 : lens[i];
        p.classList.toggle('cur', i === shown - 1);
        numEls[i].style.opacity = i < shown ? 1 : 0;
      });
      if (animIdx >= 0) {
        const p = paths[animIdx];
        p.style.strokeDashoffset = lens[animIdx];
        p.getBoundingClientRect(); // 리플로우 후 애니메이션 시작
        p.style.transition = `stroke-dashoffset ${Math.max(0.35, lens[animIdx] / 120)}s ease-in-out`;
        p.style.strokeDashoffset = 0;
      }
      info.textContent = `총 ${n}획 · ${shown}/${n}` + (d.r?.length ? ' · 빨간 선 = 부수' : '');
    }
    function stop() { clearTimeout(timer); playing = false; playBtn.textContent = '▶ 다시 보기'; }
    function play() {
      stop(); shown = 0; render(); playing = true; playBtn.textContent = '⏸ 멈춤';
      const step = () => { if (!playing) return; if (shown >= n) { stop(); return; } shown++; render(shown - 1); timer = setTimeout(step, Math.max(450, lens[shown - 1] / 120 * 1000) + 150); };
      timer = setTimeout(step, 250);
    }
    const playBtn = h('button', { class: 'btn sm', onclick: () => playing ? stop() : play() }, '▶ 다시 보기');
    const prev = h('button', { class: 'btn ghost sm', onclick: () => { stop(); shown = Math.max(0, shown - 1); render(); } }, '◀ 이전 획');
    const next = h('button', { class: 'btn ghost sm', onclick: () => { stop(); if (shown < n) { shown++; render(shown - 1); } } }, '다음 획 ▶');
    const all = h('button', { class: 'btn ghost sm', onclick: () => { stop(); shown = n; render(); } }, '전체');
    ctrl.append(prev, playBtn, next, all);
    if (practice) ctrl.append(h('button', { class: 'btn ghost sm', onclick: () => practicePad(k, d) }, '✍️ 따라 쓰기'));
    // 1획부터 끝까지 단계별 작은 그림 (누르면 그 단계로)
    if (strip) {
      const st = h('div', { class: 'stk-strip' });
      d.p.forEach((_, j) => {
        const sv = svgEl('svg', { viewBox: '0 0 109 109', width: 40, height: 40 });
        const gh = svgEl('g', { class: 'stk-ghost' }), ik = svgEl('g', { class: 'stk-ink' });
        d.p.forEach((pd, i) => { gh.append(svgEl('path', { d: pd })); if (i <= j) ik.append(svgEl('path', { d: pd, class: i === j ? 'cur' : '' })); });
        sv.append(gh, ik);
        st.append(h('button', { class: 'stk-step', title: (j + 1) + '획', onclick: () => { stop(); shown = j + 1; render(j); } }, sv));
      });
      wrap.append(st);
    }
    if (autoplay) play(); else { shown = n; render(); }
  }).catch(() => { stage.innerHTML = ''; stage.append(h('div', { class: 'muted sm stk-load' }, '획순을 불러오지 못했어요.')); });
  return wrap;
}

/* 따라 쓰기: 흐린 글자 위에 손가락·마우스로 써 보기 (채점은 하지 않아요) */
function practicePad(k, d) {
  const size = Math.min(300, window.innerWidth - 60);
  const box = h('div', { class: 'stk-pad', style: `width:${size}px;height:${size}px` });
  const svg = svgEl('svg', { viewBox: '0 0 109 109', width: size, height: size, class: 'stk-svg' });
  const guide = svgEl('g', { class: 'stk-guide' });
  guide.append(svgEl('line', { x1: 54.5, y1: 2, x2: 54.5, y2: 107 }), svgEl('line', { x1: 2, y1: 54.5, x2: 107, y2: 54.5 }));
  const ghost = svgEl('g', { class: 'stk-ghost' }); d.p.forEach(pd => ghost.append(svgEl('path', { d: pd })));
  svg.append(guide, ghost);
  const cv = h('canvas', { width: size * 2, height: size * 2, style: `width:${size}px;height:${size}px` });
  box.append(svg, cv);
  const ctx = cv.getContext('2d'); ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = size / 30; ctx.strokeStyle = '#B34A6B';
  let drawing = false, count = 0;
  const pos = e => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) * 2, (e.clientY - r.top) * 2]; };
  cv.addEventListener('pointerdown', e => { drawing = true; cv.setPointerCapture(e.pointerId); const [x, y] = pos(e); ctx.beginPath(); ctx.moveTo(x, y); e.preventDefault(); });
  cv.addEventListener('pointermove', e => { if (!drawing) return; const [x, y] = pos(e); ctx.lineTo(x, y); ctx.stroke(); e.preventDefault(); });
  const end = () => { if (drawing) { drawing = false; count++; cnt.textContent = `쓴 획 ${count} / ${d.p.length}획`; } };
  cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
  const cnt = h('div', { class: 'muted sm' }, `쓴 획 0 / ${d.p.length}획`);
  let hidden = false;
  const m = modal(h('div', { class: 'stk-practice' }, h('h2', {}, `「${k.c}」 따라 쓰기`), h('p', { class: 'muted sm' }, '획순 순서대로 흐린 글자 위에 써 보세요. 익숙해지면 흐린 글자를 끄고 써 보세요.'), box, cnt,
    h('div', { class: 'row tight gap' },
      h('button', { class: 'btn ghost sm', onclick: () => { ctx.clearRect(0, 0, cv.width, cv.height); count = 0; cnt.textContent = `쓴 획 0 / ${d.p.length}획`; } }, '지우기'),
      h('button', { class: 'btn ghost sm', onclick: e => { hidden = !hidden; ghost.style.opacity = hidden ? 0 : ''; e.currentTarget.textContent = hidden ? '흐린 글자 보기' : '흐린 글자 끄기'; } }, '흐린 글자 끄기'),
      h('button', { class: 'btn sm', onclick: () => m.close() }, '닫기'))));
}

/* 획순 창 (묶음 카드·카드 공부에서) */
function showStrokes(k) {
  modal(h('div', { class: 'stk-modal' }, h('div', { class: 'row' }, h('h2', {}, h('span', { class: 'jp-serif', lang: 'ja' }, k.c), ' ', h('small', { class: 'muted' }, k.m))),
    strokeBox(k, { size: Math.min(260, window.innerWidth - 80) }),
    h('p', { class: 'muted sm stk-credit' }, '획순 자료: KanjiVG (CC BY-SA 3.0)')));
}
