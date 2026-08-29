/* ============================================================
   AI RUN : 바이러스 러너 — game.js
   바이브 코딩 실습용 HTML Canvas 러닝 게임
   ============================================================ */

(() => {
  "use strict";

  // ── Constants ──────────────────────────────────────────────
  const LANES = 3;
  const MAX_LIVES = 5;
  const BASE_SPEED = 3.5;
  const SCORE_PER_SEC = 10;
  const DODGE_BONUS = 50;
  const VACCINE_BONUS = 100;
  const INVINCIBLE_MS = 1800;
  const LANE_LERP = 0.18;

  const SPEED_TIERS = [
    { until: 20, mult: 1.0 },
    { until: 40, mult: 1.2 },
    { until: 60, mult: 1.5 },
    { until: Infinity, mult: 1.8 },
  ];

  const CHARS = {
    bbiya: {
      name: "삐야",
      emoji: "🐥",
      base: "assets/characters/bbiya",
    },
    oru: {
      name: "오르",
      emoji: "🐻",
      base: "assets/characters/oru",
    },
  };

  const ANIM = {
    run: { count: 5, fps: 10, prefix: "run" },
    hit: { count: 5, fps: 12, prefix: "hit" },
    happy: { count: 3, fps: 8, prefix: "happy" },
  };

  const SOUNDS = {
    lobby: "assets/sounds/bgm_lobby.mp3",
    game: "assets/sounds/bgm_game.mp3",
    heal: "assets/sounds/heal.mp3",
    hit: "assets/sounds/hit.mp3",
    data: "assets/sounds/data.mp3",
  };

  const audioState = {
    unlocked: false,
    lobby: null,
    game: null,
    sfx: {},
    activeBgm: null,
  };

  // ── DOM refs ───────────────────────────────────────────────
  const screens = {
    start: document.getElementById("screen-start"),
    select: document.getElementById("screen-select"),
    game: document.getElementById("screen-game"),
    pause: document.getElementById("screen-pause"),
    over: document.getElementById("screen-over"),
  };

  const canvas = document.getElementById("game-canvas");
  const ctx = canvas.getContext("2d");
  const hudLives = document.getElementById("hud-lives");
  const hudScore = document.getElementById("hud-score");
  const hudDistance = document.getElementById("hud-distance");
  const toast = document.getElementById("toast");

  // ── State ──────────────────────────────────────────────────
  let selectedChar = "bbiya";
  let gameState = "idle"; // idle | playing | paused
  let rafId = null;
  let lastTime = 0;

  const sprites = {};
  let imagesLoaded = 0;
  let totalImages = 0;

  const game = {
    lane: 1,
    laneX: 0,
    targetLaneX: 0,
    lives: MAX_LIVES,
    score: 0,
    distance: 0,
    elapsed: 0,
    speedMult: 1,
    invincibleUntil: 0,
    blinkPhase: 0,
    hitFlash: 0,
    hitAnimUntil: 0,
    happyUntil: 0,
    runFrame: 0,
    runTimer: 0,
    obstacles: [],
    items: [],
    spawnTimer: 0,
    itemTimer: 0,
    bgOffset: 0,
    codeLines: [],
    shakeUntil: 0,
  };

  // ── Screen navigation ──────────────────────────────────────
  const OVERLAY_SCREENS = new Set(["pause", "over"]);

  function showScreen(name) {
    if (OVERLAY_SCREENS.has(name)) {
      screens[name].classList.add("active");
      return;
    }
    Object.entries(screens).forEach(([key, el]) => {
      if (!OVERLAY_SCREENS.has(key)) el.classList.remove("active");
    });
    Object.values(screens).forEach((s) => {
      if (OVERLAY_SCREENS.has(s.id.replace("screen-", ""))) s.classList.remove("active");
    });
    screens[name].classList.add("active");
  }

  function hideOverlay(name) {
    screens[name].classList.remove("active");
  }

  // ── Audio (Mixkit — assets/sounds/ATTRIBUTION.md) ───────────
  function makeAudio(src, opts) {
    const el = new Audio(src);
    el.loop = !!(opts && opts.loop);
    el.preload = "auto";
    el.volume = (opts && opts.volume) != null ? opts.volume : 1;
    return el;
  }

  function initAudio() {
    audioState.lobby = makeAudio(SOUNDS.lobby, { loop: true, volume: 0.32 });
    audioState.game = makeAudio(SOUNDS.game, { loop: true, volume: 0.38 });
    audioState.sfx.heal = makeAudio(SOUNDS.heal, { volume: 0.72 });
    audioState.sfx.hit = makeAudio(SOUNDS.hit, { volume: 0.78 });
    audioState.sfx.data = makeAudio(SOUNDS.data, { volume: 0.58 });
  }

  function unlockAudio() {
    if (audioState.unlocked) return;
    audioState.unlocked = true;
    const all = [audioState.lobby, audioState.game].concat(Object.values(audioState.sfx));
    all.forEach(function (clip) {
      if (!clip) return;
      const playPromise = clip.play();
      if (playPromise && playPromise.then) {
        playPromise
          .then(function () {
            clip.pause();
            clip.currentTime = 0;
          })
          .catch(function () {});
      }
    });
  }

  function stopAllBgm() {
    [audioState.lobby, audioState.game].forEach(function (clip) {
      if (!clip) return;
      clip.pause();
      clip.currentTime = 0;
    });
    audioState.activeBgm = null;
  }

  function playBgm(kind) {
    if (!audioState.unlocked) return;
    const next = kind === "game" ? audioState.game : audioState.lobby;
    if (!next) return;
    if (audioState.activeBgm === next && !next.paused) return;
    stopAllBgm();
    audioState.activeBgm = next;
    next.play().catch(function () {});
  }

  function pauseBgm() {
    if (audioState.activeBgm && !audioState.activeBgm.paused) {
      audioState.activeBgm.pause();
    }
  }

  function resumeBgm() {
    if (!audioState.unlocked || !audioState.activeBgm) return;
    if (audioState.activeBgm.paused) {
      audioState.activeBgm.play().catch(function () {});
    }
  }

  function syncBgm() {
    if (gameState === "playing") {
      playBgm("game");
      return;
    }
    if (gameState === "paused") {
      pauseBgm();
      return;
    }
    if (screens.start.classList.contains("active") || screens.select.classList.contains("active")) {
      playBgm("lobby");
    }
  }

  function playSfx(name) {
    if (!audioState.unlocked) return;
    const base = audioState.sfx[name];
    if (!base) return;
    const clip = base.cloneNode();
    clip.volume = base.volume;
    clip.play().catch(function () {});
  }

  function loadBest() {
    try {
      return {
        score: parseInt(localStorage.getItem("aiRun_bestScore") || "0", 10),
        distance: parseInt(localStorage.getItem("aiRun_bestDistance") || "0", 10),
      };
    } catch (err) {
      return { score: 0, distance: 0 };
    }
  }

  function saveBest(score, distance) {
    try {
      const best = loadBest();
      if (score > best.score) localStorage.setItem("aiRun_bestScore", String(score));
      if (distance > best.distance) localStorage.setItem("aiRun_bestDistance", String(distance));
    } catch (err) {
      /* Safari file:// 또는 시크릿 모드에서는 localStorage 불가 */
    }
  }

  function updateStartBest() {
    const b = loadBest();
    document.getElementById("start-best-score").textContent = b.score.toLocaleString();
    document.getElementById("start-best-distance").textContent = b.distance;
  }

  // ── Toast ──────────────────────────────────────────────────
  let toastTimer = null;
  function showToast(msg) {
    toast.textContent = msg;
    toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("show"), 1400);
  }

  // ── Image loading ──────────────────────────────────────────
  function spritePaths(charKey) {
    const base = CHARS[charKey].base;
    const paths = { front: base + "/front.png", run: [], hit: [], happy: [] };
    Object.keys(ANIM).forEach(function (kind) {
      const def = ANIM[kind];
      for (let i = 1; i <= def.count; i++) {
        paths[kind].push(base + "/" + def.prefix + "_" + String(i).padStart(2, "0") + ".png");
      }
    });
    return paths;
  }

  function loadOne(src, onDone) {
    var img = new Image();
    img.onload = onDone;
    img.onerror = onDone;
    img.src = src;
    return img;
  }

  function loadImages() {
    totalImages = 0;
    imagesLoaded = 0;

    Object.keys(CHARS).forEach(function (key) {
      const paths = spritePaths(key);
      sprites[key] = { front: null, run: [], hit: [], happy: [] };
      totalImages += 1 + paths.run.length + paths.hit.length + paths.happy.length;
    });

    function onImageLoaded() {
      imagesLoaded++;
      if (imagesLoaded >= totalImages) initCodeLines();
    }

    Object.keys(CHARS).forEach(function (key) {
      const paths = spritePaths(key);
      sprites[key].front = loadOne(paths.front, onImageLoaded);
      ["run", "hit", "happy"].forEach(function (kind) {
        paths[kind].forEach(function (src, i) {
          sprites[key][kind][i] = loadOne(src, onImageLoaded);
        });
      });
    });
  }

  function initCodeLines() {
    if (game.codeLines.length > 0) return;
    const snippets = ["10100101", "01011010", "AI_RUN()", "defeat(virus)", "01010101", "vaccine++", "01101001"];
    for (let i = 0; i < 12; i++) {
      game.codeLines.push({
        x: Math.random(),
        y: Math.random(),
        text: snippets[Math.floor(Math.random() * snippets.length)],
        alpha: 0.1 + Math.random() * 0.2,
        speed: 0.3 + Math.random() * 0.5,
      });
    }
  }

  // ── Canvas sizing ──────────────────────────────────────────
  function resizeCanvas() {
    var rect = canvas.getBoundingClientRect();
    var w = rect.width || window.innerWidth || 375;
    var h = rect.height || window.innerHeight * 0.65 || 500;
    var dpr = window.devicePixelRatio || 1;

    if (rect.width < 10 || rect.height < 10) {
      canvas.style.minHeight = "280px";
      h = Math.max(h, 280);
    }

    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    syncLanePosition(false);
  }

  let lanePositions = [];
  function syncLanePosition(snap) {
    calcLanePositions();
    game.targetLaneX = lanePositions[game.lane];
    if (snap) game.laneX = lanePositions[game.lane];
  }

  function calcLanePositions() {
    const w = canvas.clientWidth || window.innerWidth || 375;
    lanePositions = [
      w * 0.2,
      w * 0.5,
      w * 0.8,
    ];
  }

  // ── Game init / reset ──────────────────────────────────────
  function resetGame() {
    game.lane = 1;
    game.lives = MAX_LIVES;
    game.score = 0;
    game.distance = 0;
    game.elapsed = 0;
    game.speedMult = 1;
    game.invincibleUntil = 0;
    game.blinkPhase = 0;
    game.hitFlash = 0;
    game.hitAnimUntil = 0;
    game.happyUntil = 0;
    game.runFrame = 0;
    game.runTimer = 0;
    game.obstacles = [];
    game.items = [];
    game.spawnTimer = 0;
    game.itemTimer = 0;
    game.bgOffset = 0;
    game.shakeUntil = 0;
    calcLanePositions();
    syncLanePosition(true);
    updateHUD();
  }

  function startGame() {
    resetGame();
    gameState = "playing";
    showScreen("game");
    syncBgm();

    // Safari: 화면 전환 후 레이아웃이 잡힌 뒤 캔버스 크기·레인 위치 계산
    requestAnimationFrame(function () {
      resizeCanvas();
      syncLanePosition(true);
      lastTime = performance.now();
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(loop);
    });
  }

  function pauseGame() {
    if (gameState !== "playing") return;
    gameState = "paused";
    cancelAnimationFrame(rafId);
    pauseBgm();
    showScreen("pause");
  }

  function resumeGame() {
    gameState = "playing";
    hideOverlay("pause");
    resumeBgm();
    lastTime = performance.now();
    rafId = requestAnimationFrame(loop);
  }

  function endGame() {
    gameState = "idle";
    cancelAnimationFrame(rafId);
    pauseBgm();
    saveBest(game.score, Math.floor(game.distance));

    const best = loadBest();
    document.getElementById("over-score").textContent = game.score.toLocaleString();
    document.getElementById("over-distance").textContent = Math.floor(game.distance) + "m";
    document.getElementById("over-best").textContent = best.score.toLocaleString();

    const overChar = document.getElementById("over-char-img");
    overChar.innerHTML = '<img src="' + CHARS[selectedChar].base + '/front.png" alt="' + CHARS[selectedChar].name + '" />';

    showScreen("over");
    updateStartBest();
  }

  // ── Input ──────────────────────────────────────────────────
  function moveLane(dir) {
    if (gameState !== "playing") return;
    if (dir === "left" && game.lane > 0) game.lane--;
    if (dir === "right" && game.lane < LANES - 1) game.lane++;
    game.targetLaneX = lanePositions[game.lane];
  }

  function onKeyDown(e) {
    if (gameState === "playing") {
      if (e.key === "ArrowLeft" || e.key === "a" || e.key === "A") moveLane("left");
      if (e.key === "ArrowRight" || e.key === "d" || e.key === "D") moveLane("right");
      if (e.key === "Escape") pauseGame();
    }
  }

  // ── Spawning ───────────────────────────────────────────────
  const SPAWN_Y = -60;
  const LANE_CLEARANCE = 130; // 같은 레인에서 이 거리 이내 겹침 방지

  function laneBlocked(lane, y, margin) {
    const minY = y - margin;
    const maxY = y + margin;
    for (let i = 0; i < game.obstacles.length; i++) {
      const obs = game.obstacles[i];
      if (!obs.hit && obs.lane === lane && obs.y >= minY && obs.y <= maxY) return true;
    }
    for (let j = 0; j < game.items.length; j++) {
      const item = game.items[j];
      if (!item.collected && item.lane === lane && item.y >= minY && item.y <= maxY) return true;
    }
    return false;
  }

  function pickOpenLane(y, margin) {
    const lanes = [0, 1, 2].filter(function (l) {
      return !laneBlocked(l, y, margin);
    });
    if (!lanes.length) return -1;
    return lanes[Math.floor(Math.random() * lanes.length)];
  }

  function spawnObstaclePattern() {
    const patterns = [
      [0], [1], [2],
      [0, 2], [0, 1], [1, 2],
    ];
    const pat = patterns[Math.floor(Math.random() * patterns.length)];
    pat.forEach(function (lane) {
      if (laneBlocked(lane, SPAWN_Y, LANE_CLEARANCE)) return;
      game.obstacles.push({ lane: lane, y: SPAWN_Y, passed: false, id: Math.random() });
    });
  }

  function spawnVaccine() {
    const lane = pickOpenLane(SPAWN_Y, LANE_CLEARANCE);
    if (lane < 0) {
      game.itemTimer = 1.2;
      return;
    }
    game.items.push({ lane: lane, y: SPAWN_Y, type: "vaccine", collected: false });
  }

  // ── Collision ──────────────────────────────────────────────
  const PLAYER_Y_RATIO = 0.78;
  const HIT_RADIUS = 38;

  function checkCollisions(now) {
    const px = game.laneX;
    const py = canvas.clientHeight * PLAYER_Y_RATIO;

    if (now < game.invincibleUntil) return;

    for (const obs of game.obstacles) {
      if (obs.hit) continue;
      const ox = lanePositions[obs.lane];
      const oy = obs.y;
      const dist = Math.hypot(px - ox, py - oy);
      if (dist < HIT_RADIUS) {
        obs.hit = true;
        onHit(now);
        return;
      }
    }

    for (const item of game.items) {
      if (item.collected) continue;
      const ix = lanePositions[item.lane];
      const iy = item.y;
      const dist = Math.hypot(px - ix, py - iy);
      if (dist < HIT_RADIUS) {
        item.collected = true;
        onVaccine(now);
      }
    }
  }

  function onHit(now) {
    playSfx("hit");
    game.lives--;
    game.invincibleUntil = now + INVINCIBLE_MS;
    game.hitFlash = now + 400;
    game.hitAnimUntil = now + 500;
    game.shakeUntil = now + 350;
    screens.game.classList.add("shake");
    setTimeout(() => screens.game.classList.remove("shake"), 350);
    updateHUD();
    if (game.lives <= 0) {
      setTimeout(endGame, 600);
    }
  }

  function onVaccine(now) {
    playSfx("heal");
    if (game.lives < MAX_LIVES) {
      game.lives++;
      showToast("✨ +1 LIFE");
    }
    game.score += VACCINE_BONUS;
    game.happyUntil = now + 800;
    updateHUD();
  }

  // ── HUD ────────────────────────────────────────────────────
  function updateHUD() {
    hudLives.textContent = "❤️".repeat(Math.max(0, game.lives)) + (game.lives === 0 ? "" : "");
    if (game.lives === 0) hudLives.textContent = "💀";
    hudScore.textContent = String(Math.floor(game.score)).padStart(5, "0");
    hudDistance.textContent = Math.floor(game.distance);
  }

  // ── Speed tier ─────────────────────────────────────────────
  function getSpeedMult(elapsed) {
    for (const tier of SPEED_TIERS) {
      if (elapsed < tier.until) return tier.mult;
    }
    return 1.8;
  }

  // ── Draw helpers ───────────────────────────────────────────
  function drawBackground(w, h, dt) {
    const grd = ctx.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0, "#050818");
    grd.addColorStop(0.5, "#0a1030");
    grd.addColorStop(1, "#050818");
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, w, h);

    game.bgOffset = (game.bgOffset + dt * 60 * game.speedMult) % 40;

    ctx.font = "10px monospace";
    game.codeLines.forEach((line) => {
      line.y += line.speed * dt * game.speedMult * 0.05;
      if (line.y > 1) { line.y = 0; line.x = Math.random(); }
      ctx.fillStyle = `rgba(0, 212, 255, ${line.alpha})`;
      ctx.fillText(line.text, line.x * w, line.y * h);
    });

    // Road
    const roadTop = h * 0.15;
    const roadBot = h;
    ctx.fillStyle = "rgba(0, 30, 60, 0.6)";
    ctx.fillRect(w * 0.05, roadTop, w * 0.9, roadBot - roadTop);

    // Lane dividers
    ctx.strokeStyle = "rgba(0, 212, 255, 0.2)";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([12, 16]);
    ctx.lineDashOffset = -game.bgOffset;
    for (let i = 1; i < LANES; i++) {
      const x = w * (0.05 + (0.9 / LANES) * i);
      ctx.beginPath();
      ctx.moveTo(x, roadTop);
      ctx.lineTo(x, roadBot);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // Perspective lines
    ctx.strokeStyle = "rgba(0, 212, 255, 0.08)";
    ctx.lineWidth = 1;
    for (let i = 0; i < 8; i++) {
      const t = ((i * 0.125 + game.bgOffset / h) % 1);
      const y = roadTop + t * (roadBot - roadTop);
      ctx.beginPath();
      ctx.moveTo(w * 0.05, y);
      ctx.lineTo(w * 0.95, y);
      ctx.stroke();
    }

    // Lane labels
    ctx.fillStyle = "rgba(0, 212, 255, 0.15)";
    ctx.font = "9px Pretendard, sans-serif";
    ctx.textAlign = "center";
    ["LEFT", "CENTER", "RIGHT"].forEach((label, i) => {
      ctx.fillText(label, lanePositions[i], h - 8);
    });
  }

  function drawSpriteImage(img, key, x, y, size) {
    if (!img || !img.complete || !img.naturalWidth) {
      ctx.font = size * 0.7 + "px serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(CHARS[key].emoji, x, y);
      return;
    }

    const aspect = img.naturalWidth / img.naturalHeight;
    let dw = size;
    let dh = size;
    if (aspect > 1) dh = size / aspect;
    else dw = size * aspect;

    const bob = Math.sin(game.runTimer * 12) * 2;
    ctx.drawImage(img, x - dw / 2, y - dh / 2 + bob, dw, dh);
  }

  function getPlayerFrame(now) {
    const set = sprites[selectedChar];
    if (!set) return null;

    if (now < game.happyUntil) {
      const idx = Math.floor((1 - (game.happyUntil - now) / 800) * ANIM.happy.count) % ANIM.happy.count;
      return set.happy[idx] || set.front;
    }

    if (now < game.hitAnimUntil) {
      const elapsed = game.hitAnimUntil - now;
      const idx = Math.floor((1 - elapsed / 500) * ANIM.hit.count) % ANIM.hit.count;
      return set.hit[idx] || set.front;
    }

    const idx = Math.floor(game.runTimer * ANIM.run.fps) % ANIM.run.count;
    return set.run[idx] || set.front;
  }

  function drawVirus(x, y, size) {
    ctx.font = `${size}px serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    ctx.shadowColor = "rgba(255, 60, 100, 0.6)";
    ctx.shadowBlur = 12;
    ctx.fillText("🦠", x, y);
    ctx.shadowBlur = 0;

    ctx.strokeStyle = "rgba(255, 60, 100, 0.3)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, size * 0.55, 0, Math.PI * 2);
    ctx.stroke();
  }

  function drawVaccine(x, y, size) {
    ctx.font = `${size}px serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.shadowColor = "rgba(0, 255, 170, 0.6)";
    ctx.shadowBlur = 14;
    ctx.fillText("💉", x, y);
    ctx.shadowBlur = 0;
  }

  function drawPlayer(w, h, now) {
    const px = game.laneX;
    const py = h * PLAYER_Y_RATIO;
    const size = Math.min(w * 0.22, 90);

    if (now >= game.hitAnimUntil && now < game.invincibleUntil) {
      game.blinkPhase += 0.15;
      if (Math.floor(game.blinkPhase) % 2 === 0) return;
    }

    const frame = getPlayerFrame(now);
    drawSpriteImage(frame, selectedChar, px, py, size);

    // Glow under player
    const glow = ctx.createRadialGradient(px, py + size * 0.4, 0, px, py + size * 0.4, size * 0.6);
    glow.addColorStop(0, "rgba(0, 212, 255, 0.25)");
    glow.addColorStop(1, "transparent");
    ctx.fillStyle = glow;
    ctx.fillRect(px - size, py, size * 2, size);
  }

  // ── Main loop ──────────────────────────────────────────────
  function loop(now) {
    if (gameState !== "playing") return;

    const dt = Math.min((now - lastTime) / 1000, 0.05);
    lastTime = now;

    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const speed = BASE_SPEED * game.speedMult;

    game.elapsed += dt;
    game.speedMult = getSpeedMult(game.elapsed);
    game.score += SCORE_PER_SEC * dt;
    game.distance += speed * dt * 4;

    // Lane lerp
    game.laneX += (game.targetLaneX - game.laneX) * LANE_LERP;

    // Run animation timer
    if (now >= game.happyUntil && now >= game.hitAnimUntil) {
      game.runTimer += dt;
    }

    // Spawn obstacles
    game.spawnTimer -= dt;
    const spawnInterval = Math.max(0.7, 1.8 - game.elapsed * 0.015);
    if (game.spawnTimer <= 0) {
      spawnObstaclePattern();
      game.spawnTimer = spawnInterval;
    }

    // Spawn vaccine
    game.itemTimer -= dt;
    if (game.itemTimer <= 0) {
      spawnVaccine();
      game.itemTimer = 5 + Math.random() * 4;
    }

    // Move obstacles
    game.obstacles.forEach((obs) => {
      obs.y += speed * 60 * dt;
      if (!obs.passed && obs.y > h * PLAYER_Y_RATIO + 20) {
        obs.passed = true;
        if (!obs.hit) {
          game.score += DODGE_BONUS;
          playSfx("data");
        }
      }
    });
    game.obstacles = game.obstacles.filter((o) => o.y < h + 60);

    game.items.forEach((item) => {
      item.y += speed * 60 * dt;
    });
    game.items = game.items.filter((i) => i.y < h + 60 && !i.collected);

    checkCollisions(now);
    updateHUD();

    // Draw
    ctx.save();
    if (now < game.shakeUntil) {
      ctx.translate((Math.random() - 0.5) * 8, (Math.random() - 0.5) * 6);
    }

    drawBackground(w, h, dt);

    game.obstacles.forEach((obs) => {
      if (!obs.hit) drawVirus(lanePositions[obs.lane], obs.y, 36);
    });

    game.items.forEach((item) => {
      if (!item.collected) drawVaccine(lanePositions[item.lane], item.y, 32);
    });

    drawPlayer(w, h, now);
    ctx.restore();

    rafId = requestAnimationFrame(loop);
  }

  // ── Event listeners ────────────────────────────────────────
  document.getElementById("btn-start").addEventListener("click", function () {
    unlockAudio();
    showScreen("select");
    syncBgm();
  });
  document.getElementById("btn-back-start").addEventListener("click", function () {
    showScreen("start");
    syncBgm();
  });

  document.querySelectorAll(".char-card").forEach((card) => {
    card.addEventListener("click", () => {
      document.querySelectorAll(".char-card").forEach((c) => c.classList.remove("selected"));
      card.classList.add("selected");
      selectedChar = card.dataset.char;
    });
  });

  document.getElementById("btn-play").addEventListener("click", function () {
    unlockAudio();
    startGame();
  });
  document.getElementById("btn-pause").addEventListener("click", pauseGame);
  document.getElementById("btn-resume").addEventListener("click", resumeGame);
  document.getElementById("btn-restart-pause").addEventListener("click", () => {
    hideOverlay("pause");
    startGame();
  });
  document.getElementById("btn-main-pause").addEventListener("click", function () {
    gameState = "idle";
    cancelAnimationFrame(rafId);
    hideOverlay("pause");
    showScreen("start");
    syncBgm();
  });
  document.getElementById("btn-retry").addEventListener("click", function () {
    showScreen("select");
    syncBgm();
  });
  document.getElementById("btn-main-over").addEventListener("click", function () {
    showScreen("start");
    syncBgm();
  });

  document.getElementById("touch-zones").addEventListener("click", (e) => {
    const zone = e.target.closest(".touch-zone");
    if (!zone) return;
    const dir = zone.dataset.dir;
    if (dir === "left") moveLane("left");
    else if (dir === "right") moveLane("right");
  });

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("resize", () => {
    if (gameState === "playing") resizeCanvas();
  });

  function boot() {
    if (!canvas || !ctx) {
      console.error("Canvas를 초기화할 수 없습니다.");
      return;
    }
    initAudio();
    loadImages();
    initCodeLines();
    updateStartBest();
    calcLanePositions();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
