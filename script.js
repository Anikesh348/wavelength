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

const state = {
  teams: [
    { name: "Team Aurora", score: 0 },
    { name: "Team Ember", score: 0 },
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
    lastPointerAt: 0,
    lastFrameAt: performance.now(),
    clickStep: 0,
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
  wheelShell: document.getElementById("wheelShell"),
  pointerLayer: document.getElementById("pointerLayer"),
  spindle: document.getElementById("spindle"),
  coverLayer: document.getElementById("coverLayer"),
  scorePopup: document.getElementById("scorePopup"),
  spectrumCanvas: document.getElementById("spectrumCanvas"),
  targetCanvas: document.getElementById("targetCanvas"),
};

const spectrumCtx = el.spectrumCanvas.getContext("2d");
const targetCtx = el.targetCanvas.getContext("2d");

let audioCtx = null;
let previousPairIndex = -1;
let popupTimer = null;

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

function pickSpectrumPair() {
  let idx = Math.floor(Math.random() * spectrumPairs.length);
  if (idx === previousPairIndex && spectrumPairs.length > 1) {
    idx = (idx + 1) % spectrumPairs.length;
  }
  previousPairIndex = idx;
  return spectrumPairs[idx];
}

function buildRound() {
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
  setCover("closed");
  updateUI();
  drawAll();
}

function updateUI() {
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
    el.resetRoundBtn.disabled = false;
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
  state.wheel.ringOuterR = state.wheel.outerR * 0.92;
  state.wheel.faceR = state.wheel.outerR * 0.84;
  state.wheel.hubR = state.wheel.faceR * 0.2;
  state.wheel.targetInnerR = state.wheel.hubR * 1.08;
  state.wheel.targetOuterR = state.wheel.faceR * 0.95;
  state.wheel.slopeCenterY = state.wheel.cy;
  state.wheel.slopeSideY = state.wheel.cy - state.wheel.faceR * 0.26;
  const spindleLength = clamp(state.wheel.faceR * 0.8, 120, state.wheel.faceR - 14);
  const spindleWidth = clamp(state.wheel.faceR * 0.03, 7, 11);

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

  for (let i = 0; i < 86; i += 1) {
    const t = i / 86;
    const a = t * Math.PI * 2;
    const sx = cx + Math.cos(a) * (outerR * 1.018);
    const sy = cy + Math.sin(a) * (outerR * 1.018);
    ctx.beginPath();
    ctx.fillStyle = "#f2eee5";
    ctx.arc(sx, sy, outerR * 0.048, 0, Math.PI * 2);
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

  const faceGlow = ctx.createRadialGradient(
    cx,
    cy - faceR * 0.85,
    faceR * 0.06,
    cx,
    cy - faceR * 0.3,
    faceR * 0.95
  );
  faceGlow.addColorStop(0, "rgba(255,255,255,0.4)");
  faceGlow.addColorStop(0.35, "rgba(255,255,255,0.16)");
  faceGlow.addColorStop(1, "rgba(255,255,255,0)");
  ctx.beginPath();
  ctx.fillStyle = faceGlow;
  ctx.arc(cx, cy, faceR, 0, Math.PI * 2, false);
  ctx.fill();

  const faceShade = ctx.createLinearGradient(0, cy, 0, cy + faceR);
  faceShade.addColorStop(0, "rgba(0, 0, 0, 0)");
  faceShade.addColorStop(1, "rgba(0, 0, 0, 0.08)");
  ctx.beginPath();
  ctx.fillStyle = faceShade;
  ctx.arc(cx, cy, faceR, 0, Math.PI * 2, false);
  ctx.fill();

  ctx.strokeStyle = "#0a1156";
  ctx.lineWidth = Math.max(1.6, faceR * 0.02);
  ctx.beginPath();
  ctx.arc(cx, cy, faceR, 0, Math.PI * 2, false);
  ctx.stroke();

  ctx.strokeStyle = "rgba(255, 255, 255, 0.62)";
  ctx.lineWidth = Math.max(2.4, outerR * 0.012);
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.arc(cx, cy, ringOuterR * 0.965, Math.PI * 0.56, Math.PI * 0.9);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, ringOuterR * 0.965, Math.PI * 0.1, Math.PI * 0.44);
  ctx.stroke();
  ctx.lineCap = "butt";
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

function drawTarget(rotationDeg) {
  const { w, h, cx, cy, targetInnerR, targetOuterR } = state.wheel;
  targetCtx.clearRect(0, 0, w, h);
  targetCtx.save();
  targetCtx.translate(cx, cy);
  targetCtx.rotate((rotationDeg * Math.PI) / 180);
  targetCtx.translate(-cx, -cy);
  const theta = angleToTheta(state.targetAngle);
  const halfW = (state.targetWidth * Math.PI) / 360;
  const wedges = ["#e7b43e", "#a6d6b2", "#e46952", "#a6d6b2", "#e7b43e"];
  const step = (halfW * 2) / wedges.length;
  const centers = [theta, theta + Math.PI];

  for (const centerTheta of centers) {
    targetCtx.save();
    targetCtx.shadowColor = "rgba(0,0,0,0.17)";
    targetCtx.shadowBlur = 7;
    for (let i = 0; i < wedges.length; i += 1) {
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
        wedges[i]
      );
    }
    targetCtx.restore();
  }
  targetCtx.restore();
}

function drawAll() {
  const liveWheelRotation =
    state.phase === "setup" ? state.dial.angle : state.wheelRotation;
  drawSpectrum(liveWheelRotation);
  drawTarget(liveWheelRotation);
}

function setCover(mode) {
  el.coverLayer.classList.remove("open", "closed");
  el.coverLayer.classList.add(mode);
}

function showScorePopup(points, label) {
  if (popupTimer) clearTimeout(popupTimer);
  el.scorePopup.textContent = `${label} +${points}`;
  el.scorePopup.classList.add("show");
  popupTimer = setTimeout(() => {
    el.scorePopup.classList.remove("show");
  }, 2400);
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

function pointerDown(event) {
  if (state.phase !== "guessing" && state.phase !== "setup") return;
  initAudio();
  state.dial.dragging = true;
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
}

function pointerMove(event) {
  if (
    !state.dial.dragging ||
    (state.phase !== "guessing" && state.phase !== "setup")
  ) {
    return;
  }
  const now = performance.now();
  if (state.phase === "setup") {
    const spinAngle = readPointerSpinAngle(event.clientX, event.clientY);
    const delta = signedAngularDelta(state.dial.lastPointerAt, spinAngle);
    state.dial.angle += delta * SETUP_PUSH_GAIN;
    state.dial.target = state.dial.angle;
    state.dial.velocity = 0;
    state.dial.lastPointerAt = spinAngle;
    state.dial.lastFrameAt = now;
    return;
  }

  const dt = Math.max(16, now - state.dial.lastFrameAt);
  const angle = readPointerAngle(event.clientX, event.clientY);
  state.dial.target = angle;
  const delta = angle - state.dial.lastPointerAt;
  state.dial.velocity = clamp(delta / (dt / 16.7), -6.5, 6.5) * 0.38;
  state.dial.lastPointerAt = angle;
  state.dial.lastFrameAt = now;
}

function pointerUp() {
  if (!state.dial.dragging) return;
  state.dial.dragging = false;
  if (state.phase === "setup") {
    state.dial.target = state.dial.angle;
    state.dial.velocity = 0;
  }
  el.pointerLayer.classList.remove("dragging");
}

function tick() {
  if (state.phase === "setup") {
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

  const spring = state.dial.dragging ? 0.42 : 0.16;
  const limit = getGuessAngleLimit();
  state.dial.target = clamp(state.dial.target, -limit, limit);
  state.dial.velocity += (state.dial.target - state.dial.angle) * spring;
  state.dial.velocity *= state.dial.dragging ? 0.62 : 0.84;
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
  state.dial.target = state.dial.angle;
  state.dial.velocity = 0;
  state.phase = "reveal";
  setCover("open");
  playRevealSound();
  const result = calculateScore();
  state.teams[state.currentTeam].score += result.points;
  showScorePopup(result.points, result.label);
  updateUI();
  drawAll();
}

function nextRound() {
  if (state.phase !== "reveal") return;
  state.currentTeam = state.currentTeam === 0 ? 1 : 0;
  state.round += 1;
  buildRound();
}

function resetRound() {
  if (state.phase !== "psychic" && state.phase !== "guessing") return;
  state.phase = "setup";
  state.dial.dragging = false;
  state.dial.angle = state.wheelRotation;
  state.dial.target = state.wheelRotation;
  state.dial.velocity = 0;
  state.dial.clickStep = Math.round(state.dial.angle / 3.2);
  setCover("closed");
  if (popupTimer) {
    clearTimeout(popupTimer);
    popupTimer = null;
  }
  el.scorePopup.classList.remove("show");
  el.pointerLayer.classList.remove("dragging");
  updateNeedle();
  updateUI();
  drawAll();
}

function newGame() {
  state.teams[0].score = 0;
  state.teams[1].score = 0;
  state.currentTeam = 0;
  state.round = 1;
  buildRound();
}

function attachEvents() {
  window.addEventListener("resize", () => {
    resizeCanvas(el.spectrumCanvas, spectrumCtx);
    resizeCanvas(el.targetCanvas, targetCtx);
    measureWheel();
    drawAll();
  });

  el.pointerLayer.addEventListener("pointerdown", (event) => {
    if (state.phase !== "guessing" && state.phase !== "setup") return;
    pointerDown(event);
    el.pointerLayer.setPointerCapture(event.pointerId);
  });
  el.pointerLayer.addEventListener("pointermove", pointerMove);
  el.pointerLayer.addEventListener("pointerup", pointerUp);
  el.pointerLayer.addEventListener("pointercancel", pointerUp);

  el.startGuessBtn.addEventListener("click", () => {
    initAudio();
    startGuessing();
  });
  el.revealBtn.addEventListener("click", reveal);
  el.resetRoundBtn.addEventListener("click", resetRound);
  el.nextRoundBtn.addEventListener("click", nextRound);
  el.newGameBtn.addEventListener("click", newGame);
}

function boot() {
  resizeCanvas(el.spectrumCanvas, spectrumCtx);
  resizeCanvas(el.targetCanvas, targetCtx);
  measureWheel();
  attachEvents();
  buildRound();
  updateNeedle();
  tick();
}

boot();
