'use strict';

/*
 * Void Shatter — Vector Arcade Asteroid Shooter
 * Pure Canvas 2D + Web Audio API. Zero external dependencies, zero inline styles,
 * zero dynamic code evaluation, zero runtime network requests.
 */
(() => {
  // ───────────────────────── Utilities ─────────────────────────

  const TAU = Math.PI * 2;
  const rand = (min, max) => min + Math.random() * (max - min);
  const randInt = (min, max) => Math.floor(rand(min, max + 1));
  const clamp = (v, min, max) => (v < min ? min : v > max ? max : v);
  const pick = (list) => list[Math.floor(Math.random() * list.length)];
  const wrapCoord = (val, span) => ((val % span) + span) % span;

  const torusDelta = (from, to, span) => {
    let d = to - from;
    const half = span * 0.5;
    if (d > half) d -= span;
    else if (d < -half) d += span;
    return d;
  };

  const angleDiff = (from, to) => {
    let d = (to - from) % TAU;
    if (d > Math.PI) d -= TAU;
    else if (d < -Math.PI) d += TAU;
    return d;
  };

  const distSqPointToSegment = (px, py, x1, y1, x2, y2) => {
    const abx = x2 - x1;
    const aby = y2 - y1;
    const lenSq = abx * abx + aby * aby;
    if (lenSq <= 0.000001) {
      const dx = px - x1;
      const dy = py - y1;
      return dx * dx + dy * dy;
    }
    const t = clamp(((px - x1) * abx + (py - y1) * aby) / lenSq, 0, 1);
    const dx = px - (x1 + abx * t);
    const dy = py - (y1 + aby * t);
    return dx * dx + dy * dy;
  };

  const byId = (id) => {
    const el = document.getElementById(id);
    if (!el) throw new Error(`Missing required element #${id}`);
    return el;
  };

  const STATE = Object.freeze({
    MENU: 'menu',
    PLAYING: 'playing',
    PAUSED: 'paused',
    OVER: 'over',
  });

  const STORAGE_KEYS = Object.freeze({
    high: 'voidShatter.highScore',
    mute: 'voidShatter.muted',
  });

  const MAX_SAFE_SCORE = 999_999_999;

  const Store = Object.freeze({
    get(key, fallback) {
      try {
        const storage = globalThis.localStorage;
        if (!storage) return fallback;
        const value = storage.getItem(key);
        return value === null ? fallback : value;
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      try {
        const storage = globalThis.localStorage;
        if (!storage) return false;
        storage.setItem(key, String(value));
        return true;
      } catch {
        return false;
      }
    },
    readScore(key) {
      const raw = this.get(key, '0');
      if (typeof raw !== 'string' || !/^\d{1,9}$/.test(raw)) return 0;
      const parsed = Number(raw);
      return Number.isSafeInteger(parsed) && parsed >= 0 ? Math.min(parsed, MAX_SAFE_SCORE) : 0;
    },
  });

  // Live reduced-motion preference tracking
  const MotionPref = (() => {
    const mq = typeof globalThis.matchMedia === 'function'
      ? globalThis.matchMedia('(prefers-reduced-motion: reduce)')
      : null;
    let reduced = mq?.matches ?? false;
    mq?.addEventListener('change', (e) => {
      reduced = e.matches;
    });
    return Object.freeze({
      get reduced() {
        return reduced;
      },
    });
  })();

  // ───────────────────────── Tuning ─────────────────────────

  const CFG = Object.freeze({
    maxFrameDt: 0.05,
    maxStep: 1 / 100,
    startLives: 3,
    maxLives: 6,
    extraLifeEvery: 12000,
    maxParticles: 1100,
    maxFloaters: 48,
    maxPowerUps: 5,
    comboDuration: 3.3,
    maxComboMult: 8,
    ship: Object.freeze({
      radius: 12,
      turnSpeed: 4.85,
      thrust: 455,
      maxSpeed: 475,
      drag: 0.52,
      fireCooldown: 0.145,
      rapidCooldown: 0.088,
      bulletSpeed: 920,
      bulletLife: 1.15,
      maxBullets: 27,
      invulnTime: 2.6,
      respawnDelay: 1.45,
      respawnClearance: 155,
      trailRate: 92,
      weaponDuration: 10.5,
    }),
    dash: Object.freeze({
      cooldown: 3.0,
      impulse: 640,
      maxDashSpeed: 700,
      boostTime: 0.28,
      invuln: 0.52,
      pushRadius: 175,
      pushForce: 265,
    }),
    volatileBlastRadius: 132,
    novaRadius: 340,
    powerUpLife: 11.5,
    powerUpMagnet: 155,
    // Screens shorter/narrower than this (phones) see a slightly zoomed-out field
    // so the play area keeps desktop proportions. Larger screens are unaffected.
    minViewSpan: 540,
    touchPixelRatioCap: 1.5,
  });

  const TIERS = Object.freeze({
    3: Object.freeze({ radius: 56, points: 20, speed: [28, 62], color: '#6cc8ff', glow: '#2b8cff' }),
    2: Object.freeze({ radius: 31, points: 50, speed: [50, 102], color: '#b893ff', glow: '#7b4dff' }),
    1: Object.freeze({ radius: 17, points: 100, speed: [82, 152], color: '#ff6fd8', glow: '#ff2fb5' }),
  });

  const VARIANTS = Object.freeze({
    normal: Object.freeze({ scoreMul: 1, fill: 'rgba(8, 10, 30, 0.84)' }),
    crystal: Object.freeze({
      scoreMul: 1.5,
      color: '#52ffbe',
      glow: '#12e69c',
      fill: 'rgba(6, 28, 28, 0.86)',
    }),
    volatile: Object.freeze({
      scoreMul: 1.4,
      color: '#ff9642',
      glow: '#ff3d57',
      fill: 'rgba(34, 10, 16, 0.88)',
    }),
  });

  const POWERUPS = Object.freeze({
    spread: Object.freeze({ label: 'Spread ×3', color: '#ffd76a', glow: '#ff9c33', glyph: 'S' }),
    rapid: Object.freeze({ label: 'Overdrive', color: '#4dffb8', glow: '#00e68a', glyph: 'R' }),
    shield: Object.freeze({ label: 'Aegis Shield', color: '#5ff6ff', glow: '#00c8ff', glyph: 'A' }),
    nova: Object.freeze({ label: 'Nova Pulse', color: '#ff6fd8', glow: '#ff2eb0', glyph: 'N' }),
  });

  const COMBO_NOTES = Object.freeze([523.25, 587.33, 659.25, 783.99, 880, 1046.5, 1174.66, 1318.51]);
  const SHIP_COLOR = '#5ff6ff';
  const SHIP_GLOW = '#00d9ff';
  const FLAME_COLORS = Object.freeze(['#ffb347', '#ff7a3d', '#ff3d9a', '#ffe08a']);

  // Sleek vector starfighter geometry (nose right at angle 0)
  const HULL = Object.freeze([18, 0, 5, 5, -11, 11, -7, 3, -10, 0, -7, -3, -11, -11, 5, -5]);

  const traceHull = (ctx) => {
    ctx.moveTo(HULL[0], HULL[1]);
    for (let i = 2; i < HULL.length; i += 2) ctx.lineTo(HULL[i], HULL[i + 1]);
    ctx.closePath();
  };

  // Call `cb(ox, oy)` for each visible toroidal wrap offset needed around `(x, y)`
  const forEachWrapped = (x, y, margin, w, h, cb) => {
    const left = x < margin;
    const right = x > w - margin;
    const top = y < margin;
    const bottom = y > h - margin;

    cb(0, 0);
    if (left) cb(w, 0);
    else if (right) cb(-w, 0);

    if (top) {
      cb(0, h);
      if (left) cb(w, h);
      else if (right) cb(-w, h);
    } else if (bottom) {
      cb(0, -h);
      if (left) cb(w, -h);
      else if (right) cb(-w, -h);
    }
  };

  // ───────────────────────── Procedural Audio ─────────────────────────

  const MAX_AUDIO_VOICES = 28;

  class SoundEngine {
    #ctx = null;
    #master = null;
    #noiseBuffer = null;
    #hum = null;
    #saucer = null;
    #muted = false;
    #volume = 0.5;
    #thrusting = false;
    #saucerOn = false;
    #saucerHunter = false;
    #activeVoices = 0;
    #lastTrigger = Object.create(null);

    constructor(muted) {
      this.#muted = Boolean(muted);
    }

    get muted() {
      return this.#muted;
    }

    get canPlay() {
      return this.#ctx !== null && this.#ctx.state === 'running' && !this.#muted;
    }

    /** Must be called from a user gesture; safe to call repeatedly. */
    init() {
      if (this.#ctx) {
        // iOS can also report 'interrupted' (e.g. after a phone call)
        if (this.#ctx.state !== 'running' && this.#ctx.state !== 'closed' && !this.#muted && !document.hidden) {
          this.#ctx.resume().catch(() => {});
        }
        return;
      }
      const AudioCtor = globalThis.AudioContext;
      if (typeof AudioCtor !== 'function') return;
      try {
        this.#ctx = new AudioCtor();
      } catch {
        this.#ctx = null;
        return;
      }

      const c = this.#ctx;
      this.#master = c.createGain();
      this.#master.gain.value = this.#muted ? 0 : this.#volume;

      const comp = c.createDynamicsCompressor();
      comp.threshold.value = -15;
      comp.knee.value = 14;
      comp.ratio.value = 5;
      comp.attack.value = 0.002;
      comp.release.value = 0.16;
      this.#master.connect(comp);
      comp.connect(c.destination);

      const length = Math.floor(c.sampleRate * 2);
      this.#noiseBuffer = c.createBuffer(1, length, c.sampleRate);
      const data = this.#noiseBuffer.getChannelData(0);
      for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;

      this.#buildHum();
      this.#buildSaucerHum();

      if (c.state === 'suspended' && !this.#muted) {
        c.resume().catch(() => {});
      }
    }

    suspend() {
      this.setThrust(false);
      this.setSaucerHum(false, false);
      if (this.#ctx && this.#ctx.state === 'running') {
        this.#ctx.suspend().catch(() => {});
      }
    }

    resumeIfActive() {
      if (this.#ctx && this.#ctx.state !== 'running' && this.#ctx.state !== 'closed' && !this.#muted && !document.hidden) {
        this.#ctx.resume().catch(() => {});
      }
    }

    #smoothParam(param, target, t, timeConstant) {
      if (typeof param.cancelAndHoldAtTime === 'function') {
        param.cancelAndHoldAtTime(t);
      } else {
        param.cancelScheduledValues(t);
        param.setValueAtTime(param.value, t);
      }
      param.setTargetAtTime(target, t, timeConstant);
    }

    #buildHum() {
      const c = this.#ctx;
      const noise = c.createBufferSource();
      noise.buffer = this.#noiseBuffer;
      noise.loop = true;

      const osc = c.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = 50;
      const oscGain = c.createGain();
      oscGain.gain.value = 0.24;

      const filter = c.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 280;
      filter.Q.value = 0.9;

      const gain = c.createGain();
      gain.gain.value = 0;

      noise.connect(filter);
      osc.connect(oscGain);
      oscGain.connect(filter);
      filter.connect(gain);
      gain.connect(this.#master);
      noise.start();
      osc.start();
      this.#hum = { gain, filter, osc };
    }

    #buildSaucerHum() {
      const c = this.#ctx;
      const osc = c.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = 240;

      const lfo = c.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.value = 6.5;

      const lfoDepth = c.createGain();
      lfoDepth.gain.value = 46;

      const gain = c.createGain();
      gain.gain.value = 0;

      lfo.connect(lfoDepth);
      lfoDepth.connect(osc.frequency);
      osc.connect(gain);
      gain.connect(this.#master);
      osc.start();
      lfo.start();
      this.#saucer = { osc, lfo, lfoDepth, gain };
    }

    setThrust(on) {
      if (!this.#hum || !this.#ctx || on === this.#thrusting) return;
      this.#thrusting = on;
      const t = this.#ctx.currentTime;
      this.#smoothParam(this.#hum.gain.gain, on ? 0.19 : 0, t, on ? 0.035 : 0.065);
      this.#smoothParam(this.#hum.filter.frequency, on ? 920 : 280, t, 0.11);
      this.#smoothParam(this.#hum.osc.frequency, on ? 66 : 50, t, 0.18);
    }

    setSaucerHum(active, isHunter) {
      if (!this.#saucer || !this.#ctx) return;
      if (active === this.#saucerOn && (!active || isHunter === this.#saucerHunter)) return;
      this.#saucerOn = active;
      this.#saucerHunter = isHunter;
      const t = this.#ctx.currentTime;
      this.#smoothParam(this.#saucer.gain.gain, active ? (isHunter ? 0.075 : 0.06) : 0, t, 0.08);
      if (active) {
        this.#smoothParam(this.#saucer.osc.frequency, isHunter ? 330 : 225, t, 0.08);
        this.#smoothParam(this.#saucer.lfo.frequency, isHunter ? 9.5 : 6.2, t, 0.08);
      }
    }

    setMuted(muted) {
      this.#muted = Boolean(muted);
      if (this.#master && this.#ctx) {
        const t = this.#ctx.currentTime;
        this.#smoothParam(this.#master.gain, this.#muted ? 0 : this.#volume, t, 0.02);
        if (!this.#muted && this.#ctx.state === 'suspended' && !document.hidden) {
          this.#ctx.resume().catch(() => {});
        }
      }
    }

    #canTrigger(tag, minGapMs) {
      if (!this.canPlay || this.#activeVoices >= MAX_AUDIO_VOICES) return false;
      if (minGapMs > 0) {
        const now = performance.now();
        const prev = this.#lastTrigger[tag] ?? 0;
        if (now - prev < minGapMs) return false;
        this.#lastTrigger[tag] = now;
      }
      return true;
    }

    #bindCleanup(source, nodes) {
      this.#activeVoices += 1;
      source.onended = () => {
        this.#activeVoices = Math.max(0, this.#activeVoices - 1);
        for (const node of nodes) {
          try {
            node.disconnect();
          } catch {
            // Already disconnected
          }
        }
      };
    }

    #envelope(param, t, peak, attack, duration) {
      const safePeak = Math.max(0.0002, peak);
      const safeAttack = Math.max(0.002, attack);
      const safeDur = Math.max(safeAttack + 0.006, duration);
      param.setValueAtTime(0.0001, t);
      param.exponentialRampToValueAtTime(safePeak, t + safeAttack);
      param.exponentialRampToValueAtTime(0.0001, t + safeDur);
    }

    tone(freq, delay, duration, type, volume, endFreq) {
      if (!this.canPlay || this.#activeVoices >= MAX_AUDIO_VOICES) return;
      const c = this.#ctx;
      const t = c.currentTime + Math.max(0, delay);
      const safeDur = Math.max(0.02, duration);
      const safeFreq = Math.max(20, freq);
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(safeFreq, t);
      if (endFreq && endFreq > 0) {
        osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), t + safeDur);
      }
      this.#envelope(gain.gain, t, volume, 0.01, safeDur);
      osc.connect(gain);
      gain.connect(this.#master);
      osc.start(t);
      osc.stop(t + safeDur + 0.03);
      this.#bindCleanup(osc, [osc, gain]);
    }

    noiseBurst(duration, volume, filterType, fromFreq, toFreq, q) {
      if (!this.canPlay || this.#activeVoices >= MAX_AUDIO_VOICES) return;
      const c = this.#ctx;
      const t = c.currentTime;
      const safeDur = Math.max(0.03, duration);
      const src = c.createBufferSource();
      src.buffer = this.#noiseBuffer;
      const filter = c.createBiquadFilter();
      filter.type = filterType;
      filter.Q.value = q;
      filter.frequency.setValueAtTime(Math.max(20, fromFreq), t);
      filter.frequency.exponentialRampToValueAtTime(Math.max(20, toFreq), t + safeDur);
      const gain = c.createGain();
      this.#envelope(gain.gain, t, volume, 0.008, safeDur);
      src.connect(filter);
      filter.connect(gain);
      gain.connect(this.#master);
      const maxOffset = Math.max(0, this.#noiseBuffer.duration - safeDur - 0.05);
      src.start(t, Math.random() * maxOffset, safeDur + 0.04);
      this.#bindCleanup(src, [src, filter, gain]);
    }

    laser(weapon) {
      if (!this.#canTrigger('laser', 35)) return;
      const c = this.#ctx;
      const t = c.currentTime;
      const osc = c.createOscillator();
      const filter = c.createBiquadFilter();
      const gain = c.createGain();

      const isRapid = weapon === 'rapid';
      const isSpread = weapon === 'spread';
      osc.type = isRapid ? 'sawtooth' : 'square';
      const startFreq = (isRapid ? 1680 : isSpread ? 1220 : 1380) + Math.random() * 220;
      const endFreq = isRapid ? 260 : 165;
      const dur = isRapid ? 0.095 : 0.135;

      osc.frequency.setValueAtTime(startFreq, t);
      osc.frequency.exponentialRampToValueAtTime(endFreq, t + dur);
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(isRapid ? 6400 : 5200, t);
      filter.frequency.exponentialRampToValueAtTime(700, t + dur);
      this.#envelope(gain.gain, t, isSpread ? 0.15 : 0.125, 0.004, dur + 0.015);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(this.#master);
      osc.start(t);
      osc.stop(t + dur + 0.03);
      this.#bindCleanup(osc, [osc, filter, gain]);

      if (isSpread) {
        this.tone(880, 0, 0.09, 'triangle', 0.06, 220);
      }
    }

    saucerShot(isHunter) {
      if (!this.#canTrigger('saucerShot', 90)) return;
      this.tone(isHunter ? 980 : 720, 0, 0.16, 'sawtooth', 0.09, isHunter ? 240 : 180);
    }

    explosion(size, variant = 'normal') {
      if (!this.#canTrigger('explosion', 42)) return;
      const duration = 0.3 + size * 0.22;
      this.noiseBurst(duration, 0.26 + size * 0.11, 'lowpass', 2600 - size * 380, 58, 0.75);
      this.tone(132 - size * 18, 0, duration * 0.58, 'sine', 0.22 + size * 0.08, 32);
      if (variant === 'crystal') {
        this.tone(1046, 0, 0.2, 'triangle', 0.09, 1568);
        this.tone(1318, 0.04, 0.24, 'sine', 0.08, 2093);
      } else if (variant === 'volatile') {
        this.noiseBurst(0.55, 0.42, 'bandpass', 950, 95, 1.2);
        this.tone(86, 0, 0.48, 'sawtooth', 0.14, 28);
      }
    }

    armorHit() {
      if (!this.#canTrigger('armorHit', 40)) return;
      this.tone(1480, 0, 0.075, 'triangle', 0.12, 620);
      this.noiseBurst(0.08, 0.15, 'highpass', 3200, 1400, 1.5);
    }

    comboPing(mult) {
      if (mult < 2 || !this.#canTrigger('combo', 55)) return;
      const idx = clamp(mult - 2, 0, COMBO_NOTES.length - 1);
      this.tone(COMBO_NOTES[idx], 0, 0.14, 'sine', 0.065);
    }

    shipExplode() {
      this.noiseBurst(1.25, 0.72, 'lowpass', 1900, 38, 0.6);
      this.tone(440, 0, 0.92, 'sawtooth', 0.12, 48);
      this.tone(92, 0, 0.8, 'sine', 0.38, 26);
    }

    saucerExplode() {
      this.noiseBurst(0.7, 0.48, 'bandpass', 1800, 120, 1.1);
      this.tone(620, 0, 0.45, 'sawtooth', 0.12, 70);
      this.tone(150, 0, 0.5, 'sine', 0.26, 36);
    }

    dash() {
      this.noiseBurst(0.32, 0.28, 'bandpass', 340, 3600, 2.4);
      this.tone(240, 0, 0.28, 'sine', 0.12, 920);
    }

    dashReady() {
      if (!this.#canTrigger('dashReady', 200)) return;
      this.tone(880, 0, 0.08, 'sine', 0.055, 1175);
    }

    powerUp(kind) {
      if (kind === 'nova') {
        this.nova();
        return;
      }
      const seq = kind === 'shield' ? [523, 659, 988] : [587, 784, 1175, 1568];
      for (let i = 0; i < seq.length; i++) {
        this.tone(seq[i], i * 0.055, 0.18, 'triangle', 0.1);
      }
    }

    shieldAbsorb() {
      this.noiseBurst(0.35, 0.3, 'bandpass', 2400, 420, 2.2);
      this.tone(680, 0, 0.28, 'sine', 0.18, 190);
      this.tone(1020, 0.02, 0.22, 'triangle', 0.1, 440);
    }

    nova() {
      this.noiseBurst(0.95, 0.55, 'lowpass', 3200, 75, 0.9);
      this.tone(180, 0, 0.72, 'sine', 0.34, 34);
      this.tone(523, 0.04, 0.52, 'triangle', 0.12, 1046);
      this.tone(784, 0.08, 0.52, 'sine', 0.1, 1568);
    }

    heartbeat(high) {
      if (!this.#canTrigger('beat', 160)) return;
      this.tone(high ? 92 : 76, 0, 0.11, 'sine', 0.075, high ? 58 : 48);
    }

    waveStart() {
      const notes = [330, 440, 660];
      for (let i = 0; i < notes.length; i++) {
        this.tone(notes[i], i * 0.09, 0.22, 'triangle', 0.11);
      }
    }

    waveClear() {
      const notes = [523, 659, 784, 1046];
      for (let i = 0; i < notes.length; i++) {
        this.tone(notes[i], i * 0.08, 0.26, 'triangle', 0.11);
      }
    }

    extraLife() {
      const notes = [880, 1175, 1568, 2093];
      for (let i = 0; i < notes.length; i++) {
        this.tone(notes[i], i * 0.065, 0.28, 'sine', 0.13);
      }
    }

    gameOver() {
      const notes = [392, 330, 262, 196];
      for (let i = 0; i < notes.length; i++) {
        this.tone(notes[i], i * 0.19, 0.44, 'triangle', 0.12);
      }
    }

    uiBlip() {
      this.tone(660, 0, 0.08, 'triangle', 0.08, 990);
    }
  }

  // ───────────────────────── Input ─────────────────────────

  const GAME_KEYS = new Set([
    'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space',
    'KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft', 'ShiftRight',
    'KeyP', 'Escape', 'KeyM', 'Enter', 'NumpadEnter', 'KeyR',
  ]);
  const DASH_KEYS = new Set(['ShiftLeft', 'ShiftRight', 'ArrowDown', 'KeyS']);
  const CONFIRM_KEYS = new Set(['Enter', 'NumpadEnter', 'Space']);

  class Input {
    down = new Set();
    touch = { left: false, right: false, thrust: false, fire: false };

    get left() { return this.down.has('ArrowLeft') || this.down.has('KeyA') || this.touch.left; }
    get right() { return this.down.has('ArrowRight') || this.down.has('KeyD') || this.touch.right; }
    get thrust() { return this.down.has('ArrowUp') || this.down.has('KeyW') || this.touch.thrust; }
    get fire() { return this.down.has('Space') || this.touch.fire; }

    clear() {
      this.down.clear();
      this.touch.left = false;
      this.touch.right = false;
      this.touch.thrust = false;
      this.touch.fire = false;
    }
  }

  // ───────────────────────── Touch Controls ─────────────────────────

  // Fractions of the left pad: left third rotates left, right third rotates right,
  // top part thrusts. Corners combine (e.g. top-left = thrust + rotate left).
  const PAD_ZONE = Object.freeze({ left: 0.36, right: 0.64, up: 0.45 });
  const RELEASE_EVENTS = Object.freeze(['pointerup', 'pointercancel', 'lostpointercapture']);

  class TouchControls {
    #game;
    #touch;
    #pad;
    #keys;
    #fire;
    #dash;
    #pause;
    #padPointer = null;
    #releaseFire = () => {};
    #releaseDash = () => {};
    #enabled = false;

    constructor(game, input) {
      this.#game = game;
      this.#touch = input.touch;
      this.#pad = byId('touch-pad');
      this.#keys = {
        left: byId('touch-left'),
        right: byId('touch-right'),
        thrust: byId('touch-up'),
      };
      this.#fire = byId('touch-fire');
      this.#dash = byId('touch-dash');
      this.#pause = byId('touch-pause');
      this.#bind();
      this.setEnabled(TouchControls.prefersTouch());
    }

    /** True on phones/tablets whose main input is a finger (not touchscreen laptops). */
    static prefersTouch() {
      if (typeof globalThis.matchMedia !== 'function') return false;
      return globalThis.matchMedia('(pointer: coarse)').matches
        && globalThis.matchMedia('(hover: none)').matches;
    }

    static #capture(el, pointerId) {
      try {
        el.setPointerCapture(pointerId);
      } catch {
        // Pointer already released before capture could be taken
      }
    }

    setEnabled(on) {
      if (on === this.#enabled) return;
      this.#enabled = on;
      document.body.classList.toggle('touch', on);
      if (!on) this.releaseAll();
    }

    setDashReady(ready) {
      this.#dash.classList.toggle('ready', ready);
    }

    releaseAll() {
      this.#releasePad();
      this.#releaseFire();
      this.#releaseDash();
    }

    #bind() {
      // Show touch controls after a finger touch; hide them again if a keyboard is used.
      globalThis.addEventListener('pointerdown', (e) => {
        if (e.pointerType === 'touch') this.setEnabled(true);
      }, { capture: true, passive: true });
      globalThis.addEventListener('keydown', (e) => {
        if (GAME_KEYS.has(e.code)) this.setEnabled(false);
      }, { capture: true });
      globalThis.addEventListener('blur', () => this.releaseAll());
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) this.releaseAll();
      });

      const pad = this.#pad;
      pad.addEventListener('pointerdown', (e) => {
        if (this.#padPointer !== null) return;
        e.preventDefault();
        this.#padPointer = e.pointerId;
        TouchControls.#capture(pad, e.pointerId);
        this.#updatePad(e);
      });
      pad.addEventListener('pointermove', (e) => {
        if (e.pointerId === this.#padPointer) this.#updatePad(e);
      });
      const endPad = (e) => {
        if (e.pointerId === this.#padPointer) this.#releasePad();
      };
      for (const type of RELEASE_EVENTS) pad.addEventListener(type, endPad);

      this.#releaseFire = this.#bindHold(this.#fire, (down) => {
        this.#touch.fire = down;
      });
      this.#releaseDash = this.#bindHold(this.#dash, (down) => {
        if (down) this.#game.onKeyPress('ShiftLeft');
      });

      this.#pause.addEventListener('click', (e) => {
        e.currentTarget?.blur?.();
        this.#game.onKeyPress('KeyP');
      });

      byId('touch-controls').addEventListener('contextmenu', (e) => e.preventDefault());
    }

    #bindHold(el, onChange) {
      let activeId = null;
      const release = () => {
        if (activeId === null) return;
        activeId = null;
        el.classList.remove('pressed');
        onChange(false);
      };
      el.addEventListener('pointerdown', (e) => {
        if (activeId !== null) return;
        e.preventDefault();
        activeId = e.pointerId;
        TouchControls.#capture(el, e.pointerId);
        el.classList.add('pressed');
        onChange(true);
      });
      const end = (e) => {
        if (e.pointerId === activeId) release();
      };
      for (const type of RELEASE_EVENTS) el.addEventListener(type, end);
      return release;
    }

    #updatePad(e) {
      const r = this.#pad.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return;
      const x = (e.clientX - r.left) / r.width;
      const y = (e.clientY - r.top) / r.height;
      this.#setPad(x < PAD_ZONE.left, x > PAD_ZONE.right, y < PAD_ZONE.up);
    }

    #releasePad() {
      this.#padPointer = null;
      this.#setPad(false, false, false);
    }

    #setPad(left, right, thrust) {
      const t = this.#touch;
      t.left = left;
      t.right = right;
      t.thrust = thrust;
      this.#keys.left.classList.toggle('active', left);
      this.#keys.right.classList.toggle('active', right);
      this.#keys.thrust.classList.toggle('active', thrust);
    }
  }

  // ───────────────────────── Starfield ─────────────────────────

  const STAR_PALETTE = Object.freeze([
    '#9fb8ff', '#d2e2ff', '#ffffff', '#ffe8cc', '#c9b8ff', '#a8f6ff',
  ]);

  class Starfield {
    layers = [
      { count: 145, parallax: 0.032, drift: 4, size: [0.6, 1.15], alpha: [0.22, 0.55] },
      { count: 78, parallax: 0.095, drift: 9, size: [0.95, 1.65], alpha: [0.36, 0.78] },
      { count: 32, parallax: 0.21, drift: 16, size: [1.45, 2.45], alpha: [0.58, 0.96] },
    ];
    stars = [];
    nebula = null;
    width = 1;
    height = 1;

    resize(width, height, rebuildNebula = true) {
      this.width = width;
      this.height = height;
      const density = clamp((width * height) / (1280 * 720), 0.45, 2.2);
      this.stars = this.layers.map((layer, li) => {
        const count = Math.round(layer.count * density);
        const list = new Array(count);
        for (let i = 0; i < count; i++) {
          list[i] = {
            x: rand(0, width),
            y: rand(0, height),
            size: rand(layer.size[0], layer.size[1]),
            alpha: rand(layer.alpha[0], layer.alpha[1]),
            twinkle: rand(0.6, 2.7),
            phase: rand(0, TAU),
            color: li === 0 ? STAR_PALETTE[i % 2] : pick(STAR_PALETTE),
            flare: li === 2 && i % 4 === 0,
          };
        }
        return list;
      });
      if (rebuildNebula || !this.nebula) {
        this.buildNebula(width, height);
      }
    }

    buildNebula(width, height) {
      const scale = 0.45;
      const canvas = this.nebula ?? document.createElement('canvas');
      canvas.width = Math.max(1, Math.ceil(width * scale));
      canvas.height = Math.max(1, Math.ceil(height * scale));
      const g = canvas.getContext('2d');
      if (!g) return;
      g.clearRect(0, 0, canvas.width, canvas.height);

      const blobs = [
        'rgba(92, 58, 224, 0.19)',
        'rgba(18, 152, 220, 0.13)',
        'rgba(218, 48, 168, 0.1)',
        'rgba(32, 92, 225, 0.12)',
        'rgba(24, 210, 170, 0.065)',
      ];
      const big = Math.max(canvas.width, canvas.height);
      for (const color of blobs) {
        const x = rand(0, canvas.width);
        const y = rand(0, canvas.height);
        const r = rand(0.32, 0.72) * big;
        const grad = g.createRadialGradient(x, y, 0, x, y, r);
        grad.addColorStop(0, color);
        grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
        g.fillStyle = grad;
        g.fillRect(0, 0, canvas.width, canvas.height);
      }
      this.nebula = canvas;
    }

    update(dt, vx, vy) {
      const w = this.width;
      const h = this.height;
      for (let li = 0; li < this.layers.length; li++) {
        const layer = this.layers[li];
        const dx = (-vx * layer.parallax - layer.drift) * dt;
        const dy = (-vy * layer.parallax - layer.drift * 0.35) * dt;
        const list = this.stars[li];
        for (let i = 0; i < list.length; i++) {
          const s = list[i];
          s.x += dx;
          s.y += dy;
          if (s.x < 0) s.x += w;
          else if (s.x >= w) s.x -= w;
          if (s.y < 0) s.y += h;
          else if (s.y >= h) s.y -= h;
        }
      }
    }

    draw(ctx, time, warpVx, warpVy, warpFactor) {
      if (this.nebula) ctx.drawImage(this.nebula, 0, 0, this.width, this.height);
      const streak = warpFactor > 0.02 && !MotionPref.reduced;

      for (let li = 0; li < this.layers.length; li++) {
        const list = this.stars[li];
        const parallax = this.layers[li].parallax;
        for (let i = 0; i < list.length; i++) {
          const s = list[i];
          const tw = 0.72 + 0.28 * Math.sin(time * s.twinkle + s.phase);
          const alpha = s.alpha * tw;
          ctx.globalAlpha = alpha;

          if (streak && li >= 1) {
            const sx = -warpVx * parallax * 0.095 * warpFactor;
            const sy = -warpVy * parallax * 0.095 * warpFactor;
            ctx.strokeStyle = s.color;
            ctx.lineWidth = s.size * 0.85;
            ctx.beginPath();
            ctx.moveTo(s.x, s.y);
            ctx.lineTo(s.x - sx, s.y - sy);
            ctx.stroke();
          } else {
            ctx.fillStyle = s.color;
            ctx.fillRect(s.x, s.y, s.size, s.size);
            if (s.flare) {
              const arm = s.size * 2.5 * tw;
              ctx.globalAlpha = alpha * 0.42;
              ctx.fillRect(s.x - arm + s.size * 0.5, s.y + s.size * 0.35, arm * 2, 0.7);
              ctx.fillRect(s.x + s.size * 0.35, s.y - arm + s.size * 0.5, 0.7, arm * 2);
            }
          }
        }
      }
      ctx.globalAlpha = 1;
    }
  }

  // ───────────────────────── Particles (Pooled) ─────────────────────────

  const P_DOT = 0;
  const P_SPARK = 1;
  const P_SHARD = 2;
  const P_RING = 3;
  const P_GHOST = 4;
  const P_FLASH = 5;

  class ParticleSystem {
    active = [];
    pool = [];

    constructor(max) {
      this.max = max;
    }

    spawn(kind, x, y, vx, vy, life, size, color, drag) {
      if (this.active.length >= this.max) return null;
      const p = this.pool.pop() ?? {};
      p.kind = kind;
      p.x = x;
      p.y = y;
      p.vx = vx;
      p.vy = vy;
      p.life = life;
      p.maxLife = life;
      p.size = size;
      p.color = color;
      p.drag = drag;
      p.angle = 0;
      p.spin = 0;
      p.len = 0;
      p.grow = 0;
      this.active.push(p);
      return p;
    }

    update(dt, width, height) {
      const list = this.active;
      const margin = 120;
      for (let i = list.length - 1; i >= 0; i--) {
        const p = list[i];
        p.life -= dt;
        if (p.life <= 0) {
          const last = list.pop();
          if (last !== p) list[i] = last;
          this.pool.push(p);
          continue;
        }
        if (p.drag < 1) {
          const d = p.drag ** dt;
          p.vx *= d;
          p.vy *= d;
        }
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.angle += p.spin * dt;

        // Clean up non-ring particles that drift far off-screen
        if (p.kind !== P_RING && (p.x < -margin || p.x > width + margin || p.y < -margin || p.y > height + margin)) {
          const last = list.pop();
          if (last !== p) list[i] = last;
          this.pool.push(p);
        }
      }
    }

    clear() {
      while (this.active.length) this.pool.push(this.active.pop());
    }

    draw(ctx) {
      const list = this.active;
      if (!list.length) return;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.lineCap = 'round';
      for (let i = 0; i < list.length; i++) {
        const p = list[i];
        const t = p.life / p.maxLife;
        ctx.globalAlpha = t;
        switch (p.kind) {
          case P_DOT: {
            const s = p.size * (0.4 + 0.6 * t);
            ctx.fillStyle = p.color;
            ctx.fillRect(p.x - s * 0.5, p.y - s * 0.5, s, s);
            break;
          }
          case P_SPARK: {
            ctx.strokeStyle = p.color;
            ctx.lineWidth = p.size;
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(p.x - p.vx * 0.048, p.y - p.vy * 0.048);
            ctx.stroke();
            break;
          }
          case P_SHARD: {
            const hx = Math.cos(p.angle) * p.len * 0.5;
            const hy = Math.sin(p.angle) * p.len * 0.5;
            ctx.strokeStyle = p.color;
            ctx.lineWidth = p.size;
            ctx.beginPath();
            ctx.moveTo(p.x - hx, p.y - hy);
            ctx.lineTo(p.x + hx, p.y + hy);
            ctx.stroke();
            break;
          }
          case P_RING: {
            const eased = 1 - t * t;
            const r = Math.max(0.5, p.size + eased * p.grow);
            ctx.strokeStyle = p.color;
            ctx.lineWidth = 0.7 + 2.8 * t;
            ctx.beginPath();
            ctx.arc(p.x, p.y, r, 0, TAU);
            ctx.stroke();
            break;
          }
          case P_GHOST: {
            ctx.globalAlpha = t * 0.48;
            ctx.strokeStyle = p.color;
            ctx.lineWidth = 1.5;
            ctx.save();
            ctx.translate(p.x, p.y);
            ctx.rotate(p.angle);
            ctx.beginPath();
            traceHull(ctx);
            ctx.stroke();
            ctx.restore();
            break;
          }
          case P_FLASH: {
            const r = p.size * (1.25 - 0.55 * t);
            ctx.globalAlpha = t * 0.55;
            ctx.fillStyle = p.color;
            ctx.beginPath();
            ctx.arc(p.x, p.y, r, 0, TAU);
            ctx.fill();
            break;
          }
          default:
            break;
        }
      }
      ctx.restore();
    }
  }

  // ───────────────────────── Entities ─────────────────────────

  class Ship {
    x = 0;
    y = 0;
    vx = 0;
    vy = 0;
    angle = -Math.PI / 2;
    radius = CFG.ship.radius;
    alive = true;
    thrusting = false;
    turnDir = 0;
    invuln = 0;
    fireTimer = 0;
    dashCooldown = 0;
    dashWasReady = true;
    dashBoost = 0;
    dashInvuln = 0;
    ghostTimer = 0;
    trailAcc = 0;
    rcsAcc = 0;
    shield = false;
    weapon = 'normal';
    weaponTimer = 0;

    constructor(x, y) {
      this.reset(x, y);
    }

    reset(x, y, initialFireDelay = 0) {
      this.x = x;
      this.y = y;
      this.vx = 0;
      this.vy = 0;
      this.angle = -Math.PI / 2;
      this.radius = CFG.ship.radius;
      this.alive = true;
      this.thrusting = false;
      this.turnDir = 0;
      this.invuln = CFG.ship.invulnTime;
      this.fireTimer = initialFireDelay;
      this.dashCooldown = 0;
      this.dashWasReady = true;
      this.dashBoost = 0;
      this.dashInvuln = 0;
      this.ghostTimer = 0;
      this.trailAcc = 0;
      this.rcsAcc = 0;
      this.shield = false;
      this.weapon = 'normal';
      this.weaponTimer = 0;
    }

    get vulnerable() {
      return this.alive && this.invuln <= 0 && this.dashInvuln <= 0;
    }
  }

  class Asteroid {
    hitFlash = 0;

    constructor(x, y, size, vx, vy, variant = 'normal') {
      const tier = TIERS[size];
      this.x = x;
      this.y = y;
      this.vx = vx;
      this.vy = vy;
      this.size = size;
      this.variant = variant;
      this.hp = variant === 'volatile' && size === 3 ? 2 : 1;
      this.maxHp = this.hp;
      this.radius = tier.radius * rand(0.92, 1.08);
      this.rot = rand(0, TAU);
      this.spin = rand(0.25, 1.15) * (Math.random() < 0.5 ? -1 : 1) * (1.5 - size * 0.25);

      const n = variant === 'crystal' ? randInt(7, 9) : randInt(9, 13);
      this.points = new Float32Array(n * 2);
      for (let i = 0; i < n; i++) {
        const ang = (i / n) * TAU + rand(-0.18, 0.18) * (TAU / n);
        const r = this.radius * (variant === 'crystal' ? (i % 2 === 0 ? rand(0.95, 1.12) : rand(0.7, 0.84)) : rand(0.75, 1.1));
        this.points[i * 2] = Math.cos(ang) * r;
        this.points[i * 2 + 1] = Math.sin(ang) * r;
      }

      // Internal crystalline facets (pairs of vertex indices)
      const facetCount = variant === 'crystal' ? 3 : size >= 2 ? 2 : 1;
      this.facets = new Uint8Array(facetCount * 2);
      for (let i = 0; i < facetCount; i++) {
        const a = Math.floor((i * n) / facetCount);
        const b = (a + Math.floor(n / 2) + (i % 2)) % n;
        this.facets[i * 2] = a;
        this.facets[i * 2 + 1] = b;
      }

      const craterCount = variant === 'crystal' ? 0 : size === 1 ? 1 : randInt(1, 3);
      this.craters = new Float32Array(craterCount * 3);
      for (let i = 0; i < craterCount; i++) {
        const ang = rand(0, TAU);
        const d = rand(0.12, 0.46) * this.radius;
        this.craters[i * 3] = Math.cos(ang) * d;
        this.craters[i * 3 + 1] = Math.sin(ang) * d;
        this.craters[i * 3 + 2] = rand(0.1, 0.19) * this.radius;
      }
    }

    get hitRadius() {
      return this.radius * 0.9;
    }

    get color() {
      return VARIANTS[this.variant].color ?? TIERS[this.size].color;
    }

    get glow() {
      return VARIANTS[this.variant].glow ?? TIERS[this.size].glow;
    }
  }

  class Saucer {
    hitFlash = 0;
    warpIn = 0.75;
    bobPhase = rand(0, TAU);
    steerTimer = rand(1.1, 2.4);

    constructor(x, y, dir, kind) {
      this.x = x;
      this.y = y;
      this.dir = dir;
      this.kind = kind; // 'scout' | 'hunter'
      const isHunter = kind === 'hunter';
      this.radius = isHunter ? 17 : 21;
      this.hp = isHunter ? 2 : 1;
      this.points = isHunter ? 500 : 250;
      this.speed = isHunter ? 168 : 122;
      this.vx = dir * this.speed;
      this.vy = rand(-45, 45);
      this.fireTimer = isHunter ? 1.25 : 1.75;
      this.life = 18;
    }
  }

  class PowerUp {
    rot = rand(0, TAU);

    constructor(x, y, kind) {
      const ang = rand(0, TAU);
      const sp = rand(22, 46);
      this.x = x;
      this.y = y;
      this.vx = Math.cos(ang) * sp;
      this.vy = Math.sin(ang) * sp;
      this.kind = kind;
      this.radius = 15;
      this.life = CFG.powerUpLife;
      this.maxLife = CFG.powerUpLife;
    }
  }

  // ───────────────────────── Game ─────────────────────────

  class Game {
    #resizeTimer = 0;
    #dprQuery = null;
    #dprListener = null;

    constructor() {
      this.canvas = byId('game');
      const ctx = this.canvas.getContext('2d', { alpha: false });
      if (!ctx) throw new Error('Canvas 2D context unavailable');
      this.ctx = ctx;

      this.ui = {
        hud: byId('hud'),
        score: byId('hud-score'),
        high: byId('hud-high'),
        combo: byId('hud-combo'),
        comboVal: byId('hud-combo-val'),
        comboMeter: byId('hud-combo-meter'),
        wave: byId('hud-wave'),
        power: byId('hud-power'),
        powerName: byId('hud-power-name'),
        powerMeter: byId('hud-power-meter'),
        livesChip: byId('hud-lives-chip'),
        lives: byId('hud-lives'),
        dash: byId('hud-dash'),
        dashMeter: byId('hud-dash-meter'),
        dashText: byId('hud-dash-text'),
        soundBadge: byId('sound-badge'),
        banner: byId('banner'),
        bannerTitle: byId('banner-title'),
        bannerSub: byId('banner-sub'),
        toast: byId('toast'),
        start: byId('screen-start'),
        startHigh: byId('start-high'),
        pause: byId('screen-pause'),
        pauseScore: byId('pause-score'),
        pauseWave: byId('pause-wave'),
        pauseCombo: byId('pause-combo'),
        over: byId('screen-over'),
        overScore: byId('over-score'),
        overWave: byId('over-wave'),
        overHigh: byId('over-high'),
        overRecord: byId('over-record'),
        overKills: byId('over-kills'),
        overCombo: byId('over-combo'),
        overAcc: byId('over-acc'),
        btnStart: byId('btn-start'),
        btnResume: byId('btn-resume'),
        btnRestart: byId('btn-restart'),
        btnSound: byId('btn-sound'),
        btnPauseMenu: byId('btn-pause-menu'),
        btnAgain: byId('btn-again'),
        btnOverMenu: byId('btn-over-menu'),
      };

      this.input = new Input();
      this.touchControls = new TouchControls(this, this.input);
      this.pixelRatioCap = TouchControls.prefersTouch() ? CFG.touchPixelRatioCap : 2;
      this.audio = new SoundEngine(Store.get(STORAGE_KEYS.mute, '0') === '1');
      this.stars = new Starfield();
      this.particles = new ParticleSystem(CFG.maxParticles);

      this.asteroids = [];
      this.bullets = [];
      this.enemyBullets = [];
      this.saucers = [];
      this.powerUps = [];
      this.floaters = [];
      this.ship = null;

      this.savedHigh = Store.readScore(STORAGE_KEYS.high);
      this.highScore = this.savedHigh;
      this.highAtStart = this.savedHigh;

      this.state = STATE.MENU;
      this.stateTime = 0;
      this.time = 0;
      this.score = 0;
      this.lives = 0;
      this.wave = 0;
      this.speedMul = 1;
      this.nextLifeAt = CFG.extraLifeEvery;
      this.shake = 0;
      this.hitStop = 0;
      this.screenFlash = 0;
      this.screenFlashColor = '#5ff6ff';
      this.chromaPunch = 0;

      // Combo & Run telemetry
      this.comboCount = 0;
      this.comboMult = 1;
      this.comboTimer = 0;
      this.maxCombo = 1;
      this.kills = 0;
      this.shotsFired = 0;
      this.shotsHit = 0;
      this.waveLostLife = false;

      // Timers
      this.respawnTimer = 0;
      this.respawnWait = 0;
      this.gameOverPending = false;
      this.gameOverTimer = 0;
      this.waveClearing = false;
      this.waveTimer = 0;
      this.saucerSpawnTimer = 0;
      this.beatTimer = 0;
      this.beatHigh = false;
      this.bannerTimer = 0;
      this.toastTimer = 0;
      this.hudCache = Object.create(null);

      this.width = 1;
      this.height = 1;
      this.dpr = 1;

      this.lastTime = performance.now();
      this.loopBound = (now) => this.loop(now);

      this.resize(true);
      this.bindEvents();
      this.watchDpr();
      this.updateSoundUi();
      this.ui.startHigh.textContent = this.savedHigh.toLocaleString();
      this.spawnAttract();
      this.setState(STATE.MENU);
      requestAnimationFrame(this.loopBound);
    }

    // ───── Setup & Events ─────

    bindEvents() {
      const onResize = () => {
        this.resize(false);
        globalThis.clearTimeout(this.#resizeTimer);
        this.#resizeTimer = globalThis.setTimeout(() => {
          this.stars.buildNebula(this.width, this.height);
        }, 160);
      };

      globalThis.addEventListener('resize', onResize, { passive: true });
      if (typeof globalThis.ResizeObserver === 'function') {
        const ro = new ResizeObserver(onResize);
        ro.observe(document.documentElement);
      }

      globalThis.addEventListener('keydown', (e) => {
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        this.audio.init();
        if (
          this.state !== STATE.PLAYING
          && CONFIRM_KEYS.has(e.code)
          && document.activeElement instanceof HTMLButtonElement
        ) {
          return;
        }
        if (GAME_KEYS.has(e.code)) e.preventDefault();
        this.input.down.add(e.code);
        if (!e.repeat) this.onKeyPress(e.code);
      });

      globalThis.addEventListener('keyup', (e) => {
        this.input.down.delete(e.code);
      });

      globalThis.addEventListener('pointerdown', () => this.audio.init(), { passive: true });
      // Mobile browsers (notably iOS Safari) only unlock audio on touch release
      globalThis.addEventListener('pointerup', () => this.audio.init(), { passive: true });
      globalThis.addEventListener('touchend', () => this.audio.init(), { passive: true });

      globalThis.addEventListener('blur', () => {
        this.input.clear();
        this.pause();
      });

      document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
          this.input.clear();
          this.pause();
          this.audio.suspend();
        } else {
          this.audio.resumeIfActive();
        }
      });

      globalThis.addEventListener('pagehide', () => this.persistHighScore());

      const onClick = (el, handler) => {
        el.addEventListener('click', (e) => {
          this.audio.init();
          e.currentTarget?.blur?.();
          handler();
        });
      };

      onClick(this.ui.btnStart, () => this.startGame());
      onClick(this.ui.btnResume, () => this.resume());
      onClick(this.ui.btnRestart, () => this.startGame());
      onClick(this.ui.btnSound, () => this.toggleMute());
      onClick(this.ui.soundBadge, () => this.toggleMute());
      onClick(this.ui.btnPauseMenu, () => this.goToMenu());
      onClick(this.ui.btnAgain, () => this.startGame());
      onClick(this.ui.btnOverMenu, () => this.goToMenu());
    }

    watchDpr() {
      if (typeof globalThis.matchMedia !== 'function') return;
      if (this.#dprQuery && this.#dprListener) {
        this.#dprQuery.removeEventListener('change', this.#dprListener);
      }
      const dpr = globalThis.devicePixelRatio ?? 1;
      this.#dprQuery = globalThis.matchMedia(`(resolution: ${dpr}dppx)`);
      this.#dprListener = () => {
        this.resize(false);
        this.watchDpr();
      };
      this.#dprQuery.addEventListener('change', this.#dprListener, { once: true });
    }

    onKeyPress(code) {
      if (code === 'KeyM') {
        this.toggleMute();
        return;
      }
      switch (this.state) {
        case STATE.MENU:
          if (CONFIRM_KEYS.has(code)) this.startGame();
          break;
        case STATE.PLAYING:
          if (code === 'KeyP' || code === 'Escape') this.pause();
          else if (DASH_KEYS.has(code)) this.tryDash(true);
          break;
        case STATE.PAUSED:
          if (code === 'KeyP' || code === 'Escape' || code === 'Enter' || code === 'NumpadEnter') this.resume();
          else if (code === 'KeyR') this.startGame();
          break;
        case STATE.OVER:
          if ((CONFIRM_KEYS.has(code) || code === 'KeyR') && this.stateTime > 0.65) this.startGame();
          else if (code === 'Escape') this.goToMenu();
          break;
        default:
          break;
      }
    }

    resize(rebuildNebula) {
      const cssW = Math.max(320, globalThis.innerWidth);
      const cssH = Math.max(240, globalThis.innerHeight);
      const pixelRatio = clamp(globalThis.devicePixelRatio ?? 1, 1, this.pixelRatioCap);
      // `viewScale` is 1 on desktop; below `minViewSpan` the world is zoomed out to fit.
      const viewScale = Math.min(1, Math.min(cssW, cssH) / CFG.minViewSpan);
      const w = Math.round(cssW / viewScale);
      const h = Math.round(cssH / viewScale);
      // `dpr` is the full render scale (device pixels per world unit), so glow sizes scale with it
      const dpr = pixelRatio * viewScale;
      if (w === this.width && h === this.height && dpr === this.dpr && !rebuildNebula) return;

      this.width = w;
      this.height = h;
      this.dpr = dpr;
      this.canvas.width = Math.round(cssW * pixelRatio);
      this.canvas.height = Math.round(cssH * pixelRatio);
      this.stars.resize(w, h, rebuildNebula);

      const fit = (e) => {
        e.x = wrapCoord(e.x, w);
        e.y = wrapCoord(e.y, h);
      };
      for (const a of this.asteroids) fit(a);
      for (let i = this.bullets.length - 1; i >= 0; i--) {
        const b = this.bullets[i];
        if (b.x < -24 || b.x > w + 24 || b.y < -24 || b.y > h + 24) {
          this.removeBullet(i);
        }
      }
      for (const p of this.powerUps) fit(p);
      if (this.ship) fit(this.ship);
    }

    // ───── State Management ─────

    setState(next) {
      this.state = next;
      this.stateTime = 0;
      const { ui } = this;
      const screens = [
        [ui.start, next === STATE.MENU],
        [ui.pause, next === STATE.PAUSED],
        [ui.over, next === STATE.OVER],
      ];
      for (const [el, active] of screens) {
        el.classList.toggle('active', active);
        el.setAttribute('aria-hidden', active ? 'false' : 'true');
        el.inert = !active;
      }
      ui.hud.classList.toggle('visible', next !== STATE.MENU);
      document.body.dataset.state = next;

      if (next === STATE.PLAYING) {
        const focused = document.activeElement;
        if (focused !== document.body) focused?.blur?.();
        this.audio.resumeIfActive();
      } else {
        this.audio.setThrust(false);
        this.audio.setSaucerHum(false, false);
        this.touchControls.releaseAll();
      }
    }

    resetRun() {
      this.asteroids.length = 0;
      this.bullets.length = 0;
      this.enemyBullets.length = 0;
      this.saucers.length = 0;
      this.powerUps.length = 0;
      this.floaters.length = 0;
      this.particles.clear();

      this.score = 0;
      this.lives = CFG.startLives;
      this.wave = 0;
      this.speedMul = 1;
      this.nextLifeAt = CFG.extraLifeEvery;
      this.shake = 0;
      this.hitStop = 0;
      this.screenFlash = 0;
      this.chromaPunch = 0;

      this.comboCount = 0;
      this.comboMult = 1;
      this.comboTimer = 0;
      this.maxCombo = 1;
      this.kills = 0;
      this.shotsFired = 0;
      this.shotsHit = 0;
      this.waveLostLife = false;

      this.gameOverPending = false;
      this.gameOverTimer = 0;
      this.waveClearing = false;
      this.waveTimer = 0;
      this.saucerSpawnTimer = 0;
      this.beatTimer = 0.85;
      this.beatHigh = false;
      this.respawnTimer = 0;
      this.respawnWait = 0;
      this.hideBanner();
      this.hudCache = Object.create(null);
    }

    startGame() {
      this.audio.init();
      this.persistHighScore();
      this.resetRun();
      this.highAtStart = this.savedHigh;
      this.highScore = this.savedHigh;
      this.ship = new Ship(this.width * 0.5, this.height * 0.5);
      this.ship.fireTimer = 0.22; // prevent accidental stray shot when starting via Spacebar
      this.setState(STATE.PLAYING);
      this.nextWave();
      this.syncHud();
    }

    pause() {
      if (this.state !== STATE.PLAYING) return;
      this.ui.pauseScore.textContent = this.score.toLocaleString();
      this.ui.pauseWave.textContent = String(this.wave);
      this.ui.pauseCombo.textContent = `×${this.comboMult}`;
      this.setState(STATE.PAUSED);
    }

    resume() {
      if (this.state !== STATE.PAUSED) return;
      this.setState(STATE.PLAYING);
    }

    goToMenu() {
      this.persistHighScore();
      this.resetRun();
      this.ui.startHigh.textContent = this.savedHigh.toLocaleString();
      this.spawnAttract();
      this.setState(STATE.MENU);
    }

    gameOver() {
      this.gameOverPending = false;
      this.bullets.length = 0;
      this.enemyBullets.length = 0;
      const isRecord = this.score > this.highAtStart && this.score > 0;
      this.persistHighScore();
      this.hideBanner();
      this.ui.overScore.textContent = this.score.toLocaleString();
      this.ui.overWave.textContent = String(this.wave);
      this.ui.overHigh.textContent = this.savedHigh.toLocaleString();
      this.ui.overKills.textContent = this.kills.toLocaleString();
      this.ui.overCombo.textContent = `×${this.maxCombo}`;
      this.ui.overAcc.textContent = this.shotsFired > 0
        ? `${Math.min(100, Math.round((this.shotsHit / this.shotsFired) * 100))}%`
        : '—';
      this.ui.overRecord.classList.toggle('show', isRecord);
      this.setState(STATE.OVER);
      this.audio.gameOver();
    }

    persistHighScore() {
      if (this.highScore > this.savedHigh) {
        this.savedHigh = Math.min(this.highScore, MAX_SAFE_SCORE);
        Store.set(STORAGE_KEYS.high, this.savedHigh);
      }
    }

    toggleMute() {
      const muted = !this.audio.muted;
      this.audio.setMuted(muted);
      Store.set(STORAGE_KEYS.mute, muted ? '1' : '0');
      this.updateSoundUi();
      this.showToast(muted ? 'Sound muted' : 'Sound on');
      if (!muted) this.audio.uiBlip();
    }

    updateSoundUi() {
      const muted = this.audio.muted;
      this.ui.soundBadge.textContent = muted ? 'Muted · M' : 'Sound on · M';
      this.ui.soundBadge.classList.toggle('muted', muted);
      this.ui.soundBadge.setAttribute('aria-pressed', muted ? 'true' : 'false');
      this.ui.btnSound.textContent = muted ? 'Sound: Off' : 'Sound: On';
    }

    showBanner(title, sub, duration) {
      this.ui.bannerTitle.textContent = title;
      this.ui.bannerSub.textContent = sub;
      this.ui.banner.classList.add('show');
      this.bannerTimer = duration;
    }

    hideBanner() {
      this.bannerTimer = 0;
      this.ui.banner.classList.remove('show');
    }

    showToast(text) {
      this.ui.toast.textContent = text;
      this.ui.toast.classList.add('show');
      globalThis.clearTimeout(this.toastTimer);
      this.toastTimer = globalThis.setTimeout(() => this.ui.toast.classList.remove('show'), 1450);
    }

    // ───── Spawning ─────

    makeAsteroid(x, y, size, speedMul, variant, towardX, towardY) {
      const tier = TIERS[size];
      const speed = rand(tier.speed[0], tier.speed[1]) * speedMul;
      const ang = towardX === undefined
        ? rand(0, TAU)
        : Math.atan2(towardY - y, towardX - x) + rand(-0.55, 0.55);
      return new Asteroid(
        wrapCoord(x, this.width),
        wrapCoord(y, this.height),
        size,
        Math.cos(ang) * speed,
        Math.sin(ang) * speed,
        variant,
      );
    }

    spawnAttract() {
      this.asteroids.length = 0;
      this.bullets.length = 0;
      this.ship = new Ship(this.width * 0.5, this.height * 0.5);
      this.ship.invuln = 0;
      for (let i = 0; i < 8; i++) {
        const p = this.edgeSpawnPoint(this.width * 0.5, this.height * 0.5, 180);
        const size = Math.random() < 0.6 ? 3 : 2;
        const variant = i === 0 ? 'crystal' : i === 1 ? 'volatile' : 'normal';
        this.asteroids.push(this.makeAsteroid(p.x, p.y, size, 0.6, variant));
      }
    }

    edgeSpawnPoint(avoidX, avoidY, minDist) {
      const w = this.width;
      const h = this.height;
      let best = { x: 10, y: 10 };
      let bestDist = -1;
      for (let attempt = 0; attempt < 28; attempt++) {
        const edge = randInt(0, 3);
        const x = edge === 0 ? 4 : edge === 1 ? w - 4 : rand(0, w);
        const y = edge === 2 ? 4 : edge === 3 ? h - 4 : rand(0, h);
        const d = Math.hypot(torusDelta(avoidX, x, w), torusDelta(avoidY, y, h));
        if (d >= minDist) return { x, y };
        if (d > bestDist) {
          bestDist = d;
          best = { x, y };
        }
      }
      return best;
    }

    nextWave() {
      this.wave += 1;
      this.waveLostLife = false;
      this.speedMul = Math.min(1 + (this.wave - 1) * 0.085, 2.15);
      const count = Math.min(3 + this.wave, 11);
      const s = this.ship;
      const ax = s?.alive ? s.x : this.width * 0.5;
      const ay = s?.alive ? s.y : this.height * 0.5;
      const minDist = Math.max(210, Math.min(this.width, this.height) * 0.34);

      const crystalQuota = this.wave >= 2 ? (this.wave >= 5 ? 2 : 1) : 0;
      const volatileQuota = this.wave >= 3 ? Math.min(Math.floor((this.wave - 1) * 0.5), 3) : 0;

      for (let i = 0; i < count; i++) {
        let variant = 'normal';
        if (i < crystalQuota) variant = 'crystal';
        else if (i < crystalQuota + volatileQuota) variant = 'volatile';

        const p = this.edgeSpawnPoint(ax, ay, minDist);
        const rock = this.makeAsteroid(
          p.x,
          p.y,
          3,
          this.speedMul,
          variant,
          rand(this.width * 0.22, this.width * 0.78),
          rand(this.height * 0.22, this.height * 0.78),
        );
        this.asteroids.push(rock);
        const ring = this.particles.spawn(P_RING, rock.x, rock.y, 0, 0, 0.45, 10, rock.color, 1);
        if (ring) ring.grow = rock.radius * 1.1;
      }

      this.saucerSpawnTimer = this.wave >= 2 ? Math.max(7, 16 - this.wave * 1.1) : 999;

      const tags = [];
      if (crystalQuota > 0) tags.push('crystal ore');
      if (volatileQuota > 0) tags.push('volatile cores');
      if (this.wave >= 4) tags.push('hunters active');
      else if (this.wave >= 2) tags.push('scouts detected');
      const sub = tags.length ? `${count} rocks · ${tags.join(' · ')}` : `${count} asteroids inbound`;

      this.showBanner(`WAVE ${this.wave}`, sub, 2.15);
      this.audio.waveStart();
    }

    spawnSaucer() {
      const maxSaucers = this.wave >= 8 ? 2 : 1;
      if (this.saucers.length >= maxSaucers) return;
      const isHunter = this.wave >= 4 && Math.random() < clamp((this.wave - 3) * 0.22, 0.28, 0.72);
      const fromLeft = Math.random() < 0.5;
      const x = fromLeft ? 28 : this.width - 28;
      const y = rand(this.height * 0.14, this.height * 0.86);
      const saucer = new Saucer(x, y, fromLeft ? 1 : -1, isHunter ? 'hunter' : 'scout');
      this.saucers.push(saucer);

      const ringColor = isHunter ? '#ff4f8b' : '#4dffb8';
      const ring = this.particles.spawn(P_RING, x, y, 0, 0, 0.65, 6, ringColor, 1);
      if (ring) ring.grow = 68;
      this.showToast(isHunter ? 'Hunter saucer inbound' : 'Scout saucer inbound');
    }

    spawnPowerUp(x, y, forcedKind) {
      if (this.powerUps.length >= CFG.maxPowerUps) return;
      const pool = ['spread', 'rapid', 'shield', 'nova'];
      const kind = forcedKind ?? pick(pool);
      this.powerUps.push(new PowerUp(x, y, kind));
      const ring = this.particles.spawn(P_RING, x, y, 0, 0, 0.45, 6, POWERUPS[kind].color, 1);
      if (ring) ring.grow = 36;
    }

    // ───── Scoring & Juice ─────

    registerComboKill() {
      this.comboCount += 1;
      this.comboTimer = CFG.comboDuration;
      const prevMult = this.comboMult;
      const nextMult = clamp(1 + Math.floor(this.comboCount / 2.4), 1, CFG.maxComboMult);
      this.comboMult = nextMult;
      if (nextMult > this.maxCombo) this.maxCombo = nextMult;
      if (nextMult > prevMult) this.audio.comboPing(nextMult);
    }

    addScore(basePoints, x, y, color, applyCombo = true) {
      const mult = applyCombo ? this.comboMult : 1;
      const points = Math.round(basePoints * mult);
      this.score = Math.min(this.score + points, MAX_SAFE_SCORE);
      if (this.score > this.highScore) this.highScore = this.score;

      if (x !== undefined) {
        const label = mult > 1 ? `+${points} ×${mult}` : `+${points}`;
        this.addFloater(label, x, y, color ?? '#ffffff');
      }

      while (this.score >= this.nextLifeAt) {
        this.nextLifeAt += CFG.extraLifeEvery;
        if (!this.gameOverPending && this.lives < CFG.maxLives) {
          this.lives += 1;
          this.audio.extraLife();
          this.showToast('Extra hull awarded');
          this.triggerFlash('#5ff6ff', 0.16);
        }
      }
    }

    addFloater(text, x, y, color) {
      if (this.floaters.length >= CFG.maxFloaters) {
        this.floaters[0] = this.floaters[this.floaters.length - 1];
        this.floaters.pop();
      }
      this.floaters.push({ text, x, y, color, life: 0.95, maxLife: 0.95 });
    }

    addShake(amount) {
      const scaled = MotionPref.reduced ? amount * 0.2 : amount;
      this.shake = Math.min(this.shake + scaled, 18);
    }

    triggerHitStop(seconds) {
      if (MotionPref.reduced) return;
      this.hitStop = Math.max(this.hitStop, seconds);
    }

    triggerFlash(color, alpha) {
      if (MotionPref.reduced) return;
      this.screenFlashColor = color;
      this.screenFlash = Math.max(this.screenFlash, alpha);
    }

    // ───── Combat ─────

    fire(playAudio = true) {
      const s = this.ship;
      const c = CFG.ship;
      if (!s) return;

      const isSpread = s.weapon === 'spread';
      const isRapid = s.weapon === 'rapid';
      const speed = c.bulletSpeed;
      const emitters = isSpread
        ? [
          { spread: -0.16, forward: 13, lateral: -8 },
          { spread: 0, forward: 19, lateral: 0 },
          { spread: 0.16, forward: 13, lateral: 8 },
        ]
        : [{ spread: 0, forward: 19, lateral: 0 }];

      // Atomic volley check so Spread Shot never fires uneven partial volleys
      if (this.bullets.length + emitters.length > c.maxBullets) return;

      const color = isSpread ? '#ffd76a' : isRapid ? '#6affc8' : '#fff3a6';
      const glow = isSpread ? '#ff9922' : isRapid ? '#00e68a' : '#ffc933';

      const cos = Math.cos(s.angle);
      const sin = Math.sin(s.angle);
      const perpX = -sin;
      const perpY = cos;
      const rawMx = s.x + cos * 19;
      const rawMy = s.y + sin * 19;
      const wrapOx = rawMx < 0 ? this.width : rawMx >= this.width ? -this.width : 0;
      const wrapOy = rawMy < 0 ? this.height : rawMy >= this.height ? -this.height : 0;
      const mx = rawMx + wrapOx;
      const my = rawMy + wrapOy;

      for (const em of emitters) {
        const a = s.angle + em.spread;
        const bCos = Math.cos(a);
        const bSin = Math.sin(a);
        const bx = s.x + cos * em.forward + perpX * em.lateral + wrapOx;
        const by = s.y + sin * em.forward + perpY * em.lateral + wrapOy;
        this.bullets.push({
          x: bx,
          y: by,
          prevX: bx,
          prevY: by,
          dx: bCos,
          dy: bSin,
          vx: bCos * speed,
          vy: bSin * speed,
          traveled: 0,
          life: c.bulletLife,
          color,
          glow,
        });
        if (this.state === STATE.PLAYING) this.shotsFired += 1;
      }

      s.fireTimer = isRapid ? c.rapidCooldown : c.fireCooldown;
      s.vx -= cos * (isSpread ? 11 : 6);
      s.vy -= sin * (isSpread ? 11 : 6);

      for (let i = 0; i < (isSpread ? 6 : 3); i++) {
        const a = s.angle + rand(-0.55, 0.55);
        const sp = rand(95, 240);
        this.particles.spawn(
          P_SPARK,
          mx,
          my,
          s.vx * 0.5 + Math.cos(a) * sp,
          s.vy * 0.5 + Math.sin(a) * sp,
          rand(0.08, 0.16),
          1.45,
          color,
          0.05,
        );
      }

      if (playAudio) this.audio.laser(s.weapon);
    }

    tryDash(playAudio = true) {
      const s = this.ship;
      if (!s?.alive || s.dashCooldown > 0) return;
      if (this.state !== STATE.PLAYING && this.state !== STATE.MENU) return;

      const d = CFG.dash;
      const cos = Math.cos(s.angle);
      const sin = Math.sin(s.angle);
      s.vx += cos * d.impulse;
      s.vy += sin * d.impulse;
      const dashSp = Math.hypot(s.vx, s.vy);
      if (dashSp > d.maxDashSpeed) {
        s.vx *= d.maxDashSpeed / dashSp;
        s.vy *= d.maxDashSpeed / dashSp;
      }
      s.dashBoost = d.boostTime;
      s.dashInvuln = d.invuln;
      s.dashCooldown = d.cooldown;
      s.dashWasReady = false;
      s.ghostTimer = 0;

      const ring = this.particles.spawn(P_RING, s.x, s.y, 0, 0, 0.48, 8, '#7df9ff', 1);
      if (ring) ring.grow = d.pushRadius;
      this.particles.spawn(P_FLASH, s.x, s.y, 0, 0, 0.16, 26, '#7df9ff', 1);

      for (let i = 0; i < 20; i++) {
        const a = rand(0, TAU);
        const sp = rand(130, 320);
        this.particles.spawn(
          P_SPARK,
          s.x,
          s.y,
          Math.cos(a) * sp,
          Math.sin(a) * sp,
          rand(0.2, 0.42),
          1.6,
          pick(['#7df9ff', '#a98bff', '#ffffff']),
          0.08,
        );
      }

      // Shield burst: shove nearby asteroids outward across toroidal space
      for (const a of this.asteroids) {
        const dx = torusDelta(s.x, a.x, this.width);
        const dy = torusDelta(s.y, a.y, this.height);
        const dist = Math.hypot(dx, dy);
        const reach = d.pushRadius + a.radius;
        if (dist < reach && dist > 0.001) {
          const force = (d.pushForce * (1 - dist / reach)) / Math.sqrt(a.size);
          a.vx += (dx / dist) * force;
          a.vy += (dy / dist) * force;
          const maxSpeed = TIERS[a.size].speed[1] * this.speedMul * 1.85;
          const sp = Math.hypot(a.vx, a.vy);
          if (sp > maxSpeed) {
            a.vx *= maxSpeed / sp;
            a.vy *= maxSpeed / sp;
          }
        }
      }

      // Phase Dash deflects/vaporizes enemy plasma bolts in burst radius
      let deflected = 0;
      for (let i = this.enemyBullets.length - 1; i >= 0; i--) {
        const eb = this.enemyBullets[i];
        const dx = torusDelta(s.x, eb.x, this.width);
        const dy = torusDelta(s.y, eb.y, this.height);
        if (dx * dx + dy * dy < d.pushRadius * d.pushRadius) {
          for (let k = 0; k < 6; k++) {
            const ang = rand(0, TAU);
            const sp = rand(70, 190);
            this.particles.spawn(P_SPARK, eb.x, eb.y, Math.cos(ang) * sp, Math.sin(ang) * sp, 0.25, 1.5, '#7df9ff', 0.12);
          }
          const last = this.enemyBullets.pop();
          if (i < this.enemyBullets.length) this.enemyBullets[i] = last;
          deflected += 1;
        }
      }
      if (deflected > 0 && this.state === STATE.PLAYING) {
        this.addScore(deflected * 35, s.x, s.y - 22, '#7df9ff', false);
        this.addFloater('DEFLECT!', s.x, s.y - 40, '#7df9ff');
      }

      this.addShake(3.2);
      if (playAudio) this.audio.dash();
    }

    triggerNova() {
      const s = this.ship;
      if (!s) return;
      const rad = CFG.novaRadius;
      const r1 = this.particles.spawn(P_RING, s.x, s.y, 0, 0, 0.72, 12, '#ff6fd8', 1);
      if (r1) r1.grow = rad;
      const r2 = this.particles.spawn(P_RING, s.x, s.y, 0, 0, 0.55, 8, '#5ff6ff', 1);
      if (r2) r2.grow = rad * 0.72;
      this.particles.spawn(P_FLASH, s.x, s.y, 0, 0, 0.28, 70, '#ffb8f0', 1);
      this.triggerFlash('#ff8ae6', 0.26);
      this.triggerHitStop(0.032);
      this.addShake(11);

      // Clear all enemy projectiles
      for (const eb of this.enemyBullets) {
        this.particles.spawn(P_SPARK, eb.x, eb.y, rand(-120, 120), rand(-120, 120), 0.3, 1.6, '#ff6fd8', 0.15);
      }
      this.enemyBullets.length = 0;

      // Damage saucers in range
      for (let i = this.saucers.length - 1; i >= 0; i--) {
        const u = this.saucers[i];
        const dx = torusDelta(s.x, u.x, this.width);
        const dy = torusDelta(s.y, u.y, this.height);
        if (Math.hypot(dx, dy) <= rad + u.radius) {
          this.damageSaucer(i, 2, dx * 2, dy * 2);
        }
      }

      // Shatter asteroids in range (iterate snapshot of indices backwards safely)
      const hits = [];
      for (let i = 0; i < this.asteroids.length; i++) {
        const a = this.asteroids[i];
        const dx = torusDelta(s.x, a.x, this.width);
        const dy = torusDelta(s.y, a.y, this.height);
        if (Math.hypot(dx, dy) <= rad + a.radius) {
          hits.push(a);
        }
      }
      for (const target of hits) {
        const idx = this.asteroids.indexOf(target);
        if (idx !== -1) {
          const dx = torusDelta(s.x, target.x, this.width);
          const dy = torusDelta(s.y, target.y, this.height);
          this.destroyAsteroid(idx, dx * 2.5, dy * 2.5, true, 0);
        }
      }
      this.addFloater('NOVA PULSE!', s.x, s.y - 28, '#ff6fd8');
    }

    collectPowerUp(index) {
      const p = this.powerUps[index];
      const last = this.powerUps.pop();
      if (index < this.powerUps.length) this.powerUps[index] = last;

      const s = this.ship;
      if (!s?.alive) return;
      const meta = POWERUPS[p.kind];
      this.audio.powerUp(p.kind);

      for (let i = 0; i < 16; i++) {
        const ang = rand(0, TAU);
        const sp = rand(80, 230);
        this.particles.spawn(P_SPARK, p.x, p.y, Math.cos(ang) * sp, Math.sin(ang) * sp, 0.36, 1.8, meta.color, 0.14);
      }

      if (p.kind === 'spread' || p.kind === 'rapid') {
        s.weapon = p.kind;
        s.weaponTimer = CFG.ship.weaponDuration;
        this.addFloater(meta.label.toUpperCase(), p.x, p.y - 12, meta.color);
        this.showToast(`${meta.label} engaged`);
      } else if (p.kind === 'shield') {
        if (s.shield) {
          this.addScore(500, p.x, p.y - 12, meta.color, false);
          this.showToast('Aegis overcharge +500');
        } else {
          s.shield = true;
          this.addFloater('AEGIS SHIELD', p.x, p.y - 12, meta.color);
          this.showToast('Aegis shield online');
        }
      } else if (p.kind === 'nova') {
        this.triggerNova();
      }
    }

    hitAsteroid(index, impactVx, impactVy, awardScore = true, depth = 0) {
      const a = this.asteroids[index];
      if (!a) return;
      if (a.hp > 1) {
        a.hp -= 1;
        a.hitFlash = 0.18;
        a.vx += impactVx * 0.06;
        a.vy += impactVy * 0.06;
        for (let i = 0; i < 10; i++) {
          const ang = rand(0, TAU);
          const sp = rand(90, 220);
          this.particles.spawn(P_SPARK, a.x, a.y, Math.cos(ang) * sp, Math.sin(ang) * sp, 0.24, 1.5, '#ffe099', 0.1);
        }
        if (awardScore) {
          this.audio.armorHit();
          this.addShake(2.2);
          this.addFloater('CRACKED', a.x, a.y - a.radius * 0.45, '#ffbe6b');
        }
        return;
      }
      this.destroyAsteroid(index, impactVx, impactVy, awardScore, depth);
    }

    destroyAsteroid(index, impactVx, impactVy, awardScore = true, depth = 0) {
      const list = this.asteroids;
      const a = list[index];
      if (!a) return;
      const last = list.pop();
      if (last !== a) list[index] = last;

      const tier = TIERS[a.size];
      const variantMeta = VARIANTS[a.variant];
      const rockColor = a.color;

      if (awardScore && this.state === STATE.PLAYING) {
        this.kills += 1;
        this.registerComboKill();
        this.addScore(Math.round(tier.points * variantMeta.scoreMul), a.x, a.y, rockColor, true);
        this.audio.explosion(a.size, a.variant);
      }

      this.spawnExplosion(a.x, a.y, a.size, a.radius, rockColor, a.vx, a.vy, a.variant);
      this.addShake(a.size * (a.variant === 'volatile' ? 3.2 : 2.1));
      if (a.size === 3 && awardScore) this.triggerHitStop(0.018);

      // Crystal asteroid drops a power-up core
      if (awardScore && this.state === STATE.PLAYING && a.variant === 'crystal' && a.size >= 2) {
        this.spawnPowerUp(a.x, a.y);
      }

      // Split into smaller fragments
      if (a.size > 1) {
        const childSize = a.size - 1;
        const childTier = TIERS[childSize];
        const count = a.size === 3 && this.wave >= 5 && Math.random() < 0.28 ? 3 : 2;
        const base = Math.atan2(a.vy + impactVy * 0.05, a.vx + impactVx * 0.05);
        for (let k = 0; k < count; k++) {
          const ang = base + (k - (count - 1) / 2) * rand(0.7, 1.15) + rand(-0.25, 0.25);
          const speed = rand(childTier.speed[0], childTier.speed[1]) * this.speedMul;
          const off = childTier.radius * 0.55;
          const childVariant = a.variant === 'volatile' && k === 0 && childSize === 2 ? 'volatile' : 'normal';
          list.push(new Asteroid(
            wrapCoord(a.x + Math.cos(ang) * off, this.width),
            wrapCoord(a.y + Math.sin(ang) * off, this.height),
            childSize,
            Math.cos(ang) * speed,
            Math.sin(ang) * speed,
            childVariant,
          ));
        }
      }

      // Volatile chain blast damages nearby rocks & saucers (bounded recursion depth)
      if (a.variant === 'volatile' && depth < 3) {
        const blastR = CFG.volatileBlastRadius * (0.72 + a.size * 0.15);
        const blastRing = this.particles.spawn(P_RING, a.x, a.y, 0, 0, 0.5, 10, '#ff6a3d', 1);
        if (blastRing) blastRing.grow = blastR;
        this.particles.spawn(P_FLASH, a.x, a.y, 0, 0, 0.22, 42, '#ff9642', 1);
        if (awardScore) this.addFloater('CHAIN BLAST!', a.x, a.y - 24, '#ff9642');

        const nearby = [];
        for (let i = 0; i < list.length; i++) {
          const other = list[i];
          const dx = torusDelta(a.x, other.x, this.width);
          const dy = torusDelta(a.y, other.y, this.height);
          if (Math.hypot(dx, dy) < blastR + other.radius) nearby.push(other);
        }
        for (const target of nearby) {
          const idx = list.indexOf(target);
          if (idx !== -1) {
            const dx = torusDelta(a.x, target.x, this.width);
            const dy = torusDelta(a.y, target.y, this.height);
            this.hitAsteroid(idx, dx * 4, dy * 4, awardScore, depth + 1);
          }
        }
      }
    }

    damageSaucer(index, dmg, impactVx, impactVy) {
      const u = this.saucers[index];
      if (!u) return;
      u.hp -= dmg;
      u.hitFlash = 0.16;
      if (u.hp > 0) {
        this.audio.armorHit();
        for (let i = 0; i < 10; i++) {
          const ang = rand(0, TAU);
          const sp = rand(90, 220);
          this.particles.spawn(P_SPARK, u.x, u.y, Math.cos(ang) * sp, Math.sin(ang) * sp, 0.25, 1.5, '#ff85b3', 0.12);
        }
        return;
      }

      const last = this.saucers.pop();
      if (index < this.saucers.length) this.saucers[index] = last;

      const color = u.kind === 'hunter' ? '#ff5f9e' : '#4dffb8';
      this.kills += 1;
      this.registerComboKill();
      this.addScore(u.points, u.x, u.y, color, true);
      this.addFloater(u.kind === 'hunter' ? 'HUNTER DOWN!' : 'SCOUT DOWN!', u.x, u.y - 22, color);
      this.spawnExplosion(u.x, u.y, 2, u.radius * 1.4, color, u.vx + impactVx * 0.08, u.vy + impactVy * 0.08, 'normal');
      this.particles.spawn(P_FLASH, u.x, u.y, 0, 0, 0.24, 46, color, 1);
      this.audio.saucerExplode();
      this.addShake(9);
      this.triggerHitStop(0.03);

      // Hunters always drop a power-up; Scouts have a 45% drop chance
      if (u.kind === 'hunter' || Math.random() < 0.45) {
        this.spawnPowerUp(u.x, u.y);
      }
    }

    spawnExplosion(x, y, size, radius, color, vx, vy, variant) {
      const P = this.particles;
      const count = 9 + size * 9;
      for (let i = 0; i < count; i++) {
        const a = rand(0, TAU);
        const sp = rand(45, 140 + size * 58);
        const kind = Math.random() < 0.52 ? P_DOT : P_SPARK;
        const c = variant === 'volatile' && i % 3 === 0 ? '#ffd26a' : (Math.random() < 0.68 ? color : '#ffffff');
        P.spawn(
          kind,
          x + Math.cos(a) * radius * 0.28,
          y + Math.sin(a) * radius * 0.28,
          vx * 0.3 + Math.cos(a) * sp,
          vy * 0.3 + Math.sin(a) * sp,
          rand(0.35, 0.82 + size * 0.15),
          rand(1.2, 2.9),
          c,
          0.22,
        );
      }

      const shards = 3 + size * 2;
      for (let i = 0; i < shards; i++) {
        const a = rand(0, TAU);
        const sp = rand(35, 120);
        const p = P.spawn(P_SHARD, x, y, vx * 0.4 + Math.cos(a) * sp, vy * 0.4 + Math.sin(a) * sp, rand(0.6, 1.25), 1.45, color, 0.4);
        if (p) {
          p.len = rand(4, 6 + size * 4);
          p.angle = rand(0, TAU);
          p.spin = rand(-7, 7);
        }
      }

      P.spawn(P_FLASH, x, y, vx * 0.15, vy * 0.15, 0.16, radius * 0.75, color, 1);
      const ring = P.spawn(P_RING, x, y, vx * 0.2, vy * 0.2, 0.35 + size * 0.1, radius * 0.3, color, 1);
      if (ring) ring.grow = radius * 1.35;
    }

    hitShip() {
      const s = this.ship;
      if (!s?.vulnerable) return;

      // Aegis Shield absorbs the hit cleanly!
      if (s.shield) {
        s.shield = false;
        s.invuln = 1.45;
        this.audio.shieldAbsorb();
        this.addShake(7.5);
        this.triggerHitStop(0.028);
        this.triggerFlash('#5ff6ff', 0.22);
        this.addFloater('SHIELD SAVED!', s.x, s.y - 26, '#5ff6ff');
        this.showToast('Aegis shield absorbed impact');

        const ring = this.particles.spawn(P_RING, s.x, s.y, 0, 0, 0.58, 14, '#5ff6ff', 1);
        if (ring) ring.grow = 190;
        for (let i = 0; i < 26; i++) {
          const ang = rand(0, TAU);
          const sp = rand(120, 320);
          this.particles.spawn(P_SPARK, s.x, s.y, Math.cos(ang) * sp, Math.sin(ang) * sp, 0.45, 1.8, '#5ff6ff', 0.12);
        }
        // Push nearby hazards away
        for (const a of this.asteroids) {
          const dx = torusDelta(s.x, a.x, this.width);
          const dy = torusDelta(s.y, a.y, this.height);
          const dist = Math.hypot(dx, dy);
          if (dist < 220 && dist > 0.001) {
            const force = 310 * (1 - dist / 220);
            a.vx += (dx / dist) * force;
            a.vy += (dy / dist) * force;
          }
        }
        this.enemyBullets.length = 0;
        return;
      }

      this.killShip();
    }

    killShip() {
      const s = this.ship;
      s.alive = false;
      s.thrusting = false;
      s.weapon = 'normal';
      s.weaponTimer = 0;
      this.waveLostLife = true;
      this.comboCount = 0;
      this.comboMult = 1;
      this.comboTimer = 0;

      this.audio.setThrust(false);
      this.audio.shipExplode();
      this.addShake(15);
      this.triggerHitStop(0.042);
      this.triggerFlash('#ff4d73', 0.28);
      this.chromaPunch = MotionPref.reduced ? 0 : 0.45;

      const P = this.particles;
      for (let i = 0; i < 66; i++) {
        const a = rand(0, TAU);
        const sp = rand(65, 380);
        P.spawn(
          i % 3 === 0 ? P_DOT : P_SPARK,
          s.x,
          s.y,
          s.vx * 0.3 + Math.cos(a) * sp,
          s.vy * 0.3 + Math.sin(a) * sp,
          rand(0.5, 1.35),
          rand(1.4, 3.1),
          pick([SHIP_COLOR, '#ffffff', '#ffb347', '#ff6fd8']),
          0.2,
        );
      }

      // Break hull edges into spinning shards
      const cos = Math.cos(s.angle);
      const sin = Math.sin(s.angle);
      for (let i = 0; i < HULL.length; i += 2) {
        const j = (i + 2) % HULL.length;
        const lx = (HULL[i] + HULL[j]) * 0.5;
        const ly = (HULL[i + 1] + HULL[j + 1]) * 0.5;
        const wx = s.x + lx * cos - ly * sin;
        const wy = s.y + lx * sin + ly * cos;
        const p = P.spawn(P_SHARD, wx, wy, s.vx * 0.4 + (wx - s.x) * 4.5, s.vy * 0.4 + (wy - s.y) * 4.5, rand(1.15, 1.75), 1.8, SHIP_COLOR, 0.45);
        if (p) {
          p.len = Math.hypot(HULL[j] - HULL[i], HULL[j + 1] - HULL[i + 1]);
          p.angle = Math.atan2(HULL[j + 1] - HULL[i + 1], HULL[j] - HULL[i]) + s.angle;
          p.spin = rand(-6, 6);
        }
      }

      const ring = P.spawn(P_RING, s.x, s.y, 0, 0, 0.85, 6, SHIP_COLOR, 1);
      if (ring) ring.grow = 125;

      this.lives -= 1;
      if (this.lives <= 0) {
        this.lives = 0;
        this.gameOverPending = true;
        this.gameOverTimer = 2.25;
      } else {
        this.respawnTimer = CFG.ship.respawnDelay;
        this.respawnWait = 0;
      }
    }

    isAreaClear(x, y, clearance) {
      for (const a of this.asteroids) {
        const r = clearance + a.radius;
        const dx = torusDelta(x, a.x, this.width);
        const dy = torusDelta(y, a.y, this.height);
        if (dx * dx + dy * dy < r * r) return false;
      }
      for (const u of this.saucers) {
        const r = clearance + u.radius;
        const dx = torusDelta(x, u.x, this.width);
        const dy = torusDelta(y, u.y, this.height);
        if (dx * dx + dy * dy < r * r) return false;
      }
      return true;
    }

    respawnShip() {
      this.ship.reset(this.width * 0.5, this.height * 0.5, 0.15);
      const ring = this.particles.spawn(P_RING, this.ship.x, this.ship.y, 0, 0, 0.6, 44, SHIP_COLOR, 1);
      if (ring) ring.grow = -38;
      this.audio.uiBlip();
    }

    // ───── Update Loop ─────

    loop(now) {
      let frameDt = (now - this.lastTime) / 1000;
      this.lastTime = now;
      if (!(frameDt > 0)) frameDt = 0;
      frameDt = Math.min(frameDt, CFG.maxFrameDt);

      const steps = Math.max(1, Math.ceil(frameDt / CFG.maxStep));
      const dt = frameDt / steps;
      for (let i = 0; i < steps; i++) this.update(dt);

      this.render();
      this.syncHud();
      requestAnimationFrame(this.loopBound);
    }

    update(dt) {
      this.stateTime += dt;
      if (this.state === STATE.PAUSED) return;

      if (this.hitStop > 0) {
        this.hitStop = Math.max(0, this.hitStop - dt);
        return;
      }

      this.time += dt;

      const s = this.ship;
      const playing = this.state === STATE.PLAYING;
      const menu = this.state === STATE.MENU;
      const shipLive = (playing || menu) && s?.alive;

      this.stars.update(dt, shipLive ? s.vx : 0, shipLive ? s.vy : 0);
      this.updateAsteroids(dt);

      if (playing) {
        this.updateShip(dt, this.input, true);
        this.updateBullets(dt);
        this.updateEnemyBullets(dt);
        this.updateSaucers(dt);
        this.updatePowerUps(dt);
        this.handleCollisions(true);
        this.updateProgress(dt);
        this.updateComboAndPulse(dt);
      } else if (menu) {
        this.updateAttractPilot(dt);
        this.updateBullets(dt);
        this.handleCollisions(false);
        if (this.asteroids.length < 5) {
          const p = this.edgeSpawnPoint(s?.x ?? this.width * 0.5, s?.y ?? this.height * 0.5, 220);
          const v = Math.random() < 0.16 ? 'crystal' : Math.random() < 0.14 ? 'volatile' : 'normal';
          this.asteroids.push(this.makeAsteroid(p.x, p.y, 3, 0.62, v));
        }
      }

      this.particles.update(dt, this.width, this.height);
      this.updateFloaters(dt);

      if (this.bannerTimer > 0) {
        this.bannerTimer -= dt;
        if (this.bannerTimer <= 0) this.hideBanner();
      }

      this.shake *= Math.exp(-dt * 9.5);
      if (this.shake < 0.05) this.shake = 0;

      if (this.screenFlash > 0) {
        this.screenFlash = Math.max(0, this.screenFlash - dt * 1.4);
      }
      if (this.chromaPunch > 0) {
        this.chromaPunch = Math.max(0, this.chromaPunch - dt * 1.6);
      }
    }

    updateAttractPilot(dt) {
      const s = this.ship;
      if (!s?.alive) return;
      s.invuln = 0;

      // Track nearest direct-line target for aiming and nearest toroidal hazard for evasion
      let aimTarget = null;
      let aimDist = Infinity;
      let threatDist = Infinity;
      let threatRadius = 0;
      for (const a of this.asteroids) {
        const ddx = a.x - s.x;
        const ddy = a.y - s.y;
        const directD = Math.hypot(ddx, ddy);
        if (directD < aimDist) {
          aimDist = directD;
          aimTarget = { a, dx: ddx, dy: ddy, d: directD };
        }
        const td = Math.hypot(torusDelta(s.x, a.x, this.width), torusDelta(s.y, a.y, this.height));
        if (td < threatDist) {
          threatDist = td;
          threatRadius = a.radius;
        }
      }

      const aiCtrl = { left: false, right: false, thrust: false, fire: false };
      if (aimTarget) {
        const leadTime = clamp(aimTarget.d / CFG.ship.bulletSpeed, 0, 0.5);
        const tx = aimTarget.dx + aimTarget.a.vx * leadTime;
        const ty = aimTarget.dy + aimTarget.a.vy * leadTime;
        const targetAng = Math.atan2(ty, tx);
        const diff = angleDiff(s.angle, targetAng);

        if (diff > 0.09) aiCtrl.right = true;
        else if (diff < -0.09) aiCtrl.left = true;

        if (Math.abs(diff) < 0.22 && aimTarget.d < 460) {
          aiCtrl.fire = true;
        }

        if (threatDist < threatRadius + 78 && s.dashCooldown <= 0) {
          this.tryDash(false);
        } else if (aimTarget.d > 260 && Math.abs(diff) < 0.6) {
          aiCtrl.thrust = true;
        } else if (Math.hypot(s.vx, s.vy) < 75) {
          aiCtrl.thrust = true;
        }
      }

      this.updateShip(dt, aiCtrl, false);
    }

    updateShip(dt, ctrl, playAudio) {
      const s = this.ship;
      if (!s?.alive) {
        if (playAudio) this.audio.setThrust(false);
        return;
      }

      const c = CFG.ship;
      const turn = (ctrl.right ? 1 : 0) - (ctrl.left ? 1 : 0);
      s.turnDir = turn;
      s.angle += turn * c.turnSpeed * dt;
      if (s.angle > Math.PI) s.angle -= TAU;
      else if (s.angle < -Math.PI) s.angle += TAU;

      const cos = Math.cos(s.angle);
      const sin = Math.sin(s.angle);
      s.thrusting = ctrl.thrust;

      if (s.thrusting) {
        s.vx += cos * c.thrust * dt;
        s.vy += sin * c.thrust * dt;
        this.emitThrust(s, cos, sin, dt);
      } else {
        s.trailAcc = 0;
      }

      if (turn !== 0) {
        this.emitRcs(s, cos, sin, turn, dt);
      } else {
        s.rcsAcc = 0;
      }

      if (playAudio) this.audio.setThrust(s.thrusting);

      const drag = c.drag ** dt;
      s.vx *= drag;
      s.vy *= drag;

      const speed = Math.hypot(s.vx, s.vy);
      if (speed > c.maxSpeed && s.dashBoost <= 0) {
        const target = c.maxSpeed + (speed - c.maxSpeed) * (0.004 ** dt);
        s.vx *= target / speed;
        s.vy *= target / speed;
      }

      s.x = wrapCoord(s.x + s.vx * dt, this.width);
      s.y = wrapCoord(s.y + s.vy * dt, this.height);

      s.invuln = Math.max(0, s.invuln - dt);
      s.dashInvuln = Math.max(0, s.dashInvuln - dt);
      s.dashCooldown = Math.max(0, s.dashCooldown - dt);
      s.fireTimer = Math.max(0, s.fireTimer - dt);

      if (s.dashCooldown <= 0 && !s.dashWasReady) {
        s.dashWasReady = true;
        if (playAudio) {
          this.audio.dashReady();
          const readyRing = this.particles.spawn(P_RING, s.x, s.y, s.vx * 0.25, s.vy * 0.25, 0.34, 14, '#7df9ff', 1);
          if (readyRing) readyRing.grow = 24;
        }
      }

      if (s.weaponTimer > 0) {
        s.weaponTimer -= dt;
        if (s.weaponTimer <= 0) {
          s.weaponTimer = 0;
          s.weapon = 'normal';
        }
      }

      if (s.dashBoost > 0) {
        s.dashBoost = Math.max(0, s.dashBoost - dt);
        s.ghostTimer -= dt;
        if (s.ghostTimer <= 0) {
          s.ghostTimer = 0.032;
          const g = this.particles.spawn(P_GHOST, s.x, s.y, 0, 0, 0.3, 1, '#7df9ff', 1);
          if (g) g.angle = s.angle;
        }
      }

      if (ctrl.fire && s.fireTimer <= 0) this.fire(playAudio);
    }

    emitThrust(s, cos, sin, dt) {
      s.trailAcc += dt * CFG.ship.trailRate;
      const bx = s.x - cos * 9;
      const by = s.y - sin * 9;
      while (s.trailAcc >= 1) {
        s.trailAcc -= 1;
        const spread = rand(-0.34, 0.34);
        const back = rand(95, 185);
        const ex = Math.cos(s.angle + Math.PI + spread);
        const ey = Math.sin(s.angle + Math.PI + spread);
        this.particles.spawn(
          P_DOT,
          bx + rand(-2, 2),
          by + rand(-2, 2),
          s.vx * 0.7 + ex * back,
          s.vy * 0.7 + ey * back,
          rand(0.2, 0.46),
          rand(1.5, 3.1),
          pick(FLAME_COLORS),
          0.08,
        );
      }
    }

    emitRcs(s, cos, sin, turn, dt) {
      s.rcsAcc += dt * 30;
      while (s.rcsAcc >= 1) {
        s.rcsAcc -= 1;
        // Side thruster puff on nose opposite turn direction
        const side = -turn;
        const nx = s.x + cos * 9 - sin * (side * 4);
        const ny = s.y + sin * 9 + cos * (side * 4);
        const px = -sin * side * rand(50, 95);
        const py = cos * side * rand(50, 95);
        this.particles.spawn(P_DOT, nx, ny, s.vx * 0.6 + px, s.vy * 0.6 + py, 0.14, 1.3, '#aef9ff', 0.15);
      }
    }

    updateBullets(dt) {
      const list = this.bullets;
      const margin = 24;
      const w = this.width;
      const h = this.height;
      const stepDist = CFG.ship.bulletSpeed * dt;
      for (let i = list.length - 1; i >= 0; i--) {
        const b = list[i];
        b.life -= dt;
        b.prevX = b.x;
        b.prevY = b.y;
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        b.traveled += stepDist;
        if (b.life <= 0 || b.x < -margin || b.x > w + margin || b.y < -margin || b.y > h + margin) {
          this.removeBullet(i);
        }
      }
    }

    removeBullet(index) {
      const list = this.bullets;
      const last = list.pop();
      if (index < list.length) list[index] = last;
    }

    updateEnemyBullets(dt) {
      const list = this.enemyBullets;
      const margin = 20;
      for (let i = list.length - 1; i >= 0; i--) {
        const b = list[i];
        b.life -= dt;
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        if (b.life <= 0 || b.x < -margin || b.x > this.width + margin || b.y < -margin || b.y > this.height + margin) {
          const last = list.pop();
          if (i < list.length) list[i] = last;
        }
      }
    }

    updateAsteroids(dt) {
      for (const a of this.asteroids) {
        a.x = wrapCoord(a.x + a.vx * dt, this.width);
        a.y = wrapCoord(a.y + a.vy * dt, this.height);
        a.rot += a.spin * dt;
        if (a.hitFlash > 0) a.hitFlash = Math.max(0, a.hitFlash - dt);
      }
    }

    updateSaucers(dt) {
      const s = this.ship;
      let hasHunter = false;

      for (let i = this.saucers.length - 1; i >= 0; i--) {
        const u = this.saucers[i];
        if (u.kind === 'hunter') hasHunter = true;
        if (u.hitFlash > 0) u.hitFlash = Math.max(0, u.hitFlash - dt);
        u.bobPhase += dt * 4.2;

        if (u.warpIn > 0) {
          u.warpIn = Math.max(0, u.warpIn - dt);
          continue;
        }

        u.life -= dt;
        u.steerTimer -= dt;
        if (u.steerTimer <= 0) {
          u.steerTimer = rand(1.2, 2.5);
          u.vy = rand(-80, 80);
        }

        u.x += u.vx * dt;
        u.y = wrapCoord(u.y + (u.vy + Math.sin(u.bobPhase) * 32) * dt, this.height);

        // Exit off opposite screen edge cleanly
        if (u.life <= 0 || (u.dir > 0 && u.x > this.width + 44) || (u.dir < 0 && u.x < -44)) {
          const last = this.saucers.pop();
          if (i < this.saucers.length) this.saucers[i] = last;
          continue;
        }

        // Fire plasma bolt at player
        u.fireTimer -= dt;
        if (u.fireTimer <= 0 && s?.alive) {
          const isHunter = u.kind === 'hunter';
          u.fireTimer = isHunter ? rand(1.15, 1.65) : rand(1.8, 2.5);
          const dx = torusDelta(u.x, s.x, this.width);
          const dy = torusDelta(u.y, s.y, this.height);
          const bulletSp = isHunter ? 410 : 320;
          const dist = Math.hypot(dx, dy);
          const lead = isHunter ? clamp(dist / bulletSp, 0, 0.6) : 0;
          const aimAng = Math.atan2(dy + s.vy * lead, dx + s.vx * lead) + rand(isHunter ? -0.11 : -0.34, isHunter ? 0.11 : 0.34);

          this.enemyBullets.push({
            x: u.x + Math.cos(aimAng) * (u.radius + 4),
            y: u.y + Math.sin(aimAng) * (u.radius + 4),
            vx: Math.cos(aimAng) * bulletSp,
            vy: Math.sin(aimAng) * bulletSp,
            life: 2.3,
            color: isHunter ? '#ff5f9e' : '#7affc2',
          });
          this.audio.saucerShot(isHunter);
        }
      }

      this.audio.setSaucerHum(this.saucers.length > 0, hasHunter);
    }

    updatePowerUps(dt) {
      const s = this.ship;
      for (let i = this.powerUps.length - 1; i >= 0; i--) {
        const p = this.powerUps[i];
        p.life -= dt;
        if (p.life <= 0) {
          const last = this.powerUps.pop();
          if (i < this.powerUps.length) this.powerUps[i] = last;
          continue;
        }

        p.rot += dt * 1.8;

        // Gentle magnetic pull toward living ship
        if (s?.alive) {
          const dx = torusDelta(p.x, s.x, this.width);
          const dy = torusDelta(p.y, s.y, this.height);
          const dist = Math.hypot(dx, dy);
          if (dist < CFG.powerUpMagnet && dist > 1) {
            const pull = (1 - dist / CFG.powerUpMagnet) * 520;
            p.vx += (dx / dist) * pull * dt;
            p.vy += (dy / dist) * pull * dt;
          }
          if (dist < s.radius + p.radius + 4) {
            this.collectPowerUp(i);
            continue;
          }
        }

        const drag = 0.72 ** dt;
        p.vx *= drag;
        p.vy *= drag;
        p.x = wrapCoord(p.x + p.vx * dt, this.width);
        p.y = wrapCoord(p.y + p.vy * dt, this.height);
      }
    }

    handleCollisions(isPlaying) {
      const rocks = this.asteroids;
      const bullets = this.bullets;
      const w = this.width;
      const h = this.height;

      // Player bullets vs asteroids & saucers (swept segment collision against visible rock copies)
      for (let i = bullets.length - 1; i >= 0; i--) {
        const b = bullets[i];
        let consumed = false;

        for (let j = 0; j < rocks.length; j++) {
          const a = rocks[j];
          const rSq = (a.hitRadius + 2.5) ** 2;
          let hit = false;
          forEachWrapped(a.x, a.y, a.radius + 8, w, h, (ox, oy) => {
            if (!hit && distSqPointToSegment(a.x + ox, a.y + oy, b.prevX, b.prevY, b.x, b.y) < rSq) {
              hit = true;
            }
          });
          if (hit) {
            this.removeBullet(i);
            if (isPlaying) this.shotsHit += 1;
            this.hitAsteroid(j, b.vx, b.vy, isPlaying, 0);
            consumed = true;
            break;
          }
        }
        if (consumed || !isPlaying) continue;

        for (let j = 0; j < this.saucers.length; j++) {
          const u = this.saucers[j];
          if (u.warpIn > 0) continue;
          const rSq = (u.radius + 3) ** 2;
          if (distSqPointToSegment(u.x, u.y, b.prevX, b.prevY, b.x, b.y) < rSq) {
            this.removeBullet(i);
            this.shotsHit += 1;
            this.damageSaucer(j, 1, b.vx, b.vy);
            break;
          }
        }
      }

      if (!isPlaying) return;

      const s = this.ship;
      if (s?.vulnerable) {
        // Ship vs asteroids
        for (let j = 0; j < rocks.length; j++) {
          const a = rocks[j];
          const dx = torusDelta(a.x, s.x, w);
          const dy = torusDelta(a.y, s.y, h);
          const r = s.radius * 0.85 + a.hitRadius * 0.94;
          if (dx * dx + dy * dy < r * r) {
            this.destroyAsteroid(j, s.vx * 4, s.vy * 4, false, 0);
            this.hitShip();
            break;
          }
        }
      }

      if (s?.vulnerable) {
        // Ship vs saucers
        for (let j = 0; j < this.saucers.length; j++) {
          const u = this.saucers[j];
          if (u.warpIn > 0) continue;
          const dx = torusDelta(u.x, s.x, w);
          const dy = torusDelta(u.y, s.y, h);
          const r = s.radius + u.radius * 0.85;
          if (dx * dx + dy * dy < r * r) {
            this.damageSaucer(j, 2, s.vx * 3, s.vy * 3);
            this.hitShip();
            break;
          }
        }
      }

      if (s?.vulnerable) {
        // Ship vs enemy plasma bolts
        for (let i = this.enemyBullets.length - 1; i >= 0; i--) {
          const eb = this.enemyBullets[i];
          const dx = torusDelta(eb.x, s.x, w);
          const dy = torusDelta(eb.y, s.y, h);
          const r = s.radius + 4;
          if (dx * dx + dy * dy < r * r) {
            const last = this.enemyBullets.pop();
            if (i < this.enemyBullets.length) this.enemyBullets[i] = last;
            this.hitShip();
            break;
          }
        }
      }
    }

    updateComboAndPulse(dt) {
      if (this.comboTimer > 0) {
        this.comboTimer -= dt;
        if (this.comboTimer <= 0) {
          this.comboTimer = 0;
          this.comboCount = 0;
          this.comboMult = 1;
        }
      }

      // Subtle arcade tension heartbeat while wave is active
      if (!this.waveClearing && this.asteroids.length > 0 && this.ship?.alive) {
        this.beatTimer -= dt;
        if (this.beatTimer <= 0) {
          const pace = clamp(0.32 + this.asteroids.length * 0.042, 0.34, 0.96);
          this.beatTimer = pace;
          this.beatHigh = !this.beatHigh;
          this.audio.heartbeat(this.beatHigh);
        }
      }
    }

    updateProgress(dt) {
      const s = this.ship;
      if (s && !s.alive) {
        if (this.gameOverPending) {
          this.gameOverTimer -= dt;
          if (this.gameOverTimer <= 0) this.gameOver();
          return;
        }
        this.respawnTimer -= dt;
        if (this.respawnTimer <= 0) {
          this.respawnWait += dt;
          const cx = this.width * 0.5;
          const cy = this.height * 0.5;
          if (this.isAreaClear(cx, cy, CFG.ship.respawnClearance) || this.respawnWait > 2.5) {
            this.respawnShip();
          }
        }
      }

      // Saucer spawning during active waves (Wave 2+)
      if (!this.waveClearing && this.wave >= 2 && this.asteroids.length > 0) {
        this.saucerSpawnTimer -= dt;
        if (this.saucerSpawnTimer <= 0) {
          this.spawnSaucer();
          this.saucerSpawnTimer = Math.max(10, 21 - this.wave * 0.9);
        }
      }

      if (this.waveClearing) {
        this.waveTimer -= dt;
        if (this.waveTimer <= 0) {
          this.waveClearing = false;
          this.nextWave();
        }
      } else if (this.asteroids.length === 0 && this.saucers.length === 0) {
        this.waveClearing = true;
        this.waveTimer = 2.35;
        const baseBonus = 150 * this.wave;
        const flawless = !this.waveLostLife ? 250 * this.wave : 0;
        const totalBonus = baseBonus + flawless;
        this.addScore(totalBonus, undefined, undefined, undefined, false);
        const sub = flawless > 0
          ? `Flawless clear · Bonus +${totalBonus.toLocaleString()}`
          : `Wave bonus +${totalBonus.toLocaleString()}`;
        this.showBanner(`WAVE ${this.wave} CLEARED`, sub, 1.75);
        this.audio.waveClear();
      }
    }

    updateFloaters(dt) {
      const list = this.floaters;
      for (let i = list.length - 1; i >= 0; i--) {
        const f = list[i];
        f.life -= dt;
        if (f.life <= 0) {
          const last = list.pop();
          if (last !== f) list[i] = last;
          continue;
        }
        f.y -= 36 * dt;
      }
    }

    // ───── HUD (Zero Inline Style Mutations) ─────

    syncHud() {
      if (this.state === STATE.MENU) return;
      const ui = this.ui;
      const cache = this.hudCache;

      if (cache.score !== this.score) {
        cache.score = this.score;
        ui.score.textContent = this.score.toLocaleString();
      }
      if (cache.high !== this.highScore) {
        cache.high = this.highScore;
        ui.high.textContent = this.highScore.toLocaleString();
      }
      if (cache.wave !== this.wave) {
        cache.wave = this.wave;
        ui.wave.textContent = String(this.wave);
      }
      if (cache.lives !== this.lives) {
        cache.lives = this.lives;
        ui.lives.textContent = this.lives > 0 ? '▲'.repeat(this.lives) : '—';
      }

      const s = this.ship;
      const shielded = Boolean(s?.shield);
      if (cache.shielded !== shielded) {
        cache.shielded = shielded;
        ui.livesChip.classList.toggle('shielded', shielded);
      }

      // Combo chip
      const comboActive = this.comboMult > 1;
      const comboTier = this.comboMult >= 6 ? '3' : this.comboMult >= 4 ? '2' : '1';
      const comboPct = comboActive ? Math.round((this.comboTimer / CFG.comboDuration) * 100) : 0;
      if (cache.comboActive !== comboActive) {
        cache.comboActive = comboActive;
        ui.combo.classList.toggle('active', comboActive);
      }
      if (cache.comboMult !== this.comboMult) {
        cache.comboMult = this.comboMult;
        ui.comboVal.textContent = `×${this.comboMult}`;
      }
      if (cache.comboTier !== comboTier) {
        cache.comboTier = comboTier;
        ui.combo.dataset.tier = comboTier;
      }
      if (cache.comboPct !== comboPct) {
        cache.comboPct = comboPct;
        ui.comboMeter.value = comboPct;
      }

      // Active weapon power-up chip
      const weapon = s?.weapon ?? 'normal';
      const powerActive = weapon !== 'normal' && (s?.weaponTimer ?? 0) > 0;
      const powerPct = powerActive ? Math.round((s.weaponTimer / CFG.ship.weaponDuration) * 100) : 0;
      if (cache.powerActive !== powerActive || cache.weapon !== weapon) {
        cache.powerActive = powerActive;
        cache.weapon = weapon;
        ui.power.classList.toggle('active', powerActive);
        ui.power.dataset.power = powerActive ? weapon : 'none';
        if (powerActive) ui.powerName.textContent = POWERUPS[weapon].label;
      }
      if (cache.powerPct !== powerPct) {
        cache.powerPct = powerPct;
        ui.powerMeter.value = powerPct;
      }

      // Phase Dash meter (<progress value="0..100">)
      const cooldown = s?.dashCooldown ?? 0;
      const ready = cooldown <= 0;
      const dashPct = Math.round((1 - cooldown / CFG.dash.cooldown) * 100);
      if (cache.dashPct !== dashPct) {
        cache.dashPct = dashPct;
        ui.dashMeter.value = clamp(dashPct, 0, 100);
      }
      const label = ready ? 'Ready' : `${cooldown.toFixed(1)}s`;
      if (cache.dashLabel !== label) {
        cache.dashLabel = label;
        ui.dashText.textContent = label;
      }
      if (cache.dashReady !== ready) {
        cache.dashReady = ready;
        ui.dash.classList.toggle('ready', ready);
        this.touchControls.setDashReady(ready);
      }
    }

    // ───── Render ─────

    render() {
      const ctx = this.ctx;
      const dpr = this.dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      ctx.shadowBlur = 0;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';

      ctx.fillStyle = '#02030b';
      ctx.fillRect(0, 0, this.width, this.height);

      const s = this.ship;
      const warpFactor = s?.alive && s.dashBoost > 0 ? s.dashBoost / CFG.dash.boostTime : 0;
      this.stars.draw(ctx, this.time, s?.vx ?? 0, s?.vy ?? 0, warpFactor);

      ctx.save();
      if (this.shake > 0 && this.state === STATE.PLAYING) {
        const sx = Math.sin(this.time * 91.7) * this.shake;
        const sy = Math.cos(this.time * 117.3) * this.shake;
        ctx.translate(sx, sy);
      }

      this.drawAsteroids(ctx);
      this.drawPowerUps(ctx);
      this.drawSaucers(ctx);
      this.particles.draw(ctx);
      this.drawBullets(ctx);
      this.drawEnemyBullets(ctx);

      if (s?.alive && this.state !== STATE.OVER) {
        this.drawShip(ctx);
      }

      this.drawFloaters(ctx);
      ctx.restore();

      // Subtle screen-wide impact flash (Nova / Shield / Hull hit)
      if (this.screenFlash > 0.005) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = this.screenFlash;
        ctx.fillStyle = this.screenFlashColor;
        ctx.fillRect(0, 0, this.width, this.height);
        ctx.restore();
      }

      // Subtle chromatic vignette punch on hull loss
      if (this.chromaPunch > 0.01) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = this.chromaPunch * 0.32;
        ctx.lineWidth = 6;
        ctx.strokeStyle = '#ff3864';
        ctx.strokeRect(4, 4, this.width - 8, this.height - 8);
        ctx.strokeStyle = '#5ff6ff';
        ctx.strokeRect(10, 10, this.width - 20, this.height - 20);
        ctx.restore();
      }
    }

    traceAsteroidAt(ctx, a, ox, oy) {
      const cos = Math.cos(a.rot);
      const sin = Math.sin(a.rot);
      const pts = a.points;
      const cx = a.x + ox;
      const cy = a.y + oy;
      for (let i = 0; i < pts.length; i += 2) {
        const px = pts[i];
        const py = pts[i + 1];
        const x = cx + px * cos - py * sin;
        const y = cy + px * sin + py * cos;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
    }

    traceAsteroidDetailsAt(ctx, a, ox, oy) {
      const cos = Math.cos(a.rot);
      const sin = Math.sin(a.rot);
      const cx = a.x + ox;
      const cy = a.y + oy;

      // Internal facet lines
      const pts = a.points;
      const f = a.facets;
      for (let i = 0; i < f.length; i += 2) {
        const i1 = f[i] * 2;
        const i2 = f[i + 1] * 2;
        ctx.moveTo(cx + pts[i1] * cos - pts[i1 + 1] * sin, cy + pts[i1] * sin + pts[i1 + 1] * cos);
        ctx.lineTo(cx + pts[i2] * cos - pts[i2 + 1] * sin, cy + pts[i2] * sin + pts[i2 + 1] * cos);
      }

      // Craters
      const c = a.craters;
      for (let i = 0; i < c.length; i += 3) {
        const x = cx + c[i] * cos - c[i + 1] * sin;
        const y = cy + c[i] * sin + c[i + 1] * cos;
        ctx.moveTo(x + c[i + 2], y);
        ctx.arc(x, y, c[i + 2], 0, TAU);
      }
    }

    drawAsteroids(ctx) {
      if (!this.asteroids.length) return;
      const w = this.width;
      const h = this.height;
      const glowScale = this.dpr;

      // Batch normal rocks by size for peak performance; draw special variants individually for distinct glow
      for (let size = 3; size >= 1; size--) {
        const tier = TIERS[size];
        let any = false;
        ctx.beginPath();
        for (const a of this.asteroids) {
          if (a.size !== size || a.variant !== 'normal') continue;
          any = true;
          forEachWrapped(a.x, a.y, a.radius + 8, w, h, (ox, oy) => this.traceAsteroidAt(ctx, a, ox, oy));
        }
        if (!any) continue;

        ctx.shadowBlur = 0;
        ctx.fillStyle = VARIANTS.normal.fill;
        ctx.fill();

        ctx.shadowColor = tier.glow;
        ctx.shadowBlur = 12 * glowScale;
        ctx.strokeStyle = tier.color;
        ctx.lineWidth = 1.9;
        ctx.stroke();

        ctx.shadowBlur = 0;
        ctx.beginPath();
        for (const a of this.asteroids) {
          if (a.size !== size || a.variant !== 'normal') continue;
          forEachWrapped(a.x, a.y, a.radius + 8, w, h, (ox, oy) => this.traceAsteroidDetailsAt(ctx, a, ox, oy));
        }
        ctx.globalAlpha = 0.28;
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      // Special Crystal & Volatile asteroids
      for (const a of this.asteroids) {
        if (a.variant === 'normal') continue;
        const pulse = 0.72 + 0.28 * Math.sin(this.time * (a.variant === 'volatile' ? 9 : 5.5) + a.rot);
        const flashing = a.hitFlash > 0;
        const stroke = flashing ? '#ffffff' : a.color;

        ctx.beginPath();
        forEachWrapped(a.x, a.y, a.radius + 8, w, h, (ox, oy) => this.traceAsteroidAt(ctx, a, ox, oy));
        ctx.shadowBlur = 0;
        ctx.fillStyle = flashing ? 'rgba(255, 220, 180, 0.35)' : VARIANTS[a.variant].fill;
        ctx.fill();

        ctx.shadowColor = a.glow;
        ctx.shadowBlur = (13 + 6 * pulse) * glowScale;
        ctx.strokeStyle = stroke;
        ctx.lineWidth = a.hp > 1 ? 2.6 : 2.0;
        ctx.stroke();

        // Inner facets + glowing volatile core
        ctx.shadowBlur = 0;
        ctx.beginPath();
        forEachWrapped(a.x, a.y, a.radius + 8, w, h, (ox, oy) => this.traceAsteroidDetailsAt(ctx, a, ox, oy));
        ctx.globalAlpha = a.variant === 'crystal' ? 0.55 : 0.38;
        ctx.lineWidth = 1.1;
        ctx.stroke();
        ctx.globalAlpha = 1;

        if (a.variant === 'volatile') {
          forEachWrapped(a.x, a.y, a.radius + 8, w, h, (ox, oy) => {
            ctx.fillStyle = a.hp === 1 ? '#ff3d57' : '#ff9642';
            ctx.globalAlpha = 0.45 + 0.4 * pulse;
            ctx.beginPath();
            ctx.arc(a.x + ox, a.y + oy, a.radius * (0.18 + 0.06 * pulse), 0, TAU);
            ctx.fill();
          });
          ctx.globalAlpha = 1;
        }
      }
    }

    drawPowerUps(ctx) {
      if (!this.powerUps.length) return;
      const w = this.width;
      const h = this.height;
      const dpr = this.dpr;

      ctx.font = '700 11px ui-monospace, "Cascadia Mono", Consolas, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      for (const p of this.powerUps) {
        const meta = POWERUPS[p.kind];
        const frac = p.life / p.maxLife;
        const blink = p.life < 2.8 && Math.floor(this.time * 12) % 2 === 0 ? 0.45 : 1;
        const pulse = 1 + 0.08 * Math.sin(this.time * 7 + p.rot);

        forEachWrapped(p.x, p.y, 26, w, h, (ox, oy) => {
          const cx = p.x + ox;
          const cy = p.y + oy;

          ctx.save();
          ctx.translate(cx, cy);
          ctx.globalAlpha = blink;

          // Remaining lifetime arc
          ctx.strokeStyle = meta.color;
          ctx.globalAlpha = blink * 0.45;
          ctx.lineWidth = 1.6;
          ctx.beginPath();
          ctx.arc(0, 0, 18.5, -Math.PI / 2, -Math.PI / 2 + TAU * frac);
          ctx.stroke();

          // Rotating neon hexagon core
          ctx.save();
          ctx.rotate(p.rot);
          ctx.scale(pulse, pulse);
          ctx.beginPath();
          for (let i = 0; i < 6; i++) {
            const ang = (i / 6) * TAU;
            const px = Math.cos(ang) * 12;
            const py = Math.sin(ang) * 12;
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          }
          ctx.closePath();
          ctx.globalAlpha = blink;
          ctx.fillStyle = 'rgba(6, 12, 28, 0.88)';
          ctx.fill();
          ctx.shadowColor = meta.glow;
          ctx.shadowBlur = 14 * dpr;
          ctx.strokeStyle = meta.color;
          ctx.lineWidth = 1.9;
          ctx.stroke();
          ctx.restore();

          ctx.shadowBlur = 0;
          ctx.fillStyle = meta.color;
          ctx.globalAlpha = blink;
          ctx.fillText(meta.glyph, 0, 0.5);
          ctx.restore();
        });
      }
      ctx.globalAlpha = 1;
    }

    drawSaucers(ctx) {
      if (!this.saucers.length) return;
      const dpr = this.dpr;

      for (const u of this.saucers) {
        const isHunter = u.kind === 'hunter';
        const color = u.hitFlash > 0 ? '#ffffff' : (isHunter ? '#ff5f9e' : '#4dffb8');
        const glow = isHunter ? '#ff2970' : '#00e68a';
        const scale = u.warpIn > 0 ? 1 - u.warpIn * 0.7 : 1;

        ctx.save();
        ctx.translate(u.x, u.y);
        ctx.scale(scale, scale);
        ctx.globalAlpha = u.warpIn > 0 ? 1 - u.warpIn * 0.75 : 1;

        const r = u.radius;
        // Saucer body hull
        ctx.beginPath();
        if (isHunter) {
          ctx.moveTo(-r, 0);
          ctx.lineTo(-r * 0.45, -r * 0.52);
          ctx.lineTo(r * 0.45, -r * 0.52);
          ctx.lineTo(r, 0);
          ctx.lineTo(r * 0.55, r * 0.48);
          ctx.lineTo(-r * 0.55, r * 0.48);
          ctx.closePath();
        } else {
          ctx.moveTo(-r, 1);
          ctx.lineTo(-r * 0.48, -r * 0.36);
          ctx.lineTo(r * 0.48, -r * 0.36);
          ctx.lineTo(r, 1);
          ctx.lineTo(r * 0.52, r * 0.44);
          ctx.lineTo(-r * 0.52, r * 0.44);
          ctx.closePath();
        }

        ctx.fillStyle = 'rgba(10, 12, 30, 0.9)';
        ctx.fill();
        ctx.shadowColor = glow;
        ctx.shadowBlur = 16 * dpr;
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.stroke();

        // Dome & midline
        ctx.shadowBlur = 0;
        ctx.beginPath();
        ctx.moveTo(-r * 0.9, 1);
        ctx.lineTo(r * 0.9, 1);
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(0, -r * 0.34, r * 0.32, Math.PI, 0);
        ctx.stroke();

        // Animated running lights
        const lightCount = 3;
        for (let i = 0; i < lightCount; i++) {
          const lx = (i - 1) * r * 0.44;
          const lit = Math.floor(this.time * 8 + i) % lightCount === 0;
          ctx.fillStyle = lit ? '#ffffff' : color;
          ctx.globalAlpha = lit ? 1 : 0.45;
          ctx.beginPath();
          ctx.arc(lx, 1, 1.9, 0, TAU);
          ctx.fill();
        }

        ctx.restore();
      }
      ctx.globalAlpha = 1;
    }

    drawBullets(ctx) {
      if (!this.bullets.length) return;
      const dpr = this.dpr;
      ctx.save();
      for (const b of this.bullets) {
        const len = Math.min(15, Math.max(4, b.traveled));
        const tx = b.x - b.dx * len;
        const ty = b.y - b.dy * len;

        ctx.shadowColor = b.glow;
        ctx.shadowBlur = 11 * dpr;
        ctx.strokeStyle = b.color;
        ctx.lineWidth = 3.1;
        ctx.beginPath();
        ctx.moveTo(tx, ty);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();

        ctx.shadowBlur = 0;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.3;
        ctx.beginPath();
        ctx.moveTo(b.x - b.dx * (len * 0.6), b.y - b.dy * (len * 0.6));
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
      ctx.restore();
    }

    drawEnemyBullets(ctx) {
      if (!this.enemyBullets.length) return;
      const dpr = this.dpr;
      for (const b of this.enemyBullets) {
        ctx.shadowColor = b.color;
        ctx.shadowBlur = 12 * dpr;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(b.x, b.y, 3.2, 0, TAU);
        ctx.fill();
        ctx.strokeStyle = b.color;
        ctx.lineWidth = 1.8;
        ctx.stroke();
      }
      ctx.shadowBlur = 0;
    }

    drawShip(ctx) {
      const s = this.ship;
      const w = this.width;
      const h = this.height;
      const dpr = this.dpr;
      const blinkOff = s.invuln > 0 && Math.floor(s.invuln * 10) % 2 === 1;

      // Deterministic flame length tied to `this.time` so pausing freezes the flame cleanly
      const flameLen = 13 + 5.5 * Math.sin(this.time * 68) + 3.5 * Math.cos(this.time * 119);
      const weaponAccent = s.weapon === 'spread' ? '#ffd76a' : s.weapon === 'rapid' ? '#4dffb8' : SHIP_COLOR;

      forEachWrapped(s.x, s.y, 34, w, h, (ox, oy) => {
        ctx.save();
        ctx.translate(s.x + ox, s.y + oy);

        // Shield / Invulnerability halo
        if (s.shield || s.invuln > 0 || s.dashInvuln > 0) {
          const pulse = 0.5 + 0.5 * Math.sin(this.time * 9);
          const isDash = s.dashInvuln > 0;
          const isAegis = s.shield && !isDash;
          ctx.globalAlpha = isDash ? 0.68 : isAegis ? 0.42 + 0.2 * pulse : 0.18 + 0.22 * pulse;
          ctx.strokeStyle = isDash ? '#d2c2ff' : SHIP_COLOR;
          ctx.lineWidth = isAegis ? 1.7 : 1.25;
          ctx.shadowColor = SHIP_GLOW;
          ctx.shadowBlur = 11 * dpr;

          if (isAegis) {
            // Hexagonal Aegis Energy Shield
            ctx.save();
            ctx.rotate(this.time * 0.8);
            ctx.beginPath();
            const rad = 24 + pulse * 1.5;
            for (let i = 0; i < 6; i++) {
              const ang = (i / 6) * TAU;
              const px = Math.cos(ang) * rad;
              const py = Math.sin(ang) * rad;
              if (i === 0) ctx.moveTo(px, py);
              else ctx.lineTo(px, py);
            }
            ctx.closePath();
            ctx.stroke();
            ctx.restore();
          } else {
            ctx.beginPath();
            ctx.arc(0, 0, 22 + pulse * 2, 0, TAU);
            ctx.stroke();
          }
        }

        ctx.rotate(s.angle);
        ctx.globalAlpha = blinkOff ? 0.24 : 1;

        // Twin-core plasma thruster plume
        if (s.thrusting) {
          ctx.shadowColor = '#ff3d7f';
          ctx.shadowBlur = 15 * dpr;
          ctx.strokeStyle = '#ff8a3d';
          ctx.lineWidth = 2.1;
          ctx.beginPath();
          ctx.moveTo(-8, -4.8);
          ctx.lineTo(-9 - flameLen, 0);
          ctx.lineTo(-8, 4.8);
          ctx.stroke();

          ctx.strokeStyle = '#fff0b3';
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          ctx.moveTo(-8, -2.3);
          ctx.lineTo(-9 - flameLen * 0.56, 0);
          ctx.lineTo(-8, 2.3);
          ctx.stroke();
        }

        // Main starfighter hull
        ctx.beginPath();
        traceHull(ctx);
        ctx.shadowBlur = 0;
        ctx.fillStyle = 'rgba(4, 18, 32, 0.92)';
        ctx.fill();

        ctx.shadowColor = s.weapon !== 'normal' ? weaponAccent : SHIP_GLOW;
        ctx.shadowBlur = 16 * dpr;
        ctx.strokeStyle = s.dashInvuln > 0 ? '#e5dcff' : weaponAccent;
        ctx.lineWidth = 2.05;
        ctx.stroke();

        // Inner wing detail lines
        ctx.shadowBlur = 0;
        ctx.globalAlpha *= 0.55;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(4, 4.2);
        ctx.lineTo(-6, 7.6);
        ctx.moveTo(4, -4.2);
        ctx.lineTo(-6, -7.6);
        ctx.stroke();

        // Cockpit canopy
        ctx.globalAlpha = blinkOff ? 0.2 : 0.85;
        ctx.fillStyle = '#d4feff';
        ctx.beginPath();
        ctx.moveTo(10, 0);
        ctx.lineTo(0, -3);
        ctx.lineTo(-2, 0);
        ctx.lineTo(0, 3);
        ctx.closePath();
        ctx.fill();

        ctx.restore();
      });
    }

    drawFloaters(ctx) {
      if (!this.floaters.length) return;
      ctx.font = '700 13px ui-monospace, "Cascadia Mono", Consolas, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (const f of this.floaters) {
        ctx.globalAlpha = Math.min(1, (f.life / f.maxLife) * 1.65);
        ctx.fillStyle = f.color;
        ctx.fillText(f.text, f.x, f.y);
      }
      ctx.globalAlpha = 1;
    }
  }

  // ───────────────────────── Boot ─────────────────────────

  const boot = () => {
    const game = new Game();
    void game;
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
