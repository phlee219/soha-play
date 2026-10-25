'use strict';
/* global clipNames */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
const shuffle = a => { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.random() * (i + 1) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; };
const pick = a => a[Math.random() * a.length | 0];
const wait = ms => new Promise(r => setTimeout(r, ms));
const GAMES = ['words', 'peek', 'find'];

let C = null;            // content.json
let cards = [];          // family cards from IndexedDB, each with .url for its photo
let screen = 'home';

/* ---------- settings & usage (small, per device) ---------- */
const S = (() => {
  const d = { sessionMin: 10, choices: 2, showWords: true, tips: true };
  try { return Object.assign(d, JSON.parse(localStorage.getItem('soha-settings') || '{}')); } catch { return d; }
})();
function saveSettings() { try { localStorage.setItem('soha-settings', JSON.stringify(S)); } catch {} }

const today = () => new Date().toLocaleDateString('sv');
let usagePending = 0;
function flushUsage() {
  if (!usagePending) return;
  try {
    const u = JSON.parse(localStorage.getItem('soha-usage') || '{}');
    u[today()] = (u[today()] || 0) + usagePending;
    for (const k of Object.keys(u).sort().slice(0, -30)) delete u[k];
    localStorage.setItem('soha-usage', JSON.stringify(u));
  } catch {}
  usagePending = 0;
}
function readUsage() { flushUsage(); try { return JSON.parse(localStorage.getItem('soha-usage') || '{}'); } catch { return {}; } }

/* ---------- family cards: photos and recordings stay in this device's IndexedDB ---------- */
let dbp = null;
function db() {
  return dbp || (dbp = new Promise((res, rej) => {
    const r = indexedDB.open('soha-play', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('cards', { keyPath: 'id' });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }));
}
async function store(mode, fn) {
  const d = await db();
  return new Promise((res, rej) => {
    const t = d.transaction('cards', mode);
    const req = fn(t.objectStore('cards'));
    t.oncomplete = () => res(req.result);
    t.onerror = t.onabort = () => rej(t.error);
  });
}
async function loadCards() {
  for (const c of cards) URL.revokeObjectURL(c.url);
  let list = [];
  try { list = await store('readonly', s => s.getAll()); } catch {}
  cards = list.sort((a, b) => a.createdAt - b.createdAt);
  for (const c of cards) c.url = URL.createObjectURL(c.image);
}

/* ---------- audio: pre-made voice clips + parent recordings, no device TTS ---------- */
const clipUrl = new Map();
function clipSrc(name) {
  if (!clipUrl.has(name)) {
    clipUrl.set(name, fetch(`audio/${name}.mp3`)
      .then(r => { if (!r.ok) throw new Error(r.status); return r.blob(); })
      .then(b => URL.createObjectURL(b))
      .catch(() => { clipUrl.delete(name); return null; }));
  }
  return clipUrl.get(name);
}
let token = 0, cur = null;
function stopAudio() {
  token++;
  if (cur) { cur.a.pause(); cur.done(); }
}
async function playOne(src, t) {
  const blob = src instanceof Blob;
  const url = blob ? URL.createObjectURL(src) : await clipSrc(src);
  if (!url) return;
  if (t !== token) { if (blob) URL.revokeObjectURL(url); return; }
  await new Promise(res => {
    const a = new Audio(url);
    const done = () => { if (cur && cur.a === a) cur = null; if (blob) URL.revokeObjectURL(url); res(); };
    cur = { a, done };
    a.onended = a.onerror = done;
    a.play().catch(done);
  });
}
// play(clipName | Blob | pauseMs, ...) — resolves true if it finished without being interrupted
async function play(...seq) {
  stopAudio();
  const t = token;
  for (const s of seq) {
    if (t !== token) return false;
    if (typeof s === 'number') await wait(s);
    else if (s) await playOne(s, t);
  }
  return t === token;
}

/* ---------- items ---------- */
const animalItem = a => ({ key: 'a-' + a.id, name: a.name, sub: a.sound, emoji: a.emoji,
  say: [`a-${a.id}-name`], sound: `a-${a.id}-sound`, where: [`a-${a.id}-where`] });
const wordItem = w => ({ key: 'w-' + w.id, name: w.name, emoji: w.emoji,
  say: [`w-${w.id}-name`], where: [`w-${w.id}-where`] });
const cardItem = c => ({ key: c.id, name: c.label, img: c.url,
  say: c.audio ? [c.audio] : [], where: c.audio ? [c.audio, 150, 'p-where'] : null });

function visual(it) {
  if (it.img) { const i = el('img', 'vis'); i.src = it.img; i.alt = it.name; i.draggable = false; return i; }
  return el('span', it.emoji ? 'vis emoji' : 'vis text', it.emoji || it.name);
}
function bounce(n) { n.classList.remove('bounce'); void n.offsetWidth; n.classList.add('bounce'); }

/* ---------- screens & play-time limit ---------- */
const sess = { start: 0, panelAt: 0, hiddenAt: 0 };
function sessionLeft() {
  if (!S.sessionMin || !sess.start) return Infinity;
  return S.sessionMin * 60000 - (Date.now() - sess.start);
}
function show(id) {
  stopAudio();
  $('#big').classList.remove('on');
  if (GAMES.includes(id)) {
    if (sessionLeft() <= 0) id = 'end';
    else if (!sess.start) sess.start = Date.now();
  }
  screen = id;
  $$('.screen').forEach(s => s.classList.toggle('on', s.id === id));
  if (id === 'words') renderWords();
  else if (id === 'peek') peekStart();
  else if (id === 'find') findNext();
  else if (id === 'end') play(600, 'p-bye');
  tickBar();
}
function tickBar() {
  const bar = $('#sessionBar'), left = sessionLeft();
  bar.classList.toggle('on', left !== Infinity && GAMES.includes(screen));
  if (left === Infinity) return;
  const f = Math.max(0, left / (S.sessionMin * 60000));
  bar.firstElementChild.style.width = (f * 100) + '%';
  bar.classList.toggle('low', f < .2);
}
setInterval(() => {
  const active = GAMES.includes(screen) && !sess.panelAt && document.visibilityState === 'visible';
  if (!active) return;
  if (++usagePending >= 15) flushUsage();
  if (sessionLeft() <= 0) show('end'); else tickBar();
}, 1000);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') { sess.hiddenAt = Date.now(); flushUsage(); stopAudio(); return; }
  // A long break (30 min+) starts a fresh session, unless the day's play already ended.
  if (sess.hiddenAt && Date.now() - sess.hiddenAt > 30 * 60000 && screen !== 'end') sess.start = 0;
  else if (sess.start && sess.hiddenAt) sess.start += Date.now() - sess.hiddenAt;  // time away doesn't count
  sess.hiddenAt = 0;
  tickBar();
});

/* ---------- 1. word cards ---------- */
function renderWords() {
  const g = $('#grid');
  g.textContent = '';
  const add = it => {
    const b = el('button', 'card');
    b.append(visual(it), el('span', 'lbl', it.name));
    b.onclick = () => openBig(it);
    g.append(b);
  };
  g.append(el('h3', 'sec', '우리 가족'));
  if (cards.length) cards.map(cardItem).forEach(add);
  else g.append(el('p', 'empty', '⚙️ 부모 설정에서 가족 사진과 목소리를 넣어 주세요'));
  if (S.showWords) { g.append(el('h3', 'sec', '낱말')); C.words.map(wordItem).forEach(add); }
}
let bigItem = null;
function openBig(it) {
  bigItem = it;
  const v = $('#bigVis');
  v.textContent = '';
  v.append(visual(it));
  $('#bigName').textContent = it.name;
  $('#big').classList.add('on');
  bounce(v);
  play(...it.say);
}
$('#big').addEventListener('click', e => {
  if (e.target.closest('#bigVis')) { bounce($('#bigVis')); play(...bigItem.say); return; }
  stopAudio();
  $('#big').classList.remove('on');
});

/* ---------- 2. animal peekaboo: ask, wait, reveal name then sound ---------- */
const peek = { order: [], i: 0, open: false, busy: false };
function peekStart() {
  peek.order = shuffle(C.animals.map(animalItem));
  peek.i = 0;
  peekSet();
  play(500, 'p-peek');
}
function peekSet() {
  const a = peek.order[peek.i % peek.order.length];
  peek.open = false;
  $('#peekAnimal').textContent = a.emoji;
  $('#stage').className = 'stage ' + pick(['door', 'bush']);
  $('#peekCap').classList.remove('on');
}
function peekTap() {
  if (peek.busy) return;
  const a = peek.order[peek.i % peek.order.length];
  if (!peek.open) {
    peek.open = true;
    $('#stage').classList.add('open');
    const cap = $('#peekCap');
    cap.querySelector('b').textContent = a.name;
    cap.querySelector('span').textContent = a.sub;
    cap.classList.add('on');
    play(250, ...a.say, 700, a.sound);
    return;
  }
  peek.busy = true;
  stopAudio();
  $('#stage').classList.remove('open');
  $('#peekCap').classList.remove('on');
  setTimeout(() => {
    peek.i++;
    if (peek.i % peek.order.length === 0) peek.order = shuffle(peek.order);
    peekSet();
    peek.busy = false;
    if (screen === 'peek') play(300, 'p-peek');
  }, 650);
}
$('#peekArea').addEventListener('click', peekTap);

/* ---------- 3. where is it? (receptive vocabulary, errorless) ---------- */
const F = { target: null, btn: null, last: null, round: 0, lock: false };
function findPools() {
  const pools = [C.animals.map(animalItem)];
  if (S.showWords) pools.push(C.words.map(wordItem));
  const fam = cards.filter(c => c.audio).map(cardItem);
  if (fam.length >= S.choices) pools.push(fam, fam);   // family photos come up more often
  return pools;
}
function findNext() {
  const pool = pick(findPools());
  let target;
  do target = pick(pool); while (pool.length > 1 && target.key === F.last);
  Object.assign(F, { target, last: target.key, lock: false, round: F.round + 1 });
  const opts = shuffle([target, ...shuffle(pool.filter(x => x.key !== target.key)).slice(0, S.choices - 1)]);
  const box = $('#choices');
  box.textContent = '';
  box.dataset.n = opts.length;
  for (const it of opts) {
    const b = el('button', 'choice');
    b.append(visual(it));
    b.onclick = () => findTap(b, it);
    box.append(b);
    if (it === target) F.btn = b;
  }
  play(500, ...target.where);
}
async function findTap(b, it) {
  if (F.lock) return;
  if (it !== F.target) {
    b.classList.remove('nope'); void b.offsetWidth; b.classList.add('nope');
    F.btn.classList.add('hint');
    play('p-here', 200, ...F.target.say);
    return;
  }
  F.lock = true;
  const round = F.round;
  $$('.choice').forEach(x => x.classList.toggle('fade', x !== b));
  b.classList.remove('hint');
  b.classList.add('right');
  await play(...it.say, 250, pick(['p-yes1', 'p-yes2', 'p-yes3']));
  await wait(900);
  if (screen === 'find' && F.round === round && !sess.panelAt) findNext();
}
$('#findAsk').addEventListener('click', () => { if (F.target && !F.lock) play(...F.target.where); });

/* ---------- parent controls ---------- */
function hold(btn, cb, ms = 1500) {
  let t = 0;
  const stop = () => { clearTimeout(t); btn.classList.remove('holding'); };
  btn.style.setProperty('--hold', ms + 'ms');
  btn.addEventListener('pointerdown', e => {
    e.preventDefault();
    btn.classList.add('holding');
    t = setTimeout(() => { stop(); cb(); }, ms);
  });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach(n => btn.addEventListener(n, stop));
}

const form = { id: null, image: null, audio: null, createdAt: 0 };
let rec = null, previewUrl = null;

function openParent() {
  stopAudio();
  sess.panelAt = Date.now();
  $('#sMin').value = String(S.sessionMin);
  $('#sChoices').value = String(S.choices);
  $('#sWords').checked = S.showWords;
  $('#sTips').checked = S.tips;
  resetForm();
  renderList();
  renderUsage();
  $('#parent').classList.add('on');
}
function closeParent() {
  stopRec();
  stopAudio();
  $('#parent').classList.remove('on');
  if (sess.start) sess.start += Date.now() - sess.panelAt;   // settings time doesn't count
  sess.panelAt = 0;
  if (screen === 'words') renderWords();
  else if (screen === 'find') findNext();
  tickBar();
}
function msg(text, ok) { const m = $('#fMsg'); m.textContent = text; m.classList.toggle('ok', !!ok); }

function resetForm(c) {
  stopRec();
  Object.assign(form, { id: c ? c.id : null, image: c ? c.image : null, audio: c ? c.audio : null, createdAt: c ? c.createdAt : 0 });
  $('#fLabel').value = c ? c.label : '';
  $('#fTitle').textContent = c ? `카드 수정: ${c.label}` : '새 카드';
  drawPreview();
  syncRec();
  msg('');
}
function drawPreview() {
  const p = $('#fPreview');
  p.textContent = '';
  if (previewUrl) { URL.revokeObjectURL(previewUrl); previewUrl = null; }
  if (!form.image) { p.textContent = '사진 없음'; return; }
  previewUrl = URL.createObjectURL(form.image);
  const i = el('img');
  i.src = previewUrl;
  p.append(i);
}
async function shrink(file) {
  let bmp;
  try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch { throw new Error('이 사진은 열 수 없어요. JPG나 PNG 사진을 골라 주세요.'); }
  const k = Math.min(1, 1200 / Math.max(bmp.width, bmp.height));
  const cv = document.createElement('canvas');
  cv.width = Math.round(bmp.width * k);
  cv.height = Math.round(bmp.height * k);
  cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
  bmp.close();
  return new Promise(r => cv.toBlob(r, 'image/jpeg', 0.85));
}
$('#fPhoto').addEventListener('change', async e => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  try { form.image = await shrink(f); drawPreview(); msg(''); if (!$('#fLabel').value) $('#fLabel').focus(); }
  catch (err) { msg(err.message); }
});

function syncRec() {
  const r = $('#fRec');
  r.textContent = rec ? '⏹ 멈추기' : (form.audio ? '⏺ 다시 녹음' : '⏺ 이름 녹음');
  r.classList.toggle('rec', !!rec);
  $('#fPlay').disabled = !form.audio || !!rec;
  $('#fDelRec').disabled = !form.audio || !!rec;
}
async function toggleRec() {
  if (rec) return stopRec();
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); }
  catch { return msg('마이크를 쓸 수 없어요. 브라우저에서 마이크 권한을 허용해 주세요.'); }
  stopAudio();
  const chunks = [];
  const r = new MediaRecorder(stream);
  r.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
  r.onstop = () => {
    stream.getTracks().forEach(t => t.stop());
    if (chunks.length) form.audio = new Blob(chunks, { type: r.mimeType || 'audio/webm' });
    rec = null;
    syncRec();
    if (form.audio && $('#parent').classList.contains('on')) play(form.audio);
  };
  rec = r;
  r.start();
  r.timer = setTimeout(stopRec, 5000);
  syncRec();
  msg('');
}
function stopRec() {
  if (!rec) return;
  clearTimeout(rec.timer);
  if (rec.state !== 'inactive') rec.stop();
}
$('#fRec').addEventListener('click', toggleRec);
$('#fPlay').addEventListener('click', () => form.audio && play(form.audio));
$('#fDelRec').addEventListener('click', () => { form.audio = null; syncRec(); });
$('#fNew').addEventListener('click', () => resetForm());
$('#fSave').addEventListener('click', async () => {
  const label = $('#fLabel').value.trim();
  if (rec) return msg('녹음을 먼저 멈춰 주세요.');
  if (!form.image) return msg('사진을 먼저 골라 주세요.');
  if (!label) return msg('이름을 적어 주세요.');
  const noVoice = !form.audio;
  try {
    await store('readwrite', s => s.put({ id: form.id || 'c' + Date.now(), label, image: form.image, audio: form.audio, createdAt: form.createdAt || Date.now() }));
  } catch (e) { return msg('저장하지 못했어요: ' + e); }
  await loadCards();
  renderList();
  resetForm();
  msg(noVoice ? `"${label}" 저장했어요. 녹음이 없어서 이 카드는 소리가 나지 않아요.` : `"${label}" 저장했어요.`, true);
});

function renderList() {
  const box = $('#myList');
  box.textContent = '';
  if (!cards.length) { box.append(el('p', 'hint', '아직 카드가 없어요. 위에서 사진과 이름을 넣어 주세요.')); return; }
  for (const c of cards) {
    const row = el('div', 'item');
    const img = el('img'); img.src = c.url; img.alt = '';
    const playB = el('button', 'btn', '▶'); playB.disabled = !c.audio; playB.onclick = () => play(c.audio);
    const edit = el('button', 'btn', '수정'); edit.onclick = () => { resetForm(c); $('#parent').scrollTo({ top: 0, behavior: 'smooth' }); };
    const del = el('button', 'btn', '삭제');
    del.onclick = async () => {
      if (!confirm(`"${c.label}" 카드를 지울까요?`)) return;
      await store('readwrite', s => s.delete(c.id));
      if (form.id === c.id) resetForm();
      await loadCards();
      renderList();
    };
    row.append(img, el('span', 'name', c.label + (c.audio ? '  🎤' : '  (녹음 없음)')), playB, edit, del);
    box.append(row);
  }
}
function renderUsage() {
  const u = readUsage(), box = $('#usage');
  box.textContent = '';
  const days = [];
  for (let i = 6; i >= 0; i--) { const d = new Date(); d.setDate(d.getDate() - i); days.push(d.toLocaleDateString('sv')); }
  const max = Math.max(600, ...days.map(d => u[d] || 0));
  for (const d of days) {
    const sec = u[d] || 0, bar = el('i');
    bar.style.width = (sec / max * 100) + '%';
    const wrap = el('span'); wrap.append(bar);
    box.append(el('span', null, d.slice(5).replace('-', '/')), wrap, el('span', null, `${Math.round(sec / 60)}분`));
  }
}
$('#sMin').addEventListener('change', e => { S.sessionMin = +e.target.value; saveSettings(); });
$('#sChoices').addEventListener('change', e => { S.choices = +e.target.value; saveSettings(); });
$('#sWords').addEventListener('change', e => { S.showWords = e.target.checked; saveSettings(); });
$('#sTips').addEventListener('change', e => { S.tips = e.target.checked; saveSettings(); document.body.classList.toggle('noTips', !S.tips); });
$('#pClose').addEventListener('click', closeParent);

/* ---------- wiring ---------- */
$$('[data-go]').forEach(b => b.addEventListener('click', () => show(b.dataset.go)));
$$('.homeBtn').forEach(b => hold(b, () => show('home'), 1200));
hold($('#gear'), openParent);
hold($('#resume'), () => { sess.start = 0; show('home'); }, 2000);
document.addEventListener('contextmenu', e => { if (!$('#parent').classList.contains('on')) e.preventDefault(); });
// Android back gesture shouldn't drop a toddler out of the app.
history.pushState(null, '', location.href);
window.addEventListener('popstate', () => history.pushState(null, '', location.href));

(async function init() {
  try { C = await (await fetch('content.json')).json(); }
  catch { document.body.textContent = 'content.json을 읽지 못했어요. 웹 서버(https)로 열어 주세요.'; return; }
  document.body.classList.toggle('noTips', !S.tips);
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch {}
  await loadCards();
  clipNames(C).forEach(clipSrc);   // warm the clip cache so the first tap answers at once
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
