/* 일본어 공부방 · views */
'use strict';
const TABS = [['today', '今', '오늘'], ['study', '学', '공부'], ['record', '記', '기록'], ['test', '試', '시험'], ['talk', '話', '회화'], ['stats', '力', '내 실력']];
const DEFAULT_BOOKS = ['우키우키 상권', '우키우키 하권', '기타'];
const books = () => (App.state.books && App.state.books.length) ? App.state.books : DEFAULT_BOOKS;
const profile = () => Object.assign({ name: '일본어 공부방', sub: 'N5 → N2 · 워홀 준비' }, App.state.profile || {});
function exams() {
  if (App.state.exams && App.state.exams.length) return App.state.exams;
  return [{ name: 'JLPT N5', date: App.state.examDate || '2026-12-06', level: App.state.target || 5 }, { name: 'JLPT N2', date: '2027-07-04', level: 2 }];
}
function nextExam() { const ex = [...exams()].sort((a, b) => a.date.localeCompare(b.date)); return ex.find(e => e.date >= App.today) || ex[ex.length - 1] || { name: '시험', date: App.today, level: 5 }; }
const examDate = () => nextExam().date;
const targetLevel = () => +nextExam().level || 5;
const unitText = () => App.state.unit || '진도 미입력';
const md = s => { if (!s) return ''; const [, m, d] = s.split('-'); return `${+m}월 ${+d}일`; };

function nav(tab, sub) {
  TTS.stop(); ensureToday();
  App.tab = tab; App.sub = sub;
  try { localStorage.setItem('jp.tab', tab); } catch { }
  $$('.nav [data-tab], .tabbar [data-tab]').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  const v = $('#view'); v.innerHTML = ''; window.scrollTo(0, 0);
  ({ today: renderToday, study: renderStudy, record: renderRecord, test: renderTest, talk: renderTalk, stats: renderStats, settings: renderSettings })[tab](v, sub);
  $('#unitFoot').textContent = '학원 진도 · ' + unitText();
  const pr = profile(); const lg = $('.side .logo'); if (lg) { lg.firstChild.textContent = pr.name; $('small', lg).textContent = pr.sub; }
  document.title = pr.name;
}
function pageHead(title, subtitle, right) {
  return h('div', { class: 'top' }, h('div', {}, h('h1', {}, title), subtitle ? h('p', {}, subtitle) : null), right || null);
}
function segTabs(items, cur, onPick) {
  return h('div', { class: 'tabs' }, items.map(([k, label]) => h('button', { class: k === cur ? 'on' : '', onclick: () => onPick(k) }, label)));
}
function card(title, right, ...body) { return h('section', { class: 'card' }, title ? h('h2', {}, title, right ? h('span', {}, right) : null) : null, ...body); }
function modal(content, { wide = false } = {}) {
  const bg = h('div', { class: 'modal-bg', onclick: e => { if (e.target === bg) close(); } });
  const m = h('div', { class: 'modal' + (wide ? ' wide' : '') }, h('button', { class: 'mclose', onclick: () => close() }, '✕'), content);
  bg.append(m); document.body.append(bg);
  function close() { TTS.stop(); bg.remove(); }
  return { close, el: m };
}
function busy(btn, text) { const o = btn.textContent; btn.disabled = true; btn.textContent = text; return () => { btn.disabled = false; btn.textContent = o; }; }
function aiMissing() { return h('div', { class: 'note warn' }, 'AI 기능이 아직 연결되지 않았어요. 설치 안내서의 "AI 연결" 단계를 확인해 주세요.'); }

/* =================== TODAY =================== */
async function getDay() {
  ensureToday();
  const path = 'day/' + App.today;
  if (App.dayDoc?.date === App.today) return App.dayDoc;
  let d = null;
  if (App.db) { const s = await App.db.doc(path).get().catch(() => null); if (s?.exists) d = JSON.parse(JSON.stringify(s.data())); }
  if (!d) { d = buildDay(); if (App.db) mergeWrite(path, cur => cur || d).then(m => { if (m && m.sec && App.dayDoc === d && !Object.values(d.sec).some(x => x.done)) App.dayDoc = m; }).catch(() => {}); }
  App.dayDoc = d; return d;
}
function buildDay() {
  const due = dueCount();
  let review = dueItems(due > 12 ? Math.min(25, due) : 12); // 밀리면 최대 25개까지 늘려요
  if (review.length < 8) {
    const extra = balancedPick(allVocab().filter(v => ['a', 'l'].includes(status(v.id)) && !review.includes(v.id)).map(v => v.id), 10 - review.length);
    review = review.concat(extra);
  }
  if (review.length < 6) review = review.concat(shuffle(allVocab().filter(v => v.l === targetLevel() && status(v.id) === 'n')).slice(0, 8 - review.length).map(v => v.id));
  const last = App.lessons[0];
  const unseen = q => !q.seen;
  let lessonQ = last ? bankQuestions((q, b) => b.source === last.id && q.area !== 'l' && unseen(q)) : [];
  if (lessonQ.length < 6) lessonQ = lessonQ.concat(bankQuestions(q => q.area !== 'l' && unseen(q) && !lessonQ.find(x => x.id === q.id)));
  const listen = shuffle(bankQuestions(q => q.area === 'l' && unseen(q))).slice(0, 2);
  const drill = shuffle(App.drill.filter(d => (d.ok || 0) < 2)).slice(0, 3).map(d => d.id);
  return {
    date: App.today, round: 1, due,
    sec: {
      review: { ids: review, done: false },
      lesson: { refs: lessonQ.slice(0, 6).map(q => ({ bank: q.bank, id: q.id })), lessonIds: last ? (last.grammarIds || []).concat(last.vocabIds || []).slice(0, 12) : [], done: false },
      drill: { ids: drill, done: false },
      listen: { refs: listen.map(q => ({ bank: q.bank, id: q.id })), done: false },
    },
  };
}
/* 파트 완료 표시: 시작한 날짜의 세트에, 그 파트만 '완료'로 저장 (다른 기기·새로 불러온 세트와 섞여도 안 사라지게) */
function markSectionDone(date, key, s, round = 1) {
  s.done = true;
  if (App.dayDoc?.date === date && (App.dayDoc.round || 1) === round && App.dayDoc.sec?.[key]) App.dayDoc.sec[key].done = true;
  mergeWrite('day/' + date, cur => {
    if (cur?.sec && (cur.round || 1) !== round) return null; // 그사이 새 세트를 받았으면 건드리지 않아요
    if (!cur || !cur.sec) { const d = App.dayDoc?.date === date ? clone(App.dayDoc) : null; if (!d) return null; d.sec[key].done = true; return d; }
    if (cur.sec[key]) cur.sec[key].done = true; else cur.sec[key] = Object.assign({}, s, { done: true });
    return cur;
  }).catch(() => {});
}
function saveDay() {
  if (!App.dayDoc) return;
  const local = clone(App.dayDoc);
  // 다른 기기에서 끝낸 파트는 끝난 상태로 유지
  mergeWrite('day/' + local.date, cur => { if (!cur || !cur.sec) return local; if ((cur.round || 1) !== (local.round || 1)) return null; for (const k of Object.keys(local.sec)) { if (!cur.sec[k]) cur.sec[k] = local.sec[k]; else if (local.sec[k].done) cur.sec[k].done = true; } return cur; })
    .then(m => { if (m && App.dayDoc?.date === m.date) for (const k of Object.keys(m.sec || {})) if (m.sec[k]?.done && App.dayDoc.sec[k]) App.dayDoc.sec[k].done = true; }).catch(() => {});
}

async function renderToday(v) {
  const dd = daysBetween(App.today, examDate());
  const d = new Date();
  const wd = '일월화수목금토'[d.getDay()];
  v.append(pageHead(`${d.getMonth() + 1}월 ${d.getDate()}일 ${wd}요일, 오늘의 공부`, '학원 가기 전 30분에 맞춰 구성했어요',
    h('div', { class: 'dday' }, h('b', {}, dd > 0 ? `D-${dd}` : dd === 0 ? 'D-DAY' : '완료'), h('div', {}, nextExam().name, h('br'), md(examDate())))));
  const lr = App.state.autoGen?.lastResult;
  if (lr && lr.date === App.today) v.append(h('div', { class: 'note ' + (lr.ok ? '' : 'warn') }, lr.ok ? (lr.n ? `오늘 ${lr.at}에 새 문제 ${lr.n}개를 만들어 두었어요. 오늘 세트와 시험에 섞여 나와요.` : `오늘 아침 자동 만들기: ${lr.msg || '건너뜀'}`) : `오늘 아침 자동 문제 만들기에 실패했어요 (${lr.msg || ''}). 설정에서 "지금 한 번 만들기"를 눌러 보세요.`));
  const grid = h('div', { class: 'grid2' }); v.append(grid);
  const setCard = card('오늘의 세트', '', h('div', { class: 'muted' }, '불러오는 중…'));
  grid.append(setCard);
  // readiness
  const acc = areaAccuracy(14);
  const bars = Object.entries(AREA).map(([a, name]) => { const [o, n] = acc[a]; const p = n ? Math.round(o / n * 100) : null; return { a, name, p, n }; });
  const measured = bars.filter(b => b.p != null);
  const weakest = measured.length ? measured.reduce((x, y) => (y.p < x.p ? y : x)) : null;
  grid.append(card(`N${targetLevel()} 준비도`, '지난 2주 정답률',
    ...bars.map(b => h('div', { class: 'bar' + (weakest && b.a === weakest.a && measured.length > 1 ? ' weak' : '') }, h('div', { class: 'l' }, b.name, h('b', {}, b.p == null ? '기록 없음' : b.p + '%')), h('div', { class: 'tr' }, h('div', { style: `width:${b.p || 0}%` })))),
    weakest && measured.length > 1 ? h('div', { class: 'tip' }, `${weakest.name}이(가) 가장 낮아요. 오늘 세트와 영역 집중 시험으로 보강해 보세요.`) : h('div', { class: 'tip soft' }, '문제를 풀수록 영역별 정답률이 쌓여요. 먼저 시험 탭의 진단 모의고사를 추천해요.')));
  const g3 = h('div', { class: 'grid3' }); v.append(g3);
  // last lesson
  const L = App.lessons[0];
  g3.append(card('최근 수업 노트', L ? md(L.date) : '',
    L ? h('div', { class: 'note-mini', onclick: () => showLesson(L) },
      h('span', { class: 'chip c-blue' }, L.unit || ''), h('div', { class: 'g jp-serif', lang: 'ja' }, L.note?.title || '수업 기록'), h('div', { class: 'muted' }, L.note?.sub || ''),
      h('div', { class: 'meta' }, h('span', { class: 'chip c-gray' }, `단어 ${(L.vocabIds || []).length}`), h('span', { class: 'chip c-gray' }, `문법 ${(L.grammarIds || []).length}`), h('span', { class: 'chip c-gray' }, `예문 ${L.exCount || 0}`)),
      h('ul', {}, (L.note?.apps || []).slice(0, 3).map(a => h('li', { lang: 'ja' }, a))))
      : h('div', { class: 'empty sm' }, '아직 수업 기록이 없어요.', h('br'), h('button', { class: 'btn sm', onclick: () => nav('record') }, '첫 수업 기록하기'))));
  // status
  const st = levelStats(targetLevel());
  const seg = (k, color) => h('div', { style: `width:${st[k] / st.total * 100}%;background:${color}` });
  g3.append(card(`N${targetLevel()} 항목 학습 상태`, `전체 ${st.total}개`,
    h('div', { class: 'stack' }, seg('m', 'var(--ok)'), seg('l', 'var(--amber)'), seg('a', 'var(--blue)'), seg('n', 'var(--empty)')),
    h('div', { class: 'legend' }, [['m', '익힘', 'var(--ok)'], ['l', '학습 중', 'var(--amber)'], ['a', '학원에서 배움', 'var(--blue)'], ['n', '미학습', 'var(--empty)']].map(([k, n, c]) => h('div', {}, h('i', { style: `background:${c}` }), n, h('b', {}, st[k])))),
    h('p', { class: 'muted sm' }, '서로 다른 날 3번 연속, 또는 4번 연속 맞히면 "익힘"으로 바뀌어요')));
  // quick memo
  const ta = h('textarea', { placeholder: '모르는 단어나 말 못 한 문장을 바로 적어두세요', rows: 3 });
  const recent = App.memos.slice(0, 2);
  g3.append(card('회화 모임 메모', App.state.nextMeet ? '다음 모임 · ' + App.state.nextMeet.slice(5).replace('-', '/') : '',
    ta, h('div', { class: 'row end' }, h('button', { class: 'btn sm', onclick: async e => { const t = ta.value.trim(); if (!t) return; const done = busy(e.currentTarget, '정리 중…'); try { await saveMemo(t); ta.value = ''; nav('today'); } finally { done(); } } }, '저장')),
    recent.length ? h('div', { class: 'ex' }, '최근 메모', recent.flatMap(m => (m.entries || []).slice(0, 2).map(en => h('div', {}, jp(en.jp || ''), h('span', { class: 'muted' }, ' ' + (en.ko || '')))))) : null));

  // build set
  const day = await getDay();
  setCard.innerHTML = '';
  const sec = day.sec;
  const doneCount = Object.values(sec).filter(s => s.done).length;
  setCard.append(h('h2', {}, '오늘의 세트' + ((day.round || 1) > 1 ? ` · ${day.round}회차` : ''), h('span', {}, `${doneCount} / 4 완료`)));
  const rows = [
    ['review', `복습 단어 ${sec.review.ids.length}개`, (day.due || 0) > sec.review.ids.length && (day.round || 1) === 1 ? `밀린 복습 ${day.due}개 중 오래된 것부터` : '복습일이 된 단어·최근 틀린 항목', 'c-green', '복습', Math.max(4, sec.review.ids.length * 0.6 | 0)],
    ['lesson', (sec.lesson.refs.length || sec.lesson.lessonIds.length) ? `수업 문항 ${sec.lesson.refs.length || Math.min(6, sec.lesson.lessonIds.length)}개` : '수업 문항', App.lessons[0] ? (App.lessons[0].unit || '') + ' · ' + (App.lessons[0].note?.title || '') : '수업 기록 후 생성돼요', 'c-blue', '학원', 7],
    ['drill', `순간 작문 ${sec.drill.ids.length || 3}문장`, '한국어 → 일본어로 바로 말하기', 'c-amber', '회화', 6],
    ['listen', `청해 ${sec.listen.refs.length || 2}문항`, '음성 듣고 풀기', 'c-red', '청해', 5],
  ];
  let firstOpen = null;
  rows.forEach(([key, title, desc, cls, tag, min], idx) => {
    const s = sec[key];
    if (!s.done && !firstOpen) firstOpen = key;
    setCard.append(h('div', { class: 'srow', onclick: () => startSection(key) },
      h('div', { class: 'num' + (s.done ? ' done' : '') }, s.done ? '✓' : String(idx + 1)),
      h('div', { class: 't' }, h('b', {}, title), h('p', {}, desc)),
      h('span', { class: 'chip ' + (s.done ? 'c-green' : cls) }, s.done ? '완료' : tag), h('div', { class: 'min' }, min + '분')));
  });
  setCard.append(h('div', { class: 'setfoot' }, h('p', {}, firstOpen ? '순서대로 하면 약 25분이에요' : '오늘 세트를 모두 마쳤어요!'),
    firstOpen ? h('button', { class: 'btn', onclick: () => startSection(firstOpen) }, doneCount ? '이어서 시작 →' : '세트 시작 →') : h('div', { class: 'row tight gap' }, h('button', { class: 'btn ghost', onclick: () => nav('test') }, '시험 탭'), h('button', { class: 'btn', onclick: e => newRound(e.currentTarget) }, '새 세트 받기 →'))));
}
/* 세트를 다 풀면 같은 날에도 새 세트를 하나 더 받아요 (정답률·진도는 푼 만큼 그대로 쌓여요) */
async function newRound(btn) {
  btn.disabled = true;
  const cur = await getDay();
  const nd = buildDay(); nd.round = (cur.round || 1) + 1;
  const m = await mergeWrite('day/' + App.today, c => {
    if (c?.sec && (c.round || 1) >= nd.round) return null; // 다른 기기에서 이미 받았으면 그걸 써요
    if (c?.sec && Object.values(c.sec).some(x => !x.done)) return null;
    return nd;
  }).catch(() => null);
  App.dayDoc = null; if (m) App.dayDoc = m;
  nav('today');
}

function overlay(title) {
  const ov = h('div', { class: 'overlay' }, h('div', { class: 'ovin' }, title ? h('div', { class: 'ovtitle' }, title) : null, h('div', { class: 'ovbody' })));
  document.body.append(ov); document.body.classList.add('noscroll');
  return { body: $('.ovbody', ov), close: () => { TTS.stop(); ov.remove(); document.body.classList.remove('noscroll'); } };
}
async function startSection(key) {
  const day = await getDay(); const s = day.sec[key];
  const finish = () => markSectionDone(day.date, key, s, day.round || 1);
  if (key === 'drill') { const o = overlay('순간 작문'); drillRunner(o.body, s.ids.length ? s.ids : null, () => { finish(); o.close(); nav('today'); }, () => { o.close(); nav('today'); }); return; }
  let qs = [];
  if (key === 'review') qs = s.ids.map(id => ruleQ(id));
  // 세트를 만든 뒤에 문제 은행이 채워졌으면, 지금 있는 문제로 채워요
  const topUp = (refs, want, filter) => { const have = new Set(refs.map(r => r.id)); const add = shuffle(bankQuestions(q => !q.seen && !have.has(q.id) && filter(q))).slice(0, Math.max(0, want - refs.length)); if (add.length) { refs.push(...add.map(q => ({ bank: q.bank, id: q.id }))); saveDay(); } };
  if (key === 'lesson') { topUp(s.refs, 6, q => q.area !== 'l'); qs = s.refs.map(resolveRef).filter(Boolean); if (qs.length < 3) qs = qs.concat(s.lessonIds.slice(0, 6).map(id => ruleQ(id))); }
  if (key === 'listen') { topUp(s.refs, 2, q => q.area === 'l'); qs = s.refs.map(resolveRef).filter(Boolean); }
  qs = qs.filter(Boolean);
  if (!qs.length) {
    if (key === 'listen' || key === 'lesson') return offerGenerate(key === 'listen' ? 'l' : 'mix', () => { App.dayDoc = null; const nd = buildDay(); mergeWrite('day/' + App.today, cur => { if (cur?.sec) { nd.round = cur.round || 1; for (const k of Object.keys(nd.sec)) if (cur.sec[k]?.done) nd.sec[k] = cur.sec[k]; } return nd; }).then(() => nav('today')); });
    toast('풀 문제가 없어요.'); return;
  }
  const o = overlay({ review: '복습 단어', lesson: '수업 문항', listen: '청해' }[key]);
  runQuiz(o.body, qs, { onExit: o.close, onDone: () => { o.close(); nav('today'); }, onFinish: finish, doneText: '오늘 화면으로' });
}
function offerGenerate(kind, after) {
  const ids = pickStudyIds(targetLevel(), 14);
  const counts = kind === 'l' ? { '聴解 課題理解(l)': 2, '聴解 ポイント理解(l)': 2, '聴解 発話表現/即時応答(l)': 2 } : undefined;
  const m = modal(h('div', {}, h('h2', {}, kind === 'l' ? '청해 문제가 아직 없어요' : '문제 은행이 비어 있어요'),
    h('p', { class: 'muted' }, '배운 항목을 바탕으로 AI가 문제를 만들어 은행에 쌓아둘게요. 1~2분 걸려요.'),
    !App.sample ? aiMissing() : h('div', { class: 'row end' }, h('button', { class: 'btn', onclick: async e => {
      const done = busy(e.currentTarget, '문제 만드는 중…');
      try { const b = await generateQuestions({ ids, level: targetLevel(), counts, source: kind === 'l' ? 'listen' : 'auto', title: kind === 'l' ? '청해 보충' : '자동 보충' }); toast(`문제 ${b.qs.length}개를 만들었어요.`); m.close(); after && after(); }
      catch (err) { toast(aiErrorText(err), 'err'); done(); }
    } }, '문제 만들기'))));
}
function pickStudyIds(level, n) {
  const pool = [...allGrammar(), ...allVocab()].filter(i => (i.l || level) === level || (i.l === 0));
  const a = pool.filter(i => ['a', 'l'].includes(status(i.id)));
  const nn = pool.filter(i => status(i.id) === 'n');
  const g = a.filter(i => i.t === 'g');
  const out = [...pick(g, Math.ceil(n * 0.4)), ...pick(a.filter(i => i.t === 'v'), Math.ceil(n * 0.35)), ...pick(nn, Math.ceil(n * 0.25))];
  return [...new Set(out.map(i => i.id))].slice(0, n);
}

/* =================== RECORD =================== */
function renderRecord(v, sub = 'lesson') {
  v.append(pageHead(sub === 'memo' ? '회화 모임 기록' : '수업 기록하기', sub === 'memo' ? '대충 적어도 AI가 단어와 문장으로 정리해요' : '사진이나 메모를 넣으면 AI가 정리하고, 확인 후 반영돼요',
    segTabs([['lesson', '수업 노트'], ['memo', '회화 모임']], sub, k => nav('record', k))));
  if (sub === 'memo') return renderMemo(v);
  const cols = h('div', { class: 'cols3' }); v.append(cols);
  const bl = books();
  const unitNow = App.state.unit || '우키우키 하권 2과';
  const curBook = bl.find(b => unitNow.startsWith(b)) || bl.find(b => unitNow.includes(b.replace('우키우키 ', ''))) || bl[0];
  const curNo = +(unitNow.match(/(\d+)\s*과/) || [])[1] || 0;
  const bookSel = h('select', {}, bl.map(b => h('option', { value: b, selected: b === curBook }, b)), h('option', { value: '__add' }, '＋ 교재 추가…'));
  bookSel.addEventListener('change', () => { if (bookSel.value === '__add') { bookSel.value = curBook; nav('settings'); } });
  const lessonNo = h('input', { type: 'number', min: 1, max: 60, value: curNo ? curNo + 1 : 1 });
  const dateIn = h('input', { type: 'date', value: App.today });
  const files = []; const thumbs = h('div', { class: 'photos' });
  const fileIn = h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true, onchange: () => { for (const f of fileIn.files) if (files.length < 6) files.push(f); fileIn.value = ''; drawThumbs(); } });
  function drawThumbs() {
    thumbs.innerHTML = '';
    files.forEach((f, i) => { const u = URL.createObjectURL(f); thumbs.append(h('div', { class: 'ph', style: `background-image:url(${u})` }, h('button', { class: 'phx', onclick: () => { files.splice(i, 1); drawThumbs(); } }, '✕'), h('b', {}, `사진 ${i + 1}`))); });
    if (files.length < 6) thumbs.append(h('button', { class: 'add', onclick: () => fileIn.click() }, '＋', h('br'), '사진 추가'));
  }
  drawThumbs();
  const memo = h('textarea', { rows: 4, placeholder: '예) 하권 3과, 〜たことがある 응용 3개. 선생님이 富士山 예문 중요하다고 함' });
  const statusBox = h('div');
  const runBtn = h('button', { class: 'btn full', onclick: () => extract() }, 'AI로 정리하기');
  cols.append(h('section', { class: 'card' },
    h('div', { class: 'label' }, '단원'), h('div', { class: 'row tight' }, bookSel, lessonNo, h('span', { class: 'muted' }, '과')),
    h('div', { class: 'label' }, '수업 날짜'), dateIn,
    h('div', { class: 'label' }, '사진 (교재 · 프린트)'), thumbs, fileIn,
    h('div', { class: 'label' }, '메모 (선택)'), memo, h('div', { style: 'height:14px' }), App.sample ? runBtn : aiMissing(), statusBox));
  const mid = h('section', { class: 'card' }, h('h2', {}, '추출 결과 확인', h('span', {}, '체크된 항목만 반영돼요')), h('div', { class: 'empty' }, '왼쪽에 사진이나 메모를 넣고', h('br'), '"AI로 정리하기"를 눌러 주세요.'));
  const right = h('section', {}, h('div', { class: 'paper empty-paper' }, h('div', { class: 'muted' }, '정리가 끝나면 여기에 한 장 수업 노트가 만들어져요.')));
  cols.append(mid, right);
  // history
  v.append(h('h3', { class: 'sub' }, '지난 수업 노트'));
  const hist = h('div', { class: 'histgrid' }); v.append(hist);
  if (!App.lessons.length) hist.append(h('div', { class: 'muted' }, '아직 기록이 없어요.'));
  for (const L of App.lessons.slice(0, 30)) hist.append(h('button', { class: 'histcard', onclick: () => showLesson(L) }, h('span', { class: 'muted sm' }, L.date + ' · ' + (L.unit || '')), h('b', { lang: 'ja' }, L.note?.title || '수업'), h('span', { class: 'muted sm' }, `단어 ${(L.vocabIds || []).length} · 문법 ${(L.grammarIds || []).length}`)));

  let ctl = null;
  const setStatusBox = (title, text, extra) => { statusBox.innerHTML = ''; statusBox.append(h('div', { class: 'status' }, h('b', {}, title), text, extra || null)); };
  const fmtSec = ms => `${Math.round(ms / 1000)}초`;
  async function extract() {
    const unit = `${bookSel.value} ${lessonNo.value}과`;
    if (!files.length && !memo.value.trim()) { toast('사진이나 메모를 넣어 주세요.'); return; }
    const done = busy(runBtn, 'AI에게 맡기는 중…');
    ctl = new AbortController();
    const stopBtn = h('button', { class: 'btn ghost sm', onclick: () => ctl.abort() }, '그만 기다리기');
    try {
      // 사진은 먼저 저장해 둬요. 새로고침해도 반영할 때 그대로 쓸 수 있어요.
      setStatusBox('사진 올리는 중', '수업 사진을 저장하고 있어요.');
      const photos = [];
      if (App.assets && files.length) for (const f of files) { try { photos.push((await App.assets.upload(f)).id); } catch { } }
      const meta = { unit, date: dateIn.value || App.today, memo: memo.value.trim(), photos, at: Date.now() };
      const prompt = lessonPrompt(unit, files.length, meta.memo);
      const opts = { images: files.length ? files : undefined, modelTier: 'vision', kind: 'lesson', signal: ctl.signal };
      let out = null;
      for (let attempt = 0; attempt < 3 && !out; attempt++) {
        if (attempt) { setStatusBox('다시 맡기는 중', `AI 서버가 바빠서 ${attempt}번째 다시 시도해요.`, stopBtn); await sleep(attempt === 1 ? 4000 : 10000); }
        try {
          const jobId = await App.sample.submitJSON(prompt, opts);
          App.state.pendingLesson = { ...meta, jobId }; saveState(); flushSaves();
          setStatusBox('AI가 정리하는 중', '화면을 끄거나 다른 탭에 가도 괜찮아요. 돌아오면 결과가 이어서 나와요.', stopBtn);
          out = await App.sample.waitJSON(jobId, { signal: ctl.signal, onWait: ms => { const b = $('.status b', statusBox); if (b) b.textContent = `AI가 정리하는 중 · ${fmtSec(ms)}`; } });
        } catch (e) {
          if (e?.code === 'cancelled' || !['overloaded', 'timeout', 'network', 'upstream'].includes(e?.code) || attempt === 2) throw e;
        }
      }
      finishExtract(out, meta);
    } catch (e) {
      if (e?.code === 'cancelled') { setStatusBox('기다리기를 멈췄어요', '정리는 서버에서 계속돼요. 나중에 이 화면에 다시 오면 결과를 이어서 받아요.'); }
      else { delete App.state.pendingLesson; saveState(); statusBox.innerHTML = ''; statusBox.append(h('div', { class: 'note warn' }, aiErrorText(e))); }
    } finally { done(); }
  }
  function finishExtract(out, meta) {
    App.state.pendingLesson = { ...meta, jobId: null, out }; saveState(); flushSaves();
    if (App.tab !== 'record') toast('수업 정리가 끝났어요. 기록 탭에서 확인하고 반영해 주세요.');
    if (!statusBox.isConnected) return;
    setStatusBox('AI 정리 완료', `문법 ${(out.grammar || []).length} · 단어 ${(out.vocab || []).length} · 예문 ${(out.examples || []).length} 추출 · 오른쪽에서 확인하고 반영해 주세요`);
    showExtract(out, meta.unit, meta);
  }
  // 새로고침·다른 기기에서 열었을 때: 맡겨 둔 정리를 이어받기
  const pend = App.state.pendingLesson;
  if (pend && App.sample) {
    const discard = h('button', { class: 'btn ghost sm', onclick: () => { delete App.state.pendingLesson; saveState(); flushSaves(); nav('record'); } }, '버리기');
    if (pend.out) {
      setStatusBox('반영하지 않은 정리 결과가 있어요', `${pend.unit} · ${md(pend.date)} · 확인하고 반영하거나 버릴 수 있어요.`, discard);
      showExtract(pend.out, pend.unit, pend);
    } else if (pend.jobId) {
      setStatusBox('맡겨 둔 정리 결과를 확인하는 중', `${pend.unit} · 잠시만 기다려 주세요.`, discard);
      App.sample.waitJSON(pend.jobId, { onWait: ms => { const b = $('.status b', statusBox); if (b) b.textContent = `맡겨 둔 정리 확인 중 · ${fmtSec(ms)}`; } })
        .then(out => finishExtract(out, pend))
        .catch(e => { delete App.state.pendingLesson; saveState(); flushSaves(); if (statusBox.isConnected) { statusBox.innerHTML = ''; statusBox.append(h('div', { class: 'note warn' }, '맡겨 둔 정리가 실패했어요. ' + aiErrorText(e) + ' 사진을 다시 넣고 정리해 주세요.')); } });
    }
  }
  function showExtract(out, unit, meta = {}) {
    const G = (out.grammar || []).slice(0, 8), V = (out.vocab || []).slice(0, 30), E = (out.examples || []).slice(0, 25);
    const gRows = G.map(g => ({ g, match: matchGrammar(g.p), on: true, apps: (g.apps || []).slice(0, 6).map(a => ({ a, match: matchGrammar(a.p), on: true })) }));
    const vRows = V.map(x => { const m = matchVocab(x.w, x.r); return { x, match: m, on: !x.unsure }; });
    const unsureN = vRows.filter(r => !r.on).length;
    mid.innerHTML = '';
    mid.append(h('h2', {}, '추출 결과 확인', h('span', {}, '체크된 항목만 반영돼요')));
    const ck = row => { const b = h('input', { type: 'checkbox', checked: row.on, onchange: () => row.on = b.checked }); return b; };
    const tag = (m, unsure) => unsure ? h('span', { class: 'chip c-red' }, '확인 필요') : m ? h('span', { class: 'chip c-blue' }, '마스터 연결') : h('span', { class: 'chip c-amber' }, '새 항목');
    mid.append(h('h3', { class: 'mini' }, '문법'));
    const gram = h('div', { class: 'gram' });
    for (const r of gRows) {
      gram.append(h('label', { class: 'gmain' }, ck(r), h('span', { class: 'jp', lang: 'ja' }, r.g.p), h('span', { class: 'm' }, r.g.m), h('span', { class: 'chip c-gray' }, r.g.level || ''), tag(r.match)));
      for (const a of r.apps) gram.append(h('label', { class: 'gsub' }, ck(a), h('span', { lang: 'ja' }, a.a.p), h('span', { class: 'm' }, a.a.m), h('span', { class: 'chip c-gray' }, '응용')));
    }
    if (!gRows.length) gram.append(h('div', { class: 'muted pad' }, '추출된 문법이 없어요.'));
    mid.append(gram);
    mid.append(h('h3', { class: 'mini' }, `단어 ${vRows.length}개`, unsureN ? h('span', { class: 'chip c-red' }, `확인 필요 ${unsureN}`) : null));
    const tb = h('table', { class: 'tbl' }, h('tr', {}, h('th'), h('th', {}, '단어'), h('th', {}, '읽기'), h('th', {}, '뜻'), h('th', {}, '레벨'), h('th', {}, '상태')));
    for (const r of vRows) {
      const wIn = h('input', { class: 'cell', value: r.x.w, lang: 'ja', onchange: () => r.x.w = wIn.value });
      const rIn = h('input', { class: 'cell', value: r.x.r, lang: 'ja', onchange: () => r.x.r = rIn.value });
      const mIn = h('input', { class: 'cell', value: r.x.m, onchange: () => r.x.m = mIn.value });
      tb.append(h('tr', { class: r.x.unsure ? 'warn' : '' }, h('td', {}, ck(r)), h('td', {}, wIn), h('td', {}, rIn), h('td', {}, mIn), h('td', {}, (r.match ? 'N' + (r.match.l || '-') : r.x.level || '')), h('td', { title: r.x.why || '' }, tag(r.match, r.x.unsure))));
    }
    mid.append(h('div', { class: 'tblwrap' }, tb));
    const exList = h('div', { class: 'exlist', hidden: true }, E.map(e => h('div', {}, jp(e.j), h('small', {}, e.k))));
    mid.append(h('button', { class: 'linkbtn', onclick: () => exList.hidden = !exList.hidden }, `예문 ${E.length}개 보기`), exList);
    const applyBtn = h('button', { class: 'btn', onclick: () => apply() }, '확인하고 반영');
    mid.append(h('div', { class: 'bottom' }, h('p', {}, '반영하면 항목들이 "학원에서 배움"으로 바뀌고, 이 범위의 문제가 자동으로 만들어져요.'), applyBtn));
    right.innerHTML = ''; right.append(noteView(out.note || {}, meta.date || App.today, unit));
    async function apply() {
      const done = busy(applyBtn, '반영 중…');
      try {
        const gIds = [], vIds = [];
        for (const r of gRows) {
          if (r.on) gIds.push(r.match ? r.match.id : addCustomGrammar(r.g));
          for (const a of r.apps) if (a.on) gIds.push(a.match ? a.match.id : addCustomGrammar({ ...a.a, level: r.g.level }));
        }
        for (const r of vRows) if (r.on && r.x.w) { const m = matchVocab(r.x.w, r.x.r); vIds.push(m ? m.id : addCustomVocab(r.x)); }
        const uniq = [...new Set(gIds.concat(vIds))];
        uniq.forEach(id => setStatus(id, 'a'));
        if (App.custom._dirty) { delete App.custom._dirty; await saveCustom(); }
        let photos = meta.photos || [];
        if (!meta.photos && App.assets && files.length) { for (const f of files) { try { const a = await App.assets.upload(f); photos.push(a.id); } catch { } } }
        const id = uid('L');
        const L = { date: meta.date || dateIn.value || App.today, unit, memo: meta.memo ?? memo.value.trim(), photos, note: out.note || {}, grammarIds: [...new Set(gIds)], vocabIds: [...new Set(vIds)], exCount: E.length, examples: E.slice(0, 25) };
        await writeDoc('lessons/' + id, L);
        App.lessons.unshift({ id, ...L });
        for (const e of E.slice(0, 15)) App.drill.push({ id: uid('d'), ko: e.k, jp: e.j, from: 'lesson', at: App.today, ok: 0, ng: 0 });
        markDirty('drill');
        App.state.unit = unit; App.state.lastLesson = id; delete App.state.pendingLesson; saveState(); await flushSaves();
        App.dayDoc = null; if (App.db) App.db.doc('day/' + App.today).delete().catch(() => {});
        toast(`반영했어요. 항목 ${uniq.length}개가 "학원에서 배움"이 됐어요.`);
        mid.innerHTML = ''; mid.append(h('h2', {}, '반영 완료'), h('p', {}, `문법 ${gIds.length} · 단어 ${vIds.length} · 예문 ${E.length}`), h('div', { class: 'status' }, h('b', {}, '문제 만드는 중…'), '이 범위의 실전 문제를 은행에 쌓고 있어요. 다른 화면으로 가도 괜찮아요.'));
        generateQuestions({ ids: uniq.slice(0, 24), level: guessLevel(uniq), source: id, title: unit }).then(b => { toast(`${unit} 문제 ${b.qs.length}개를 만들었어요.`); if (App.tab === 'record') nav('record'); })
          .catch(err => toast('문제 생성 실패: ' + aiErrorText(err), 'err'));
      } catch (e) { console.error(e); toast('반영 중 오류가 났어요.', 'err'); done(); }
    }
  }
}
function lessonPrompt(unit, nPhotos, memoText) {
  return `일본어 학원 수업 자료(교재 "${unit}", 선생님 프린트)를 정리해 주세요. 학습자는 한국인이고 JLPT N5→N2를 준비 중입니다.
${nPhotos ? `첨부 사진 ${nPhotos}장은 교재/프린트 페이지입니다. 사진에 실제로 보이는 내용만 추출하세요.` : ''}
학습자 메모: ${memoText || '(없음)'}

이 JSON 하나만 답하세요:
{"grammar":[{"p":"문형(예: 〜たことがある)","m":"한국어 뜻","f":"접속 공식","level":"N5|N4|N3|N2","apps":[{"p":"응용 문형","m":"뜻"}]}],
"vocab":[{"w":"표기(한자 포함)","r":"히라가나 읽기","m":"한국어 뜻","level":"N5|N4|N3|N2","unsure":false,"why":"unsure일 때 이유(사진 흐림, 표기 불일치 등)"}],
"examples":[{"j":"일본어 예문","k":"한국어 뜻"}],
"note":{"title":"대표 문형","sub":"접속 · 의미 한 줄","conj":"활용 예 한 줄(예: 行く → 行った → 行ったことがある)","examples":[{"j":"핵심 예문","k":"뜻"}],"apps":["응용 문형 · 설명"],"caution":"헷갈리기 쉬운 점 한두 문장"}}
규칙: 단어는 수업에서 새로 나온 것 위주로 최대 25개, 예문은 최대 20개. 읽기나 표기가 확실하지 않으면 unsure를 true로. 한국어는 자연스럽게.`;
}
function guessLevel(ids) { const ls = ids.map(id => App.byId[id]?.l).filter(l => l >= 2); if (!ls.length) return targetLevel(); const c = {}; ls.forEach(l => c[l] = (c[l] || 0) + 1); return +Object.entries(c).sort((a, b) => b[1] - a[1])[0][0]; }
const normP = s => String(s || '').replace(/[〜～~\s・()（）]/g, '').replace(/[ーｰ]/g, 'ー');
function matchGrammar(p) {
  const n = normP(p); if (!n) return null;
  const all = allGrammar();
  return all.find(g => normP(g.p) === n) || all.find(g => { const gp = normP(g.p); return gp.length >= 3 && n.length >= 3 && (gp.includes(n) || n.includes(gp)); }) || null;
}
function matchVocab(w, r) {
  const all = allVocab();
  return all.find(v => v.w === w) || all.find(v => v.w.split(/[;；]/).map(s => s.trim()).includes(w)) || (r ? all.find(v => v.r === r && v.w === r) : null) || null;
}
function addCustomVocab(x) {
  const id = 'CV-' + (App.custom.vocab.length + 1).toString().padStart(4, '0') + Math.random().toString(36).slice(2, 4);
  const l = +(String(x.level || '').replace(/\D/g, '')) || 0;
  const it = { id, l, w: x.w, r: x.r || '', m: x.m || '', src: '수업', t: 'v' };
  App.custom.vocab.push(it); App.byId[id] = it; App.custom._dirty = true; return id;
}
function addCustomGrammar(g) {
  const id = 'CG-' + (App.custom.grammar.length + 1).toString().padStart(3, '0') + Math.random().toString(36).slice(2, 4);
  const l = +(String(g.level || '').replace(/\D/g, '')) || 0;
  const it = { id, l, p: g.p, m: g.m || '', f: g.f || '', ej: '', ek: '', src: '수업', t: 'g' };
  App.custom.grammar.push(it); App.byId[id] = it; App.custom._dirty = true; return id;
}
function noteView(n, date, unit) {
  return h('div', { class: 'paper' },
    h('div', { class: 'hd' }, h('span', {}, '수업 노트 · ' + md(date)), h('span', {}, unit || '')),
    h('h4', { class: 'jp-serif', lang: 'ja' }, n.title || '수업 정리'),
    n.sub ? h('div', { class: 's' }, n.sub) : null,
    n.conj ? h('div', { class: 'box', lang: 'ja' }, n.conj) : null,
    (n.examples || []).length ? h('div', { class: 't' }, '핵심 예문') : null,
    ...(n.examples || []).slice(0, 4).map(e => h('div', { class: 'ex' }, jp(e.j), h('small', {}, e.k), h('button', { class: 'say', title: '듣기', onclick: () => TTS.speak([{ s: 'N', t: e.j }]) }, '🔈'))),
    (n.apps || []).length ? h('div', { class: 't' }, '응용') : null,
    ...(n.apps || []).slice(0, 6).map(a => h('div', { class: 'ex', lang: 'ja' }, a)),
    n.caution ? h('div', { class: 'warnbox' }, '헷갈리기 쉬운 점: ', h('span', { lang: 'ja' }, n.caution)) : null);
}
function lessonEditor(L, onSaved) {
  const bl = [...books()];
  let curBook = bl.find(b => (L.unit || '').startsWith(b));
  if (!curBook) { curBook = (L.unit || '').replace(/\s*\d+\s*과\s*$/, '').trim() || bl[0]; if (!bl.includes(curBook)) bl.push(curBook); }
  const curNo = +((L.unit || '').match(/(\d+)\s*과/) || [])[1] || 1;
  const bookSel = h('select', { id: 'leBook' }, bl.map(b => h('option', { value: b, selected: b === curBook }, b)));
  const noIn = h('input', { id: 'leNo', type: 'number', min: 1, max: 60, value: curNo });
  const dateIn = h('input', { id: 'leDate', type: 'date', value: L.date || App.today });
  const saveBtn = h('button', { class: 'btn sm', onclick: async () => {
    const n = Math.max(1, +noIn.value || 1);
    const unit = `${bookSel.value} ${n}과`, date = dateIn.value || L.date;
    const done = busy(saveBtn, '저장 중…');
    try {
      const wasLatest = App.lessons[0]?.id === L.id;
      L.unit = unit; L.date = date;
      const { id, ...data } = L;
      await writeDoc('lessons/' + L.id, data);
      App.lessons.sort((a, b) => String(b.date).localeCompare(String(a.date)));
      // 이 수업으로 만든 문제 묶음의 이름도 같이 바꿈
      for (const b of App.banks) if (b.source === L.id && b.title !== unit) { b.title = unit; b._dirty = true; }
      scheduleBankSave();
      if (wasLatest || App.lessons[0]?.id === L.id) { App.state.unit = App.lessons[0].unit; saveState(); }
      await flushSaves();
      toast('수업 정보를 고쳤어요.');
      onSaved && onSaved();
    } catch { toast('저장하지 못했어요.', 'err'); done(); }
  } }, '저장');
  return h('div', { class: 'lessonedit' },
    h('div', { class: 'row tight gap' }, bookSel, noIn, h('span', { class: 'muted' }, '과'), dateIn),
    h('div', { class: 'row end' }, h('button', { class: 'btn ghost sm', onclick: () => onSaved && onSaved(true) }, '취소'), saveBtn));
}
function showLesson(L) {
  const body = h('div', { class: 'lessonview' });
  const top = h('div', { class: 'row lv-top' }, h('button', { class: 'btn ghost sm', onclick: () => {
    top.replaceWith(lessonEditor(L, cancelled => { m.close(); if (!cancelled) nav(App.tab, App.sub); showLesson(L); }));
  } }, '✏️ 단원·날짜 수정'));
  body.append(top, noteView(L.note || {}, L.date, L.unit));
  const items = [...(L.grammarIds || []), ...(L.vocabIds || [])].map(id => App.byId[id]).filter(Boolean);
  if (items.length) body.append(h('h3', { class: 'mini' }, '이 수업의 항목'), h('div', { class: 'chips' }, items.map(it => h('span', { class: 'chip ' + STATUS_CLS[status(it.id)], lang: 'ja', title: it.m }, itemLabel(it)))));
  if ((L.photos || []).length && App.assets) {
    const ph = h('div', { class: 'photos' }); body.append(h('h3', { class: 'mini' }, '사진'), ph);
    L.photos.forEach(async p => { const u = await App.assets.url(p).catch(() => null); if (u) ph.append(h('a', { href: u, target: '_blank', rel: 'noopener', class: 'ph', style: `background-image:url("${u}")` })); });
  }
  if ((L.examples || []).length) body.append(h('h3', { class: 'mini' }, '예문'), h('div', { class: 'exlist' }, L.examples.map(e => h('div', {}, jp(e.j), h('small', {}, e.k)))));
  body.append(h('div', { class: 'row end' }, h('button', { class: 'btn', onclick: async () => { m.close(); await loadArchive(); const qs = bankQuestions((q, b) => b.source === L.id); const o = overlay(L.unit + ' 테스트'); runQuiz(o.body, shuffle(qs).slice(0, 15).concat(pick(L.vocabIds || [], 5).map(id => ruleQ(id))), { onExit: o.close, onDone: o.close, emptyText: '이 수업의 문제가 아직 없어요.' }); } }, '이 수업 테스트')));
  const m = modal(body, { wide: true });
}

/* ---- memo ---- */
async function saveMemo(text) {
  const id = uid('M');
  const memo = { at: Date.now(), date: App.today, text, entries: [] };
  if (App.sample) {
    try {
      const out = await aiJSON(`한국인 일본어 학습자(JLPT N5~N4 수준)가 회화 모임 후 휴대폰으로 대충 적은 메모입니다. 각 내용을 학습 항목으로 정리하세요.
메모: """${text.slice(0, 2000)}"""
JSON 배열만 답하세요: [{"kind":"word|sentence","jp":"정확한 일본어(단어는 사전형, 문장은 자연스러운 회화체)","r":"히라가나 읽기(단어만)","ko":"한국어 뜻","level":"N5|N4|N3|N2","why":"한 줄 설명(뉘앙스·쓰임)","status":"들었지만 모름|말하고 싶었음"}]
메모에 철자 오류나 한국어가 섞여 있으면 의도를 추측해 바로잡으세요.`, { modelTier: 'quick' });
      memo.entries = (Array.isArray(out) ? out : []).slice(0, 15).map(e => ({ kind: e.kind === 'sentence' ? 'sentence' : 'word', jp: String(e.jp || ''), r: String(e.r || ''), ko: String(e.ko || ''), level: e.level || '', why: String(e.why || ''), st: e.status || '' }));
      for (const e of memo.entries) {
        if (e.kind === 'word' && e.jp) {
          const m = matchVocab(e.jp, e.r); const vid = m ? m.id : addCustomVocab({ w: e.jp, r: e.r, m: e.ko, level: e.level });
          const p = ensureP(vid); if (p.s === 'n' || p.s === 'a') p.s = 'l'; p.nx = App.today; markDirty('prog:' + chunkOf(vid)); e.id = vid;
        } else if (e.jp) { App.drill.push({ id: uid('d'), ko: e.ko, jp: e.jp, from: 'memo', at: App.today, ok: 0, ng: 0 }); markDirty('drill'); }
      }
      if (App.custom._dirty) { delete App.custom._dirty; saveCustom().catch(() => {}); }
    } catch (e) { toast(aiErrorText(e) + ' 메모는 원문 그대로 저장했어요.', 'err'); }
  }
  await writeDoc('memos/' + id, memo);
  App.memos.unshift({ id, ...memo });
  flushSaves();
  toast('메모를 저장했어요.');
}
/* 모임 메모 날짜 고치기: 날짜만 바꾸고 정리된 단어·문장은 그대로 */
function editMemoDate(memo) {
  const inp = h('input', { type: 'date', value: memo.date || App.today });
  const m = modal(h('div', {}, h('h2', {}, '메모 날짜 수정'), h('p', { class: 'muted' }, '이 메모가 어느 모임 날짜인지 바꿔요. 정리된 단어와 문장은 그대로예요.'), inp,
    h('div', { class: 'row end' }, h('button', { class: 'btn ghost', onclick: () => m.close() }, '취소'), h('button', { class: 'btn', onclick: async e => {
      const d = inp.value; if (!/^\d{4}-\d\d-\d\d$/.test(d)) { toast('날짜를 골라 주세요.'); return; }
      const done = busy(e.currentTarget, '저장 중…');
      try {
        const r = await mergeWrite('memos/' + memo.id, cur => cur ? Object.assign(cur, { date: d }) : null);
        if (!r) throw 0;
        memo.date = d; m.close(); toast('날짜를 바꿨어요.'); nav('record', 'memo');
      } catch { toast('저장하지 못했어요. 다시 시도해 주세요.', 'err'); done(); }
    } }, '저장'))));
}
function renderMemo(v) {
  const wrap = h('div', { class: 'grid2' }); v.append(wrap);
  const ta = h('textarea', { rows: 5, placeholder: '예) しゅうしょく 이란 단어 못 알아들음 / "주말에 친구를 만났어요" 말 못 함' });
  const nextIn = h('input', { type: 'date', value: App.state.nextMeet || '' , onchange: () => { App.state.nextMeet = nextIn.value; saveState(); } });
  const saveBtn = h('button', { class: 'btn', onclick: async () => { const t = ta.value.trim(); if (!t) return; const done = busy(saveBtn, 'AI가 정리하는 중…'); try { await saveMemo(t); nav('record', 'memo'); } finally { done(); } } }, '저장');
  wrap.append(card('모임 메모 쓰기', '', ta, h('div', { class: 'row' }, h('label', { class: 'muted sm' }, '다음 모임 ', nextIn), saveBtn),
    h('p', { class: 'muted sm' }, '단어는 단어 DB의 복습 대상으로, 말 못 한 문장은 순간 작문 드릴로 들어가요.')));
  // 날짜별로 묶어서, 누르면 그날 정리된 내용이 펼쳐져요
  const byDate = new Map();
  for (const m of [...App.memos].sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || (b.at || 0) - (a.at || 0))) { const k = m.date || '날짜 없음'; if (!byDate.has(k)) byDate.set(k, []); byDate.get(k).push(m); }
  const list = card('모임 메모 기록', `${byDate.size}일`);
  if (!App.memos.length) list.append(h('div', { class: 'muted' }, '아직 메모가 없어요.'));
  const entryRow = e => h('div', { class: 'mm' }, h('div', { class: 'jpl', lang: 'ja' }, e.jp + (e.r && e.r !== e.jp ? `（${e.r}）` : '')), h('p', {}, e.ko + (e.why ? ' · ' + e.why : '')),
    h('div', { class: 'r' }, h('span', { class: 'chip ' + (e.kind === 'word' ? 'c-blue' : 'c-amber') }, e.kind === 'word' ? '단어 DB에 들어감 ✓' : '순간 작문에 들어감 ✓'), e.level ? h('span', { class: 'chip c-gray' }, e.level) : null));
  for (const [date, ms] of byDate) {
    const ents = ms.flatMap(m => m.entries || []);
    const nw = ents.filter(e => e.kind === 'word').length, ns = ents.length - nw;
    const wd = /^\d{4}-\d\d-\d\d$/.test(date) ? '일월화수목금토'[new Date(date + 'T00:00:00').getDay()] : '';
    list.append(h('details', { class: 'memoday' },
      h('summary', {}, h('b', {}, date.slice(5).replace('-', '/') + (wd ? ` (${wd})` : '')), h('span', { class: 'muted sm' }, [nw ? `단어 ${nw}` : '', ns ? `문장 ${ns}` : '', ms.length > 1 ? `메모 ${ms.length}개` : ''].filter(Boolean).join(' · ') || '메모')),
      h('div', { class: 'memoday-b' }, ms.map(m => h('div', { class: 'memo' },
        h('div', { class: 'row' }, h('details', { class: 'orig' }, h('summary', { class: 'muted sm' }, '내가 적은 원문'), h('div', { class: 'sm' }, m.text || '')),
          h('button', { class: 'btn ghost sm', onclick: () => editMemoDate(m) }, '📅 날짜 수정')),
        ...(m.entries?.length ? m.entries.map(entryRow) : [h('div', {}, m.text)]))))));
  }
  wrap.append(list);
}

/* =================== TEST =================== */
function renderTest(v, sub) {
  const wrongN = App.wrong.length;
  v.append(pageHead('시험', '실제 JLPT 문제 유형으로 출제돼요', h('button', { class: 'btn ghost', onclick: () => startMode('wrong') }, `오답 다시 풀기 · ${Math.min(wrongN, 20)}문항`)));
  const cols = h('div', { class: 'cols-test' }); v.append(cols);
  const modes = [['daily', '데일리', '오늘 세트로 이동', 'c-gray', '오늘'], ['unit', '단원 테스트', '수업 기록 기반 · 응용 문법 포함', 'c-blue', App.lessons[0]?.unit || '수업'], ['mock', `N${targetLevel()} 진단 모의고사`, '실전 구성 · 영역별 점수 · 40문항', 'c-red', '추천'], ['area', '영역 집중', '약한 영역만 골라 20문항', 'c-gray', '선택'], ['wrong', '오답 재시험', '틀린 문항 다시 · AI 변형 문제', 'c-amber', String(wrongN)]];
  const side = h('section', {}, modes.map(([k, t, d, c, chip]) => h('button', { class: 'mode' + (k === sub ? ' on' : ''), onclick: () => k === 'daily' ? nav('today') : startMode(k) }, h('b', {}, t, h('span', { class: 'chip ' + c }, chip)), h('p', {}, d))));
  const main = h('section', { class: 'card qcard' }); const info = h('section', { class: 'card' });
  cols.append(side, main, info);
  // info panel
  const bankAll = bankQuestions();
  const cnt = a => bankAll.filter(q => q.area === a).length;
  info.append(h('h2', {}, '문제 은행'), ...Object.entries(AREA).map(([a, n]) => h('div', { class: 'kv' }, h('span', {}, n), h('b', {}, cnt(a) + '문항'))),
    h('h2', { style: 'margin-top:18px' }, '출제 구성'), h('div', { class: 'kv' }, h('span', {}, '학원에서 배운 것'), h('b', {}, '약 60%')), h('div', { class: 'kv' }, h('span', {}, '복습 대상'), h('b', {}, '약 25%')), h('div', { class: 'kv' }, h('span', {}, '레벨 범위 미학습'), h('b', {}, '약 15%')),
    h('div', { style: 'height:12px' }), App.sample ? h('button', { class: 'btn ghost full', onclick: e => fillBank(e.currentTarget) }, 'AI로 문제 은행 보충') : aiMissing());
  main.append(h('div', { class: 'empty' }, '왼쪽에서 시험 종류를 골라 주세요.', h('br'), h('span', { class: 'muted' }, '처음이라면 진단 모의고사부터 추천해요.')));
  async function fillBank(btn) {
    const done = busy(btn, '문제 만드는 중… (1~2분)');
    try { const b = await generateQuestions({ ids: pickStudyIds(targetLevel(), 16), level: targetLevel(), source: 'auto', title: '보충' }); toast(`문제 ${b.qs.length}개를 추가했어요.`); nav('test', sub); }
    catch (e) { toast(aiErrorText(e), 'err'); done(); }
  }
  function startMode(k) {
    $$('.mode', side).forEach((b, i) => b.classList.toggle('on', modes[i][0] === k));
    main.innerHTML = '';
    if (k === 'unit') { main.append(h('div', { class: 'muted' }, '불러오는 중…')); return loadArchive().then(() => { main.innerHTML = ''; unitPicker(main); }); }
    if (k === 'mock') return mockIntro(main);
    if (k === 'area') return areaPicker(main);
    if (k === 'wrong') { main.append(h('div', { class: 'muted' }, '불러오는 중…')); return loadArchive().then(() => { main.innerHTML = ''; wrongMode(main); }); }
  }
  function unitPicker(el) {
    el.append(h('h2', {}, '단원 테스트'));
    if (!App.lessons.length) { el.append(h('div', { class: 'empty' }, '수업 기록이 아직 없어요.', h('br'), h('button', { class: 'btn sm', onclick: () => nav('record') }, '수업 기록하기'))); return; }
    for (const L of App.lessons.slice(0, 20)) {
      const n = bankQuestions((q, b) => b.source === L.id).length;
      el.append(h('button', { class: 'pickrow', onclick: () => { const qs = shuffle(bankQuestions((q, b) => b.source === L.id)).slice(0, 15).concat(pick(L.vocabIds || [], 5).map(id => ruleQ(id))); runQuiz(el, qs, { onDone: () => nav('test', 'unit'), emptyText: '이 수업의 문제가 아직 없어요.' }); } },
        h('b', {}, L.unit + ' · ', h('span', { lang: 'ja' }, L.note?.title || '')), h('span', { class: 'muted' }, `${L.date} · 문제 ${n}개`)));
    }
  }
  function areaPicker(el) {
    el.append(h('h2', {}, '영역 집중'), h('p', { class: 'muted' }, '집중할 영역을 고르세요.'));
    const acc = areaAccuracy(14);
    for (const [a, n] of Object.entries(AREA)) {
      const [o, t] = acc[a];
      el.append(h('button', { class: 'pickrow', onclick: () => runArea(a) }, h('b', {}, n), h('span', { class: 'muted' }, t ? `최근 정답률 ${Math.round(o / t * 100)}%` : '기록 없음')));
    }
    function runArea(a) {
      let qs;
      if (a === 'v') { const ids = balancedPick(allVocab().filter(v => v.l >= targetLevel() - 0 && v.l <= 5 && ['a', 'l', 'm'].includes(status(v.id))).map(v => v.id), 14).concat(shuffle(App.M.kanji.filter(k => k.l === targetLevel())).slice(0, 2).map(k => k.id)); qs = ids.map(id => ruleQ(id)).concat(shuffle(bankQuestions(q => q.area === 'v')).slice(0, 4)); }
      else qs = shuffle(bankQuestions(q => q.area === a)).sort((x, y) => (x.seen || 0) - (y.seen || 0)).slice(0, 20);
      if (!qs.length) return offerGenerate(a === 'l' ? 'l' : 'mix', () => nav('test', 'area'));
      runQuiz(el, shuffle(qs), { onDone: () => nav('test', 'area') });
    }
  }
  function wrongMode(el) {
    el.append(h('h2', {}, '오답 재시험'));
    const seen = new Set(); const qs = [];
    for (const w of [...App.wrong].reverse()) { const q = resolveRef(w.q); if (!q) continue; const key = q.id; if (seen.has(key)) continue; seen.add(key); qs.push(q); if (qs.length >= 20) break; }
    if (!qs.length) { el.append(h('div', { class: 'empty' }, '틀린 문제가 아직 없어요.')); return; }
    const ids = [...new Set(App.wrong.slice(-30).flatMap(w => w.ids || []))].slice(0, 16);
    el.append(h('p', { class: 'muted' }, `최근 틀린 문제 ${qs.length}개가 있어요.`),
      h('div', { class: 'row' }, h('button', { class: 'btn', onclick: () => runQuiz(el, shuffle(qs), { onDone: () => nav('test', 'wrong') }) }, '같은 문제 다시 풀기'),
        App.sample ? h('button', { class: 'btn ghost', onclick: async e => { const done = busy(e.currentTarget, '변형 문제 만드는 중…'); try { const b = await generateQuestions({ ids, level: targetLevel(), source: 'wrong', title: '오답 변형', counts: { '文脈規定(v)': 3, '言い換え類義(v)': 2, '文法形式の判断(g)': 5, '文の組み立て(g)': 2, '聴解 ポイント理解(l)': 2 } }); runQuiz(el, b.qs.map(q => ({ bank: b.id, ...q })), { onDone: () => nav('test', 'wrong') }); } catch (err) { toast(aiErrorText(err), 'err'); done(); } } }, 'AI로 다른 문장 문제 만들기') : null));
  }
  function mockIntro(el) {
    const L = targetLevel();
    const vq = () => shuffle(allVocab().filter(v => v.l === L && /[一-龯]/.test(v.w))).slice(0, 15).map((v, i) => ruleQ(v.id, ['read', 'read', 'write', 'mean', 'read'][i % 5]));
    const gb = bankQuestions(q => (q.area === 'g' || q.area === 'r'));
    const lb = bankQuestions(q => q.area === 'l');
    el.append(h('h2', {}, `N${L} 진단 모의고사`), h('p', { class: 'muted' }, '문자·어휘 15 · 문법·독해 15 · 청해 10 · 제한 시간 40분. 실전 모드라 정답은 마지막에 한꺼번에 보여줘요.'),
      h('div', { class: 'kv' }, h('span', {}, '문법·독해 문제 은행'), h('b', {}, `${gb.length} / 15`)), h('div', { class: 'kv' }, h('span', {}, '청해 문제 은행'), h('b', {}, `${lb.length} / 10`)));
    const need = gb.length < 15 || lb.length < 10;
    const go = () => {
      const g = shuffle(bankQuestions(q => q.area === 'g' || q.area === 'r')).sort((a, b) => (a.seen || 0) - (b.seen || 0)).slice(0, 15);
      const l = shuffle(bankQuestions(q => q.area === 'l')).sort((a, b) => (a.seen || 0) - (b.seen || 0)).slice(0, 10);
      runQuiz(el, vq().concat(g, l), { mode: 'exam', timerMin: 40, onDone: () => nav('test', 'mock'), onFinish: (res, qs, by) => { App.state.lastMock = { date: App.today, by }; saveState(); } });
    };
    if (need && App.sample) {
      el.append(h('div', { class: 'note' }, '모의고사용 문제가 부족해요. AI가 먼저 문제를 만들게요 (2~3분).'),
        h('div', { class: 'row' }, h('button', { class: 'btn', onclick: async e => {
          const done = busy(e.currentTarget, '모의고사 문제 만드는 중…');
          try {
            const ids = shuffle([...App.M.grammar.filter(g => g.l === L), ...allVocab().filter(v => v.l === L)]).slice(0, 18).map(i => i.id);
            const jobs = [];
            if (gb.length < 15) jobs.push(generateQuestions({ ids, level: L, source: 'mock', title: '모의고사 문법·독해', counts: { '文法形式の判断(g)': 7, '文の組み立て(g)': 4, '読解 短文(r)': 3, '文章の文法(g)': 2 } }));
            if (lb.length < 10) jobs.push(generateQuestions({ ids: ids.slice(0, 12), level: L, source: 'mock', title: '모의고사 청해', counts: { '聴解 課題理解(l)': 4, '聴解 ポイント理解(l)': 3, '聴解 発話表現(l)': 2, '聴解 即時応答(l)': 2 } }));
            await Promise.all(jobs); el.innerHTML = ''; mockIntro(el);
          } catch (err) { toast(aiErrorText(err), 'err'); done(); }
        } }, '문제 만들고 시작'), h('button', { class: 'btn ghost', onclick: go }, '있는 문제로 바로 시작')));
    } else el.append(h('div', { class: 'row' }, h('button', { class: 'btn', onclick: go }, '시작하기')));
    if (App.state.lastMock) { const { date, by } = App.state.lastMock; el.append(h('div', { class: 'note' }, `지난 모의고사 (${date}): `, Object.entries(by).map(([a, [o, n]]) => `${AREA[a]} ${o}/${n}`).join(' · '))); }
  }
  if (sub) startMode(sub);
}

/* =================== TALK =================== */
const SCENES = [
  { id: 'cafe', ic: '店', t: '카페 접객', d: '주문 받기 · 계산 · 추천', role: '카페에 온 손님. 학습자는 카페 점원', lv: 5 },
  { id: 'interview', ic: '面', t: '아르바이트 면접', d: '자기소개 · 경험 · 지원 이유', role: '카페 점장 田中. 학습자는 아르바이트 지원자', lv: 4 },
  { id: 'self', ic: '自', t: '모임 자기소개', d: '취미 · 일 · 일본에 가는 이유', role: '처음 만난 일본인 친구. 편한 정중체', lv: 5 },
  { id: 'ward', ic: '役', t: '구청 전입신고', d: '서류 · 주소 · 확인 질문', role: '구청 창구 직원. 학습자는 막 이사 온 외국인', lv: 4 },
  { id: 'bank', ic: '銀', t: '은행 계좌 개설', d: '본인 확인 · 도장 · 카드', role: '은행 창구 직원. 학습자는 계좌를 만들려는 워홀 외국인', lv: 4 },
  { id: 'house', ic: '家', t: '부동산 집 구하기', d: '예산 · 역 거리 · 조건', role: '부동산 직원. 학습자는 방을 찾는 손님', lv: 4 },
  { id: 'cowork', ic: '同', t: '동료와 잡담', d: '주말 · 음식 · 날씨', role: '같은 가게 일본인 동료. 반말과 정중체 섞기', lv: 4 },
  { id: 'phone', ic: '電', t: '사무실 전화 응대', d: '존경어 · 겸양어 필요', role: '거래처 직원이 전화함. 학습자는 회사 직원으로 받음', lv: 3 },
];
function renderTalk(v, sub = 'drill') {
  v.append(pageHead('회화', '배운 문법 범위 안에서 말하는 연습을 해요', segTabs([['drill', '순간 작문'], ['role', '장면 롤플레이'], ['prep', '모임 준비']], sub, k => nav('talk', k))));
  if (sub === 'role') return renderRole(v);
  if (sub === 'prep') return renderPrep(v);
  const wrap = h('div', { class: 'grid2' }); v.append(wrap);
  const box = h('section', { class: 'card' }); wrap.append(box);
  drillRunner(box, null, () => nav('talk', 'drill'));
  const listCard = card('작문 문장 목록', `${App.drill.length}개`);
  const gen = App.sample ? h('button', { class: 'btn ghost sm', onclick: async e => {
    const done = busy(e.currentTarget, '만드는 중…');
    try {
      const out = await aiJSON(`한국인 일본어 학습자의 순간 작문 연습 문장을 만드세요. 학습자가 배운 문법만 사용: ${learnedContext(targetLevel(), 40)}. 워홀·카페·일상 회화 장면으로 5문장. JSON 배열만: [{"ko":"한국어 문장","jp":"자연스러운 일본어 정답(정중체)"}]`, { modelTier: 'quick' });
      for (const x of (Array.isArray(out) ? out : []).slice(0, 8)) if (x.ko && x.jp) App.drill.push({ id: uid('d'), ko: String(x.ko), jp: String(x.jp), from: 'ai', at: App.today, ok: 0, ng: 0 });
      markDirty('drill'); await flushSaves(); nav('talk', 'drill');
    } catch (err) { toast(aiErrorText(err), 'err'); done(); }
  } }, 'AI로 5문장 추가') : null;
  listCard.querySelector('h2').append(gen || '');
  const fromLabel = { lesson: '수업', memo: '모임', ai: 'AI', role: '롤플레이' };
  for (const d of [...App.drill].reverse().slice(0, 60)) listCard.append(h('div', { class: 'drow' }, h('div', {}, h('div', {}, d.ko), h('small', { lang: 'ja', class: 'muted' }, d.jp)), h('span', { class: 'chip ' + ((d.ok || 0) >= 2 ? 'c-green' : 'c-gray') }, (d.ok || 0) >= 2 ? '익힘' : fromLabel[d.from] || '')));
  if (!App.drill.length) listCard.append(h('div', { class: 'muted' }, '수업을 기록하거나 모임 메모를 저장하면 문장이 쌓여요.'));
  wrap.append(listCard);
}
function drillRunner(root, ids, onDone, onExit) {
  let list = ids ? ids.map(id => App.drill.find(d => d.id === id)).filter(Boolean) : shuffle(App.drill.filter(d => (d.ok || 0) < 2)).slice(0, 5);
  root.innerHTML = '';
  if (!list.length) { root.append(h('div', { class: 'empty' }, '연습할 작문 문장이 없어요.', h('br'), h('span', { class: 'muted' }, '수업을 기록하거나 "AI로 5문장 추가"를 눌러 주세요.')), onExit ? h('div', { class: 'row end' }, h('button', { class: 'btn', onclick: onDone }, '완료로 표시')) : null); return; }
  let i = 0;
  const show = () => {
    const d = list[i]; root.innerHTML = '';
    if (onExit) root.append(h('div', { class: 'qhead' }, h('button', { class: 'x', onclick: onExit }, '✕'), h('div', { class: 'qbar' }, h('div', { style: `width:${i / list.length * 100}%` })), h('span', { class: 'qn' }, `${i + 1} / ${list.length}`)));
    else root.append(h('h2', {}, '순간 작문', h('span', {}, `${i + 1} / ${list.length}`)));
    const inp = h('textarea', { rows: 2, lang: 'ja', placeholder: '일본어로 써 보세요 (말로 해 본 뒤 써도 좋아요)' });
    const out = h('div');
    const chk = h('button', { class: 'btn', onclick: () => check() }, '확인');
    root.append(h('div', { class: 'drillko' }, d.ko), inp, h('div', { class: 'row end' }, h('button', { class: 'btn ghost', onclick: () => reveal(null) }, '모르겠어요'), chk), out);
    setTimeout(() => inp.focus(), 50);
    async function check() {
      const a = inp.value.trim(); if (!a) { reveal(null); return; }
      if (!App.sample) { reveal(null, a); return; }
      const done = busy(chk, '채점 중…');
      try {
        const r = await aiJSON(`한국인 일본어 학습자의 작문을 채점하세요.
한국어: ${d.ko}
모범 답안: ${d.jp}
학습자 답: ${a}
의미가 통하고 문법이 맞으면 ok=true (모범 답안과 달라도 자연스러우면 정답). JSON만: {"ok":true,"fixed":"학습자 답을 최소한으로 고친 문장","why":"한국어로 짧은 피드백 1~2문장"}`, { modelTier: 'quick', cache: false });
        reveal(r, a);
      } catch (e) { toast(aiErrorText(e), 'err'); reveal(null, a); } finally { done(); }
    }
    function reveal(r, a) {
      chk.disabled = true; out.innerHTML = '';
      const ok = r ? !!r.ok : null;
      out.append(h('div', { class: 'fb ' + (ok === true ? 'ok' : ok === false ? 'no' : '') },
        r ? h('b', {}, ok ? '자연스러워요!' : '이렇게 고쳐 보세요') : h('b', {}, '모범 답안'),
        r && !ok && r.fixed ? h('div', { class: 'big', lang: 'ja' }, r.fixed) : null,
        r?.why ? h('div', {}, r.why) : null,
        h('div', { class: 'model' }, '모범 답안: ', jp(d.jp), h('button', { class: 'say', onclick: () => TTS.speak([{ s: 'N', t: d.jp }]) }, '🔈'))));
      const mark = good => { d.ok = good ? (d.ok || 0) + 1 : 0; d.ng = good ? (d.ng || 0) : (d.ng || 0) + 1; d.last = App.today; markDirty('drill'); if (i < list.length - 1) { i++; show(); } else { flushSaves(); onDone && onDone(); } };
      out.append(h('div', { class: 'row end' }, ok === null ? h('button', { class: 'btn ghost', onclick: () => mark(false) }, '✕ 못 했어요') : null, ok === null ? h('button', { class: 'btn', onclick: () => mark(true) }, '○ 맞았어요') : h('button', { class: 'btn', onclick: () => mark(ok) }, i < list.length - 1 ? '다음 →' : '완료')));
    }
  };
  show();
}
function renderRole(v) {
  const cols = h('div', { class: 'cols-talk' }); v.append(cols);
  const chatCard = h('section', { class: 'card chat' }); const side = h('section', {});
  cols.append(chatCard, side);
  const sceneCard = card('워홀 장면', '단계별 해제'); side.append(sceneCard);
  const usedCard = card('이번 대화에서 쓴 문법'); side.append(usedCard);
  const lv = targetLevel();
  let current = null, turns = [], fixes = [], used = {};
  // 장면을 바꾸면 session이 바뀌어서, 이전 장면의 늦게 온 답이 새 장면에 섞이지 않아요
  let session = 0, waiting = false;
  SCENES.forEach(s => {
    const locked = s.lv < lv - 1;
    sceneCard.append(h('button', { class: 'sc' + (locked ? ' lock' : ''), onclick: () => !locked && open(s) }, h('div', { class: 'ic' }, s.ic), h('div', { class: 't' }, s.t, h('p', {}, s.d)), h('span', { class: 'chip c-gray' }, locked ? `N${s.lv} 이후` : `N${s.lv}`)));
  });
  sceneCard.append(h('div', { class: 'muted sm', style: 'margin-top:12px' }, '경어 단계'), h('div', { class: 'steps' }, [5, 4, 3].map(l => h('div', { class: lv <= l ? 'on' : '' }))), h('div', { class: 'stl' }, h('span', {}, '정중체'), h('span', {}, '丁寧語 확장'), h('span', {}, '尊敬語・謙譲語')));
  chatCard.append(h('div', { class: 'empty' }, '오른쪽에서 장면을 골라 주세요.'));
  if (!App.sample) chatCard.append(aiMissing());
  async function open(s) {
    const my = ++session; waiting = false;
    current = s; fixes = []; used = {}; turns = [];
    $$('.sc', sceneCard).forEach((b, i) => b.classList.toggle('on', SCENES[i] === s));
    let saved = null;
    if (App.db) { const snap = await App.db.doc('talk/' + s.id).get().catch(() => null); if (snap?.exists) saved = JSON.parse(JSON.stringify(snap.data())); }
    if (my !== session) return; // 불러오는 사이 다른 장면을 고름
    turns = saved?.turns || [];
    drawChat();
    if (!turns.length) send(null);
  }
  const rules = s => `당신은 일본어 회화 롤플레이 상대입니다. 역할: ${s.role}. 장면: ${s.t}.
학습자: 한국인, JLPT N${lv} 수준, 워홀 준비 중. 학습자가 배운 문법: ${learnedContext(lv, 50)}
규칙: 1) 짧고 자연스러운 일본어로 한두 문장씩 말하고, 질문으로 대화를 이어가세요. N${lv} 수준 어휘 위주. 2) 학습자의 마지막 일본어에 문법·어휘 오류가 있으면 fix에 고친 문장을 주세요(없으면 null). 3) 8턴 정도에서 장면을 자연스럽게 마무리하고 end=true.
매번 JSON만 답하세요: {"reply":"당신의 대사(일본어)","ko":"대사의 한국어 뜻","fix":{"wrong":"틀린 부분","right":"고친 문장 전체","why":"한국어 설명","ko":"고친 문장의 한국어 뜻"} 또는 null,"used":["학습자가 쓴 문형"],"end":false}`;
  function drawChat() {
    chatCard.innerHTML = '';
    const s = current;
    chatCard.append(h('div', { class: 'scene' }, h('div', { class: 'ic' }, s.ic), h('div', {}, h('b', {}, s.t), h('p', {}, s.role)), h('div', { class: 'r' }, h('span', { class: 'chip c-gray' }, `${turns.filter(t => t.role === 'user' && !t.sys).length} 턴`), h('button', { class: 'btn ghost sm', onclick: () => { session++; waiting = false; turns = []; App.db && App.db.doc('talk/' + s.id).delete().catch(() => {}); drawChat(); send(null); } }, '처음부터'))));
    const msgs = h('div', { class: 'msgs' }); chatCard.append(msgs);
    for (const t of turns) {
      if (t.sys) continue;
      if (t.role === 'assistant') msgs.append(h('div', { class: 'm ai' }, h('div', { class: 'bub', lang: 'ja' }, t.reply || t.content, h('button', { class: 'say', onclick: () => TTS.speak([{ s: 'N', t: t.reply || t.content }]) }, '🔈')), t.ko ? h('div', { class: 'ko' }, t.ko) : null));
      else msgs.append(h('div', { class: 'm me' }, h('div', { class: 'bub', lang: 'ja' }, t.content)));
      if (t.fix) msgs.append(h('div', { class: 'fix' }, h('b', {}, '이렇게 고쳐 보세요'), h('div', { class: 'ok', lang: 'ja' }, t.fix.right), h('div', {}, t.fix.why || ''), h('span', { class: 'red' }, ' 순간 작문에 추가됨')));
    }
    const inp = h('input', { lang: 'ja', placeholder: '일본어로 답해 보세요', onkeydown: e => { if (e.key === 'Enter' && !e.isComposing) go(); } });
    const go = () => { const t = inp.value.trim(); if (!t) return; inp.value = ''; send(t); };
    const hint = h('button', { class: 'ib', onclick: async () => {
      const last = [...turns].reverse().find(t => t.role === 'assistant'); if (!last) return;
      try { const r = await aiJSON(`일본어 회화 연습 중입니다. 상대의 말: 「${last.reply || last.content}」. N${lv} 학습자가 할 수 있는 자연스러운 대답 예시 2개를 JSON 배열로: [{"jp":"","ko":""}]`, { modelTier: 'quick' }); modal(h('div', {}, h('h2', {}, '대답 힌트'), ...(r || []).map(x => h('div', { class: 'mm' }, jp(x.jp, 'jpl'), h('p', {}, x.ko))))); } catch (e) { toast(aiErrorText(e), 'err'); }
    } }, '힌트');
    const ask = h('button', { class: 'ib', onclick: () => {
      const kin = h('input', { placeholder: '예) 주말에는 보통 카페에서 일해요' });
      const go2 = h('button', { class: 'btn', onclick: async () => {
        const k = kin.value.trim(); if (!k) return; const done = busy(go2, '바꾸는 중…');
        try { const r = await aiJSON(`다음 한국어를 이 장면(${current.t})에 맞는 자연스러운 일본어(N${lv} 수준, 정중체)로 바꿔 주세요: "${k}". JSON: {"jp":"","r":"히라가나 읽기"}`, { modelTier: 'quick' }); inp.value = r.jp || ''; mm.close(); inp.focus(); } catch (e) { toast(aiErrorText(e), 'err'); done(); }
      } }, '일본어로 바꾸기');
      const mm = modal(h('div', {}, h('h2', {}, '한국어로 물어보기'), h('p', { class: 'muted' }, '하고 싶은 말을 한국어로 적으면 입력칸에 일본어로 넣어 드려요.'), kin, h('div', { class: 'row end' }, go2)));
      setTimeout(() => kin.focus(), 50);
    } }, '한국어로 물어보기');
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const mic = SR ? h('button', { class: 'mic', title: '음성 입력', onclick: () => { try { const r = new SR(); r.lang = 'ja-JP'; r.interimResults = false; mic.classList.add('rec'); r.onresult = e => { inp.value = e.results[0][0].transcript; }; r.onend = () => mic.classList.remove('rec'); r.onerror = () => { mic.classList.remove('rec'); toast('음성 입력을 쓸 수 없어요. 타이핑해 주세요.'); }; r.start(); } catch { toast('음성 입력을 쓸 수 없어요.'); } } }, '●') : null;
    chatCard.append(h('div', { class: 'input' }, inp, hint, ask, mic, h('button', { class: 'btn', onclick: go }, '보내기')));
    msgs.scrollTop = msgs.scrollHeight;
    drawUsed();
  }
  function drawUsed() {
    usedCard.innerHTML = ''; usedCard.append(h('h2', {}, '이번 대화에서 쓴 문법'));
    const all = {}; for (const t of turns) for (const u of t.used || []) all[u] = (all[u] || 0) + 1;
    const fx = turns.filter(t => t.fix);
    if (!Object.keys(all).length && !fx.length) usedCard.append(h('div', { class: 'muted sm' }, '대화를 시작하면 여기에 쌓여요.'));
    for (const [u] of Object.entries(all)) usedCard.append(h('div', { class: 'kv' }, jp(u), h('span', { class: 'chip c-green' }, '사용')));
    for (const t of fx) usedCard.append(h('div', { class: 'kv' }, jp(t.fix.right.slice(0, 18)), h('span', { class: 'chip c-red' }, '실수')));
    usedCard.append(h('p', { class: 'muted sm' }, '실수한 표현은 순간 작문 드릴로 다시 나와요'));
  }
  async function send(text) {
    if (!App.sample) return;
    if (waiting) { toast('상대가 답하는 중이에요. 답이 오면 보내 주세요.'); return; }
    const scene = current, my = session, myTurns = turns;
    if (text) myTurns.push({ role: 'user', content: text });
    drawChat();
    const msgs = $('.msgs', chatCard); const thinking = h('div', { class: 'm ai' }, h('div', { class: 'bub muted' }, '…')); msgs.append(thinking); msgs.scrollTop = msgs.scrollHeight;
    const conv = [{ role: 'user', content: rules(scene) + (myTurns.length ? '' : '\n\n장면을 시작하세요. 첫 대사를 하세요.') }];
    if (myTurns.length) conv.push({ role: 'assistant', content: '{"reply":"(시작)","ko":"","fix":null,"used":[],"end":false}' });
    for (const t of myTurns.slice(-16)) conv.push(t.role === 'assistant' ? { role: 'assistant', content: JSON.stringify({ reply: t.reply, ko: t.ko, fix: null, used: [], end: false }) } : { role: 'user', content: t.content });
    if (conv[conv.length - 1].role !== 'user') conv.push({ role: 'user', content: '(계속)' });
    waiting = true;
    try {
      const r = await aiJSON(conv, { modelTier: 'quick', cache: false });
      if (text && r.fix && r.fix.right) {
        const last = myTurns[myTurns.length - 1]; last.fix = { right: String(r.fix.right), why: String(r.fix.why || ''), wrong: String(r.fix.wrong || '') };
        App.drill.push({ id: uid('d'), ko: String(r.fix.ko || r.fix.why || ''), jp: String(r.fix.right), from: 'role', at: App.today, ok: 0, ng: 0 }); markDirty('drill');
      }
      if (text) myTurns[myTurns.length - 1].used = Array.isArray(r.used) ? r.used.slice(0, 4).map(String) : [];
      myTurns.push({ role: 'assistant', reply: String(r.reply || ''), ko: String(r.ko || ''), end: !!r.end });
      // 답은 항상 "보낸 장면"에만 저장 (그사이 다른 장면으로 바꿨어도 섞이지 않게)
      if (App.db) writeDoc('talk/' + scene.id, { turns: myTurns.slice(-40), at: App.today }).catch(() => {});
      if (my !== session) return;
      drawChat();
      if (r.end) toast('장면이 끝났어요. 수고했어요!');
    } catch (e) { if (my === session) { thinking.remove(); toast(aiErrorText(e), 'err'); } }
    finally { if (my === session) waiting = false; }
  }
}
function renderPrep(v) {
  const wrap = h('div', { class: 'grid2' }); v.append(wrap);
  const topic = h('input', { placeholder: '예) 주말에 한 일, 좋아하는 음식, 일본 여행 계획' });
  const out = h('div');
  const btn = h('button', { class: 'btn', onclick: async () => {
    if (!App.sample) return;
    const done = busy(btn, '만드는 중…');
    try {
      const r = await aiJSON(`한국인 일본어 학습자(JLPT N${targetLevel()}, 배운 문법: ${learnedContext(targetLevel(), 40)})가 원어민 없는 일본어 프리토킹 모임에서 쓸 표현을 준비합니다. 주제: ${topic.value || '자유 주제'}.
배운 범위 안에서 바로 쓸 수 있는 표현 6개와, 상대에게 던질 질문 3개를 주세요. JSON만: {"say":[{"jp":"","ko":"","tip":"쓰는 상황 한 줄"}],"ask":[{"jp":"","ko":""}]}`, { modelTier: 'default', async: true, kind: 'prep' });
      out.innerHTML = '';
      const all = [...(r.say || []), ...(r.ask || [])];
      out.append(h('h3', { class: 'mini' }, '말해 볼 표현'), ...(r.say || []).map(x => h('div', { class: 'mm' }, h('div', { class: 'jpl', lang: 'ja' }, x.jp, h('button', { class: 'say', onclick: () => TTS.speak([{ s: 'N', t: x.jp }]) }, '🔈')), h('p', {}, x.ko + (x.tip ? ' · ' + x.tip : '')))),
        h('h3', { class: 'mini' }, '상대에게 물어볼 질문'), ...(r.ask || []).map(x => h('div', { class: 'mm' }, h('div', { class: 'jpl', lang: 'ja' }, x.jp), h('p', {}, x.ko))),
        h('div', { class: 'row end' }, h('button', { class: 'btn ghost', onclick: e => { for (const x of all) if (x.jp) App.drill.push({ id: uid('d'), ko: x.ko, jp: x.jp, from: 'ai', at: App.today, ok: 0, ng: 0 }); markDirty('drill'); flushSaves(); e.currentTarget.disabled = true; toast('순간 작문에 추가했어요.'); } }, '순간 작문에 모두 추가')));
    } catch (e) { toast(aiErrorText(e), 'err'); } finally { done(); }
  } }, '표현 만들기');
  wrap.append(card('모임 준비', App.state.nextMeet ? '다음 모임 ' + App.state.nextMeet : '', h('div', { class: 'label' }, '다음 모임 주제'), topic, h('div', { class: 'row end' }, App.sample ? btn : aiMissing()), out));
  const recent = App.memos.slice(0, 8).flatMap(m => m.entries || []);
  wrap.append(card('지난 모임에서 막혔던 것', '', recent.length ? recent.slice(0, 12).map(e => h('div', { class: 'mm' }, jp(e.jp, 'jpl'), h('p', {}, e.ko))) : h('div', { class: 'muted' }, '모임 메모를 저장하면 여기에 모여요.')));
}

/* =================== STATS =================== */
function renderStats(v) {
  v.append(pageHead('내 실력', '레벨별 진행도와 약점, 전체 학습 항목을 한눈에 봐요', h('button', { class: 'btn ghost', onclick: () => nav('settings') }, '⚙ 설정')));
  const lv = h('div', { class: 'lvcards' }); v.append(lv);
  const plans = {}; for (const e of exams()) plans[+e.level] = md(e.date).replace(/^/, e.date.slice(0, 4) !== App.today.slice(0, 4) ? e.date.slice(0, 4) + '년 ' : ''); [5, 4, 3, 2].forEach(l => plans[l] = plans[l] || (l === targetLevel() ? '목표' : '준비 중'));
  for (const L of [5, 4, 3, 2]) {
    const s = levelStats(L); const p = s.total ? Math.round((s.a + s.l + s.m) / s.total * 100) : 0;
    lv.append(h('div', { class: 'lc' + (L === targetLevel() ? ' now' : '') + (s.total && p < 5 ? ' dim' : '') },
      h('div', { class: 'h' }, h('b', {}, 'N' + L), h('span', { class: 'chip ' + (L === targetLevel() ? 'c-red' : 'c-gray') }, plans[L])),
      h('div', { class: 'pct' }, p + '%'), h('p', {}, s.total ? `배운 항목 · ${s.total}개 중 ${s.a + s.l + s.m}개 (익힘 ${s.m})` : '데이터 준비 중 (N3·N2는 다음 단계)'),
      h('div', { class: 'tr' }, ['m', 'l', 'a'].map((k, i) => h('div', { style: `width:${s.total ? s[k] / s.total * 100 : 0}%;background:${['var(--ok)', 'var(--amber)', 'var(--blue)'][i]}` })))));
  }
  const row = h('div', { class: 'grid2 r2' }); v.append(row);
  row.append(card('주간 정답률', '최근 4주 · 영역별', weeklyChart()));
  const weak = weakItems(6);
  row.append(card('자주 틀리는 항목', '최근 2주', weak.length ? h('ul', { class: 'weak' }, weak.map(([id, n], i) => { const it = App.byId[id]; return h('li', {}, h('span', { class: 'n' }, String(i + 1)), h('div', { class: 't' }, h('span', { lang: 'ja' }, itemLabel(it)), h('p', {}, (it.r && it.t === 'v' ? it.r + ' · ' : '') + it.m)), h('span', { class: 'cnt' }, n + '회')); })) : h('div', { class: 'muted' }, '아직 틀린 기록이 없어요.')));
  // DB table
  const db = card('전체 학습 항목', `마스터 DB · ${allVocab().length + App.M.kanji.length + allGrammar().length}개`); v.append(db);
  const q = h('input', { placeholder: '단어, 한자, 문법, 뜻 검색…' });
  const fType = h('select', {}, [['', '전체'], ['v', '단어'], ['k', '한자'], ['g', '문법']].map(([k, n]) => h('option', { value: k }, n)));
  const fLv = h('select', {}, [['', '전 레벨'], ['5', 'N5'], ['4', 'N4'], ['3', 'N3'], ['2', 'N2'], ['0', '기타']].map(([k, n]) => h('option', { value: k }, n)));
  const fSt = h('select', {}, [['', '전 상태'], ...Object.entries(STATUS)].map(([k, n]) => h('option', { value: k }, n)));
  const tbl = h('div', { class: 'tblwrap' }); let page = 0;
  const more = h('button', { class: 'linkbtn', onclick: () => { page++; draw(false); } }, '더 보기');
  db.append(h('div', { class: 'search' }, q, fType, fLv, fSt), tbl, more);
  [q, fType, fLv, fSt].forEach(el => el.addEventListener('input', () => { page = 0; draw(true); }));
  let rows = [];
  function draw(reset = true) {
    if (reset) {
      const s = q.value.trim().toLowerCase();
      rows = [...allVocab(), ...App.M.kanji, ...allGrammar()].filter(it => (!fType.value || it.t === fType.value) && (!fLv.value || String(it.l || 0) === fLv.value) && (!fSt.value || status(it.id) === fSt.value) && (!s || [itemLabel(it), it.r, it.m, it.on, it.kun].some(x => x && String(x).toLowerCase().includes(s))));
      tbl.innerHTML = '';
      tbl.append(h('table', { class: 'tbl' }, h('thead', {}, h('tr', {}, ['항목', '읽기', '뜻', '종류', '레벨', '상태', '최근 기록', '다음 복습'].map(t => h('th', {}, t)))), h('tbody')));
    }
    const tb = $('tbody', tbl);
    for (const it of rows.slice(page * 50, page * 50 + 50)) {
      const p = P(it.id) || {}; const st = p.s || 'n';
      tb.append(h('tr', { class: 'click', onclick: () => itemDetail(it, () => draw(true)) }, h('td', { lang: 'ja' }, itemLabel(it)), h('td', { lang: 'ja' }, it.t === 'k' ? (it.kun || it.on) : it.r || ''), h('td', {}, it.m), h('td', {}, { v: '단어', k: '한자', g: '문법' }[it.t]), h('td', {}, it.l ? 'N' + it.l : '-'),
        h('td', {}, h('span', { class: 'chip ' + STATUS_CLS[st] }, STATUS[st])), h('td', {}, h('div', { class: 'hist' }, (p.h || '').padStart(4, ' ').slice(-4).split('').map(c => h('i', { class: c === 'o' ? 'o' : c === 'x' ? 'x' : 'e' })))), h('td', {}, p.nx ? (p.nx === App.today ? '오늘' : p.nx.slice(5).replace('-', '/')) : '-')));
    }
    more.hidden = (page + 1) * 50 >= rows.length;
  }
  draw();
  // settings
}
function itemDetail(it, after) {
  const p = P(it.id) || {};
  const sel = h('select', {}, Object.entries(STATUS).map(([k, n]) => h('option', { value: k, selected: k === (p.s || 'n') }, n)));
  const ex = it.t === 'v' ? App.EX.filter(e => e.j.includes(it.w)).slice(0, 4) : [];
  const m = modal(h('div', {},
    h('h2', { class: 'jp-serif', lang: 'ja' }, itemLabel(it)), h('p', { class: 'muted' }, [it.r, it.on && '음 ' + it.on, it.kun && '훈 ' + it.kun].filter(Boolean).join(' · ')),
    h('div', { class: 'big' }, it.m), it.f ? h('div', { class: 'box' }, it.f) : null, it.ej ? h('div', { class: 'ex' }, jp(it.ej), h('small', {}, it.ek)) : null,
    it.n ? h('p', { class: 'muted' }, it.n) : null, ...ex.map(e => h('div', { class: 'ex' }, jp(e.j), h('small', {}, e.k))),
    h('div', { class: 'kv' }, h('span', {}, '정답 / 오답'), h('b', {}, `${p.r || 0} / ${p.w || 0}`)), h('div', { class: 'kv' }, h('span', {}, '연속 정답일'), h('b', {}, String(p.c || 0))),
    h('div', { class: 'row' }, h('label', {}, '상태 직접 바꾸기 ', sel), h('button', { class: 'btn sm', onclick: () => { const q = ensureP(it.id); q.s = sel.value; if (sel.value === 'm') q.c = Math.max(q.c || 0, 3); markDirty('prog:' + chunkOf(it.id)); flushSaves(); m.close(); after && after(); } }, '저장'),
      h('button', { class: 'btn ghost sm', onclick: () => TTS.speak([{ s: 'N', t: it.t === 'v' ? it.w : it.t === 'k' ? it.c : (it.ej || '') }]) }, '🔈 듣기'))));
}
function weeklyChart() {
  const W = weeklyAccuracy(4);
  const colors = { v: '#2F4A3A', g: '#3D6A8A', r: '#B9852F', l: '#C4553C' };
  const any = W.some(w => Object.values(w.acc).some(a => a[1]));
  if (!any) return h('div', { class: 'empty sm' }, '문제를 풀면 주별 정답률 그래프가 그려져요.');
  const x = i => 80 + i * 180, y = p => 185 - p * 1.65;
  let svg = `<svg viewBox="0 0 720 225" width="100%" role="img" aria-label="주간 정답률"><g stroke="var(--line)">${[100, 70, 40, 10].map(p => `<line x1="40" x2="690" y1="${y(p)}" y2="${y(p)}"/>`).join('')}</g><g font-size="11" fill="var(--muted)">${[100, 70, 40, 10].map(p => `<text x="8" y="${y(p) + 4}">${p}</text>`).join('')}${W.map((w, i) => `<text x="${x(i) - 14}" y="214">${w.label}</text>`).join('')}</g>`;
  const usedY = [];
  for (const a of ['v', 'g', 'r', 'l']) {
    const pts = W.map((w, i) => w.acc[a][1] ? [x(i), y(w.acc[a][0] / w.acc[a][1] * 100)] : null).filter(Boolean);
    if (!pts.length) continue;
    svg += `<polyline fill="none" stroke="${colors[a]}" stroke-width="3" points="${pts.map(p => p.join(',')).join(' ')}"/>` + pts.map(p => `<circle cx="${p[0]}" cy="${p[1]}" r="4" fill="${colors[a]}"><title>${AREA[a]}</title></circle>`).join('');
    const l = pts[pts.length - 1]; let ly = l[1] + 4; while (usedY.some(u => Math.abs(u - ly) < 14)) ly += 14; usedY.push(ly); // 이름표가 겹치지 않게
    svg += `<text x="${l[0] + 8}" y="${ly}" font-size="12" font-weight="700" fill="${colors[a]}">${AREA[a]}</text>`;
  }
  return h('div', { html: svg + '</svg>' });
}

/* =================== SETTINGS =================== */
function renderSettings(v) {
  v.append(pageHead('설정', '공부방 이름, 교재, 시험 일정, AI 연결과 백업을 관리해요'));
  const wrap = h('div', { class: 'grid2 settings' }); v.append(wrap);
  const left = h('div', { class: 'stackcol' }), right = h('div', { class: 'stackcol' });
  wrap.append(left, right);
  const save = (msg = '저장했어요.') => { saveState(); flushSaves(); toast(msg); };

  // 1. 이름·부제
  const pr = profile();
  const nameIn = h('input', { id: 'setName', value: pr.name, maxlength: 30 });
  const subIn = h('input', { id: 'setSub', value: pr.sub, maxlength: 40 });
  left.append(card('공부방 이름', '', h('div', { class: 'label' }, '이름'), nameIn, h('div', { class: 'label' }, '부제'), subIn,
    h('div', { class: 'row end' }, h('button', { class: 'btn sm', onclick: () => { App.state.profile = { name: nameIn.value.trim() || '일본어 공부방', sub: subIn.value.trim() }; save(); nav('settings'); } }, '저장'))));

  // 2. 교재 목록
  const bookCard = card('교재 목록', '수업 기록에서 고르는 교재'); left.append(bookCard);
  const drawBooks = () => {
    $$('.bookrow, .bookadd', bookCard).forEach(e => e.remove());
    const bl = [...books()];
    bl.forEach((b, i) => bookCard.append(h('div', { class: 'kv bookrow' }, h('span', {}, b),
      h('div', { class: 'row tight gap' },
        i > 0 ? h('button', { class: 'ib sm', title: '위로', onclick: () => { [bl[i - 1], bl[i]] = [bl[i], bl[i - 1]]; App.state.books = bl; save('순서를 바꿨어요.'); drawBooks(); } }, '↑') : null,
        h('button', { class: 'ib sm del', title: '삭제', onclick: () => {
          if (bl.length <= 1) { toast('교재는 하나 이상 있어야 해요.'); return; }
          const mm = modal(h('div', {}, h('h2', {}, '교재 삭제'), h('p', {}, `"${b}"을(를) 목록에서 뺄까요? 이미 기록한 수업 노트는 그대로 남아요.`),
            h('div', { class: 'row end' }, h('button', { class: 'btn ghost', onclick: () => mm.close() }, '취소'), h('button', { class: 'btn', onclick: () => { bl.splice(i, 1); App.state.books = bl; save('삭제했어요.'); mm.close(); drawBooks(); } }, '삭제'))));
        } }, '삭제')))));
    const addIn = h('input', { placeholder: '예) 우키우키 중급, 新完全マスター N2 문법' });
    const add = () => { const t = addIn.value.trim(); if (!t) return; if (bl.includes(t)) { toast('이미 있는 교재예요.'); return; } bl.push(t); App.state.books = bl; save('교재를 추가했어요.'); drawBooks(); };
    addIn.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) add(); });
    bookCard.append(h('div', { class: 'row bookadd' }, addIn, h('button', { class: 'btn sm', onclick: add }, '추가')));
  };
  drawBooks();

  // 3. 시험 일정
  const examCard = card('시험 일정', '지난 시험은 자동으로 다음 시험으로 넘어가요'); right.append(examCard);
  const drawExams = () => {
    $$('.examrow, .examfoot, .examnote', examCard).forEach(e => e.remove());
    const list = exams().map(e => ({ ...e }));
    const nx = nextExam();
    list.sort((a, b) => a.date.localeCompare(b.date));
    list.forEach((e, i) => {
      const nameIn = h('input', { class: 'ename', value: e.name, onchange: () => e.name = nameIn.value.trim() || e.name });
      const dateIn = h('input', { class: 'edate', type: 'date', value: e.date, onchange: () => e.date = dateIn.value || e.date });
      const lvSel = h('select', { class: 'elv', onchange: () => e.level = +lvSel.value }, [5, 4, 3, 2, 1].map(l => h('option', { value: l, selected: l === +e.level }, 'N' + l)));
      const past = e.date < App.today;
      examCard.append(h('div', { class: 'examrow' + (past ? ' past' : '') },
        h('span', { class: 'chip ' + (e.date === nx.date && e.name === nx.name ? 'c-red' : past ? 'c-gray' : 'c-blue') }, e.date === nx.date && e.name === nx.name ? '다음 시험' : past ? '지남' : '예정'),
        nameIn, dateIn, lvSel, h('button', { class: 'ib sm del', title: '삭제', onclick: () => { if (list.length <= 1) { toast('시험은 하나 이상 있어야 해요.'); return; } list.splice(i, 1); App.state.exams = list; save('삭제했어요.'); drawExams(); } }, '삭제')));
    });
    examCard.append(h('p', { class: 'muted sm examnote' }, '"다음 시험"의 레벨이 목표 레벨이 되어 오늘 세트와 시험 출제 범위가 따라가요. N2 날짜는 7월 첫째 일요일 예정일이니, 공식 발표가 나면 고쳐 주세요.'),
      h('div', { class: 'row examfoot' },
        h('button', { class: 'btn ghost sm', onclick: () => { list.push({ name: 'JLPT', date: addDays(App.today, 180), level: 3 }); App.state.exams = list; save('시험을 추가했어요. 이름과 날짜를 고쳐 주세요.'); drawExams(); } }, '＋ 시험 추가'),
        h('button', { class: 'btn sm', onclick: () => { App.state.exams = list; App.dayDoc = null; save(); drawExams(); } }, '저장')));
  };
  drawExams();

  // 4. 매일 아침 자동 문제
  const ag = Object.assign({ on: true, hour: 7 }, App.state.autoGen || {});
  const onIn = h('input', { type: 'checkbox', id: 'agOn', checked: ag.on });
  const hourSel = h('select', { id: 'agHour' }, Array.from({ length: 24 }, (_, i) => h('option', { value: i, selected: i === +ag.hour }, `${i < 12 ? '오전' : '오후'} ${i % 12 || 12}시`)));
  const lr = ag.lastResult;
  const lastLine = lr ? (lr.ok ? (lr.n ? `${md(lr.date)} ${lr.at}에 문제 ${lr.n}개를 만들었어요` : `${md(lr.date)} ${lr.at} · ${lr.msg || '건너뜀'}`) : `${md(lr.date)} ${lr.at} 실패 · ${lr.msg || ''}`) : '아직 자동으로 만든 기록이 없어요. Supabase 예약 실행(Cron) 설정 후 다음 날부터 기록돼요.';
  const nowBtn = h('button', { class: 'btn ghost sm', onclick: async () => {
    const done = busy(nowBtn, '만드는 중…');
    try {
      const ids = [...new Set(dueItems(5).concat((App.lessons[0] ? (App.lessons[0].grammarIds || []).concat(App.lessons[0].vocabIds || []) : []).slice(0, 8), pickStudyIds(targetLevel(), 10)))].slice(0, 18);
      const b = await generateQuestions({ ids, level: targetLevel(), source: 'daily', title: '바로 만든 문제' });
      toast(`문제 ${b.qs.length}개를 만들었어요.`);
    } catch (e) { toast(aiErrorText(e), 'err'); } finally { done(); }
  } }, '지금 한 번 만들기');
  right.append(card('매일 아침 자동 문제', '',
    h('p', { class: 'muted sm' }, '정한 시각에 최근 수업·복습·오답·약한 영역을 바탕으로 15~20문항을 미리 만들어 둬요. 안 푼 문제가 40개 넘게 쌓여 있으면 그날은 건너뛰어요.'),
    h('div', { class: 'row wrap' }, h('label', {}, onIn, ' 자동으로 만들기'), h('label', {}, '시각 ', hourSel)),
    h('div', { class: 'kv' }, h('span', {}, '최근 실행'), h('b', { class: lr && !lr.ok ? 'red' : '' }, lastLine)),
    h('div', { class: 'row end' }, nowBtn, h('button', { class: 'btn sm', onclick: () => { App.state.autoGen = Object.assign({}, App.state.autoGen || {}, { on: onIn.checked, hour: +hourSel.value }); save(onIn.checked ? `매일 ${hourSel.selectedOptions[0].textContent}에 문제를 만들어요.` : '자동 만들기를 껐어요.'); } }, '저장'))));

  // 5. AI 연결 테스트
  const out = h('div', { class: 'aitest' });
  const tbtn = h('button', { class: 'btn sm', onclick: async () => {
    out.innerHTML = ''; const done = busy(tbtn, '확인 중…');
    const line = (ok, label, detail) => { out.append(h('div', { class: 'kv' }, h('span', {}, (ok ? '✅ ' : '❌ ') + label), h('b', { class: ok ? '' : 'red' }, detail || ''))); if (ok) fallbackNote(); };
    // 기본 모델 대신 다른 모델이 응답했으면 알려줘요 (모델 이름이 바뀌었거나 없어졌을 수 있어요)
    const fallbackNote = () => {
      const a = App.lastAI; if (!a?.primary || !a.model || a.model === a.primary) return;
      out.append(h('div', { class: 'note warn sm' }, `기본 모델 ${a.primary} 대신 ${a.model}가 응답했어요.`, a.skipped?.length ? h('div', { class: 'muted sm' }, a.skipped.join(' / ')) : null,
        h('div', { class: 'sm' }, /404|not found|model/i.test((a.skipped || []).join(' ')) ? '기본 모델이 없어진 것 같아요. Claude에게 "AI 모델 이름 바꿔줘"라고 요청하세요.' : '잠깐 붐벼서 그럴 수 있어요. 며칠 계속 이러면 모델을 바꿀 때예요.')));
    };
    try {
      if (!App.sample) { line(false, '연결 설정', 'Supabase 연결 없음'); return; }
      let t0 = Date.now();
      try { const r = await App.sample.json('JSON만 답하세요: {"ok":true,"hello":"こんにちは"}', { modelTier: 'quick', cache: false }); line(!!r, '빠른 모델', [App.lastAI?.model, ((Date.now() - t0) / 1000).toFixed(1) + '초'].filter(Boolean).join(' · ')); }
      catch (e) { line(false, '빠른 모델', aiErrorText(e)); showRaw(e); return; }
      t0 = Date.now();
      try { const r = await App.sample.json('JSON만 답하세요: {"ok":true}', { modelTier: 'vision', cache: false }); line(!!r, '사진 읽기 모델', [App.lastAI?.model, ((Date.now() - t0) / 1000).toFixed(1) + '초'].filter(Boolean).join(' · ')); }
      catch (e) { line(false, '사진 읽기 모델', aiErrorText(e)); }
      t0 = Date.now();
      try {
        const arr = await App.sample.json(`JLPT N5 문법 문제 2개를 만드세요.\n${Q_SPEC}`, { modelTier: 'default', async: true, kind: 'test' });
        const qs = validateQs(arr, null);
        line(qs.length > 0, '문제 만들기 (맡겨 두기 방식)', [App.lastAI?.model, ((Date.now() - t0) / 1000).toFixed(1) + '초', `문제 ${qs.length}개 읽음`].filter(Boolean).join(' · '));
        if (!qs.length) showRaw({ text: App.lastAI?.text });
      } catch (e) { line(false, '문제 만들기 모델', aiErrorText(e)); showRaw(e); }
    } finally { done(); }
    function showRaw(e) {
      const raw = e?.text || App.lastAI?.text || e?.message || '';
      if (raw) out.append(h('details', { class: 'raw' }, h('summary', {}, 'AI 응답 원문 보기 (오류 확인용)'), h('pre', {}, String(raw).slice(0, 3000))));
    }
  } }, 'AI 연결 테스트');
  right.append(card('AI 연결', '', h('p', { class: 'muted sm' }, '문제 만들기가 안 될 때 눌러 보세요. 키·함수·모델 중 어디가 문제인지 보여줘요.'), h('div', { class: 'row end' }, tbtn), out));

  // 6. 백업 · 로그아웃
  const impIn = h('input', { type: 'file', accept: 'application/json,.json', hidden: true, onchange: async () => {
    const f = impIn.files[0]; impIn.value = ''; if (!f) return;
    let rows; try { const j = JSON.parse(await f.text()); rows = Array.isArray(j) ? j : j.docs; } catch { toast('백업 파일을 읽지 못했어요.', 'err'); return; }
    if (!Array.isArray(rows) || !rows.every(r => r && typeof r.path === 'string' && r.data && typeof r.data === 'object')) { toast('공부방 백업 파일이 아니에요.', 'err'); return; }
    const mm = modal(h('div', {}, h('h2', {}, '백업 불러오기'), h('p', {}, `기록 ${rows.length}개를 불러와요. 같은 항목은 백업 내용으로 덮어써요.`),
      h('div', { class: 'row end' }, h('button', { class: 'btn ghost', onclick: () => mm.close() }, '취소'), h('button', { class: 'btn', onclick: async e => { const done = busy(e.currentTarget, '불러오는 중…'); try { await App.db.importAll(rows); toast('불러왔어요. 새로고침할게요.'); setTimeout(() => location.reload(), 800); } catch { toast('불러오기에 실패했어요.', 'err'); done(); } } }, '불러오기'))));
  } });
  right.append(card('기록 백업', App.state.lastBackup ? '마지막 백업 ' + App.state.lastBackup : '',
    h('p', { class: 'muted sm' }, '모든 학습 기록을 파일 하나로 내려받거나 다시 불러와요. 한 달에 한 번 정도 받아 두세요.'),
    h('div', { class: 'row end' },
      h('button', { class: 'btn ghost sm', onclick: async e => { const done = busy(e.currentTarget, '내보내는 중…'); try { await flushSaves(); const rows = await App.db.exportAll(); const blob = new Blob([JSON.stringify({ app: 'jp-study', at: new Date().toISOString(), docs: rows })], { type: 'application/json' }); const a = h('a', { href: URL.createObjectURL(blob), download: `공부방-백업-${App.today}.json` }); document.body.append(a); a.click(); a.remove(); App.state.lastBackup = App.today; saveState(); } catch { toast('내보내기에 실패했어요.', 'err'); } finally { done(); } } }, '백업 내려받기'),
      h('button', { class: 'btn ghost sm', onclick: () => impIn.click() }, '백업 불러오기'), impIn,
      App.signOut ? h('button', { class: 'btn ghost sm', onclick: () => App.signOut() }, '로그아웃') : null)));
}
