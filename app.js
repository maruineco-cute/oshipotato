/* ============================================================
   推しポテトメーカー - メインスクリプト
   ・すべての処理はブラウザ内で完結します。
   ・ユーザーの画像を外部サーバーへ送信することはありません。
   ============================================================ */
(function () {
'use strict';

/* ================= 純粋ヘルパー（テスト用に export） ================= */

const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rand  = (a, b) => a + Math.random() * (b - a);

/* シーン座標系（固定）。表示はこれを一様に拡大縮小するだけ */
const SW = 540, SH = 810;

/* 容器のジオメトリ */
const GEO = {
  cx: 270,          // 容器中心 x
  rimY: 440,        // 開口部（奥のリム）の y（背の高い容器）
  rimRX: 190,       // 開口部の半径（横方向）
  rimRY: 34,        // 開口部の半径（奥行き表現）
  botY: 724,        // 容器の底の y
  topHW: 190,       // 上部の半分幅
  botHW: 150,       // 底部の半分幅
  left: 80,         // 左上の x
  right: 460        // 右上の x
};

const MAX_POTATOES = 64;   // 容器の容量
const FRONT_RAIN   = 10;   // 推しが降りたあとに手前へ降る本数
const ADD_AMOUNT   = 8;    // 「ポテトついか」1回あたりの本数

/* y における容器の内側半分幅（台形の補間） */
function halfWidthAt(y) {
  if (y <= GEO.rimY) return GEO.topHW;
  const t = clamp((y - GEO.rimY) / (GEO.botY - GEO.rimY), 0, 1);
  return GEO.topHW - (GEO.topHW - GEO.botHW) * t;
}

/* 容器手前パネルの上端の y（中央がくぼんだV字カーブ） */
function frontEdgeY(x) {
  const t = clamp((x - GEO.left) / (GEO.right - GEO.left), 0, 1);
  return 456 + 256 * t * (1 - t);   // 端456 / 中央520
}

/* 端点が容器の外へはみ出さないように着地候補を補正する */
function correctEndpoints(pos) {
  for (let k = 0; k < 6; k++) {
    const dx = (pos.L / 2) * Math.sin(pos.angle);
    const dy = (pos.L / 2) * Math.cos(pos.angle);
    const e1x = pos.x - dx, e1y = pos.y - dy;
    const e2x = pos.x + dx, e2y = pos.y + dy;
    let fixed = false;

    if (e1y < 200 || e2y < 200) {           // 高くなりすぎる → 立てて下げる
      pos.angle *= 0.7;
      pos.y = Math.min(700, pos.y + 16);
      fixed = true;
    }
    const w1 = halfWidthAt(clamp(e1y, GEO.rimY, GEO.botY)) - 8;
    const w2 = halfWidthAt(clamp(e2y, GEO.rimY, GEO.botY)) - 8;
    if (Math.abs(e1x - GEO.cx) > w1 || Math.abs(e2x - GEO.cx) > w2) {
      // 中心へ寄せて角度も寝かせる（収束させる）
      pos.x = GEO.cx + (pos.x - GEO.cx) * 0.88;
      pos.angle *= 0.88;
      fixed = true;
    }
    if (e2y > 716) {                        // 底を突き抜ける → 上げる
      pos.y = 716 - Math.abs(dy);
      fixed = true;
    }
    if (!fixed) break;
  }
  return pos;
}

/* 着地候補をひとつ作る（🍟らしく、ほぼ縦向きの扇配置） */
function makeCandidate(inBox, layer, shift, R) {
  let ty;
  if (layer === 'front') {
    // 手前側ポテトは推しの下半分あたり（低め）に配置 → 顔を隠しすぎない
    ty = Math.max(478, R(484, 570) - shift * 0.6);
  } else {
    ty = Math.max(368, R(372, 530) - shift);
  }
  const x0 = R(-1, 1) * Math.max(30, halfWidthAt(ty) - 40);
  const pos = {
    x: GEO.cx + x0,
    y: ty,
    // 落下はほぼ縦。着地は中心から扇状に開く（🍟絵モジ風）
    angle: R(-0.07, 0.07),
    // 🍟絵モジ比の長いポテト（現在〜2倍をランダム。手前は顔が隠れぬようやや短め）
    L: layer === 'front' ? R(230, 320) : R(280, 420),
    Wd: R(26, 32)
  };
  return correctEndpoints(pos);
}

function minDistSq(existing, pos) {
  let d2 = Infinity;
  for (let i = 0; i < existing.length; i++) {
    const ddx = existing[i].x - pos.x, ddy = existing[i].y - pos.y;
    const dd = ddx * ddx + ddy * ddy;
    if (dd < d2) d2 = dd;
  }
  return d2;
}

/*
 * ポテトの着地位置を決める。
 * - 既存ポテトと完全に重ならない位置をランダム試行で探す
 * - 見つからなければ決定的なグリッド走査で空き位置を探す
 * - それでも空きがなければ、最も重なりの少ない候補を採用する
 */
function pickLanding(inBox, layer, existing, rnd) {
  const R = rnd ? (a, b) => a + rnd() * (b - a) : rand;
  const shift = Math.min(36, inBox * 1.1);   // たまり具合による上昇
  const REQ = 34 * 34;

  let best = null, bestD2 = -1;

  // フェーズ1: ランダム試行
  for (let attempt = 0; attempt < 10; attempt++) {
    const pos = makeCandidate(inBox, layer, shift, R);
    const d2 = minDistSq(existing, pos);
    if (d2 >= REQ) return pos;
    if (d2 > bestD2) { bestD2 = d2; best = pos; }
  }

  // フェーズ2: グリッド走査（空き位置を決定的に探す）
  const tyMin = layer === 'front' ? 478 : 368;
  const tyMax = (layer === 'front' ? 570 : 530) - shift * 0.6;
  for (let gy = tyMax; gy >= tyMin; gy -= 12) {
    const hw = Math.max(24, halfWidthAt(gy) - 34);
    for (let gx = -hw; gx <= hw; gx += 12) {
      const pos = makeCandidate(inBox, layer, shift, R);
      pos.x = clamp(GEO.cx + gx + R(-7, 7), GEO.cx - hw, GEO.cx + hw);
      pos.y = gy + R(-5, 5);
      correctEndpoints(pos);
      const d2 = minDistSq(existing, pos);
      if (d2 >= REQ) return pos;
      if (d2 > bestD2) { bestD2 = d2; best = pos; }
    }
  }

  return best;   // 最密状態で空きがなければ、最も重ならない候補を採用
}

/* Node（テスト）から使う場合の export */
if (typeof module !== 'undefined' && typeof module.exports !== 'undefined') {
  module.exports = { clamp, rand, halfWidthAt, frontEdgeY, pickLanding, correctEndpoints, SW, SH, GEO, MAX_POTATOES, FRONT_RAIN, ADD_AMOUNT };
}

/* ブラウザ外ではこれ以降を実行しない */
if (typeof document === 'undefined') return;

/* ================= DOM 取得 ================= */

const canvas = document.getElementById('stage');
if (!canvas || !canvas.getContext) return;
const ctx = canvas.getContext('2d');

const wrap        = document.getElementById('stage-wrap');
const fileInput   = document.getElementById('fileInput');
const btnUpload   = document.getElementById('btnUpload');
const btnPlay     = document.getElementById('btnPlay');
const btnAdd      = document.getElementById('btnAdd');
const btnReset    = document.getElementById('btnReset');
const btnHelp     = document.getElementById('btnHelp');
const btnMode     = document.getElementById('btnMode');
const btnShot     = document.getElementById('btnShot');
const btnSound    = document.getElementById('btnSound');
const btnSalt     = document.getElementById('btnSalt');
const saveOverlay = document.getElementById('saveOverlay');
const saveImg     = document.getElementById('saveImg');
const saveClose   = document.getElementById('saveClose');
const sizeRange   = document.getElementById('sizeRange');
const sizeLabel   = document.getElementById('sizeLabel');
const hintBar     = document.getElementById('hintBar');
const startOverlay= document.getElementById('startOverlay');
const startUpload = document.getElementById('startUpload');
const startSkip   = document.getElementById('startSkip');
const helpOverlay = document.getElementById('helpOverlay');
const helpClose   = document.getElementById('helpClose');
const toastEl     = document.getElementById('toast');

/* ================= 状態 ================= */

const reducedMQ = window.matchMedia('(prefers-reduced-motion: reduce)');

const state = {
  time: 0,
  potatoes: [],        // すべてのポテトオブジェクト
  pending: 0,          // 「ついか」分でこれから降る本数（奥/手前まぜ）
  pendingFront: 0,     // 演出分（手前）でこれから降る本数
  nextSpawn: 0,
  mode: 'play',        // 'play' | 'move'
  hasImage: false,
  started: false,      // 初期オーバーレイを閉じたかどうか
  reducedMotion: reducedMQ.matches,
  sparkles: [],
  emotes: [],
  glitter: [],
  zoomHeart: null,      // レア: 手前に迫る❤
  forceFx: null,        // テスト用抽選強制
  forceSalt: null
};

const oshi = {
  img: null,
  mask: null, maskW: 0, maskH: 0,   // アルファ判定用マスク
  baseW: 0, baseH: 0,               // userScale=1 のときの表示サイズ
  userScale: 1,
  cx: 270, cy: 450,                 // 表示中心（位置調整で変わる）
  // 降下演出
  dropping: false, dropOff: 0, dropV: 0,
  // ダブルタップ大ジャンプ
  jumping: false, jumpOff: 0, jumpV: 0,
  // ダブルタップ横一回転
  spinning: false, spinT: 0,
  // アニメーション用のばね状態
  lift: 0, liftV: 0,
  squish: 1, squishV: 0,
  ox: 0, oxV: 0, oxT: 0,
  oy: 0, oyV: 0, oyT: 0,
  tilt: 0, tiltV: 0, tiltT: 0, tiltLive: 0,
  wig: 0,
  pressed: false, pressId: -1
};

/* ポテトの色バリエーション（🍟らしい鮮やかな黄金色） [左, 中, 右] */
const PALETTE = [
  ['#ffd84d', '#ffc21e', '#f5a300'],
  ['#ffdd55', '#ffc400', '#ef9f00'],
  ['#ffd23f', '#ffbe1a', '#e89400'],
  ['#ffe066', '#ffca28', '#f09c00']
];

const SETTLE = 0.16;   // 着地後の沈み込み時間
const POP_T  = 0.30;   // つまんだポテトのはじける時間

/* ================= 背景の飾り ================= */

const DECOR = [
  [60, 150, 14, '#ffd9a0'], [480, 120, 10, '#ffc2c2'],
  [70, 330, 9, '#ffe9b3'],  [470, 320, 12, '#ffd0a8'],
  [120, 70, 8, '#ffcdc1'],  [420, 60, 7, '#ffe3ad']
];

/* ================= ユーティリティ ================= */

const view = { scale: 1 };

/* ラップ領域にアスペクト比を保って収まるサイズを計算する */
function resize() {
  const r = wrap.getBoundingClientRect();
  if (r.width <= 0 || r.height <= 0) return;
  const s = Math.min(r.width / SW, r.height / SH);
  const cssW = Math.floor(SW * s);
  const cssH = Math.floor(SH * s);
  canvas.style.width = cssW + 'px';
  canvas.style.height = cssH + 'px';
  const dpr = clamp(window.devicePixelRatio || 1, 1, 2.5);
  const pw = Math.round(cssW * dpr);
  const ph = Math.round(cssH * dpr);
  if (canvas.width !== pw) canvas.width = pw;
  if (canvas.height !== ph) canvas.height = ph;
  view.scale = pw / SW;
}

function toScene(e) {
  const r = canvas.getBoundingClientRect();
  const s = SW / (r.width || 1);
  return { x: (e.clientX - r.left) * s, y: (e.clientY - r.top) * s };
}

function normAngle(a) {
  return ((a + Math.PI) % TAU + TAU) % TAU - Math.PI;
}

let toastTimer = 0;
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.add('hidden'), 2400);
}

function spring(obj, key, vkey, target, k, damp, dt) {
  obj[vkey] += ((target - obj[key]) * k - obj[vkey] * damp) * dt;
  obj[key]  += obj[vkey] * dt;
}

function countLanded() {
  let n = 0;
  for (const p of state.potatoes) if (p.state === 'landed') n++;
  return n;
}
function countInBox() {
  let n = 0;
  for (const p of state.potatoes) if (p.state === 'landed' || p.state === 'falling') n++;
  return n;
}

/* ================= ポテトの生成 ================= */

function basePotato(pos, layer, falling) {
  const pal = PALETTE[(Math.random() * PALETTE.length) | 0];
  const instant = state.reducedMotion || !falling;
  return {
    layer: layer,
    state: instant ? 'landed' : 'falling',
    x: clamp(pos.x + (falling ? rand(-4, 4) : 0), GEO.cx - 168, GEO.cx + 168),
    y: instant ? pos.y : rand(-120, -40),
    vx: 0,
    vy: rand(240, 320),
    angle: pos.angle,
    landAngle: pos.angle,
    angleAtLand: pos.angle,
    targetY: pos.y,
    L: pos.L, W: pos.Wd,
    c: pal,
    setT: 0,
    grabT: 0,
    popT: 0,
    gx: 0, gy: 0
  };
}

/* 🍟絵モジのような「こんもりマウンド」を最初から配置する */
function buildMound() {
  // 既存を消して作り直す
  state.potatoes = state.potatoes.filter(p => p.state === 'grabbed' || p.state === 'pop');

  // 上段: リムから扇状にのぞくポテト
  for (let i = 0; i < 9; i++) {
    const x = GEO.cx + (i - 4) * 29 + rand(-7, 7);
    const pos = {
      x: x,
      y: 410 + rand(-10, 10),
      angle: (x - GEO.cx) / 260 + rand(-0.10, 0.10),
      L: rand(300, 400),
      Wd: rand(26, 32)
    };
    correctEndpoints(pos);
    const p = basePotato(pos, 'back', false);
    p.angle = pos.angle;
    state.potatoes.push(p);
  }
  // 下段: すき間を埋めるポテト（手前パネルに半分隠れる）
  for (let i = 0; i < 9; i++) {
    const x = GEO.cx + (i - 4) * 33 + rand(-8, 8);
    const pos = {
      x: x,
      y: 480 + rand(-14, 16),
      angle: (x - GEO.cx) / 330 + rand(-0.16, 0.16),
      L: rand(240, 320),
      Wd: rand(26, 32)
    };
    correctEndpoints(pos);
    const p = basePotato(pos, 'back', false);
    p.angle = pos.angle;
    state.potatoes.push(p);
  }
}

function spawnPotato(layer) {
  if (countInBox() >= MAX_POTATOES) return false;
  const existing = [];
  for (const p of state.potatoes) if (p.state === 'landed') existing.push({ x: p.x, y: p.y });
  const pos = pickLanding(countInBox(), layer, existing);
  const p = basePotato(pos, layer, true);
  state.potatoes.push(p);
  return true;
}

function startFrontRain(n) {
  state.pendingFront += n;
  state.nextSpawn = state.time;
}

function addPotatoes() {
  const cap = MAX_POTATOES - countInBox() - state.pending - state.pendingFront;
  const n = Math.min(ADD_AMOUNT, cap);
  if (n <= 0) { toast('ポテトはまんたん！つまんでへらしてね🍟'); return; }
  state.pending += n;
  state.nextSpawn = state.time;
}

/* ================= 演出（推しの降下 → 手前ポテト） ================= */

function startShow(opts) {
  opts = opts || {};
  buildMound();
  state.pending = 0;
  state.pendingFront = 0;
  state.nextSpawn = state.time;

  oshi.lift = 0; oshi.liftV = 0; oshi.wig = 0;
  oshi.pressed = false; oshi.pressId = -1;

  if (state.hasImage && !state.reducedMotion) {
    // 推しが上から降ってくる
    oshi.dropping = true;
    oshi.dropV = 0;
    oshi.dropOff = -(oshi.cy + 380);
  } else {
    oshi.dropping = false;
    oshi.dropOff = 0;
    startFrontRain(FRONT_RAIN);
  }
  if (opts.silent !== true) toast(state.hasImage ? '推しが降ってくるよ…！🍟' : 'ポテトがふるよ…！🍟');
}

/* ================= 効果音（WebAudio合成・外部ファイルなし） ================= */

let audioCtx = null;
let muted = false;

function ensureAudio() {
  if (muted) return null;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    if (!audioCtx) audioCtx = new AC();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
  } catch (err) { return null; }
}

/* 推しタップ: ぼよーん */
function playBoing() {
  const ac = ensureAudio();
  if (!ac) return;
  try {
    const t = ac.currentTime;
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(280, t);
    o.frequency.exponentialRampToValueAtTime(560, t + 0.09);
    o.frequency.exponentialRampToValueAtTime(330, t + 0.18);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.35, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    o.connect(g); g.connect(ac.destination);
    o.start(t); o.stop(t + 0.24);
  } catch (err) { /* noop */ }
}

/* ポテトつまみ: ぽこっ */
function playPop() {
  const ac = ensureAudio();
  if (!ac) return;
  try {
    const t = ac.currentTime;
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.type = 'triangle';
    o.frequency.setValueAtTime(620, t);
    o.frequency.exponentialRampToValueAtTime(150, t + 0.09);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.30, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.11);
    o.connect(g); g.connect(ac.destination);
    o.start(t); o.stop(t + 0.12);
  } catch (err) { /* noop */ }
}

/* しお(ラメ)をふる: きらきら可愛いピン音 */
function playSprinkle() {
  const ac = ensureAudio();
  if (!ac) return;
  try {
    const t0 = ac.currentTime;
    for (let i = 0; i < 7; i++) {
      const t = t0 + i * 0.035 + Math.random() * 0.02;
      const o = ac.createOscillator();
      const g = ac.createGain();
      o.type = 'sine';
      const f = 1400 + Math.random() * 1400;
      o.frequency.setValueAtTime(f, t);
      o.frequency.exponentialRampToValueAtTime(f * 1.6, t + 0.06);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.09, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
      o.connect(g); g.connect(ac.destination);
      o.start(t); o.stop(t + 0.1);
    }
  } catch (err) { /* noop */ }
}

/* ================= しお＝キラキラ白いラメ ================= */

const GLITTER_COLORS = ['#ffffff', '#fff6d8', '#ffe9f2', '#e8f7ff'];
const SPRINKLE_COLORS = ['#ff5d8f', '#ffd60a', '#4cc9f0', '#80ed99', '#c77dff', '#ff9e42', '#ffffff'];

function spawnGlitter(colorful) {
  const cols = colorful ? SPRINKLE_COLORS : GLITTER_COLORS;
  const n = state.reducedMotion ? (colorful ? 60 : 40) : (colorful ? 190 : 160);
  for (let i = 0; i < n; i++) {
    const targetY = rand(395, 565);
    state.glitter.push({
      x: rand(85, 455),
      y: state.reducedMotion ? targetY : rand(-30, 220),
      vy: rand(70, 150),
      targetY: targetY,
      landed: state.reducedMotion,
      rot: rand(0, TAU),
      size: colorful ? rand(2.5, 5) : rand(2, 4.5),
      tf: rand(6, 12),          // キラメキ速度
      phase: rand(0, TAU),
      life: 0,
      max: rand(1.8, 3.0),
      col: cols[(Math.random() * cols.length) | 0]
    });
  }
  // レア: ハートのシャワーもいっしょに
  if (colorful) heartShower();
  // 上限（連打しても重くしない）
  if (state.glitter.length > 700) {
    state.glitter.splice(0, state.glitter.length - 700);
  }
}

/* レア塩: 上からハートがさらさら降る */
function heartShower() {
  if (state.reducedMotion) return;
  const chars = ['❤', '💗', '💖', '💕'];
  for (let i = 0; i < 24; i++) {
    state.emotes.push({
      x: rand(90, 450),
      y: rand(-60, 120),
      vx: rand(-25, 25),
      vy: rand(130, 220),
      life: 0,
      max: rand(1.6, 2.4),
      ch: chars[(Math.random() * chars.length) | 0],
      size: rand(12, 26),
      special: false
    });
  }
}

function updateGlitter(dt) {
  for (const g of state.glitter) {
    g.life += dt;
    if (!g.landed) {
      g.y += g.vy * dt;
      g.x += Math.sin(state.time * 2.2 + g.phase) * 26 * dt;   // ひらひら
      if (g.y >= g.targetY) g.landed = true;
    }
  }
  state.glitter = state.glitter.filter(g => g.life < g.max);
}

function diamond(s) {
  ctx.beginPath();
  ctx.moveTo(0, -s);
  ctx.lineTo(s * 0.4, 0);
  ctx.lineTo(0, s);
  ctx.lineTo(-s * 0.4, 0);
  ctx.closePath();
}

function drawGlitter() {
  for (const g of state.glitter) {
    const fade = Math.min(1, g.life * 4, (g.max - g.life) * 2);
    const tw = 0.55 + 0.45 * Math.sin(state.time * g.tf + g.phase);
    const a = clamp(fade, 0, 1) * tw;
    if (a <= 0.02) continue;
    ctx.save();
    ctx.translate(g.x, g.y);
    ctx.rotate(g.rot);
    ctx.fillStyle = g.col;
    ctx.globalAlpha = a * 0.5;       // やわらかい Glow
    diamond(g.size * 2.2);
    ctx.fill();
    ctx.globalAlpha = a;             // 芯
    diamond(g.size);
    ctx.fill();
    ctx.restore();
  }
  ctx.globalAlpha = 1;
}

/* ================= リアクション（❤✨♪） ================= */

const EMOTE_CHARS = ['❤', '✨', '♪', '💛'];

function spawnEmotes(x, y) {
  if (state.reducedMotion) return;
  for (let i = 0; i < 3; i++) {
    state.emotes.push({
      x: x + rand(-34, 34),
      y: y + rand(-8, 12),
      vy: rand(-95, -60),
      life: 0,
      max: rand(0.7, 1.0),
      ch: EMOTE_CHARS[(Math.random() * EMOTE_CHARS.length) | 0],
      size: rand(18, 26)
    });
  }
}

/* ================= キラキラ粒子 ================= */

function spawnSparkles(x, y) {
  if (state.reducedMotion) return;
  for (let i = 0; i < 8; i++) {
    state.sparkles.push({
      x: x + rand(-12, 12), y: y + rand(-12, 12),
      vx: rand(-110, 110), vy: rand(-220, -60),
      life: 0, max: rand(0.4, 0.75), r: rand(3, 7)
    });
  }
}

/* ================= 更新処理 ================= */

function update(dt) {
  const t = state.time;

  // 落下スケジューラ（演出分の手前 → ついか分のまぜ）
  if (t >= state.nextSpawn) {
    let spawned = false;
    if (state.pendingFront > 0) {
      spawned = spawnPotato('front');
      if (spawned) state.pendingFront--;
      state.nextSpawn = t + rand(0.10, 0.20);
    } else if (state.pending > 0) {
      const layer = Math.random() < 0.4 ? 'front' : 'back';
      spawned = spawnPotato(layer);
      if (spawned) state.pending--;
      state.nextSpawn = t + rand(0.10, 0.22);
    }
  }

  // ポテト
  for (const p of state.potatoes) {
    if (p.state === 'falling') {
      p.vy += 1500 * dt;
      p.y  += p.vy * dt;
      if (p.y >= p.targetY) {
        p.y = p.targetY;
        p.state = 'landed';
        // 🍟らしく中心から扇状に開いた角度で落ち着く
        p.angleAtLand = normAngle(p.angle);
        p.landAngle = normAngle(clamp((p.x - GEO.cx) / 260, -0.5, 0.5) + rand(-0.16, 0.16));
        p.setT = state.reducedMotion ? 0 : 0.0001;
        spawnSparkles(p.x, p.y - 24);
      }
    } else if (p.state === 'landed') {
      if (p.setT > 0) {
        p.setT += dt;
        const k = Math.min(1, p.setT / SETTLE);
        const e = 1 - Math.pow(1 - k, 3);
        p.angle = p.angleAtLand + (p.landAngle - p.angleAtLand) * e;
        if (k >= 1) { p.setT = 0; p.angle = p.landAngle; }
      }
    } else if (p.state === 'grabbed') {
      p.grabT += dt;
      const tx = p.gx, ty = p.gy - 52;   // 指の少し上でつまむ
      p.x += (tx - p.x) * Math.min(1, dt * 18);
      p.y += (ty - p.y) * Math.min(1, dt * 18);
      p.angle = p.landAngle + Math.sin(p.grabT * 26) * 0.09;
      if (p.grabT > 5) { p.state = 'pop'; p.popT = 0; }   // 安全装置
    } else if (p.state === 'pop') {
      p.popT += dt;
      if (p.popT >= POP_T) p.dead = true;
    }
  }
  state.potatoes = state.potatoes.filter(p => !p.dead);

  // 推しの降下
  if (oshi.dropping) {
    oshi.dropV += 2600 * dt;
    oshi.dropOff += oshi.dropV * dt;
    if (oshi.dropOff >= 0) {
      oshi.dropOff = 0;
      oshi.dropping = false;
      oshi.liftV = -190;      // 着地のはずみ
      oshi.squishV = -3.2;    // ぺちゃん
      oshi.wig = 1;
      spawnSparkles(oshi.cx - 40, oshi.cy + 60);
      spawnSparkles(oshi.cx + 40, oshi.cy + 60);
      startFrontRain(FRONT_RAIN);
    }
  }

  // ダブルタップ大ジャンプ（放物線）
  if (oshi.jumping) {
    oshi.jumpV += 2600 * dt;
    oshi.jumpOff += oshi.jumpV * dt;
    if (oshi.jumpOff >= 0) {
      oshi.jumpOff = 0;
      oshi.jumpV = 0;
      oshi.jumping = false;
      oshi.wig = 1.2;
      oshi.squishV = -3.0;
      spawnSparkles(oshi.cx, oshi.cy + 60);
    }
  }

  // ダブルタップ横一回転（紙が裏返る感じ）
  if (oshi.spinning) {
    oshi.spinT += dt / 0.7;
    if (oshi.spinT >= 1) {
      oshi.spinning = false;
      oshi.spinT = 0;
      oshi.wig = 1;
      spawnSparkles(oshi.cx, oshi.cy);
    }
  }

  // レア: 手前に迫る❤
  if (state.zoomHeart) {
    state.zoomHeart.t += dt / 1.1;
    if (state.zoomHeart.t >= 1) state.zoomHeart = null;
  }

  // 推しのばねアニメ（タップでしっかり大きく持ち上がる）
  spring(oshi, 'lift',  'liftV',  oshi.pressed ? -70 : 0, 220, 17, dt);
  spring(oshi, 'squish','squishV',oshi.pressed ? 0.92 : 1, 160, 15, dt);
  spring(oshi, 'ox', 'oxV', oshi.oxT, 120, 13, dt);
  spring(oshi, 'oy', 'oyV', oshi.oyT, 120, 13, dt);
  if (!oshi.pressed) {
    oshi.wig = Math.max(0, oshi.wig - dt * 2.4);
    oshi.tiltLive = Math.sin(t * 21) * 0.075 * oshi.wig;
  }
  spring(oshi, 'tilt', 'tiltV', oshi.pressed ? oshi.tiltT : oshi.tiltLive, 140, 12, dt);

  // キラキラ
  for (const s of state.sparkles) {
    s.life += dt;
    s.x += s.vx * dt;
    s.y += s.vy * dt;
    s.vy += 320 * dt;
  }
  state.sparkles = state.sparkles.filter(s => s.life < s.max);

  // リアクション
  for (const em of state.emotes) {
    em.life += dt;
    em.y += em.vy * dt;
    if (em.vx) em.x += em.vx * dt;
  }
  state.emotes = state.emotes.filter(em => em.life < em.max);

  updateGlitter(dt);
}

/* ================= 描画 ================= */

function rr(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawBackground(t) {
  const g = ctx.createLinearGradient(0, 0, 0, SH);
  g.addColorStop(0, '#fff7e6');
  g.addColorStop(0.6, '#ffedcd');
  g.addColorStop(1, '#ffe1b3');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, SW, SH);

  // 上部からの光線（ゆっくり回転）
  ctx.save();
  ctx.translate(SW / 2, -140);
  if (!state.reducedMotion) ctx.rotate(t * 0.05);
  ctx.fillStyle = 'rgba(255,193,94,0.13)';
  for (let i = 0; i < 12; i += 2) {
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, 1250, i * TAU / 12, (i + 1) * TAU / 12);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();

  // ふわふわドット
  for (let i = 0; i < DECOR.length; i++) {
    const d = DECOR[i];
    const bob = state.reducedMotion ? 0 : Math.sin(t * 0.8 + i * 1.7) * 6;
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = d[3];
    ctx.beginPath();
    ctx.arc(d[0], d[1] + bob, d[2], 0, TAU);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawCupBack() {
  // 容器の影
  ctx.fillStyle = 'rgba(140,70,15,0.20)';
  ctx.beginPath();
  ctx.ellipse(270, 746, 215, 22, 0, 0, TAU);
  ctx.fill();

  // 奥側の本体（上端は奥リムの弧と完全に一致させてズレをなくす）
  ctx.fillStyle = '#c40f22';
  ctx.beginPath();
  ctx.moveTo(80, 448);
  ctx.quadraticCurveTo(270, 410, 460, 448);
  ctx.lineTo(426, 724);
  ctx.quadraticCurveTo(270, 742, 114, 724);
  ctx.closePath();
  ctx.fill();

  // 開口部: 奥リムのゆるい弧と手前縁のあいだの「舟形」の暗がり
  // （円/楕円には見えない、ファストフード箱らしい開口）
  const g = ctx.createLinearGradient(0, 410, 0, 560);
  g.addColorStop(0, '#7a0b15');
  g.addColorStop(1, '#42060c');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(80, 448);
  ctx.quadraticCurveTo(270, 410, 460, 448);   // 奥リム（中央が少し盛り上がる）
  ctx.lineTo(460, 456);
  ctx.quadraticCurveTo(270, 584, 80, 456);    // 手前縁（戻り）
  ctx.closePath();
  ctx.fill();

  // 奥リムのハイライト
  ctx.strokeStyle = 'rgba(255,150,150,0.85)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(80, 448);
  ctx.quadraticCurveTo(270, 410, 460, 448);
  ctx.stroke();
}

/* 🍟絵モジ風のポテト: 太めで黄金色、上端が明るい角丸スティック */
function drawPotato(p) {
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(p.angle);
  let sx = 1, sy = 1, alpha = 1;
  if (p.state === 'landed' && p.setT > 0) {
    const k = Math.min(1, p.setT / SETTLE);
    sy = 1 - 0.14 * Math.sin(Math.PI * k);
    sx = 1 + 0.08 * Math.sin(Math.PI * k);
  } else if (p.state === 'pop') {
    const k = Math.min(1, p.popT / POP_T);
    sx = sy = 1 + 0.5 * k;
    alpha = 1 - k;
  } else if (p.state === 'grabbed') {
    sx = sy = 1.06;
  }
  ctx.scale(sx, sy);
  ctx.globalAlpha = alpha;

  const L = p.L, Wd = p.W;
  const grad = ctx.createLinearGradient(-Wd / 2, 0, Wd / 2, 0);
  grad.addColorStop(0, p.c[0]);
  grad.addColorStop(0.45, p.c[1]);
  grad.addColorStop(1, p.c[2]);
  // 🍟は四角い！端はほぼ角ばった長方形
  rr(-Wd / 2, -L / 2, Wd, L, 2.5);
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.strokeStyle = 'rgba(214,124,0,0.4)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // 上端の明るいチップ（揚げたて感・こちらも四角）
  rr(-Wd / 2 + 2.5, -L / 2 + 2, Wd - 5, Math.min(20, L * 0.16), 2);
  ctx.fillStyle = 'rgba(255,243,176,0.9)';
  ctx.fill();

  ctx.restore();
}

function drawLandedLayer(layer) {
  const arr = [];
  for (const p of state.potatoes) {
    if (p.layer === layer && p.state === 'landed') arr.push(p);
  }
  arr.sort((a, b) => a.y - b.y);   // 奥（上）から描いて手前（下）が上に乗る
  for (const p of arr) drawPotato(p);
}

function drawFalling() {
  const arr = [];
  for (const p of state.potatoes) if (p.state === 'falling') arr.push(p);
  arr.sort((a, b) => a.y - b.y);
  for (const p of arr) drawPotato(p);
}

function drawGrabbed() {
  for (const p of state.potatoes) {
    if (p.state === 'grabbed' || p.state === 'pop') drawPotato(p);
  }
}

function drawCupFront() {
  // 手前パネル本体（上端は中央がくぼんだカーブ・背の高い箱）
  ctx.beginPath();
  ctx.moveTo(80, 456);
  ctx.quadraticCurveTo(270, 584, 460, 456);
  ctx.lineTo(426, 724);
  ctx.quadraticCurveTo(270, 742, 114, 724);
  ctx.closePath();

  const g = ctx.createLinearGradient(0, 456, 0, 724);
  g.addColorStop(0, '#ff2e44');
  g.addColorStop(1, '#c60d1f');
  ctx.fillStyle = g;
  ctx.fill();

  // 左側のやわらかいハイライト
  ctx.save();
  ctx.clip();
  ctx.fillStyle = 'rgba(255,255,255,0.14)';
  ctx.fillRect(96, 450, 54, 290);
  ctx.restore();

  // 黄色いバンド（パキッと鮮やか）
  ctx.beginPath();
  ctx.moveTo(80, 462);
  ctx.quadraticCurveTo(270, 590, 460, 462);
  ctx.lineTo(460, 496);
  ctx.quadraticCurveTo(270, 624, 80, 496);
  ctx.closePath();
  ctx.fillStyle = '#ffd60a';
  ctx.fill();

  // 上端のハイライト
  ctx.strokeStyle = 'rgba(255,255,255,0.45)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(84, 459);
  ctx.quadraticCurveTo(270, 587, 456, 459);
  ctx.stroke();

  // 輪郭
  ctx.strokeStyle = '#8f0512';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(80, 456);
  ctx.quadraticCurveTo(270, 584, 460, 456);
  ctx.lineTo(426, 724);
  ctx.quadraticCurveTo(270, 742, 114, 724);
  ctx.closePath();
  ctx.stroke();
}

function oshiSize() {
  return { w: oshi.baseW * oshi.userScale, h: oshi.baseH * oshi.userScale };
}

/* 横一回転のスケール（1→0→-1→0→1 で紙が裏返る感じ） */
function spinScaleX() {
  return oshi.spinning ? Math.cos(TAU * oshi.spinT) : 1;
}
/* 回転中の小さなホップ */
function spinHop() {
  return oshi.spinning ? -Math.sin(Math.PI * oshi.spinT) * 70 : 0;
}

function drawOshi() {
  if (!oshi.img) return;
  const s = oshiSize();
  ctx.save();
  ctx.translate(oshi.cx + oshi.ox, oshi.cy + oshi.oy + oshi.lift + oshi.dropOff + oshi.jumpOff + spinHop());
  ctx.rotate(oshi.tilt);
  ctx.scale(oshi.squish * spinScaleX(), oshi.squish);
  ctx.drawImage(oshi.img, -s.w / 2, -s.h / 2, s.w, s.h);
  ctx.restore();

  // いどうモードでは破線フレームでドラッグ可能と示す
  if (state.mode === 'move') {
    ctx.save();
    ctx.strokeStyle = 'rgba(229,56,59,0.85)';
    ctx.lineWidth = 3;
    ctx.setLineDash([10, 8]);
    rr(oshi.cx - s.w / 2 - 10, oshi.cy + oshi.dropOff + oshi.jumpOff - s.h / 2 - 10, s.w + 20, s.h + 20, 18);
    ctx.stroke();
    ctx.restore();
  }
}

function drawSparkles() {
  for (const s of state.sparkles) {
    const a = 1 - s.life / s.max;
    ctx.globalAlpha = a;
    ctx.fillStyle = '#ffcf3f';
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#fffbe6';
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r * 0.45, 0, TAU);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawEmotes() {
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const em of state.emotes) {
    const a = 1 - em.life / em.max;
    // 特別なピンクはほわっと光る
    if (em.special) {
      ctx.globalAlpha = a * 0.30;
      ctx.fillStyle = '#ff9ecb';
      ctx.beginPath();
      ctx.arc(em.x, em.y, em.size * 0.75, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = a;
    ctx.font = em.size + 'px system-ui, sans-serif';
    ctx.fillText(em.ch, em.x, em.y);
  }
  ctx.globalAlpha = 1;
}

/* レア: 真っ赤な❤が画面手前に迫ってくる（絵文字非依存・必ず赤） */
function drawZoomHeart() {
  const z = state.zoomHeart;
  if (!z) return;
  const t = z.t;
  const ease = t * t * (3 - 2 * t);
  const size = 50 + 430 * ease;
  const a = clamp(t < 0.2 ? t / 0.2 : (1 - t) / 0.35, 0, 1);
  ctx.save();
  ctx.translate(z.x, z.y);
  ctx.rotate(Math.sin(t * 6) * 0.06);

  // 赤いGlow
  ctx.globalAlpha = a * 0.4;
  ctx.fillStyle = '#ff2e44';
  ctx.beginPath();
  ctx.arc(0, 0, size * 0.55, 0, TAU);
  ctx.fill();

  // 真っ赤なハート本体（ぷっくり丸い形+グラデ）
  const s = size * 0.5;
  ctx.scale(s, s);
  ctx.translate(0, 0.05);
  ctx.globalAlpha = a;
  const g = ctx.createLinearGradient(0, -1, 0, 0.95);
  g.addColorStop(0, '#ff5d6e');
  g.addColorStop(0.5, '#f5243a');
  g.addColorStop(1, '#d90f2c');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(0, 0.95);
  ctx.bezierCurveTo(-0.55, 0.45, -1.15, 0.1, -1.15, -0.35);
  ctx.bezierCurveTo(-1.15, -0.75, -0.8, -1.0, -0.45, -1.0);
  ctx.bezierCurveTo(-0.15, -1.0, 0, -0.75, 0, -0.45);
  ctx.bezierCurveTo(0, -0.75, 0.15, -1.0, 0.45, -1.0);
  ctx.bezierCurveTo(0.8, -1.0, 1.15, -0.75, 1.15, -0.35);
  ctx.bezierCurveTo(1.15, 0.1, 0.55, 0.45, 0, 0.95);
  ctx.closePath();
  ctx.fill();

  // 小さめツヤ（左のふくらみの上にちょこん）
  ctx.globalAlpha = a * 0.6;
  ctx.fillStyle = '#ffffff';
  ctx.save();
  ctx.translate(-0.52, -0.62);
  ctx.rotate(-0.55);
  ctx.beginPath();
  ctx.ellipse(0, 0, 0.30, 0.13, 0, 0, TAU);
  ctx.fill();
  ctx.restore();

  ctx.restore();
  ctx.globalAlpha = 1;
}

function render() {
  ctx.setTransform(view.scale, 0, 0, view.scale, 0, 0);

  drawBackground(state.time);
  drawCupBack();

  // 描画順: 奥ポテト → 落下中ポテト → 推し → 手前ポテト → 容器の手前
  drawLandedLayer('back');
  drawFalling();
  drawOshi();
  drawLandedLayer('front');
  drawCupFront();

  // つまみ上げ中のポテトは容器の手前へ
  drawGrabbed();
  drawSparkles();
  drawEmotes();
  drawGlitter();
  drawZoomHeart();
}

/* ================= ヒット判定 ================= */

function inPotato(p, pt) {
  const dx = pt.x - p.x, dy = pt.y - p.y;
  const c = Math.cos(-p.angle), s = Math.sin(-p.angle);
  const lx = dx * c - dy * s;
  const ly = dx * s + dy * c;
  return Math.abs(lx) <= p.W / 2 + 8 && Math.abs(ly) <= p.L / 2 + 8;
}

/* 見えている（手前パネルより上に出ている）箇所だけが押せる */
function isVisibleAboveFront(pt) {
  return pt.y < frontEdgeY(pt.x) + 4;
}

function hitPotatoLayer(pt, layer) {
  const arr = [];
  for (const p of state.potatoes) {
    if (p.layer === layer && p.state === 'landed') arr.push(p);
  }
  arr.sort((a, b) => b.y - a.y);   // 手前（最後に描かれたもの）から判定
  for (const p of arr) {
    if (isVisibleAboveFront(pt) && inPotato(p, pt)) return p;
  }
  return null;
}

function inOshiBBox(pt, pad) {
  if (!oshi.img) return false;
  const s = oshiSize();
  return Math.abs(pt.x - oshi.cx) <= s.w / 2 + pad &&
         Math.abs(pt.y - (oshi.cy + oshi.dropOff + oshi.jumpOff)) <= s.h / 2 + pad;
}

/* 透過PNGに対応するため、アルファ値で判定する */
function hitOshiPixel(pt) {
  if (!oshi.img || oshi.dropping) return false;
  const s = oshiSize();
  if (s.w <= 0 || s.h <= 0) return false;
  const dx = pt.x - (oshi.cx + oshi.ox);
  const dy = pt.y - (oshi.cy + oshi.oy + oshi.lift + oshi.dropOff + oshi.jumpOff);
  const c = Math.cos(-oshi.tilt), sn = Math.sin(-oshi.tilt);
  let lx = dx * c - dy * sn;
  let ly = dx * sn + dy * c;
  const ssx = oshi.squish * Math.max(0.25, Math.abs(spinScaleX()));
  lx /= ssx;
  ly /= oshi.squish || 1;
  if (Math.abs(lx) > s.w / 2 || Math.abs(ly) > s.h / 2) return false;
  if (!oshi.mask) return true;   // マスクを作れなかった場合はバウンディングボックス判定
  const u = clamp(Math.floor((lx / s.w + 0.5) * oshi.maskW), 0, oshi.maskW - 1);
  const v = clamp(Math.floor((ly / s.h + 0.5) * oshi.maskH), 0, oshi.maskH - 1);
  return oshi.mask[(v * oshi.maskW + u) * 4 + 3] > 24;
}

/* ================= ポインター入力 ================= */

const pointers = new Map();

function startGrab(p, pt) {
  p.state = 'grabbed';
  p.grabT = 0;
  p.gx = pt.x;
  p.gy = pt.y;
  p.landAngle = p.angle;
  spawnSparkles(p.x, p.y - 20);
  playPop();
}

function startOshiPress(id, pt) {
  oshi.pressed = true;
  oshi.pressId = id;
  oshi.wig = 0;
  oshi.liftV -= 160;   // タップの勢いで跳ねる
  oshi.tiltT = clamp((pt.x - oshi.cx) / 240, -1, 1) * 0.13;

  // ダブルタップで大ジャンプ！
  if (state.time - lastOshiTap < 0.3) {
    lastOshiTap = 0;
    // 演出抽選: 62%ジャンプ / 20%(5回に1回)横一回転 / 10%❤バースト / 8%迫る❤
    const r = Math.random();
    const fx = state.forceFx || (r < 0.08 ? 'zoom' : (r < 0.18 ? 'burst' : (r < 0.38 ? 'spin' : 'jump')));
    if (fx === 'spin') {
      oshi.spinning = true;
      oshi.spinT = 0;
    } else if (fx === 'burst') {
      heartBurst();
    } else if (fx === 'zoom') {
      state.zoomHeart = { t: 0, x: oshi.cx + rand(-20, 20), y: oshi.cy - 40 };
    } else {
      oshi.jumping = true;
      oshi.jumpV = -1200;
    }
    oshi.wig = 1.6;
    spawnEmotes(oshi.cx, oshi.cy - oshiSize().h / 2);
    spawnEmotes(oshi.cx, oshi.cy - oshiSize().h / 2 + 20);
    spawnSparkles(oshi.cx, oshi.cy - oshiSize().h / 2);
    spawnBigHeart();
    playBoing();
  } else {
    lastOshiTap = state.time;
    // たまに大きめ❤がふわっと
    if (Math.random() < 0.35) spawnBigHeart();
  }

  spawnEmotes(oshi.cx, oshi.cy - oshiSize().h / 2 + 10);
  playBoing();
}

/* レア演出: ❤がたくさん飛び出す */
function heartBurst() {
  if (state.reducedMotion) return;
  for (let i = 0; i < 26; i++) {
    const pink = Math.random() < 0.3;
    state.emotes.push({
      x: oshi.cx + rand(-60, 60),
      y: oshi.cy - oshiSize().h / 2 + rand(-20, 30),
      vx: rand(-70, 70),
      vy: rand(-140, -60),
      life: 0,
      max: rand(1.0, 1.7),
      ch: pink ? (Math.random() < 0.5 ? '💗' : '💖') : (Math.random() < 0.8 ? '❤' : '💕'),
      size: rand(20, 48),
      special: pink
    });
  }
}

/* 大きめ❤がひとつ、ふわっと（10回に1回は特別なピンク） */
function spawnBigHeart() {
  if (state.reducedMotion) return;
  const special = Math.random() < 0.1;
  state.emotes.push({
    x: oshi.cx + rand(-44, 44),
    y: oshi.cy - oshiSize().h / 2 - 6,
    vy: special ? rand(-45, -35) : rand(-55, -40),
    life: 0,
    max: special ? rand(1.6, 2.0) : rand(1.2, 1.6),
    ch: special ? (Math.random() < 0.5 ? '💗' : '💖') : '❤',
    size: special ? rand(52, 66) : rand(44, 58),
    special: special
  });
}
let lastOshiTap = -10;

function releaseOshi() {
  oshi.pressed = false;
  oshi.pressId = -1;
  oshi.wig = 1;
  oshi.oxT = 0; oshi.oyT = 0; oshi.tiltT = 0;
}

canvas.addEventListener('pointerdown', function (e) {
  e.preventDefault();
  const pt = toScene(e);
  try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* noop */ }

  if (state.mode === 'move') {
    if (state.hasImage && inOshiBBox(pt, 30)) {
      pointers.set(e.pointerId, { type: 'drag', dx: oshi.cx - pt.x, dy: oshi.cy - pt.y });
    }
    return;
  }

  // 判定順: 推し（最優先・スターなので）→ 手前ポテト → 奥ポテト
  if (state.hasImage && hitOshiPixel(pt)) {
    startOshiPress(e.pointerId, pt);
    pointers.set(e.pointerId, { type: 'oshi', sx: pt.x, sy: pt.y });
    return;
  }

  const pf = hitPotatoLayer(pt, 'front');
  if (pf) { startGrab(pf, pt); pointers.set(e.pointerId, { type: 'potato', p: pf }); return; }

  const pb = hitPotatoLayer(pt, 'back');
  if (pb) { startGrab(pb, pt); pointers.set(e.pointerId, { type: 'potato', p: pb }); return; }
});

canvas.addEventListener('pointermove', function (e) {
  const info = pointers.get(e.pointerId);
  if (!info) return;
  const pt = toScene(e);
  if (info.type === 'drag') {
    oshi.cx = clamp(pt.x + info.dx, 150, 390);
    oshi.cy = clamp(pt.y + info.dy, 320, 600);
  } else if (info.type === 'oshi') {
    if (oshi.pressed && oshi.pressId === e.pointerId) {
      oshi.oxT = clamp((pt.x - info.sx) * 0.3, -18, 18);
      oshi.oyT = clamp((pt.y - info.sy) * 0.2, -10, 14);
      oshi.tiltT = clamp((pt.x - oshi.cx) / 240, -1, 1) * 0.13;
    }
  } else if (info.type === 'potato') {
    if (info.p.state === 'grabbed') { info.p.gx = pt.x; info.p.gy = pt.y; }
  }
});

function endPointer(e) {
  const info = pointers.get(e.pointerId);
  if (!info) return;
  if (info.type === 'oshi') {
    if (oshi.pressId === e.pointerId) releaseOshi();
  } else if (info.type === 'potato') {
    const p = info.p;
    if (p.state === 'grabbed') {
      p.state = 'pop';
      p.popT = 0;
      spawnSparkles(p.x, p.y);
    }
  }
  pointers.delete(e.pointerId);
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });

/* ================= 画像アップロード ================= */

function buildMask(img) {
  const natW = img.naturalWidth || img.width;
  const natH = img.naturalHeight || img.height;
  if (!natW || !natH) return null;
  const mw = Math.max(1, Math.min(256, natW));
  const mh = Math.max(1, Math.round(mw * natH / natW));
  try {
    const c = document.createElement('canvas');
    c.width = mw; c.height = mh;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0, mw, mh);
    const data = g.getImageData(0, 0, mw, mh).data;
    oshi.maskW = mw; oshi.maskH = mh;
    return data;
  } catch (err) {
    return null;
  }
}

function setOshiImage(img) {
  const natW = img.naturalWidth || img.width;
  const natH = img.naturalHeight || img.height;
  if (!natW || !natH) { toast('画像を読みこめませんでした'); return; }

  // 縦横比を保ったまま、300x340 の枠に収める基本サイズを決める
  const s = Math.min(300 / natW, 340 / natH, 3);
  oshi.img = img;
  oshi.baseW = natW * s;
  oshi.baseH = natH * s;
  oshi.mask = buildMask(img);
  state.hasImage = true;

  sizeRange.disabled = false;
  btnMode.disabled = false;
  btnUpload.textContent = '📷 さし替え';
}

const OK_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

function handleFile(file) {
  if (!file) return;
  const okType = OK_TYPES.indexOf(file.type) !== -1;
  const okExt = /\.(png|jpe?g|webp)$/i.test(file.name || '');
  if (!okType && !okExt) {
    toast('PNG / JPEG / WebP 画像をえらんでね');
    return;
  }
  toast('よみこみちゅう…');
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = function () {
    URL.revokeObjectURL(url);
    setOshiImage(img);
    startOverlay.classList.add('hidden');
    state.started = true;
    // 推しが降ってくる演出つきでスタート
    startShow({ silent: true });
    toast('推しが容器にイン！🎉');
  };
  img.onerror = function () {
    URL.revokeObjectURL(url);
    toast('画像を読みこめませんでした。別の画像でためしてね');
  };
  img.src = url;
}

fileInput.addEventListener('change', function () {
  const f = fileInput.files && fileInput.files[0];
  handleFile(f);
  fileInput.value = '';   // 同じファイルを再度えらべるようにする
});

/* ================= UI ================= */

function setMode(m) {
  state.mode = m;
  btnMode.classList.toggle('active', m === 'move');
  if (m === 'move') {
    btnMode.textContent = '🎮 あそぶ';
    hintBar.textContent = '📐 推しをドラッグで位置調整（おわったら「あそぶ」へ）';
  } else {
    btnMode.textContent = '📐 いどう';
    hintBar.textContent = '推しをタップすると持ち上がるよ！ポテトはタップでつまんでね🍟';
  }
  // モード切替時に押下状態を引きずらない
  for (const [id, info] of pointers) {
    if (info.type === 'oshi' && oshi.pressId === id) releaseOshi();
  }
}

btnUpload.addEventListener('click', function () { fileInput.click(); });
startUpload.addEventListener('click', function () { fileInput.click(); });
startSkip.addEventListener('click', function () {
  startOverlay.classList.add('hidden');
  state.started = true;
  startShow({ silent: true });
});

btnPlay.addEventListener('click', function () {
  if (!state.started) {
    startOverlay.classList.add('hidden');
    state.started = true;
  }
  startShow();
});

btnAdd.addEventListener('click', addPotatoes);

btnMode.addEventListener('click', function () {
  if (!state.hasImage) { toast('まずは推し画像をえらんでね'); return; }
  setMode(state.mode === 'move' ? 'play' : 'move');
});

btnReset.addEventListener('click', function () {
  oshi.cx = 270; oshi.cy = 450;
  oshi.userScale = 1;
  sizeRange.value = '100';
  sizeLabel.textContent = '100%';
  oshi.lift = 0; oshi.liftV = 0;
  oshi.squish = 1; oshi.squishV = 0;
  oshi.ox = 0; oshi.oxV = 0; oshi.oxT = 0;
  oshi.oy = 0; oshi.oyV = 0; oshi.oyT = 0;
  oshi.tilt = 0; oshi.tiltV = 0; oshi.tiltT = 0;
  oshi.pressed = false; oshi.pressId = -1; oshi.wig = 0;
  oshi.dropping = false; oshi.dropOff = 0; oshi.dropV = 0;
  oshi.jumping = false; oshi.jumpOff = 0; oshi.jumpV = 0;
  oshi.spinning = false; oshi.spinT = 0;
  state.sparkles.length = 0;
  state.emotes.length = 0;
  state.glitter.length = 0;
  state.zoomHeart = null;
  pointers.clear();
  setMode('play');
  startShow({ silent: true });
  toast('はじめからやりなおし！🍟');
});

btnHelp.addEventListener('click', function () { helpOverlay.classList.remove('hidden'); });
helpClose.addEventListener('click', function () { helpOverlay.classList.add('hidden'); });

/* 画面をPNGで保存（画像を表示して長押し保存方式・すべて端末内処理） */
btnShot.addEventListener('click', function () {
  try {
    const url = canvas.toDataURL('image/png');
    saveImg.src = url;
    saveOverlay.classList.remove('hidden');
    toast('画像を長押し(右クリック)で保存してね📸');
  } catch (err) {
    toast('保存できなかったよ…');
  }
});
saveClose.addEventListener('click', function () {
  saveOverlay.classList.add('hidden');
});

/* しお＝キラキララメをふる（7回に1回はレアカラー） */
btnSalt.addEventListener('click', function () {
  const colorful = state.forceSalt != null
    ? state.forceSalt === 'rainbow'
    : Math.random() < 1 / 7;
  spawnGlitter(colorful);
  playSprinkle();
});

/* 効果音オン/オフ */
btnSound.addEventListener('click', function () {
  muted = !muted;
  btnSound.textContent = muted ? '🔇' : '🔊';
  btnSound.setAttribute('aria-label', muted ? 'おとオン' : 'おとオフ');
  if (!muted) { ensureAudio(); playPop(); }
  toast(muted ? 'おとオフにしたよ' : 'おとオンにしたよ🔊');
});

sizeRange.addEventListener('input', function () {
  oshi.userScale = Number(sizeRange.value) / 100;
  sizeLabel.textContent = sizeRange.value + '%';
});

/* reduced-motion 設定の変化を追跡 */
try {
  reducedMQ.addEventListener('change', function (e) { state.reducedMotion = e.matches; });
} catch (err) { /* 古いブラウザでは無視 */ }

/* ================= HUD ================= */

let lastHint = '';
function updateHud() {
  let hint;
  if (state.mode === 'move') {
    hint = '📐 推しをドラッグで位置調整（おわったら「あそぶ」へ）';
  } else if (!state.hasImage && state.started) {
    hint = '「📷 推しをえらぶ」で推しを招待しよう！ポテトはタップでつまめるよ';
  } else if (state.started && countLanded() === 0 && state.pending === 0 && state.pendingFront === 0) {
    hint = 'ポテトがなくなった！「▶️ 再生」か「🍟 ついか」でふらせられるよ';
  } else {
    hint = '推しをタップすると持ち上がるよ！ポテトはタップでつまんでね🍟';
  }
  if (hint !== lastHint) { hintBar.textContent = hint; lastHint = hint; }
}

/* ================= メインループ ================= */

window.addEventListener('resize', resize);
if (typeof ResizeObserver !== 'undefined') {
  new ResizeObserver(resize).observe(wrap);
}

/* テスト/デバッグ用フック（ブラウザのみ） */
window.__opm = {
  landed: countLanded,
  inBox: countInBox,
  state: state,
  oshi: oshi
};

/* 最初のこんもりポテトを配置してから起動 */
buildMound();
resize();

let last = performance.now();
function frame(now) {
  const dt = clamp((now - last) / 1000, 0, 0.05);
  last = now;
  state.time += dt;
  update(dt);
  render();
  updateHud();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

})();
