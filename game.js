/* ============================================================
   AI RUN : 바이러스 러너 — game.js
   바이브 코딩 실습용 HTML Canvas 러닝 게임
   ============================================================ */

(() => {
  "use strict";

  // ── Constants ──────────────────────────────────────────────
  const LANES = 3;
  const BASE_SPEED = 3.5;
  const SCORE_PER_SEC = 10;
  const DODGE_BONUS = 50;
  const VACCINE_BONUS = 100;
  const INVINCIBLE_MS = 1800;
  const LANE_LERP = 0.18;
  const ITEM_PICK_RADIUS = 44;
  const SETTINGS_KEY = "aiRun_settings";
  const DEFAULT_SETTINGS = {
    bgmOn: true,
    sfxOn: true,
    bgmVolume: 0.7,
    sfxVolume: 0.8,
    keys: { left: "ArrowLeft", right: "ArrowRight", pause: "Escape" },
  };
  const BGM_BASE = { lobby: 0.32, game: 0.38 };
  const SFX_BASE = { heal: 0.72, hit: 0.78, data: 0.58 };

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
      maxLives: 3,
      hitHalfW: 22,
      hitHalfH: 20,
      drawScale: 0.18,
      drawMax: 76,
    },
    oru: {
      name: "오르",
      emoji: "🐻",
      base: "assets/characters/oru",
      maxLives: 5,
      hitHalfW: 24,
      hitHalfH: 46,
      drawScale: 0.32,
      drawMax: 128,
    },
  };

  const ITEM_ASSETS = {
    virus: "assets/items/virus.png",
    vaccine: "assets/items/vaccine.png",
    heal: "assets/items/heal.png",
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
    settings: document.getElementById("screen-settings"),
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
    lives: CHARS.bbiya.maxLives,
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
  const OVERLAY_SCREENS = new Set(["settings", "over"]);
  let settings = loadSettings();
  let pendingBind = null;

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
  function loadSettings() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (!raw) return JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
      const parsed = JSON.parse(raw);
      return {
        bgmOn: parsed.bgmOn !== false,
        sfxOn: parsed.sfxOn !== false,
        bgmVolume: clamp01(parsed.bgmVolume, DEFAULT_SETTINGS.bgmVolume),
        sfxVolume: clamp01(parsed.sfxVolume, DEFAULT_SETTINGS.sfxVolume),
        keys: {
          left: parsed.keys && parsed.keys.left ? parsed.keys.left : DEFAULT_SETTINGS.keys.left,
          right: parsed.keys && parsed.keys.right ? parsed.keys.right : DEFAULT_SETTINGS.keys.right,
          pause: parsed.keys && parsed.keys.pause ? parsed.keys.pause : DEFAULT_SETTINGS.keys.pause,
        },
      };
    } catch (err) {
      return JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
    }
  }

  function saveSettings() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch (err) {
      /* Safari file:// 또는 시크릿 모드 */
    }
  }

  function clamp01(value, fallback) {
    const n = Number(value);
    if (!isFinite(n)) return fallback;
    return Math.max(0, Math.min(1, n));
  }

  function makeAudio(src, opts) {
    const el = new Audio(src);
    el.loop = !!(opts && opts.loop);
    el.preload = "auto";
    el.volume = (opts && opts.volume) != null ? opts.volume : 1;
    return el;
  }

  function initAudio() {
    audioState.lobby = makeAudio(SOUNDS.lobby, { loop: true, volume: BGM_BASE.lobby });
    audioState.game = makeAudio(SOUNDS.game, { loop: true, volume: BGM_BASE.game });
    audioState.sfx.heal = makeAudio(SOUNDS.heal, { volume: SFX_BASE.heal });
    audioState.sfx.hit = makeAudio(SOUNDS.hit, { volume: SFX_BASE.hit });
    audioState.sfx.data = makeAudio(SOUNDS.data, { volume: SFX_BASE.data });
    applyAudioSettings();
  }

  function applyAudioSettings() {
    const bgmMul = settings.bgmOn ? settings.bgmVolume : 0;
    const sfxMul = settings.sfxOn ? settings.sfxVolume : 0;
    if (audioState.lobby) audioState.lobby.volume = BGM_BASE.lobby * bgmMul;
    if (audioState.game) audioState.game.volume = BGM_BASE.game * bgmMul;
    Object.keys(SFX_BASE).forEach(function (name) {
      if (audioState.sfx[name]) audioState.sfx[name].volume = SFX_BASE[name] * sfxMul;
    });
    if (!settings.bgmOn) {
      pauseBgm();
      return;
    }
    if (audioState.unlocked) syncBgm();
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
    if (audioState.activeBgm !== next) {
      stopAllBgm();
      audioState.activeBgm = next;
    }
    if (!settings.bgmOn) {
      if (!next.paused) next.pause();
      return;
    }
    if (!next.paused) return;
    next.play().catch(function () {});
  }

  function pauseBgm() {
    if (audioState.activeBgm && !audioState.activeBgm.paused) {
      audioState.activeBgm.pause();
    }
  }

  function resumeBgm() {
    if (!audioState.unlocked || !settings.bgmOn || !audioState.activeBgm) return;
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
    if (!audioState.unlocked || !settings.sfxOn) return;
    const base = audioState.sfx[name];
    if (!base) return;
    const clip = base.cloneNode();
    clip.volume = base.volume;
    clip.play().catch(function () {});
  }

  function keyLabel(key) {
    const map = {
      ArrowLeft: "←",
      ArrowRight: "→",
      ArrowUp: "↑",
      ArrowDown: "↓",
      Escape: "Esc",
      " ": "Space",
      Enter: "Enter",
      Tab: "Tab",
    };
    if (map[key]) return map[key];
    if (key && key.length === 1) return key.toUpperCase();
    return key || "?";
  }

  function matchesKey(pressed, bound) {
    if (!pressed || !bound) return false;
    if (pressed === bound) return true;
    return pressed.toLowerCase() === bound.toLowerCase();
  }

  function actionFromKey(key) {
    if (matchesKey(key, settings.keys.left)) return "left";
    if (matchesKey(key, settings.keys.right)) return "right";
    if (matchesKey(key, settings.keys.pause)) return "pause";
    if (settings.keys.left === "ArrowLeft" && matchesKey(key, "a")) return "left";
    if (settings.keys.right === "ArrowRight" && matchesKey(key, "d")) return "right";
    return null;
  }

  function maxLives() {
    return CHARS[selectedChar].maxLives;
  }

  function mountSettings(mode) {
    const panel = document.getElementById("settings-panel");
    const target = mode === "game"
      ? document.getElementById("settings-mount-game")
      : document.getElementById("panel-settings");
    if (!panel || !target) return;
    target.appendChild(panel);
    panel.hidden = false;
    syncSettingsUI();
  }

  function syncSettingsUI() {
    const bgmOn = document.getElementById("set-bgm-on");
    const sfxOn = document.getElementById("set-sfx-on");
    const bgmVol = document.getElementById("set-bgm-vol");
    const sfxVol = document.getElementById("set-sfx-vol");
    if (bgmOn) bgmOn.checked = settings.bgmOn;
    if (sfxOn) sfxOn.checked = settings.sfxOn;
    if (bgmVol) bgmVol.value = String(Math.round(settings.bgmVolume * 100));
    if (sfxVol) sfxVol.value = String(Math.round(settings.sfxVolume * 100));
    document.querySelectorAll(".key-bind").forEach(function (btn) {
      const action = btn.dataset.action;
      btn.classList.toggle("listening", pendingBind === action);
      btn.textContent = pendingBind === action ? "키 입력…" : keyLabel(settings.keys[action]);
    });
  }

  function showMainTab(name) {
    const homeTab = document.getElementById("tab-home");
    const settingsTab = document.getElementById("tab-settings");
    const homePanel = document.getElementById("panel-home");
    const settingsPanel = document.getElementById("panel-settings");
    const isSettings = name === "settings";
    homeTab.classList.toggle("active", !isSettings);
    settingsTab.classList.toggle("active", isSettings);
    homeTab.setAttribute("aria-selected", String(!isSettings));
    settingsTab.setAttribute("aria-selected", String(isSettings));
    homePanel.classList.toggle("active", !isSettings);
    settingsPanel.classList.toggle("active", isSettings);
    homePanel.hidden = isSettings;
    settingsPanel.hidden = !isSettings;
    if (isSettings) mountSettings("menu");
  }

  function openGameSettings() {
    if (gameState !== "playing") return;
    gameState = "paused";
    cancelAnimationFrame(rafId);
    pauseBgm();
    pendingBind = null;
    mountSettings("game");
    showScreen("settings");
  }

  function closeGameSettings() {
    hideOverlay("settings");
    pendingBind = null;
    mountSettings("menu");
    syncSettingsUI();
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

    sprites.items = {};
    Object.keys(ITEM_ASSETS).forEach(function () {
      totalImages += 1;
    });

    Object.keys(CHARS).forEach(function (key) {
      const paths = spritePaths(key);
      sprites[key] = { front: null, run: [], hit: [], happy: [] };
      totalImages += 1 + paths.run.length + paths.hit.length + paths.happy.length;
    });

    function onImageLoaded() {
      imagesLoaded++;
      if (imagesLoaded >= totalImages) initCodeLines();
    }

    Object.keys(ITEM_ASSETS).forEach(function (key) {
      sprites.items[key] = loadOne(ITEM_ASSETS[key], onImageLoaded);
    });

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
    game.lives = maxLives();
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

  function resumeGame() {
    gameState = "playing";
    closeGameSettings();
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
    if (pendingBind) {
      e.preventDefault();
      bindKey(pendingBind, e.key);
      return;
    }
    const action = actionFromKey(e.key);
    if (action === "pause") {
      if (gameState === "playing") {
        openGameSettings();
      } else if (gameState === "paused" && screens.settings.classList.contains("active")) {
        resumeGame();
      }
      return;
    }
    if (gameState === "playing") {
      if (action === "left") moveLane("left");
      if (action === "right") moveLane("right");
    }
  }

  function bindKey(action, key) {
    if (key === "Shift" || key === "Control" || key === "Alt" || key === "Meta") {
      pendingBind = null;
      syncSettingsUI();
      return;
    }
    const used = Object.keys(settings.keys).some(function (other) {
      return other !== action && matchesKey(key, settings.keys[other]);
    });
    if (used) {
      showToast("이미 다른 동작에 쓰인 키입니다");
      pendingBind = null;
      syncSettingsUI();
      return;
    }
    settings.keys[action] = key;
    pendingBind = null;
    saveSettings();
    syncSettingsUI();
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
    const type = Math.random() < 0.55 ? "vaccine" : "heal";
    game.items.push({ lane: lane, y: SPAWN_Y, type: type, collected: false });
  }

  // ── Collision ──────────────────────────────────────────────
  const PLAYER_Y_RATIO = 0.78;

  function hitsHitbox(px, py, ox, oy, halfW, halfH) {
    return Math.abs(px - ox) < halfW && Math.abs(py - oy) < halfH;
  }

  function checkCollisions(now) {
    const px = game.laneX;
    const py = canvas.clientHeight * PLAYER_Y_RATIO;
    const def = CHARS[selectedChar];

    if (now >= game.invincibleUntil) {
      for (const obs of game.obstacles) {
        if (obs.hit) continue;
        const ox = lanePositions[obs.lane];
        const oy = obs.y;
        if (hitsHitbox(px, py, ox, oy, def.hitHalfW, def.hitHalfH)) {
          obs.hit = true;
          onHit(now);
          return;
        }
      }
    }

    for (const item of game.items) {
      if (item.collected) continue;
      const ix = lanePositions[item.lane];
      const iy = item.y;
      if (hitsHitbox(px, py, ix, iy, ITEM_PICK_RADIUS * 0.55, ITEM_PICK_RADIUS * 0.75)) {
        item.collected = true;
        onHeal(now, item.type);
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

  function onHeal(now, type) {
    playSfx("heal");
    if (game.lives < maxLives()) {
      game.lives++;
      showToast(type === "heal" ? "❤️ +1 LIFE" : "✨ +1 LIFE");
    } else {
      showToast(type === "heal" ? "❤️ MAX" : "✨ MAX");
    }
    game.score += VACCINE_BONUS;
    game.happyUntil = now + 800;
    updateHUD();
  }

  // ── HUD ────────────────────────────────────────────────────
  function updateHUD() {
    if (game.lives === 0) {
      hudLives.textContent = "💀";
    } else {
      const empty = Math.max(0, maxLives() - game.lives);
      hudLives.textContent = "❤️".repeat(game.lives) + "🤍".repeat(empty);
    }
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

  function drawItemSprite(img, x, y, size, fallback, glow) {
    const ready = img && img.complete && img.naturalWidth;
    ctx.save();
    ctx.shadowColor = glow;
    ctx.shadowBlur = 14;
    if (ready) {
      ctx.drawImage(img, x - size / 2, y - size / 2, size, size);
    } else {
      ctx.font = size * 0.85 + "px serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(fallback, x, y);
    }
    ctx.restore();
  }

  function drawVirus(x, y, size) {
    drawItemSprite(sprites.items && sprites.items.virus, x, y, size, "🦠", "rgba(255, 60, 160, 0.55)");
  }

  function drawVaccine(x, y, size) {
    drawItemSprite(sprites.items && sprites.items.vaccine, x, y, size, "💉", "rgba(0, 220, 255, 0.55)");
  }

  function drawHeal(x, y, size) {
    drawItemSprite(sprites.items && sprites.items.heal, x, y, size, "❤️", "rgba(0, 255, 160, 0.5)");
  }

  function drawPlayer(w, h, now) {
    const px = game.laneX;
    const py = h * PLAYER_Y_RATIO;
    const def = CHARS[selectedChar];
    const size = Math.min(w * def.drawScale, def.drawMax);

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
      if (!obs.hit) drawVirus(lanePositions[obs.lane], obs.y, 48);
    });

    game.items.forEach((item) => {
      if (item.collected) return;
      if (item.type === "heal") drawHeal(lanePositions[item.lane], item.y, 42);
      else drawVaccine(lanePositions[item.lane], item.y, 42);
    });

    drawPlayer(w, h, now);
    ctx.restore();

    rafId = requestAnimationFrame(loop);
  }

  // ── Event listeners ────────────────────────────────────────
  document.getElementById("tab-home").addEventListener("click", function () {
    showMainTab("home");
  });
  document.getElementById("tab-settings").addEventListener("click", function () {
    unlockAudio();
    showMainTab("settings");
    syncBgm();
  });

  document.getElementById("btn-start").addEventListener("click", function () {
    unlockAudio();
    showScreen("select");
    syncBgm();
  });
  document.getElementById("btn-back-start").addEventListener("click", function () {
    showScreen("start");
    showMainTab("home");
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
  document.getElementById("btn-gear").addEventListener("click", openGameSettings);
  document.getElementById("btn-settings-resume").addEventListener("click", resumeGame);
  document.getElementById("btn-restart-settings").addEventListener("click", function () {
    closeGameSettings();
    startGame();
  });
  document.getElementById("btn-main-settings").addEventListener("click", function () {
    gameState = "idle";
    cancelAnimationFrame(rafId);
    closeGameSettings();
    showScreen("start");
    showMainTab("home");
    syncBgm();
  });
  document.getElementById("btn-retry").addEventListener("click", function () {
    hideOverlay("over");
    showScreen("select");
    syncBgm();
  });
  document.getElementById("btn-main-over").addEventListener("click", function () {
    hideOverlay("over");
    showScreen("start");
    showMainTab("home");
    syncBgm();
  });

  document.getElementById("set-bgm-on").addEventListener("change", function (e) {
    settings.bgmOn = e.target.checked;
    saveSettings();
    applyAudioSettings();
  });
  document.getElementById("set-sfx-on").addEventListener("change", function (e) {
    settings.sfxOn = e.target.checked;
    saveSettings();
    applyAudioSettings();
  });
  document.getElementById("set-bgm-vol").addEventListener("input", function (e) {
    settings.bgmVolume = Number(e.target.value) / 100;
    saveSettings();
    applyAudioSettings();
  });
  document.getElementById("set-sfx-vol").addEventListener("input", function (e) {
    settings.sfxVolume = Number(e.target.value) / 100;
    saveSettings();
    applyAudioSettings();
  });
  document.querySelectorAll(".key-bind").forEach(function (btn) {
    btn.addEventListener("click", function () {
      pendingBind = pendingBind === btn.dataset.action ? null : btn.dataset.action;
      syncSettingsUI();
    });
  });
  document.getElementById("btn-reset-keys").addEventListener("click", function () {
    settings.keys = JSON.parse(JSON.stringify(DEFAULT_SETTINGS.keys));
    pendingBind = null;
    saveSettings();
    syncSettingsUI();
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
    mountSettings("menu");
    showMainTab("home");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
