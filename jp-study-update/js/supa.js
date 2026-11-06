/* 일본어 공부방 · Supabase 연결 (DB · 사진 · AI) */
'use strict';

/* 문서 저장소: docs 테이블 한 개에 path(예: prog/W5) 단위로 JSON을 저장 */
function makeDb(sb, uid) {
  const fail = error => { const m = error?.message || ''; throw { code: /fetch|network/i.test(m) ? 'unavailable' : 'invalid_argument', message: m }; };
  const snapOf = (path, row) => ({ id: path.split('/').pop(), exists: !!row, data: () => row ? row.data : undefined, metadata: { fromCache: false } });
  const doc = path => ({
    id: path.split('/').pop(), path,
    async get() { const { data, error } = await sb.from('docs').select('data').eq('path', path).maybeSingle(); if (error) fail(error); return snapOf(path, data); },
    async set(d) { const { error } = await sb.from('docs').upsert({ user_id: uid, path, data: d, updated_at: new Date().toISOString() }, { onConflict: 'user_id,path' }); if (error) fail(error); },
    async update(d) { const s = await this.get(); if (!s.exists) throw { code: 'invalid_argument', message: 'missing' }; await this.set(Object.assign({}, s.data(), d)); },
    async delete() { const { error } = await sb.from('docs').delete().eq('path', path); if (error) fail(error); },
    collection: p => coll(path + '/' + p),
  });
  const coll = (path, ord, lim) => ({
    path,
    doc: id => doc(path + '/' + (id || Math.random().toString(36).slice(2, 12))),
    orderBy: (f, dir = 'asc') => coll(path, [f, dir], lim),
    limit: n => coll(path, ord, n),
    where: () => coll(path, ord, lim),
    async get() {
      const depth = path.split('/').length + 1, out = [];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await sb.from('docs').select('path,data').like('path', path + '/%').range(from, from + 999);
        if (error) fail(error);
        out.push(...data);
        if (data.length < 1000) break;
      }
      let rows = out.filter(r => r.path.split('/').length === depth);
      if (ord) { const [f, dir] = ord; rows.sort((a, b) => { const x = a.data?.[f], y = b.data?.[f]; return (x > y ? 1 : x < y ? -1 : 0) * (dir === 'desc' ? -1 : 1); }); }
      if (lim) rows = rows.slice(0, lim);
      const docs = rows.map(r => snapOf(r.path, r));
      return { docs, size: docs.length, empty: !docs.length };
    },
  });
  return {
    doc, collection: p => coll(p),
    async exportAll() { const out = []; for (let from = 0; ; from += 1000) { const { data, error } = await sb.from('docs').select('path,data,updated_at').range(from, from + 999); if (error) fail(error); out.push(...data); if (data.length < 1000) break; } return out; },
    async importAll(rows) { for (let i = 0; i < rows.length; i += 200) { const chunk = rows.slice(i, i + 200).map(r => ({ user_id: uid, path: r.path, data: r.data, updated_at: new Date().toISOString() })); const { error } = await sb.from('docs').upsert(chunk, { onConflict: 'user_id,path' }); if (error) fail(error); } },
  };
}

/* 사진 저장: Storage의 photos 버킷, 내 폴더(uid/)에만 */
function makeAssets(sb, uid) {
  return {
    async upload(file) {
      const blob = await shrinkImage(file, 2000, 0.85);
      const path = `${uid}/${Date.now()}-${Math.random().toString(36).slice(2, 6)}.jpg`;
      const { error } = await sb.storage.from('photos').upload(path, blob, { contentType: 'image/jpeg' });
      if (error) throw { code: 'upload_failed', message: error.message };
      return { id: path };
    },
    async url(path) { const { data, error } = await sb.storage.from('photos').createSignedUrl(path, 3600); if (error) throw error; return data.signedUrl; },
  };
}

/* 사진 크기 줄이기 (AI 전송·저장용) */
function shrinkImage(file, max = 1600, q = 0.85) {
  return new Promise((resolve, reject) => {
    const img = new Image(); const u = URL.createObjectURL(file);
    img.onload = () => {
      const s = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas'); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(u);
      c.toBlob(b => b ? resolve(b) : reject(new Error('image')), 'image/jpeg', q);
    };
    img.onerror = () => { URL.revokeObjectURL(u); reject({ code: 'image_rejected' }); };
    img.src = u;
  });
}
const blobToB64 = b => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(b); });

/* AI: Supabase Edge Function "ai"가 Gemini를 대신 호출 (API 키는 서버에만 보관) */
function makeSample(sb) {
  async function call(input, opts = {}, json = false) {
    if (opts.signal?.aborted) throw { code: 'cancelled' };
    let images;
    if (opts.images) {
      const list = Array.from(opts.images.length != null ? opts.images : [opts.images]).slice(0, 6);
      images = [];
      for (const f of list) { const b = await shrinkImage(f, 1600, 0.82); images.push({ mime: 'image/jpeg', data: await blobToB64(b) }); }
    }
    const req = sb.functions.invoke('ai', { body: { input, json, tier: opts.modelTier || 'default', images } });
    const aborted = new Promise((_, rej) => opts.signal?.addEventListener('abort', () => rej({ code: 'cancelled' })));
    const { data, error } = await Promise.race([req, aborted]);
    if (error) {
      let body = null; try { body = await error.context?.json(); } catch { }
      const st = error.context?.status;
      throw { code: body?.code || (st === 401 ? 'not_granted' : st === 429 ? 'rate_limited' : 'upstream'), message: body?.error || error.message };
    }
    if (data?.error) throw { code: data.code || 'upstream', message: data.error, text: data.text };
    const text = data?.text || '';
    App.lastAI = { at: Date.now(), model: data?.model, text: text.slice(0, 4000) };
    opts.onText && opts.onText({ text, delta: text });
    return { text, truncated: false };
  }
  const sample = (input, opts) => call(input, opts, false);
  sample.json = async (input, opts) => {
    const { text } = await call(input, opts, true);
    const v = parseLooseJSON(text);
    if (v === undefined) throw { code: 'invalid_json', text, message: text ? '' : '빈 응답' };
    return v;
  };
  sample.limits = async () => ({ images: { maxCount: 6 } });
  return sample;
}
function parseLooseJSON(t) {
  t = String(t || '').trim();
  try { return JSON.parse(t); } catch { }
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/); if (fence) { try { return JSON.parse(fence[1]); } catch { } }
  const a = t.search(/[[{]/), b = Math.max(t.lastIndexOf('}'), t.lastIndexOf(']'));
  if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch { } }
  return undefined;
}

/* 처음 로그인했을 때: 기존 시트에서 배운 항목을 "학원에서 배움"으로 반영 */
async function firstRunSeed() {
  const st = await App.db.doc('state/main').get();
  if (st.exists) return;
  const learned = await fetch('data/seed-learned.json').then(r => r.json()).catch(() => []);
  const chunks = {};
  for (const id of learned) (chunks[id.split('-')[0]] = chunks[id.split('-')[0]] || {})[id] = { s: 'a', c: 0, r: 0, w: 0 };
  for (const [k, items] of Object.entries(chunks)) await App.db.doc('prog/' + k).set({ items });
  await App.db.doc('state/main').set({ unit: '하권 2과', examDate: '2026-12-06', target: 5 });
}
