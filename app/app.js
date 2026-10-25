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

// Home tiles. `screen` is the section that runs the game; quiz games share #quiz.
const TILES = [
  { id: 'words', screen: 'words', name: '낱말 카드', icon: '🧸', bg: '#ffd6a5',
    tip: '카드를 누르고 아이와 함께 이름을 말해 보세요. 집에 있는 진짜 물건을 가리키며 "여기도 있네!" 하면 더 잘 배워요.' },
  { id: 'peek', screen: 'peek', name: '동물 까꿍', icon: '🚪', bg: '#c9f2bd',
    tip: '열기 전에 "누가 있을까?" 하고 잠깐 기다려 주세요. 동물 소리를 같이 흉내 내 보세요.' },
  { id: 'find', screen: 'quiz', name: '어디 있지?', icon: '🔍', bg: '#b9d4ff',
    tip: '틀려도 괜찮아요. 정답이 반짝이면 같이 눌러 보세요. 끝나면 진짜 물건도 함께 찾아보세요.' },
  { id: 'sound', screen: 'quiz', name: '누구 소리지?', icon: '👂', bg: '#ffc8dd',
    tip: '고르기 전에 "누구일까?" 하고 기다려 주세요. 맞히면 그 소리를 같이 흉내 내 보세요.' },
  { id: 'match', screen: 'quiz', name: '똑같은 거', icon: '🧦', bg: '#e2d4ff',
    tip: '위 그림과 똑같은 걸 찾아요. 찾으면 "똑같다!" 하고 이름을 같이 말해 주세요.' },
  { id: 'shadow', screen: 'quiz', name: '그림자 놀이', icon: '👤', bg: '#d8e2dc',
    tip: '그림자 모양을 손가락으로 따라 그려 보세요. "귀가 길쭉하네, 누굴까?"처럼 힌트를 주세요.' },
  { id: 'size', screen: 'quiz', name: '큰 거 작은 거', icon: '🐘', bg: '#fde4a5',
    tip: '팔을 크게, 작게 벌리며 "크다! 작다!" 같이 말해 보세요.' },
  { id: 'count', screen: 'count', name: '하나 둘 셋', icon: '🖐️', bg: '#bde0fe',
    tip: '하나씩 손가락으로 짚으며 같이 세어 주세요. 간식이나 장난감도 같이 세어 보세요.' },
  { id: 'balloon', screen: 'balloon', name: '풍선 놀이', icon: '🎈', bg: '#ffd1dc',
    tip: '풍선을 터뜨리면 색깔 이름이 나와요. 집에서 같은 색 물건을 찾아보세요.' },
  { id: 'move', screen: 'move', name: '따라 해요', icon: '🙌', bg: '#caf0f8',
    tip: '화면 대신 몸으로 노는 시간이에요. 같이 따라 하고, 다 하면 화면을 눌러 다음으로!' },
];
const TILE = Object.fromEntries(TILES.map(t => [t.id, t]));
const isGame = s => s !== 'home' && s !== 'end';
const BALLOON_COLORS = { red: '#ef476f', orange: '#ff9f1c', yellow: '#ffd166', green: '#06d6a0', blue: '#4ea8de', purple: '#9b5de5' };

let C = null;            // content.json
let cards = [];          // family cards from IndexedDB, each with .url for its photo
let screen = 'home', mode = 'home';

/* ---------- settings & usage (small, per device) ---------- */
const S = (() => {
  const d = { sessionMin: 10, choices: 2, countMax: 3, tips: true, offCats: [], hideGames: [] };
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
const animalItem = a => ({ key: 'a-' + a.id, cat: 'animal', name: a.name, sub: a.sound, emoji: a.emoji,
  say: [`a-${a.id}-name`], sound: `a-${a.id}-sound`, where: [`a-${a.id}-where`] });
const wordItem = w => ({ key: 'w-' + w.id, cat: w.cat, name: w.name, emoji: w.emoji,
  say: [`w-${w.id}-name`], where: [`w-${w.id}-where`] });
const cardItem = c => ({ key: c.id, cat: 'family', name: c.label, img: c.url,
  say: c.audio ? [c.audio] : [], where: c.audio ? [c.audio, 150, 'p-where'] : null });
const catOn = id => !S.offCats.includes(id);

// Item pools grouped by category, so distractors come from the same kind of thing.
function pools({ skip = [], family = true, min = S.choices } = {}) {
  const out = [];
  if (catOn('animal') && !skip.includes('animal')) out.push(C.animals.map(animalItem));
  for (const c of C.categories) {
    if (catOn(c.id) && !skip.includes(c.id)) out.push(C.words.filter(w => w.cat === c.id).map(wordItem));
  }
  const fam = cards.filter(c => c.audio).map(cardItem);
  if (family && fam.length >= min) out.push(fam, fam);   // family photos come up more often
  const ok = out.filter(p => p.length >= min);
  return ok.length ? ok : [C.animals.map(animalItem)];
}

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
  stopBalloons();
  $('#big').classList.remove('on');
  let scr = TILE[id] ? TILE[id].screen : id;
  if (isGame(scr)) {
    if (sessionLeft() <= 0) id = scr = 'end';
    else if (!sess.start) sess.start = Date.now();
  }
  screen = scr;
  mode = id;
  $$('.screen').forEach(s => s.classList.toggle('on', s.id === scr));
  const t = TILE[id];
  if (t) {
    const sec = $('#' + scr);
    $('.bar h2', sec).textContent = t.name;
    $('.tip', sec).textContent = t.tip;
  }
  if (scr === 'words') renderWords();
  else if (scr === 'peek') peekStart();
  else if (scr === 'quiz') quizNext();
  else if (scr === 'count') countNext();
  else if (scr === 'balloon') startBalloons();
  else if (scr === 'move') moveStart();
  else if (scr === 'home') renderHome();
  else if (scr === 'end') play(600, 'p-bye');
  tickBar();
}
function renderHome() {
  const box = $('#tiles');
  box.textContent = '';
  for (const t of TILES.filter(t => !S.hideGames.includes(t.id))) {
    const b = el('button', 'tile');
    b.style.background = t.bg;
    b.append(el('span', 'big', t.icon), el('span', null, t.name));
    b.onclick = () => show(t.id);
    box.append(b);
  }
  box.dataset.n = box.children.length;
}
function tickBar() {
  const bar = $('#sessionBar'), left = sessionLeft();
  bar.classList.toggle('on', left !== Infinity && isGame(screen));
  if (left === Infinity) return;
  const f = Math.max(0, left / (S.sessionMin * 60000));
  bar.firstElementChild.style.width = (f * 100) + '%';
  bar.classList.toggle('low', f < .2);
}
setInterval(() => {
  const active = isGame(screen) && !sess.panelAt && document.visibilityState === 'visible';
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

/* ---------- word cards ---------- */
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
  for (const c of C.categories) {
    if (!catOn(c.id)) continue;
    g.append(el('h3', 'sec', c.name));
    C.words.filter(w => w.cat === c.id).map(wordItem).forEach(add);
  }
  if (catOn('animal')) { g.append(el('h3', 'sec', '동물')); C.animals.map(animalItem).forEach(add); }
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
  play(...it.say, ...(it.sound ? [500, it.sound] : []));
}
$('#big').addEventListener('click', e => {
  if (e.target.closest('#bigVis')) { bounce($('#bigVis')); play(...bigItem.say, ...(bigItem.sound ? [500, bigItem.sound] : [])); return; }
  stopAudio();
  $('#big').classList.remove('on');
});

/* ---------- animal peekaboo: ask, wait, reveal name then sound ---------- */
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

/* ---------- choice games: find / sound / match / shadow / size (errorless) ---------- */
const Q = { r: null, btn: null, last: null, round: 0, lock: false };
function pickTarget(pool) {
  let t;
  do t = pick(pool); while (pool.length > 1 && t.key === Q.last);
  Q.last = t.key;
  return t;
}
function withDistractors(pool, t, ok = () => true) {
  return shuffle([t, ...shuffle(pool.filter(x => x.key !== t.key && ok(x))).slice(0, S.choices - 1)])
    .map(it => ({ it, right: it === t }));
}
const yes = () => pick(['p-yes1', 'p-yes2', 'p-yes3']);
const ROUNDS = {
  find() {
    const pool = pick(pools()), t = pickTarget(pool);
    return { opts: withDistractors(pool, t), ask: t.where, praise: t.say };
  },
  sound() {   // hear only the sound, pick the animal
    const pool = C.animals.map(animalItem), t = pickTarget(pool);
    return { opts: withDistractors(pool, t, x => x.sub !== t.sub), ask: ['p-who', 400, t.sound], praise: [...t.say, 300, t.sound] };
  },
  match() {
    const pool = pick(pools()), t = pickTarget(pool);
    return { model: t, opts: withDistractors(pool, t), ask: ['p-same'], praise: t.say };
  },
  shadow() {  // shapes must differ, so no photos, colour dots or faces
    const pool = pick(pools({ skip: ['color', 'feeling'], family: false })), t = pickTarget(pool);
    return { model: t, shadow: true, opts: withDistractors(pool, t), ask: ['p-shadow'], praise: t.say };
  },
  size() {
    const pool = pick(pools({ skip: ['color'], min: 1 })), it = pickTarget(pool), big = Math.random() < .5;
    return { opts: shuffle([{ it, cls: 'isBig', right: big }, { it, cls: 'isSmall', right: !big }]),
      ask: [big ? 'p-big' : 'p-small'], praise: it.say };
  },
};
function quizNext() {
  const r = ROUNDS[mode]();
  Object.assign(Q, { r, lock: false, round: Q.round + 1 });
  const top = $('#quizTop');
  top.textContent = '';
  top.hidden = !r.model;
  if (r.model) {
    const v = visual(r.model), frame = el('div', 'frame');
    if (r.shadow) v.classList.add('shadow');
    frame.append(v);
    top.append(frame);
  }
  const box = $('#choices');
  box.textContent = '';
  box.dataset.n = r.opts.length;
  box.classList.toggle('withTop', !!r.model);
  for (const o of r.opts) {
    const b = el('button', 'choice ' + (o.cls || ''));
    b.append(visual(o.it));
    b.onclick = () => quizTap(b, o);
    box.append(b);
    if (o.right) Q.btn = b;
  }
  play(500, ...r.ask);
}
async function quizTap(b, o) {
  if (Q.lock) return;
  if (!o.right) {
    b.classList.remove('nope'); void b.offsetWidth; b.classList.add('nope');
    Q.btn.classList.add('hint');
    play('p-here', 200, ...Q.r.praise);
    return;
  }
  Q.lock = true;
  const round = Q.round;
  $$('.choice').forEach(x => x.classList.toggle('fade', x !== b));
  b.classList.remove('hint');
  b.classList.add('right');
  if (Q.r.shadow) $('#quizTop .vis').classList.remove('shadow');   // reveal whose shadow it was
  await play(...Q.r.praise, 250, yes());
  await wait(900);
  if (screen === 'quiz' && Q.round === round && !sess.panelAt) quizNext();
}
$('#quizAsk').addEventListener('click', () => { if (Q.r && !Q.lock) play(...Q.r.ask); });

/* ---------- counting: touch each one, hear the next number ---------- */
const CT = { n: 0, done: 0, round: 0 };
function countNext() {
  const pool = pick(pools({ skip: ['color', 'feeling', 'body'], family: false, min: 1 }));
  const it = pick(pool);
  const max = Math.min(S.countMax, C.numbers.length);
  // small numbers more often: 1..max weighted toward the low end
  const n = 1 + Math.floor(Math.pow(Math.random(), 1.6) * max);
  Object.assign(CT, { n, done: 0, round: CT.round + 1 });
  const area = $('#countArea');
  area.textContent = '';
  area.dataset.n = n;
  for (let i = 0; i < n; i++) {
    const b = el('button', 'cnt');
    b.append(visual(it), el('b', 'num'));
    b.onclick = () => countTap(b);
    area.append(b);
  }
  play(400, 'p-count');
}
async function countTap(b) {
  if (b.classList.contains('on') || CT.done >= CT.n) return;
  const k = ++CT.done, round = CT.round;
  b.classList.add('on');
  b.querySelector('.num').textContent = k;
  bounce(b);
  if (k < CT.n) { play('n' + k); return; }
  await play('n' + k, 500, 'p-all');
  await wait(1200);
  if (screen === 'count' && CT.round === round && !sess.panelAt) countNext();
}

/* ---------- balloons: pop one, hear its colour ---------- */
let balloonTimer = 0;
function startBalloons() {
  stopBalloons();
  $('#sky').textContent = '';
  const spawn = () => {
    if (screen !== 'balloon' || sess.panelAt) return;
    if ($('#sky').children.length >= 5) return;
    const color = pick(Object.keys(BALLOON_COLORS));
    const b = el('button', 'balloon');
    b.style.setProperty('--c', BALLOON_COLORS[color]);
    b.style.left = (5 + Math.random() * 78) + '%';
    b.style.animationDuration = (9 + Math.random() * 5) + 's';
    b.addEventListener('animationend', () => b.remove());
    b.addEventListener('pointerdown', () => {
      if (b.classList.contains('pop')) return;
      b.classList.add('pop');
      play(`w-${color}-name`);
      setTimeout(() => b.remove(), 350);
    });
    $('#sky').append(b);
  };
  spawn();
  balloonTimer = setInterval(spawn, 1500);
}
function stopBalloons() { clearInterval(balloonTimer); balloonTimer = 0; }

/* ---------- follow along: move the body, off the screen ---------- */
const MV = { order: [], i: 0 };
function moveStart() { MV.order = shuffle(C.actions); MV.i = 0; moveSet(); }
function moveSet() {
  const m = MV.order[MV.i % MV.order.length];
  $('#moveIcon').textContent = m.emoji;
  $('#moveText').textContent = m.text;
  bounce($('#moveIcon'));
  play(300, 'm-' + m.id);
}
$('#moveArea').addEventListener('click', () => { MV.i++; moveSet(); });

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

function checks(box, list, isOn, set) {
  box.textContent = '';
  for (const x of list) {
    const l = el('label', 'chk'), c = el('input');
    c.type = 'checkbox';
    c.checked = isOn(x.id);
    c.onchange = () => { set(x.id, c.checked); saveSettings(); };
    l.append(c, ' ' + x.name);
    box.append(l);
  }
}
const toggleIn = (arr, id, on) => { const i = arr.indexOf(id); if (on && i >= 0) arr.splice(i, 1); if (!on && i < 0) arr.push(id); };

function openParent() {
  stopAudio();
  sess.panelAt = Date.now();
  $('#sMin').value = String(S.sessionMin);
  $('#sChoices').value = String(S.choices);
  $('#sCountMax').value = String(S.countMax);
  $('#sTips').checked = S.tips;
  checks($('#sGames'), TILES, id => !S.hideGames.includes(id), (id, on) => toggleIn(S.hideGames, id, on));
  checks($('#sCats'), [{ id: 'animal', name: '동물' }, ...C.categories], catOn, (id, on) => toggleIn(S.offCats, id, on));
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
  if (screen === 'home') renderHome();
  else if (screen === 'words') renderWords();
  else if (screen === 'quiz') quizNext();
  else if (screen === 'count') countNext();
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
$('#sCountMax').addEventListener('change', e => { S.countMax = +e.target.value; saveSettings(); });
$('#sTips').addEventListener('change', e => { S.tips = e.target.checked; saveSettings(); document.body.classList.toggle('noTips', !S.tips); });
$('#pClose').addEventListener('click', closeParent);

/* ---------- wiring ---------- */
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
  renderHome();
  await loadCards();
  clipNames(C).forEach(clipSrc);   // warm the clip cache so the first tap answers at once
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
