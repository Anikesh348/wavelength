const spectrumPairs = [
  ["Hot", "Cold"],
  ["Fantasy", "Sci-Fi"],
  ["Chaotic", "Organized"],
  ["Cheap", "Expensive"],
  ["Risky", "Safe"],
  ["Serious", "Funny"],
  ["Mainstream", "Niche"],
  ["Optimistic", "Pessimistic"],
  ["Soft", "Hard"],
  ["Clean", "Messy"],
  ["Abstract", "Literal"],
  ["Introvert", "Extrovert"],
  ["Tidy", "Cluttered"],
  ["Mature", "Immature"],
  ["Ethical", "Questionable"],
];

const SETUP_PUSH_GAIN = 1.35;
const FIXED_TARGET_WIDTH_DEG = 35;
const DEFAULT_TEAM_NAMES = ["Team Aurora", "Team Ember"];
const PERSISTENCE_KEY = "wavelength.scoreboard.v1";
const TARGET_WEDGE_COLORS = ["#e0b247", "#e45b4c", "#5d8fa6", "#e45b4c", "#e0b247"];
const TARGET_WEDGE_LABELS = ["2", "3", "4", "3", "2"];
const SCORE_POPUP_VISIBLE_MS = 2400;
const SCORE_POPUP_FADE_MS = 1100;
const SCORE_POPUP_OFFSET_PX = 12;
const AUTO_SPIN_MIN_SPEED = 640;
const AUTO_SPIN_MAX_SPEED = 920;
const AUTO_SPIN_STOP_SPEED = 10;
const AUTO_SPIN_STATIC_FRICTION = 30;
const AUTO_SPIN_VISCOUS_FRICTION = 0.18;
const AUTO_SPIN_AERO_DRAG = 0.0012;
const AUTO_SPIN_PEG_DRAG = 40;
const MEME_SOUND_SOURCES = Object.freeze({
  win: "./assets/sounds/7_crore_meme_sound_kbc.mp3",
  lose: "./assets/sounds/faaa.mp3",
});
const MEME_SOUND_VOLUME = 1;

const state = {
  teams: [
    { name: DEFAULT_TEAM_NAMES[0], score: 0 },
    { name: DEFAULT_TEAM_NAMES[1], score: 0 },
  ],
  currentTeam: 0,
  round: 1,
  phase: "psychic",
  leftLabel: "Hot",
  rightLabel: "Cold",
  wheelRotation: 0,
  targetAngle: 0,
  targetWidth: FIXED_TARGET_WIDTH_DEG,
  dial: {
    angle: 0,
    target: 0,
    velocity: 0,
    dragging: false,
    pointerId: null,
    lastPointerAt: 0,
    lastFrameAt: performance.now(),
    clickStep: 0,
  },
  autoSpin: {
    active: false,
    speed: 0,
    direction: 1,
    lastFrameAt: performance.now(),
    jitterSeed: 0,
  },
  wheel: {
    w: 0,
    h: 0,
    cx: 0,
    cy: 0,
    slopeSideY: 0,
    slopeCenterY: 0,
    outerR: 0,
    ringOuterR: 0,
    faceR: 0,
    hubR: 0,
    targetInnerR: 0,
    targetOuterR: 0,
  },
};

const el = {
  team0Name: document.getElementById("team0Name"),
  team1Name: document.getElementById("team1Name"),
  leftLabel: document.getElementById("leftLabel"),
  rightLabel: document.getElementById("rightLabel"),
  roundCount: document.getElementById("roundCount"),
  team0Score: document.getElementById("team0Score"),
  team1Score: document.getElementById("team1Score"),
  team0Card: document.getElementById("team0Card"),
  team1Card: document.getElementById("team1Card"),
  phaseBadge: document.getElementById("phaseBadge"),
  startGuessBtn: document.getElementById("startGuessBtn"),
  revealBtn: document.getElementById("revealBtn"),
  resetRoundBtn: document.getElementById("resetRoundBtn"),
  nextRoundBtn: document.getElementById("nextRoundBtn"),
  newGameBtn: document.getElementById("newGameBtn"),
  spinWheelBtn: document.getElementById("spinWheelBtn"),
  wheelShell: document.getElementById("wheelShell"),
  pointerLayer: document.getElementById("pointerLayer"),
  spindle: document.getElementById("spindle"),
  coverLayer: document.getElementById("coverLayer"),
  coverHandleOverlay: document.querySelector(".cover-handle-overlay"),
  scorePopup: document.getElementById("scorePopup"),
  spectrumCanvas: document.getElementById("spectrumCanvas"),
  targetCanvas: document.getElementById("targetCanvas"),
};

const spectrumCtx = el.spectrumCanvas.getContext("2d");
const targetCtx = el.targetCanvas.getContext("2d");

let audioCtx = null;
let previousPairIndex = -1;
let popupHideTimer = null;
let popupCleanupTimer = null;
let popupTeamIndex = null;
let pendingScore = null;
let spinNoiseBuffer = null;
let spinSoundNodes = null;
let activeMemeAudio = null;

function clamp(n, min, max) {
  return Math.min(Math.max(n, min), max);
}

function shortestAngularDistance(a, b) {
  return Math.abs((((a - b + 540) % 360) + 360) % 360 - 180);
}

function signedAngularDelta(from, to) {
  return ((((to - from + 540) % 360) + 360) % 360) - 180;
}

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

function normalizeTeamName(value, fallbackName) {
  if (typeof value !== "string") return fallbackName;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, 24) : fallbackName;
}

function readPersistedScoreboard() {
  try {
    const raw = localStorage.getItem(PERSISTENCE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.teams) || parsed.teams.length !== 2) {
      return null;
    }
    return parsed;
  } catch (_error) {
    return null;
  }
}

function persistScoreboard() {
  try {
    const payload = {
      teams: state.teams.map((team, index) => ({
        name: normalizeTeamName(team.name, DEFAULT_TEAM_NAMES[index]),
        score: Number.isFinite(team.score) ? Math.max(0, Math.floor(team.score)) : 0,
      })),
      round: Number.isFinite(state.round) ? Math.max(1, Math.floor(state.round)) : 1,
      currentTeam: Number.isFinite(state.currentTeam) ? Math.floor(state.currentTeam) : 0,
    };
    localStorage.setItem(PERSISTENCE_KEY, JSON.stringify(payload));
  } catch (_error) {
    // Ignore persistence failures (e.g. storage denied/private mode).
  }
}

function clearPersistedScoreboard() {
  try {
    localStorage.removeItem(PERSISTENCE_KEY);
  } catch (_error) {
    // Ignore storage cleanup failures.
  }
}

function loadPersistedScoreboard() {
  const persisted = readPersistedScoreboard();
  if (!persisted) return;
  state.teams = persisted.teams.map((team, index) => ({
    name: normalizeTeamName(team.name, DEFAULT_TEAM_NAMES[index]),
    score:
      Number.isFinite(team.score) || typeof team.score === "string"
        ? Math.max(0, Math.floor(Number(team.score) || 0))
        : 0,
  }));
  if (Number.isFinite(persisted.round) || typeof persisted.round === "string") {
    state.round = Math.max(1, Math.floor(Number(persisted.round) || 1));
  }
  if (Number.isFinite(persisted.currentTeam) || typeof persisted.currentTeam === "string") {
    const parsedTeamIndex = Math.floor(Number(persisted.currentTeam) || 0);
    state.currentTeam = clamp(parsedTeamIndex, 0, state.teams.length - 1);
  }
}

function angleToTheta(deg) {
  const t = (deg + 90) / 180;
  return Math.PI + t * Math.PI;
}

function initAudio() {
  if (!audioCtx) {
    audioCtx = new window.AudioContext();
  }
  if (audioCtx.state === "suspended") {
    audioCtx.resume();
  }
}

function playClick() {
  if (!audioCtx) return;
  const now = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = "triangle";
  osc.frequency.setValueAtTime(920, now);
  osc.frequency.exponentialRampToValueAtTime(560, now + 0.028);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.07, now + 0.005);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.045);
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start(now);
  osc.stop(now + 0.05);
}

function playRevealSound() {
  if (!audioCtx) return;
  const now = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  const filter = audioCtx.createBiquadFilter();
  osc.type = "sawtooth";
  osc.frequency.setValueAtTime(340, now);
  osc.frequency.exponentialRampToValueAtTime(150, now + 0.35);
  filter.type = "lowpass";
  filter.frequency.setValueAtTime(1900, now);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.12, now + 0.03);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.42);
  osc.connect(filter);
  filter.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start(now);
  osc.stop(now + 0.45);
}

function primeMemeSounds() {
  if (typeof window.Audio !== "function") return;
  Object.values(MEME_SOUND_SOURCES).forEach((src) => {
    const clip = new Audio(src);
    clip.preload = "auto";
    clip.volume = MEME_SOUND_VOLUME;
    clip.load();
  });
}

function stopMemeSound() {
  if (!activeMemeAudio) return;
  try {
    activeMemeAudio.pause();
    activeMemeAudio.currentTime = 0;
  } catch (_error) {
    // Ignore teardown errors from stale/failed audio elements.
  }
  activeMemeAudio = null;
}

function playMemeFallback(kind) {
  if (!audioCtx) return;
  const now = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  if (kind === "win") {
    osc.type = "triangle";
    osc.frequency.setValueAtTime(420, now);
    osc.frequency.exponentialRampToValueAtTime(940, now + 0.18);
    osc.frequency.exponentialRampToValueAtTime(1240, now + 0.3);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.11, now + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.42);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(now);
    osc.stop(now + 0.45);
    return;
  }

  osc.type = "sawtooth";
  osc.frequency.setValueAtTime(360, now);
  osc.frequency.exponentialRampToValueAtTime(160, now + 0.18);
  osc.frequency.exponentialRampToValueAtTime(96, now + 0.38);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.09, now + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.46);
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start(now);
  osc.stop(now + 0.48);
}

function playMemeSound(kind) {
  const src = MEME_SOUND_SOURCES[kind];
  if (!src || typeof window.Audio !== "function") {
    playMemeFallback(kind);
    return;
  }
  stopMemeSound();
  const clip = new Audio(src);
  clip.preload = "auto";
  clip.volume = MEME_SOUND_VOLUME;
  activeMemeAudio = clip;

  const clearIfActive = () => {
    if (activeMemeAudio === clip) {
      activeMemeAudio = null;
    }
  };

  clip.addEventListener("ended", clearIfActive, { once: true });
  clip.addEventListener(
    "error",
    () => {
      clearIfActive();
      playMemeFallback(kind);
    },
    { once: true }
  );

  const playPromise = clip.play();
  if (playPromise && typeof playPromise.catch === "function") {
    playPromise.catch(() => {
      clearIfActive();
      playMemeFallback(kind);
    });
  }
}

function playRoundResultMeme(points) {
  playMemeSound(points > 0 ? "win" : "lose");
}

function getSpinNoiseBuffer() {
  if (!audioCtx) return null;
  if (spinNoiseBuffer) return spinNoiseBuffer;
  const length = Math.floor(audioCtx.sampleRate * 2);
  const noiseBuffer = audioCtx.createBuffer(1, length, audioCtx.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < length; i += 1) {
    data[i] = (Math.random() * 2 - 1) * 0.75;
  }
  spinNoiseBuffer = noiseBuffer;
  return spinNoiseBuffer;
}

function updateSpinSound(speedDegPerSec) {
  if (!audioCtx || !spinSoundNodes) return;
  const now = audioCtx.currentTime;
  const speedRatio = clamp(speedDegPerSec / AUTO_SPIN_MAX_SPEED, 0, 1);
  const gainTarget = 0.024 + speedRatio * 0.135;
  const cutoffTarget = 300 + speedRatio * 1060;
  const resonanceTarget = 0.9 + speedRatio * 2;
  spinSoundNodes.gain.gain.setTargetAtTime(gainTarget, now, 0.055);
  spinSoundNodes.filter.frequency.setTargetAtTime(cutoffTarget, now, 0.06);
  spinSoundNodes.filter.Q.setTargetAtTime(resonanceTarget, now, 0.08);
}

function stopSpinSound({ fast = false } = {}) {
  if (!audioCtx || !spinSoundNodes) return;
  const { source, gain, wobble } = spinSoundNodes;
  const now = audioCtx.currentTime;
  const fadeTime = fast ? 0.06 : 0.18;
  gain.gain.cancelScheduledValues(now);
  gain.gain.setTargetAtTime(0.0001, now, fadeTime / 3);
  const stopAt = now + fadeTime + 0.04;
  try {
    source.stop(stopAt);
  } catch (_error) {
    // Ignore stop calls on already stopped sources.
  }
  try {
    wobble.stop(stopAt);
  } catch (_error) {
    // Ignore stop calls on already stopped oscillators.
  }
  spinSoundNodes = null;
}

function startSpinSound(initialSpeed) {
  if (!audioCtx) return;
  stopSpinSound({ fast: true });
  const noiseBuffer = getSpinNoiseBuffer();
  if (!noiseBuffer) return;
  const now = audioCtx.currentTime;
  const source = audioCtx.createBufferSource();
  source.buffer = noiseBuffer;
  source.loop = true;

  const filter = audioCtx.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.setValueAtTime(420, now);
  filter.Q.setValueAtTime(1, now);

  const gain = audioCtx.createGain();
  gain.gain.setValueAtTime(0.0001, now);

  const wobble = audioCtx.createOscillator();
  wobble.type = "sine";
  wobble.frequency.setValueAtTime(7.2, now);
  const wobbleGain = audioCtx.createGain();
  wobbleGain.gain.setValueAtTime(80, now);

  source.connect(filter);
  filter.connect(gain);
  gain.connect(audioCtx.destination);
  wobble.connect(wobbleGain);
  wobbleGain.connect(filter.frequency);

  source.start(now);
  wobble.start(now);

  spinSoundNodes = { source, filter, gain, wobble };
  updateSpinSound(initialSpeed);
}

function pickSpectrumPair() {
  let idx = Math.floor(Math.random() * spectrumPairs.length);
  if (idx === previousPairIndex && spectrumPairs.length > 1) {
    idx = (idx + 1) % spectrumPairs.length;
  }
  previousPairIndex = idx;
  return spectrumPairs[idx];
}

function buildRound({ closeCoverInstantly = false } = {}) {
  stopAutoSpin({ fastSoundOff: true });
  stopMemeSound();
  stopDialDrag();
  const [leftLabel, rightLabel] = pickSpectrumPair();
  state.leftLabel = leftLabel;
  state.rightLabel = rightLabel;
  state.targetAngle = randomBetween(-90, 90);
  state.targetWidth = FIXED_TARGET_WIDTH_DEG;
  state.phase = "setup";
  state.wheelRotation = 0;
  state.dial.angle = 0;
  state.dial.target = 0;
  state.dial.velocity = 0;
  state.dial.clickStep = 0;
  setCover("closed", { instant: closeCoverInstantly });
  updateUI();
  drawAll();
}

function updateUI() {
  if (document.activeElement !== el.team0Name) {
    el.team0Name.value = state.teams[0].name;
  }
  if (document.activeElement !== el.team1Name) {
    el.team1Name.value = state.teams[1].name;
  }
  el.leftLabel.textContent = state.leftLabel;
  el.rightLabel.textContent = state.rightLabel;
  el.roundCount.textContent = String(state.round);
  el.team0Score.textContent = String(state.teams[0].score);
  el.team1Score.textContent = String(state.teams[1].score);

  el.team0Card.classList.toggle("active", state.currentTeam === 0);
  el.team1Card.classList.toggle("active", state.currentTeam === 1);

  if (state.phase === "setup") {
    el.phaseBadge.textContent = "Setup (Hidden)";
    el.startGuessBtn.disabled = true;
    el.revealBtn.disabled = false;
    el.revealBtn.textContent = "Reveal";
    el.resetRoundBtn.disabled = true;
    el.nextRoundBtn.disabled = true;
    el.pointerLayer.classList.remove("locked");
  } else if (state.phase === "psychic") {
    el.phaseBadge.textContent = "Psychic View";
    el.startGuessBtn.disabled = false;
    el.revealBtn.disabled = true;
    el.revealBtn.textContent = "Reveal";
    el.resetRoundBtn.disabled = false;
    el.nextRoundBtn.disabled = true;
    el.pointerLayer.classList.add("locked");
  } else if (state.phase === "guessing") {
    el.phaseBadge.textContent = "Guessing View";
    el.startGuessBtn.disabled = true;
    el.revealBtn.disabled = false;
    el.revealBtn.textContent = "Reveal";
    el.resetRoundBtn.disabled = true;
    el.nextRoundBtn.disabled = true;
    el.pointerLayer.classList.remove("locked");
  } else if (state.phase === "reveal") {
    el.phaseBadge.textContent = "Reveal";
    el.startGuessBtn.disabled = true;
    el.revealBtn.disabled = true;
    el.revealBtn.textContent = "Reveal";
    el.resetRoundBtn.disabled = true;
    el.nextRoundBtn.disabled = false;
    el.pointerLayer.classList.add("locked");
  }

  el.wheelShell.classList.toggle("setup-mode", state.phase === "setup");
  el.revealBtn.classList.toggle("btn-reveal-live", state.phase === "guessing");
  syncSpinControls();

  persistScoreboard();
}

function syncSpinControls() {
  const canSpin = state.phase === "setup";
  el.wheelShell.classList.toggle("auto-spinning", state.autoSpin.active);
  if (!el.spinWheelBtn) return;
  el.spinWheelBtn.hidden = !canSpin;
  el.spinWheelBtn.setAttribute("aria-hidden", canSpin ? "false" : "true");
  el.spinWheelBtn.disabled = !canSpin || state.autoSpin.active;
  el.spinWheelBtn.classList.toggle("is-ready", canSpin && !state.autoSpin.active);
  el.spinWheelBtn.classList.toggle("is-spinning", state.autoSpin.active);
  el.spinWheelBtn.setAttribute("aria-busy", state.autoSpin.active ? "true" : "false");
}

function resizeCanvas(canvas, ctx) {
  const dpr = window.devicePixelRatio || 1;
  const width = Math.floor(canvas.clientWidth);
  const height = Math.floor(canvas.clientHeight);
  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function measureWheel() {
  const rect = el.wheelShell.getBoundingClientRect();
  state.wheel.w = rect.width;
  state.wheel.h = rect.height;
  state.wheel.cx = rect.width / 2;
  state.wheel.cy = rect.height * 0.525;
  state.wheel.outerR = Math.min(rect.width * 0.45, rect.height * 0.44);
  state.wheel.ringOuterR = state.wheel.outerR * 0.948;
  state.wheel.faceR = state.wheel.outerR * 0.836;
  state.wheel.hubR = state.wheel.faceR * 0.2;
  state.wheel.targetInnerR = state.wheel.hubR * 0.86;
  state.wheel.targetOuterR = state.wheel.faceR * 0.95;
  state.wheel.slopeCenterY = state.wheel.cy;
  state.wheel.slopeSideY = state.wheel.cy - state.wheel.faceR * 0.26;
  const spindleLength = clamp(state.wheel.faceR * 0.8, 120, state.wheel.faceR - 14);
  const spindleWidth = clamp(state.wheel.faceR * 0.018, 4, 7);

  el.wheelShell.style.setProperty("--face-radius", `${state.wheel.faceR}px`);
  el.wheelShell.style.setProperty("--face-radius-px", `${state.wheel.faceR}px`);
  el.wheelShell.style.setProperty("--pivot-x", `${(state.wheel.cx / rect.width) * 100}%`);
  el.wheelShell.style.setProperty("--pivot-x-px", `${state.wheel.cx}px`);
  el.wheelShell.style.setProperty(
    "--pivot-y",
    `${(state.wheel.cy / rect.height) * 100}%`
  );
  el.wheelShell.style.setProperty("--pivot-y-px", `${state.wheel.cy}px`);
  el.wheelShell.style.setProperty(
    "--slope-side-y-px",
    `${state.wheel.slopeSideY}px`
  );
  el.wheelShell.style.setProperty(
    "--slope-center-y-px",
    `${state.wheel.slopeCenterY}px`
  );
  el.wheelShell.style.setProperty(
    "--spindle-length-px",
    `${spindleLength}px`
  );
  el.wheelShell.style.setProperty("--spindle-width-px", `${spindleWidth}px`);

  const shellStyle = getComputedStyle(el.wheelShell);
  const slopeInsetRaw = shellStyle.getPropertyValue("--slope-inset-x").trim();
  let slopeInsetPx = state.wheel.w * 0.1;
  if (slopeInsetRaw.endsWith("%")) {
    const insetPct = Number.parseFloat(slopeInsetRaw);
    if (Number.isFinite(insetPct)) {
      slopeInsetPx = (state.wheel.w * insetPct) / 100;
    }
  } else if (slopeInsetRaw.endsWith("px")) {
    const insetPx = Number.parseFloat(slopeInsetRaw);
    if (Number.isFinite(insetPx)) {
      slopeInsetPx = insetPx;
    }
  }

  // Use the same slope-edge direction as the cover polygon, then intersect with
  // the circular mask so the handle root sits exactly on the visible cover edge.
  const slopeEdgeX = state.wheel.w - slopeInsetPx;
  const slopeEdgeY = state.wheel.slopeSideY;
  const dirX = slopeEdgeX - state.wheel.cx;
  const dirY = slopeEdgeY - state.wheel.cy;
  const dirLen = Math.hypot(dirX, dirY) || 1;
  const handleAnchorX = state.wheel.cx + (dirX / dirLen) * state.wheel.faceR;
  const handleAnchorY = state.wheel.cy + (dirY / dirLen) * state.wheel.faceR;
  el.wheelShell.style.setProperty("--cover-handle-x-px", `${handleAnchorX}px`);
  el.wheelShell.style.setProperty("--cover-handle-y-px", `${handleAnchorY}px`);
  const handleAngleDeg = (Math.atan2(dirY, dirX) * 180) / Math.PI;
  el.wheelShell.style.setProperty("--cover-handle-angle", `${handleAngleDeg}deg`);

  const guessLimit = getGuessAngleLimit();
  state.dial.angle = clamp(state.dial.angle, -guessLimit, guessLimit);
  state.dial.target = clamp(state.dial.target, -guessLimit, guessLimit);
}

function drawRingSegment(ctx, cx, cy, innerR, outerR, start, end, fill) {
  ctx.beginPath();
  ctx.arc(cx, cy, outerR, start, end, false);
  ctx.arc(cx, cy, innerR, end, start, true);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
}

function getGuessAngleLimit() {
  const sideInsetX = state.wheel.w * 0.1;
  const dx = Math.max(1, state.wheel.cx - sideInsetX);
  const dy = Math.max(1, state.wheel.cy - state.wheel.slopeSideY);
  const rawLimit = (Math.atan2(dx, dy) * 180) / Math.PI;
  return clamp(rawLimit - 1.2, 48, 88);
}

function clampGuessAngle(deg) {
  const limit = getGuessAngleLimit();
  return clamp(deg, -limit, limit);
}

function paintSpectrumBase(ctx) {
  const { cx, cy, outerR, ringOuterR, faceR } = state.wheel;

  const scallopCount = 36;
  const scallopRadius = outerR * 0.072;
  const scallopCenterR = outerR * 0.992;

  // A white undercoat keeps the scallops visually fused to the navy rim.
  ctx.beginPath();
  ctx.fillStyle = "#f2eee5";
  ctx.arc(cx, cy, scallopCenterR + scallopRadius * 0.28, 0, Math.PI * 2);
  ctx.fill();

  for (let i = 0; i < scallopCount; i += 1) {
    const t = i / scallopCount;
    const a = t * Math.PI * 2;
    const sx = cx + Math.cos(a) * scallopCenterR;
    const sy = cy + Math.sin(a) * scallopCenterR;
    ctx.beginPath();
    ctx.fillStyle = "#f2eee5";
    ctx.arc(sx, sy, scallopRadius, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.beginPath();
  ctx.fillStyle = "#070b4a";
  ctx.arc(cx, cy, ringOuterR, 0, Math.PI * 2);
  ctx.fill();

  ctx.beginPath();
  ctx.fillStyle = "#fbfbf8";
  ctx.arc(cx, cy, faceR, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = "#0a1156";
  ctx.lineWidth = Math.max(1.6, faceR * 0.02);
  ctx.beginPath();
  ctx.arc(cx, cy, faceR, 0, Math.PI * 2, false);
  ctx.stroke();
}

function drawSpectrum(rotationDeg) {
  const { w, h, cx, cy } = state.wheel;
  spectrumCtx.clearRect(0, 0, w, h);
  spectrumCtx.save();
  spectrumCtx.translate(cx, cy);
  spectrumCtx.rotate((rotationDeg * Math.PI) / 180);
  spectrumCtx.translate(-cx, -cy);
  paintSpectrumBase(spectrumCtx);
  spectrumCtx.restore();
}

function drawTarget(rotationDeg, visible = true) {
  const { w, h, cx, cy, targetInnerR, targetOuterR } = state.wheel;
  targetCtx.clearRect(0, 0, w, h);
  if (!visible) return;
  targetCtx.save();
  targetCtx.translate(cx, cy);
  targetCtx.rotate((rotationDeg * Math.PI) / 180);
  targetCtx.translate(-cx, -cy);
  const theta = angleToTheta(state.targetAngle);
  const halfW = (state.targetWidth * Math.PI) / 360;
  const step = (halfW * 2) / TARGET_WEDGE_COLORS.length;
  const centers = [theta, theta + Math.PI];
  const labelRadius = targetInnerR + (targetOuterR - targetInnerR) * 0.91;
  const labelSize = Math.max(10, Math.min(18, targetOuterR * 0.065));

  for (const centerTheta of centers) {
    targetCtx.save();
    targetCtx.shadowColor = "rgba(0,0,0,0.17)";
    targetCtx.shadowBlur = 7;
    for (let i = 0; i < TARGET_WEDGE_COLORS.length; i += 1) {
      const start = centerTheta - halfW + i * step;
      const end = start + step;
      drawRingSegment(
        targetCtx,
        cx,
        cy,
        targetInnerR,
        targetOuterR,
        start,
        end,
        TARGET_WEDGE_COLORS[i]
      );
    }
    targetCtx.restore();

    for (let i = 0; i < TARGET_WEDGE_LABELS.length; i += 1) {
      const start = centerTheta - halfW + i * step;
      const end = start + step;
      const mid = (start + end) * 0.5;
      const x = cx + Math.cos(mid) * labelRadius;
      const y = cy + Math.sin(mid) * labelRadius;

      targetCtx.save();
      targetCtx.translate(x, y);
      targetCtx.rotate(mid + Math.PI / 2);
      targetCtx.fillStyle = "#111111";
      targetCtx.font = `400 ${labelSize}px "Poppins", sans-serif`;
      targetCtx.textAlign = "center";
      targetCtx.textBaseline = "middle";
      targetCtx.fillText(TARGET_WEDGE_LABELS[i], 0, 0);
      targetCtx.restore();
    }
  }
  targetCtx.restore();
}

function drawAll() {
  const liveWheelRotation =
    state.phase === "setup" ? state.dial.angle : state.wheelRotation;
  const targetVisible = state.phase === "psychic" || state.phase === "reveal";
  drawSpectrum(liveWheelRotation);
  drawTarget(liveWheelRotation, targetVisible);
}

function setCover(mode, { instant = false } = {}) {
  const transitionTargets = [el.coverLayer, el.coverHandleOverlay].filter(Boolean);

  if (instant) {
    transitionTargets.forEach((target) => {
      target.style.transition = "none";
    });
    // Ensure transitions are disabled before changing state.
    void el.coverLayer.offsetHeight;
  }

  el.coverLayer.classList.remove("open", "closed");
  el.coverLayer.classList.add(mode);

  if (instant) {
    // Commit the new transform, then restore transitions for future interactions.
    void el.coverLayer.offsetHeight;
    transitionTargets.forEach((target) => {
      target.style.transition = "";
    });
  }
}

function startAutoSpin() {
  if (state.phase !== "setup") return;
  initAudio();
  stopDialDrag();
  stopAutoSpin({ fastSoundOff: true });

  state.autoSpin.active = true;
  state.autoSpin.direction = Math.random() < 0.5 ? 1 : -1;
  state.autoSpin.speed = randomBetween(AUTO_SPIN_MIN_SPEED, AUTO_SPIN_MAX_SPEED);
  state.autoSpin.lastFrameAt = performance.now();
  state.autoSpin.jitterSeed = Math.random() * Math.PI * 2;
  state.dial.target = state.dial.angle;
  state.dial.velocity = 0;
  state.dial.clickStep = Math.round(state.dial.angle / 3.2);

  startSpinSound(state.autoSpin.speed);
  syncSpinControls();
}

function stopAutoSpin({ fastSoundOff = false } = {}) {
  if (!state.autoSpin.active && !spinSoundNodes) return;
  state.autoSpin.active = false;
  state.autoSpin.speed = 0;
  state.autoSpin.lastFrameAt = performance.now();
  stopSpinSound({ fast: fastSoundOff });
  syncSpinControls();
}

function updateAutoSpin(now) {
  if (!state.autoSpin.active) return;
  if (state.phase !== "setup") {
    stopAutoSpin({ fastSoundOff: true });
    return;
  }

  const dt = clamp((now - state.autoSpin.lastFrameAt) / 1000, 1 / 240, 0.05);
  state.autoSpin.lastFrameAt = now;

  const speed = state.autoSpin.speed;
  const speedRatio = clamp(speed / AUTO_SPIN_MAX_SPEED, 0, 1);
  const chatter =
    Math.sin(now * 0.021 + state.autoSpin.jitterSeed + state.dial.angle * 0.17) *
    28 *
    speedRatio;
  state.dial.angle += state.autoSpin.direction * (speed + chatter) * dt;
  state.dial.target = state.dial.angle;
  state.dial.velocity = 0;

  const pegDrag =
    Math.abs(Math.sin((state.dial.angle + state.autoSpin.jitterSeed * 42) * (Math.PI / 11.5))) *
    AUTO_SPIN_PEG_DRAG *
    speedRatio;
  const decel =
    AUTO_SPIN_STATIC_FRICTION +
    AUTO_SPIN_VISCOUS_FRICTION * speed +
    AUTO_SPIN_AERO_DRAG * speed * speed +
    pegDrag;
  state.autoSpin.speed = Math.max(0, speed - decel * dt);
  updateSpinSound(state.autoSpin.speed);

  if (state.autoSpin.speed <= AUTO_SPIN_STOP_SPEED) {
    stopAutoSpin();
  }
}

function clearScorePopupTimers() {
  if (popupHideTimer) {
    clearTimeout(popupHideTimer);
    popupHideTimer = null;
  }
  if (popupCleanupTimer) {
    clearTimeout(popupCleanupTimer);
    popupCleanupTimer = null;
  }
}

function applyPendingScore() {
  if (!pendingScore) return;
  state.teams[pendingScore.teamIndex].score += pendingScore.points;
  pendingScore = null;
  updateUI();
}

function positionScorePopup(teamIndex) {
  const teamCard = teamIndex === 1 ? el.team1Card : el.team0Card;
  if (!teamCard) return;
  const rect = teamCard.getBoundingClientRect();
  const popupLeft = rect.left + rect.width * 0.5;
  const popupTop = rect.bottom + SCORE_POPUP_OFFSET_PX;
  el.scorePopup.style.setProperty("--score-popup-left-px", `${popupLeft}px`);
  el.scorePopup.style.setProperty("--score-popup-top-px", `${popupTop}px`);
}

function showScorePopup(points, label, teamIndex) {
  // If a previous popup was interrupted, settle its points first.
  applyPendingScore();
  clearScorePopupTimers();
  popupTeamIndex = teamIndex;
  pendingScore = { teamIndex, points };
  positionScorePopup(teamIndex);
  el.scorePopup.textContent = `${label} +${points}`;
  el.scorePopup.classList.remove("hiding");
  el.scorePopup.classList.add("show");

  popupHideTimer = setTimeout(() => {
    el.scorePopup.classList.remove("show");
    el.scorePopup.classList.add("hiding");
    popupCleanupTimer = setTimeout(() => {
      el.scorePopup.classList.remove("hiding");
      popupTeamIndex = null;
      applyPendingScore();
    }, SCORE_POPUP_FADE_MS);
  }, SCORE_POPUP_VISIBLE_MS);
}

function calculateScore() {
  const targetWorldAngle = state.targetAngle + state.wheelRotation;
  const oppositeTargetWorldAngle = targetWorldAngle + 180;
  const guessWorldAngle = state.dial.angle;
  const d = Math.min(
    shortestAngularDistance(guessWorldAngle, targetWorldAngle),
    shortestAngularDistance(guessWorldAngle, oppositeTargetWorldAngle)
  );
  const wedgeBandWidth = state.targetWidth / 5;
  if (d <= wedgeBandWidth * 0.5) return { points: 4, label: "Perfect" };
  if (d <= wedgeBandWidth * 1.5) return { points: 3, label: "Great" };
  if (d <= wedgeBandWidth * 2.5) return { points: 2, label: "Good" };
  return { points: 0, label: "Miss" };
}

function updateNeedle() {
  const spindleRotation =
    state.phase === "guessing" || state.phase === "reveal" ? state.dial.angle : 0;

  el.spindle.style.transform = `translate(-50%, -100%) rotate(${spindleRotation}deg)`;
}

function readPointerAngle(clientX, clientY) {
  const rect = el.wheelShell.getBoundingClientRect();
  const x = clientX - rect.left;
  const y = clientY - rect.top;
  const dx = x - state.wheel.cx;
  const dy = state.wheel.cy - y;
  const deg = (Math.atan2(dx, dy) * 180) / Math.PI;
  return clampGuessAngle(deg);
}

function readPointerSpinAngle(clientX, clientY) {
  const rect = el.wheelShell.getBoundingClientRect();
  const x = clientX - rect.left;
  const y = clientY - rect.top;
  const dx = x - state.wheel.cx;
  const dy = y - state.wheel.cy;
  return (Math.atan2(dy, dx) * 180) / Math.PI;
}

function isPrimarySpinPointer(event) {
  if (!event.isPrimary) return false;
  if (event.pointerType === "mouse") {
    return event.button === 0;
  }
  return true;
}

function stopDialDrag(pointerId = state.dial.pointerId) {
  if (pointerId !== null && el.pointerLayer.hasPointerCapture(pointerId)) {
    try {
      el.pointerLayer.releasePointerCapture(pointerId);
    } catch (_error) {
      // Capture may already be released by the browser.
    }
  }
  state.dial.dragging = false;
  state.dial.pointerId = null;
  if (state.phase === "setup") {
    state.dial.target = state.dial.angle;
    state.dial.velocity = 0;
  }
  el.pointerLayer.classList.remove("dragging");
}

function pointerDown(event) {
  if (state.phase !== "guessing" && state.phase !== "setup") return;
  if (state.phase === "setup" && state.autoSpin.active) {
    stopAutoSpin({ fastSoundOff: true });
  }
  if (state.dial.dragging) {
    stopDialDrag();
  }
  if (!isPrimarySpinPointer(event)) return;
  event.preventDefault();
  initAudio();
  state.dial.dragging = true;
  state.dial.pointerId = event.pointerId;
  state.dial.lastFrameAt = performance.now();
  if (state.phase === "setup") {
    state.dial.lastPointerAt = readPointerSpinAngle(event.clientX, event.clientY);
    state.dial.target = state.dial.angle;
    state.dial.velocity = 0;
  } else {
    const angle = readPointerAngle(event.clientX, event.clientY);
    state.dial.lastPointerAt = angle;
    state.dial.target = angle;
  }
  el.pointerLayer.classList.add("dragging");
  try {
    el.pointerLayer.setPointerCapture(event.pointerId);
  } catch (_error) {
    // Some browsers can throw if capture is unavailable; fallback listeners handle release.
  }
}

function pointerMove(event) {
  if (
    !state.dial.dragging ||
    event.pointerId !== state.dial.pointerId ||
    (state.phase !== "guessing" && state.phase !== "setup")
  ) {
    return;
  }
  event.preventDefault();
  const samples = event.getCoalescedEvents ? event.getCoalescedEvents() : null;
  const source =
    Array.isArray(samples) && samples.length > 0 ? samples[samples.length - 1] : event;

  const now = performance.now();
  if (state.phase === "setup") {
    const spinAngle = readPointerSpinAngle(source.clientX, source.clientY);
    const delta = signedAngularDelta(state.dial.lastPointerAt, spinAngle);
    const limitedDelta = clamp(delta, -16, 16);
    state.dial.angle += limitedDelta * SETUP_PUSH_GAIN;
    state.dial.target = state.dial.angle;
    state.dial.velocity = 0;
    state.dial.lastPointerAt = spinAngle;
    state.dial.lastFrameAt = now;
    return;
  }

  const dt = clamp(now - state.dial.lastFrameAt, 8, 40);
  const angle = readPointerAngle(source.clientX, source.clientY);
  state.dial.target = angle;
  const delta = signedAngularDelta(state.dial.lastPointerAt, angle);
  state.dial.velocity = clamp(delta / (dt / 16.7), -5.4, 5.4) * 0.3;
  state.dial.lastPointerAt = angle;
  state.dial.lastFrameAt = now;
}

function pointerUp(event) {
  if (!state.dial.dragging) return;
  if (event && event.pointerId !== undefined && event.pointerId !== state.dial.pointerId) {
    return;
  }
  stopDialDrag();
}

function tick(now = performance.now()) {
  if (state.phase === "setup") {
    updateAutoSpin(now);
    const clickStep = Math.round(state.dial.angle / 3.2);
    if (clickStep !== state.dial.clickStep) {
      state.dial.clickStep = clickStep;
      playClick();
    }
    updateNeedle();
    drawAll();
    requestAnimationFrame(tick);
    return;
  }

  const spring = state.dial.dragging ? 0.3 : 0.15;
  const limit = getGuessAngleLimit();
  state.dial.target = clamp(state.dial.target, -limit, limit);
  state.dial.velocity += (state.dial.target - state.dial.angle) * spring;
  state.dial.velocity *= state.dial.dragging ? 0.72 : 0.86;
  state.dial.angle += state.dial.velocity;
  state.dial.angle = clamp(state.dial.angle, -limit, limit);

  if (!state.dial.dragging) {
    if (state.dial.angle <= -limit || state.dial.angle >= limit) {
      state.dial.velocity *= -0.15;
    }
    if (Math.abs(state.dial.target - state.dial.angle) < 0.06) {
      state.dial.angle = state.dial.target;
      state.dial.velocity *= 0.6;
    }
  }

  const clickStep = Math.round(state.dial.angle / 3.2);
  if (
    clickStep !== state.dial.clickStep &&
    (state.phase === "guessing" || state.phase === "setup")
  ) {
    state.dial.clickStep = clickStep;
    playClick();
  }

  updateNeedle();
  drawAll();
  requestAnimationFrame(tick);
}

function startGuessing() {
  if (state.phase !== "psychic") return;
  stopAutoSpin({ fastSoundOff: true });
  stopMemeSound();
  stopDialDrag();
  state.phase = "guessing";
  state.dial.angle = 0;
  state.dial.target = 0;
  state.dial.velocity = 0;
  state.dial.clickStep = 0;
  setCover("closed");
  updateUI();
}

function reveal() {
  if (state.phase === "setup") {
    initAudio();
    stopAutoSpin({ fastSoundOff: true });
    stopMemeSound();
    stopDialDrag();
    state.dial.target = state.dial.angle;
    state.dial.velocity = 0;
    state.wheelRotation = state.dial.angle;
    state.phase = "psychic";
    setCover("open");
    playRevealSound();
    updateUI();
    drawAll();
    return;
  }

  if (state.phase !== "guessing") return;
  initAudio();
  stopAutoSpin({ fastSoundOff: true });
  stopMemeSound();
  stopDialDrag();
  state.dial.target = state.dial.angle;
  state.dial.velocity = 0;
  state.phase = "reveal";
  setCover("open");
  const result = calculateScore();
  playRoundResultMeme(result.points);
  showScorePopup(result.points, result.label, state.currentTeam);
  updateUI();
  drawAll();
}

function nextRound() {
  if (state.phase !== "reveal") return;
  const nextTeam = (state.currentTeam + 1) % state.teams.length;
  if (nextTeam === 0) {
    state.round += 1;
  }
  state.currentTeam = nextTeam;
  buildRound();
}

function resetRound() {
  if (state.phase !== "psychic") return;
  stopAutoSpin({ fastSoundOff: true });
  stopMemeSound();
  state.phase = "setup";
  stopDialDrag();
  state.dial.angle = state.wheelRotation;
  state.dial.target = state.wheelRotation;
  state.dial.velocity = 0;
  state.dial.clickStep = Math.round(state.dial.angle / 3.2);
  setCover("closed", { instant: true });
  clearScorePopupTimers();
  popupTeamIndex = null;
  pendingScore = null;
  el.scorePopup.classList.remove("show");
  el.scorePopup.classList.remove("hiding");
  updateNeedle();
  updateUI();
  drawAll();
}

function newGame() {
  stopAutoSpin({ fastSoundOff: true });
  stopMemeSound();
  stopDialDrag();
  clearScorePopupTimers();
  popupTeamIndex = null;
  pendingScore = null;
  el.scorePopup.classList.remove("show");
  el.scorePopup.classList.remove("hiding");
  clearPersistedScoreboard();
  state.teams[0].name = DEFAULT_TEAM_NAMES[0];
  state.teams[1].name = DEFAULT_TEAM_NAMES[1];
  state.teams[0].score = 0;
  state.teams[1].score = 0;
  state.currentTeam = 0;
  state.round = 1;
  buildRound({ closeCoverInstantly: true });
}

function attachEvents() {
  window.addEventListener("resize", () => {
    resizeCanvas(el.spectrumCanvas, spectrumCtx);
    resizeCanvas(el.targetCanvas, targetCtx);
    measureWheel();
    if (popupTeamIndex !== null) {
      positionScorePopup(popupTeamIndex);
    }
    drawAll();
  });

  el.pointerLayer.addEventListener("pointerdown", (event) => {
    if (state.phase !== "guessing" && state.phase !== "setup") return;
    pointerDown(event);
  });
  el.pointerLayer.addEventListener("pointermove", pointerMove);
  el.pointerLayer.addEventListener("pointerup", pointerUp);
  el.pointerLayer.addEventListener("pointercancel", pointerUp);
  el.pointerLayer.addEventListener("lostpointercapture", pointerUp);
  window.addEventListener("pointerup", pointerUp);
  window.addEventListener("pointercancel", pointerUp);
  window.addEventListener("blur", () => {
    stopAutoSpin({ fastSoundOff: true });
    stopMemeSound();
    stopDialDrag();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      stopAutoSpin({ fastSoundOff: true });
      stopMemeSound();
      stopDialDrag();
    }
  });

  if (el.spinWheelBtn) {
    el.spinWheelBtn.addEventListener("click", () => {
      if (state.phase !== "setup") return;
      startAutoSpin();
    });
  }

  el.startGuessBtn.addEventListener("click", () => {
    initAudio();
    startGuessing();
  });
  el.revealBtn.addEventListener("click", reveal);
  el.resetRoundBtn.addEventListener("click", resetRound);
  el.nextRoundBtn.addEventListener("click", nextRound);
  el.newGameBtn.addEventListener("click", newGame);

  const teamNameInputs = [el.team0Name, el.team1Name];
  teamNameInputs.forEach((input, index) => {
    input.addEventListener("input", () => {
      state.teams[index].name = normalizeTeamName(input.value, DEFAULT_TEAM_NAMES[index]);
      persistScoreboard();
    });
    input.addEventListener("blur", () => {
      state.teams[index].name = normalizeTeamName(input.value, DEFAULT_TEAM_NAMES[index]);
      input.value = state.teams[index].name;
      persistScoreboard();
    });
  });
}

function boot() {
  loadPersistedScoreboard();
  primeMemeSounds();
  resizeCanvas(el.spectrumCanvas, spectrumCtx);
  resizeCanvas(el.targetCanvas, targetCtx);
  measureWheel();
  attachEvents();
  buildRound();
  updateNeedle();
  tick();
}

boot();
