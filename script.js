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
  clue: "",
  wheelRotation: 0,
  targetAngle: 0,
  targetWidth: 26,
  targetBands: { inner: 0, mid: 0, outer: 0 },
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
  statusLine: document.getElementById("statusLine"),
  clueInput: document.getElementById("clueInput"),
  startGuessBtn: document.getElementById("startGuessBtn"),
  revealBtn: document.getElementById("revealBtn"),
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

function pseudoRandom(index, seed) {
  const x = Math.sin(index * 127.1 + seed * 311.7) * 43758.5453123;
  return x - Math.floor(x);
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
  state.targetWidth = randomBetween(22, 32.4);
  const half = state.targetWidth / 2;
  state.targetBands = {
    inner: half * 0.38,
    mid: half * 0.72,
    outer: half,
  };
  state.phase = "setup";
  state.clue = "";
  state.wheelRotation = 0;
  state.dial.angle = 0;
  state.dial.target = 0;
  state.dial.velocity = 0;
  state.dial.clickStep = 0;
  el.clueInput.value = "";
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

  const team = state.teams[state.currentTeam].name;
  if (state.phase === "setup") {
    el.phaseBadge.textContent = "Setup (Hidden)";
    el.statusLine.textContent = `${team} psychic: spin to reset while target is hidden, then press Reveal.`;
    el.startGuessBtn.disabled = true;
    el.revealBtn.disabled = false;
    el.revealBtn.textContent = "Reveal";
    el.nextRoundBtn.disabled = true;
    el.clueInput.disabled = true;
    el.pointerLayer.classList.remove("locked");
  } else if (state.phase === "psychic") {
    el.phaseBadge.textContent = "Psychic View";
    el.statusLine.textContent = `${team} psychic: study the bullseye and give a clue.`;
    el.startGuessBtn.disabled = false;
    el.revealBtn.disabled = true;
    el.revealBtn.textContent = "Reveal";
    el.nextRoundBtn.disabled = true;
    el.clueInput.disabled = false;
    el.pointerLayer.classList.add("locked");
  } else if (state.phase === "guessing") {
    el.phaseBadge.textContent = "Guessing View";
    const clue = state.clue ? `Clue: "${state.clue}". ` : "";
    el.statusLine.textContent = `${team} guessers: ${clue}move the spindle to lock your choice.`;
    el.startGuessBtn.disabled = true;
    el.revealBtn.disabled = false;
    el.revealBtn.textContent = "Reveal";
    el.nextRoundBtn.disabled = true;
    el.clueInput.disabled = true;
    el.pointerLayer.classList.remove("locked");
  } else if (state.phase === "reveal") {
    el.phaseBadge.textContent = "Reveal";
    el.startGuessBtn.disabled = true;
    el.revealBtn.disabled = true;
    el.revealBtn.textContent = "Reveal";
    el.nextRoundBtn.disabled = false;
    el.clueInput.disabled = true;
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
  // Push wheel center near the bottom edge so the lower half naturally sits
  // outside the visible frame, matching the physical board look.
  state.wheel.cy = rect.height * 0.965;
  state.wheel.outerR = Math.min(rect.width * 0.43, rect.height * 0.9);
  state.wheel.ringOuterR = state.wheel.outerR * 0.94;
  state.wheel.faceR = state.wheel.outerR * 0.81;
  state.wheel.hubR = state.wheel.faceR * 0.13;
  state.wheel.targetInnerR = state.wheel.hubR * 1.08;
  state.wheel.targetOuterR = state.wheel.faceR * 0.93;

  el.wheelShell.style.setProperty("--face-radius", `${state.wheel.faceR}px`);
  el.wheelShell.style.setProperty("--face-radius-px", `${state.wheel.faceR}px`);
  el.wheelShell.style.setProperty("--pivot-x", `${(state.wheel.cx / rect.width) * 100}%`);
  el.wheelShell.style.setProperty("--pivot-x-px", `${state.wheel.cx}px`);
  el.wheelShell.style.setProperty(
    "--pivot-y",
    `${(state.wheel.cy / rect.height) * 100}%`
  );
  el.wheelShell.style.setProperty("--pivot-y-px", `${state.wheel.cy}px`);
}

function drawRingSegment(ctx, cx, cy, innerR, outerR, start, end, fill) {
  ctx.beginPath();
  ctx.arc(cx, cy, outerR, start, end, false);
  ctx.arc(cx, cy, innerR, end, start, true);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
}

function sprinkleDots({
  ctx,
  cx,
  cy,
  minR,
  maxR,
  start,
  end,
  count,
  colorA,
  colorB,
  minSize,
  maxSize,
  seed,
}) {
  for (let i = 0; i < count; i += 1) {
    const a = start + pseudoRandom(i * 2 + 11, seed) * (end - start);
    const rr1 = pseudoRandom(i * 3 + 23, seed + 2.17);
    const rr2 = pseudoRandom(i * 5 + 47, seed + 6.11);
    const r = Math.sqrt(rr1 * (maxR * maxR - minR * minR) + minR * minR);
    const size = minSize + rr2 * (maxSize - minSize);
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    ctx.beginPath();
    ctx.fillStyle = rr1 > 0.72 ? colorA : colorB;
    ctx.arc(x, y, size, 0, Math.PI * 2);
    ctx.fill();
  }
}

function paintSpectrumBase(ctx) {
  const { w, h, cx, cy, outerR, ringOuterR, faceR } = state.wheel;

  for (let i = 0; i < 88; i += 1) {
    const t = i / 88;
    const a = t * Math.PI * 2;
    const sx = cx + Math.cos(a) * (outerR * 1.006);
    const sy = cy + Math.sin(a) * (outerR * 1.006);
    ctx.beginPath();
    ctx.fillStyle = "#f4efe4";
    ctx.arc(sx, sy, outerR * 0.042, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.beginPath();
  ctx.fillStyle = "#090e4b";
  ctx.arc(cx, cy, ringOuterR, 0, Math.PI * 2);
  ctx.fill();

  sprinkleDots({
    ctx,
    cx,
    cy,
    minR: faceR * 1.03,
    maxR: ringOuterR * 0.985,
    start: 0,
    end: Math.PI * 2,
    count: 340,
    colorA: "rgba(255,255,255,0.82)",
    colorB: "rgba(198,211,223,0.72)",
    minSize: 0.55,
    maxSize: 2.1,
    seed: 14.5,
  });

  ctx.beginPath();
  ctx.fillStyle = "#f1ede3";
  ctx.arc(cx, cy, faceR, 0, Math.PI * 2);
  ctx.fill();

  sprinkleDots({
    ctx,
    cx,
    cy,
    minR: 0,
    maxR: faceR * 0.98,
    start: 0,
    end: Math.PI * 2,
    count: 1800,
    colorA: "rgba(97,95,88,0.08)",
    colorB: "rgba(134,132,124,0.06)",
    minSize: 0.35,
    maxSize: 0.9,
    seed: 2.25,
  });

  const faceGlow = ctx.createRadialGradient(
    cx,
    cy - faceR * 0.85,
    faceR * 0.06,
    cx,
    cy - faceR * 0.3,
    faceR * 0.95
  );
  faceGlow.addColorStop(0, "rgba(255,255,255,0.32)");
  faceGlow.addColorStop(0.35, "rgba(255,255,255,0.13)");
  faceGlow.addColorStop(1, "rgba(255,255,255,0)");
  ctx.beginPath();
  ctx.fillStyle = faceGlow;
  ctx.arc(cx, cy, faceR, 0, Math.PI * 2, false);
  ctx.fill();

  ctx.strokeStyle = "#0b124f";
  ctx.lineWidth = Math.max(1.2, faceR * 0.018);
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

function drawTarget(showScoringBands, rotationDeg) {
  const { w, h, cx, cy, targetInnerR, targetOuterR } = state.wheel;
  targetCtx.clearRect(0, 0, w, h);
  targetCtx.save();
  targetCtx.translate(cx, cy);
  targetCtx.rotate((rotationDeg * Math.PI) / 180);
  targetCtx.translate(-cx, -cy);
  const theta = angleToTheta(state.targetAngle);
  const halfW = (state.targetWidth * Math.PI) / 360;
  const innerHalf = (state.targetBands.inner * Math.PI) / 180;
  const midHalf = (state.targetBands.mid * Math.PI) / 180;
  const wedges = ["#d29b17", "#b7e1c0", "#ed6f52", "#b7e1c0", "#d29b17"];
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

    if (showScoringBands) {
      drawRingSegment(
        targetCtx,
        cx,
        cy,
        targetInnerR,
        targetOuterR,
        centerTheta - halfW,
        centerTheta + halfW,
        "rgba(255, 255, 255, 0.14)"
      );
      drawRingSegment(
        targetCtx,
        cx,
        cy,
        targetInnerR,
        targetOuterR,
        centerTheta - midHalf,
        centerTheta + midHalf,
        "rgba(255, 255, 255, 0.24)"
      );

      targetCtx.save();
      targetCtx.shadowColor = "rgba(255,255,255,0.86)";
      targetCtx.shadowBlur = 15;
      drawRingSegment(
        targetCtx,
        cx,
        cy,
        targetInnerR,
        targetOuterR,
        centerTheta - innerHalf,
        centerTheta + innerHalf,
        "rgba(255,255,255,0.46)"
      );
      targetCtx.restore();
    }
  }
  targetCtx.restore();
}

function drawAll() {
  const liveWheelRotation =
    state.phase === "setup" ? state.dial.angle : state.wheelRotation;
  drawSpectrum(liveWheelRotation);
  drawTarget(state.phase === "reveal", liveWheelRotation);
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
  }, 1500);
}

function calculateScore() {
  const targetWorldAngle = state.targetAngle + state.wheelRotation;
  const oppositeTargetWorldAngle = targetWorldAngle + 180;
  const guessWorldAngle = state.dial.angle;
  const d = Math.min(
    shortestAngularDistance(guessWorldAngle, targetWorldAngle),
    shortestAngularDistance(guessWorldAngle, oppositeTargetWorldAngle)
  );
  const { inner, mid, outer } = state.targetBands;
  if (d <= inner) return { points: 4, label: "Perfect" };
  if (d <= mid) return { points: 3, label: "Great" };
  if (d <= outer) return { points: 2, label: "Good" };
  if (d <= outer + 7.5) return { points: 1, label: "Close" };
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
  return clamp(deg, -90, 90);
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
  state.dial.velocity += (state.dial.target - state.dial.angle) * spring;
  state.dial.velocity *= state.dial.dragging ? 0.62 : 0.84;
  state.dial.angle += state.dial.velocity;
  state.dial.angle = clamp(state.dial.angle, -90, 90);

  if (!state.dial.dragging) {
    if (state.dial.angle === -90 || state.dial.angle === 90) {
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
  state.clue = el.clueInput.value.trim();
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
  el.statusLine.textContent = `${state.teams[state.currentTeam].name} scored ${result.points} point${
    result.points === 1 ? "" : "s"
  } (${result.label.toLowerCase()}).`;
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
  el.nextRoundBtn.addEventListener("click", nextRound);
  el.newGameBtn.addEventListener("click", newGame);
  el.clueInput.addEventListener("input", () => {
    state.clue = el.clueInput.value;
  });
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
