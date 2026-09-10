// ==UserScript==
// @name         Ultimate Audio Enhancer
// @name:de      Ultimate Audio Enhancer (Echtzeit-Audio-Verbesserung)
// @namespace    https://github.com/nextscript
// @author       Freak288
// @version      1.0.0
// @description  Real-time audio enhancement for HTML5 video and audio
// @description:de Echtzeit-Audio-Verbesserung für HTML5-Video und Audio
// @match        *://*/*
// @run-at       document-start
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @connect      raw.githubusercontent.com
// @connect      github.com
// @connect      api.github.com
// @iconURL      https://raw.githubusercontent.com/nextscript/Ultimate-Audio-Enhancer/refs/heads/main/logo.png
// @downloadURL https://update.greasyfork.org/scripts/595277/Ultimate%20Audio%20Enhancer.user.js
// @updateURL https://update.greasyfork.org/scripts/595277/Ultimate%20Audio%20Enhancer.meta.js
// ==/UserScript==

'use strict';

(function () {
  // ============================================================================
  // 1. Configuration
  // ============================================================================
  const VERSION = '1.0.0';
  const AUTOEQ_BASE = 'https://raw.githubusercontent.com/nextscript/AutoEq/master/results/';
  const AUTOEQ_INDEX_URL = AUTOEQ_BASE + 'INDEX.md';
  const EXPORT_FILENAME = 'ultimate-audio-enhancer-config.json';

  // ============================================================================
  // 2. Constants
  // ============================================================================
  const EQ_BANDS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
  const EQ_Q = 0.9;
  const EQ_GAIN_MIN = -15;
  const EQ_GAIN_MAX = 15;
  const DB_TIME_CONSTANT = 0.02;
  const PARAM_TIME_CONSTANT = 0.05;
  const LIMITER = { knee: 0, ratio: 20 };

  const DFX_PRESETS = {
    Balanced:    { dfxFidelity: 3, dfxAmbience: 1, dfxSurround: 1, dfxDynamicBoost: 2, dfxHyperBass: 2 },
    Music:       { dfxFidelity: 4, dfxAmbience: 2, dfxSurround: 2, dfxDynamicBoost: 3, dfxHyperBass: 3 },
    Cinema:      { dfxFidelity: 3, dfxAmbience: 3, dfxSurround: 4, dfxDynamicBoost: 4, dfxHyperBass: 3 },
    Gaming:      { dfxFidelity: 4, dfxAmbience: 1, dfxSurround: 4, dfxDynamicBoost: 3, dfxHyperBass: 2 },
    'Vocal Clear': { dfxFidelity: 5, dfxAmbience: 1, dfxSurround: 0, dfxDynamicBoost: 2, dfxHyperBass: 1 },
    'Bass Boost':  { dfxFidelity: 3, dfxAmbience: 1, dfxSurround: 1, dfxDynamicBoost: 3, dfxHyperBass: 5 },
    Live:        { dfxFidelity: 3, dfxAmbience: 4, dfxSurround: 3, dfxDynamicBoost: 3, dfxHyperBass: 2 },
    Night:       { dfxFidelity: 4, dfxAmbience: 1, dfxSurround: 1, dfxDynamicBoost: 1, dfxHyperBass: 1 },
    Power:       { dfxFidelity: 4, dfxAmbience: 2, dfxSurround: 3, dfxDynamicBoost: 5, dfxHyperBass: 4 },
    Natural:     { dfxFidelity: 4, dfxAmbience: 1, dfxSurround: 0, dfxDynamicBoost: 1, dfxHyperBass: 1 }
  };

  const AUTOEQ_TYPE_MAP = { PK: 'peaking', LSC: 'lowshelf', HSC: 'highshelf' };

  const KEYS = {
    settings: 'uae_settings',
    ui: 'uae_ui',
    autoeqIndex: 'uae_autoeq_index',
    autoeqSelected: 'uae_autoeq_selected',
    autoeqCache: 'uae_autoeq_cache'
  };

  // ============================================================================
  // 3. Default Settings
  // ============================================================================
  function defaultSettings() {
    return {
      enabled: true,
      equalizer: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      bassBoost: 0,
      trebleBoost: 0,
      volumeBoost: 100,
      dfxPreset: 'Balanced',
      dfxFidelity: 3,
      dfxAmbience: 1,
      dfxSurround: 1,
      dfxDynamicBoost: 2,
      dfxHyperBass: 2,
      highPass: false,
      highPassFreq: 80,
      lowPass: false,
      lowPassFreq: 16000,
      limiter: true,
      limiterThreshold: -1,
      limiterRelease: 100,
      limiterAttack: 5,
      limiterCeiling: -0.5,
      limiterLookahead: 5,
      _lastBass: 30,
      _lastTreble: 20
    };
  }

  function neutralSettings() {
    const s = defaultSettings();
    s.enabled = false;
    s.dfxPreset = 'Custom';
    s.dfxFidelity = 0;
    s.dfxAmbience = 0;
    s.dfxSurround = 0;
    s.dfxDynamicBoost = 0;
    s.dfxHyperBass = 0;
    s.limiter = false;
    return s;
  }

  // ============================================================================
  // 4. Storage
  // ============================================================================
  const Storage = {
    gm: typeof GM_getValue === 'function' && typeof GM_setValue === 'function',
    get(key, fallback) {
      try {
        if (this.gm) {
          const v = GM_getValue(key, undefined);
          return v === undefined ? fallback : v;
        }
        const raw = localStorage.getItem(key);
        return raw === null ? fallback : JSON.parse(raw);
      } catch (_) {
        return fallback;
      }
    },
    set(key, value) {
      try {
        if (this.gm) {
          GM_setValue(key, value);
        } else {
          localStorage.setItem(key, JSON.stringify(value));
        }
      } catch (_) {}
    },
    del(key) {
      try {
        if (this.gm) { GM_setValue(key, ''); } else { localStorage.removeItem(key); }
      } catch (_) {}
    }
  };

  // ============================================================================
  // 5. Settings helpers (validation / sanitizing)
  // ============================================================================
  function clampNum(v, min, max) {
    return typeof v === 'number' && isFinite(v) ? Math.min(max, Math.max(min, v)) : null;
  }

  function sanitizeEq(value, fallback) {
    if (Array.isArray(value) && value.length === EQ_BANDS.length) {
      return value.map((v, i) => {
        const n = clampNum(v, EQ_GAIN_MIN, EQ_GAIN_MAX);
        return n === null ? (fallback ? fallback[i] : 0) : n;
      });
    }
    if (value && typeof value === 'object') {
      // imported object form: { 31: 2, 62: 3, ... }
      const out = (fallback || defaultSettings().equalizer).slice();
      for (let i = 0; i < EQ_BANDS.length; i++) {
        const v = value[String(EQ_BANDS[i])];
        const n = clampNum(v, EQ_GAIN_MIN, EQ_GAIN_MAX);
        if (n !== null) out[i] = n;
      }
      return out;
    }
    return fallback || defaultSettings().equalizer;
  }

  function dfxPresetMatches(name, s) {
    const p = DFX_PRESETS[name];
    return !!p &&
      s.dfxFidelity === p.dfxFidelity &&
      s.dfxAmbience === p.dfxAmbience &&
      s.dfxSurround === p.dfxSurround &&
      s.dfxDynamicBoost === p.dfxDynamicBoost &&
      s.dfxHyperBass === p.dfxHyperBass;
  }

  function sanitizeSettings(s) {
    const d = defaultSettings();
    if (!s || typeof s !== 'object') s = {};
    const out = {};
    out.enabled = typeof s.enabled === 'boolean' ? s.enabled : d.enabled;
    out.equalizer = sanitizeEq(s.equalizer, d.equalizer);
    out.bassBoost = clampNum(s.bassBoost, 0, 100); if (out.bassBoost === null) out.bassBoost = d.bassBoost;
    out.trebleBoost = clampNum(s.trebleBoost, 0, 100); if (out.trebleBoost === null) out.trebleBoost = d.trebleBoost;
    out.volumeBoost = clampNum(s.volumeBoost, 25, 300); if (out.volumeBoost === null) out.volumeBoost = d.volumeBoost;
    out.dfxPreset = typeof s.dfxPreset === 'string' && (s.dfxPreset === 'Custom' || DFX_PRESETS[s.dfxPreset]) ? s.dfxPreset : d.dfxPreset;
    out.dfxFidelity = clampNum(s.dfxFidelity, 0, 10); if (out.dfxFidelity === null) out.dfxFidelity = d.dfxFidelity;
    out.dfxAmbience = clampNum(s.dfxAmbience, 0, 10); if (out.dfxAmbience === null) out.dfxAmbience = d.dfxAmbience;
    out.dfxSurround = clampNum(s.dfxSurround, 0, 10); if (out.dfxSurround === null) out.dfxSurround = d.dfxSurround;
    out.dfxDynamicBoost = clampNum(s.dfxDynamicBoost, 0, 10); if (out.dfxDynamicBoost === null) out.dfxDynamicBoost = d.dfxDynamicBoost;
    out.dfxHyperBass = clampNum(s.dfxHyperBass, 0, 10); if (out.dfxHyperBass === null) out.dfxHyperBass = d.dfxHyperBass;
    if (out.dfxPreset !== 'Custom' && !dfxPresetMatches(out.dfxPreset, out)) out.dfxPreset = 'Custom';
    out.highPass = typeof s.highPass === 'boolean' ? s.highPass : d.highPass;
    out.highPassFreq = clampNum(s.highPassFreq, 20, 500); if (out.highPassFreq === null) out.highPassFreq = d.highPassFreq;
    out.lowPass = typeof s.lowPass === 'boolean' ? s.lowPass : d.lowPass;
    out.lowPassFreq = clampNum(s.lowPassFreq, 1000, 20000); if (out.lowPassFreq === null) out.lowPassFreq = d.lowPassFreq;
    out.limiter = typeof s.limiter === 'boolean' ? s.limiter : d.limiter;
    out.limiterThreshold = clampNum(s.limiterThreshold, -20, 0); if (out.limiterThreshold === null) out.limiterThreshold = d.limiterThreshold;
    out.limiterRelease = clampNum(s.limiterRelease, 10, 1000); if (out.limiterRelease === null) out.limiterRelease = d.limiterRelease;
    out.limiterAttack = clampNum(s.limiterAttack, 0.1, 100); if (out.limiterAttack === null) out.limiterAttack = d.limiterAttack;
    out.limiterCeiling = clampNum(s.limiterCeiling, -6, 0); if (out.limiterCeiling === null) out.limiterCeiling = d.limiterCeiling;
    out.limiterLookahead = clampNum(s.limiterLookahead, 0, 20); if (out.limiterLookahead === null) out.limiterLookahead = d.limiterLookahead;
    out._lastBass = clampNum(s._lastBass, 0, 100); if (out._lastBass === null) out._lastBass = d._lastBass;
    out._lastTreble = clampNum(s._lastTreble, 0, 100); if (out._lastTreble === null) out._lastTreble = d._lastTreble;
    return out;
  }

  // ============================================================================
  // 6. State
  // ============================================================================
  let settings = sanitizeSettings(Storage.get(KEYS.settings, null)) || defaultSettings();
  let uiState = Storage.get(KEYS.ui, null) || {};
  if (typeof uiState !== 'object' || uiState === null) uiState = {};

  let persistTimer = null;
  function persistSettings() {
    clearTimeout(persistTimer);
    persistTimer = setTimeout(function () { Storage.set(KEYS.settings, settings); }, 400);
  }
  function persistSettingsNow() {
    clearTimeout(persistTimer);
    Storage.set(KEYS.settings, settings);
  }
  function persistUI() { Storage.set(KEYS.ui, uiState); }

  // ============================================================================
  // 7. Audio Engine
  // ============================================================================
  function db2gain(db) { return Math.pow(10, db / 20); }

  const Engine = {
    ctx: null,
    nodes: null,
    gestureBound: false,

    ensure() {
      if (this.ctx) {
        if (this.ctx.state === 'suspended') {
          try { this.ctx.resume().catch(function () {}); } catch (_) {}
        }
        return this.ctx;
      }
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (typeof AC !== 'function') return null;
        this.ctx = new AC();
        this.nodes = this.buildGraph();
        this.ctx.onstatechange = function () {
          UI.updateStatus();
          if (Engine.ctx.state === 'suspended') Engine.ensure();
          Engine.probeParams();
        };
        if (!this.gestureBound) {
          this.gestureBound = true;
          const resume = function () { Engine.ensure(); };
          document.addEventListener('pointerdown', resume, true);
          document.addEventListener('keydown', resume, true);
        }
        this.apply(settings, false);
        UI.updateStatus();
        return this.ctx;
      } catch (e) {
        this.ctx = null;
        this.nodes = null;
        console.warn('[UAE] AudioContext unavailable:', e && e.message);
        return null;
      }
    },

    buildGraph() {
      const ctx = this.ctx;
      const N = {};
      N.input = ctx.createGain();
      N.volume = ctx.createGain();
      N.autoeqIn = ctx.createGain();
      this.autoeqFilters = [];
      this.autoeqData = null;
      N.autoeqOut = ctx.createGain();
      N.hp = ctx.createBiquadFilter(); N.hp.type = 'highpass';
      N.lp = ctx.createBiquadFilter(); N.lp.type = 'lowpass';
      N.eq = EQ_BANDS.map(function (f) {
        const b = ctx.createBiquadFilter();
        b.type = 'peaking';
        b.frequency.value = f;
        b.Q.value = EQ_Q;
        b.gain.value = 0;
        return b;
      });
      N.bass = ctx.createBiquadFilter(); N.bass.type = 'lowshelf'; N.bass.frequency.value = 250; N.bass.Q.value = 0.707;
      N.treble = ctx.createBiquadFilter(); N.treble.type = 'highshelf'; N.treble.frequency.value = 2000; N.treble.Q.value = 0.707;
      N.dfxFidelity = ctx.createBiquadFilter(); N.dfxFidelity.type = 'peaking'; N.dfxFidelity.frequency.value = 4200; N.dfxFidelity.Q.value = 0.85;
      N.dfxPresence = ctx.createBiquadFilter(); N.dfxPresence.type = 'highshelf'; N.dfxPresence.frequency.value = 8500; N.dfxPresence.Q.value = 0.707;
      N.dfxHyperBass = ctx.createBiquadFilter(); N.dfxHyperBass.type = 'lowshelf'; N.dfxHyperBass.frequency.value = 85; N.dfxHyperBass.Q.value = 0.8;
      N.dfxPunch = ctx.createBiquadFilter(); N.dfxPunch.type = 'peaking'; N.dfxPunch.frequency.value = 145; N.dfxPunch.Q.value = 1.1;
      N.dfxDry = ctx.createGain(); N.dfxDry.gain.value = 1;
      N.dfxAmbDelay = ctx.createDelay(0.08); N.dfxAmbDelay.delayTime.value = 0.024;
      N.dfxAmbFilter = ctx.createBiquadFilter(); N.dfxAmbFilter.type = 'highpass'; N.dfxAmbFilter.frequency.value = 650;
      N.dfxAmbWet = ctx.createGain(); N.dfxAmbWet.gain.value = 0;
      N.dfxAmbSum = ctx.createGain();

      // M/S stereo stage: L' = M + w*S, R' = M - w*S, M = (L+R)/2, S = (R-L)/2
      N.mSplit = ctx.createChannelSplitter(2);
      N.midGL = ctx.createGain();  N.midGL.gain.value = 0.5;
      N.midGR = ctx.createGain();  N.midGR.gain.value = 0.5;
      N.sideGL = ctx.createGain(); N.sideGL.gain.value = -0.5;
      N.sideGR = ctx.createGain(); N.sideGR.gain.value = 0.5;
      N.midSum = ctx.createGain();
      N.sideSum = ctx.createGain();
      N.sideOutL = ctx.createGain(); N.sideOutL.gain.value = 1;
      N.sideOutR = ctx.createGain(); N.sideOutR.gain.value = -1;
      N.mMerge = ctx.createChannelMerger(2);
      N.pan = ctx.createStereoPanner();

      // Dynamics: compIn -> comp -> makeup -> limIn -> lim -> out
      N.compIn = ctx.createGain();
      N.comp = ctx.createDynamicsCompressor();
      N.makeup = ctx.createGain();
      N.limIn = ctx.createGain();
      N.limDelay = ctx.createDelay(0.02);
      N.lim = ctx.createDynamicsCompressor();
      N.lim.knee.value = LIMITER.knee;
      N.lim.ratio.value = LIMITER.ratio;
      N.limCeiling = ctx.createGain();

      // Output + analysers
      N.out = ctx.createGain();
      N.anMain = ctx.createAnalyser(); N.anMain.fftSize = 2048;
      N.mSplit2 = ctx.createChannelSplitter(2);
      N.anL = ctx.createAnalyser(); N.anL.fftSize = 256;
      N.anR = ctx.createAnalyser(); N.anR.fftSize = 256;

      // Wiring
      N.input.connect(N.volume);
      N.volume.connect(N.autoeqIn);
      N.autoeqIn.connect(N.autoeqOut);
      N.autoeqOut.connect(N.hp);
      N.hp.connect(N.lp);
      N.lp.connect(N.eq[0]);
      for (let i = 0; i < EQ_BANDS.length - 1; i++) N.eq[i].connect(N.eq[i + 1]);
      N.eq[EQ_BANDS.length - 1].connect(N.bass);
      N.bass.connect(N.treble);
      N.treble.connect(N.dfxFidelity);
      N.dfxFidelity.connect(N.dfxPresence);
      N.dfxPresence.connect(N.dfxHyperBass);
      N.dfxHyperBass.connect(N.dfxPunch);
      N.dfxPunch.connect(N.dfxDry);
      N.dfxDry.connect(N.dfxAmbSum);
      N.dfxPunch.connect(N.dfxAmbDelay);
      N.dfxAmbDelay.connect(N.dfxAmbFilter);
      N.dfxAmbFilter.connect(N.dfxAmbWet);
      N.dfxAmbWet.connect(N.dfxAmbSum);
      N.dfxAmbSum.connect(N.mSplit);
      N.mSplit.connect(N.midGL, 0);
      N.mSplit.connect(N.midGR, 1);
      N.mSplit.connect(N.sideGL, 0);
      N.mSplit.connect(N.sideGR, 1);
      N.midGL.connect(N.midSum);
      N.midGR.connect(N.midSum);
      N.sideGL.connect(N.sideSum);
      N.sideGR.connect(N.sideSum);
      N.midSum.connect(N.mMerge, 0, 0);
      N.midSum.connect(N.mMerge, 0, 1);
      N.sideSum.connect(N.sideOutL);
      N.sideOutL.connect(N.mMerge, 0, 0);
      N.sideSum.connect(N.sideOutR);
      N.sideOutR.connect(N.mMerge, 0, 1);
      N.mMerge.connect(N.pan);
      N.mMerge.connect(N.mSplit2);
      N.mSplit2.connect(N.anL, 0);
      N.mSplit2.connect(N.anR, 1);
      N.pan.connect(N.compIn);
      N.compIn.connect(N.comp);
      N.comp.connect(N.makeup);
      N.makeup.connect(N.limIn);
      N.limIn.connect(N.limDelay);
      N.limDelay.connect(N.lim);
      N.lim.connect(N.limCeiling);
      N.limCeiling.connect(N.out);
      N.out.connect(N.anMain);
      N.anMain.connect(ctx.destination);

      // Bypass states (default: compressor OFF, limiter ON)
      N.compIn.connect(N.limIn);
      this.compBypassed = true;
      this.limBypassed = false;
      this.autoeqCount = 0;
      this.autoeqActive = false;
      return N;
    },

    setCompBypass(on) {
      const N = this.nodes;
      if (!N) return;
      if (on === this.compBypassed) return;
      this.compBypassed = on;
      if (on) { N.compIn.disconnect(N.comp); N.compIn.connect(N.limIn); }
      else { N.compIn.disconnect(N.limIn); N.compIn.connect(N.comp); }
    },

    setLimBypass(on) {
      const N = this.nodes;
      if (!N) return;
      if (on === this.limBypassed) return;
      this.limBypassed = on;
      if (on) { N.limIn.disconnect(N.limDelay); N.limIn.connect(N.out); }
      else { N.limIn.disconnect(N.out); N.limIn.connect(N.limDelay); }
    },
    // ----------------------------------------------------------------
    // Parameter-scheduler robustness. Some Chromium builds ignore
    // downward AudioParam schedules (setTargetAtTime / linearRamp /
    // exponentialRamp) and even direct .value down-moves, leaving
    // nodes stuck at their previous state. Newly created nodes
    // always start with correct coefficients, so the engine probes
    // the scheduler at runtime and, only when it is broken, swaps
    // the affected node in place for down-moves. Up-moves always
    // keep the normal smooth ramp in every build.
    // ----------------------------------------------------------------
    paramDownBroken: false,
    probed: false,

    probeParams() {
      if (this.probed || !this.ctx) return;
      if (this.ctx.state !== 'running') return;
      this.probed = true;
      try {
        const ctx = this.ctx;
        const mk = function () {
          const osc = ctx.createOscillator(); osc.frequency.value = 2000;
          const g = ctx.createGain(); g.gain.value = 0.5;
          const b = ctx.createBiquadFilter(); b.type = 'lowshelf'; b.frequency.value = 2000; b.Q.value = 1;
          const a = ctx.createAnalyser(); a.fftSize = 512;
          osc.connect(g); g.connect(b); b.connect(a);
          osc.start();
          return { osc: osc, g: g, b: b, a: a };
        };
        const buf = new Uint8Array(256);
        const level = function (a) {
          a.getByteFrequencyData(buf);
          let s = 0;
          for (let i = 19; i <= 24; i++) s += buf[i];
          return s;
        };
        const cleanup = function (x) {
          try { x.osc.stop(); } catch (_) {}
          x.g.disconnect(); x.b.disconnect(); x.a.disconnect();
        };
        const G = mk();
        const B = mk();
        setTimeout(function () {
          try {
            const t = ctx.currentTime;
            const gBase = level(G.a);
            const bBase = level(B.a);
            G.g.gain.setTargetAtTime(0.05, t, 0.05); // down-move, -10 dB
            B.b.gain.setTargetAtTime(12, t, 0.05);    // up-move control, +12 dB
            setTimeout(function () {
              const gAfter = level(G.a);
              const bAfter = level(B.a);
              cleanup(G);
              cleanup(B);
              // The up-move control must raise the level (~x2). If it did
              // not, the measurement is unreliable and standard
              // scheduling is kept.
              if (bAfter > bBase * 1.5) {
                Engine.paramDownBroken = gAfter > gBase * 0.5;
              }
            }, 400);
          } catch (_) {}
        }, 250);
      } catch (_) {}
    },

    swapSpec(key) {
      const N = this.nodes;
      const s = { node: null, prev: null, next: null, multi: false };
      const aeqFirst = (this.autoeqActive && this.autoeqCount > 0) ? this.autoeqFilters[0] : N.autoeqOut;
      const aeqLast = (this.autoeqActive && this.autoeqCount > 0) ? this.autoeqFilters[this.autoeqCount - 1] : N.autoeqOut;
      if (key.indexOf('eq') === 0 && key.length > 2) {
        const i = Number(key.slice(2));
        if (N.eq[i]) {
          s.node = N.eq[i];
          s.prev = (i === 0) ? N.lp : N.eq[i - 1];
          s.next = (i === N.eq.length - 1) ? N.bass : N.eq[i + 1];
        }
        return s;
      }
      switch (key) {
        case 'input':    s.node = N.input;    s.multi = true;  s.next = N.volume;   break;
        case 'volume':   s.node = N.volume;   s.prev = N.input;  s.next = N.autoeqIn; break;
        case 'autoeqIn': s.node = N.autoeqIn; s.prev = N.volume; s.next = aeqFirst; break;
        case 'hp':       s.node = N.hp;       s.prev = aeqLast;  s.next = N.lp;       break;
        case 'lp':       s.node = N.lp;       s.prev = N.hp;     s.next = N.eq[0];    break;
        case 'bass':     s.node = N.bass;     s.prev = N.eq[N.eq.length - 1]; s.next = N.treble; break;
        case 'treble':   s.node = N.treble;   s.prev = N.bass;   s.next = N.dfxFidelity; break;
        case 'dfxFidelity': s.node = N.dfxFidelity; s.prev = N.treble; s.next = N.dfxPresence; break;
        case 'dfxPresence': s.node = N.dfxPresence; s.prev = N.dfxFidelity; s.next = N.dfxHyperBass; break;
        case 'dfxHyperBass': s.node = N.dfxHyperBass; s.prev = N.dfxPresence; s.next = N.dfxPunch; break;
        case 'dfxPunch': s.node = N.dfxPunch; s.prev = N.dfxHyperBass; s.next = N.dfxDry; break;
        case 'dfxAmbWet': s.node = N.dfxAmbWet; s.prev = N.dfxAmbFilter; s.next = N.dfxAmbSum; break;
        case 'dfxAmbDelay': s.node = N.dfxAmbDelay; s.prev = N.dfxPunch; s.next = N.dfxAmbFilter; break;
        case 'sideOutL': s.node = N.sideOutL; s.prev = N.sideSum; s.next = N.mMerge; s.nextPort = 0; break;
        case 'sideOutR': s.node = N.sideOutR; s.prev = N.sideSum; s.next = N.mMerge; s.nextPort = 1; break;
        case 'pan':      s.node = N.pan;      s.prev = N.mMerge; s.next = N.compIn;   break;
        case 'comp':     s.node = N.comp;     s.prev = N.compIn; s.next = N.makeup;   break;
        case 'makeup':   s.node = N.makeup;   s.prev = N.comp;   s.next = N.limIn;    break;
        case 'limDelay': s.node = N.limDelay; s.prev = N.limIn;  s.next = N.lim;      break;
        case 'lim':      s.node = N.lim;      s.prev = N.limDelay; s.next = N.limCeiling; break;
        case 'limCeiling': s.node = N.limCeiling; s.prev = N.lim; s.next = N.out;     break;
        case 'out':      s.node = N.out;      s.prev = N.limCeiling; s.next = N.anMain; break;
      }
      return s;
    },

    doSwap(key, makeFresh) {
      const s = this.swapSpec(key);
      if (!s.node || !s.next) return;
      const fresh = makeFresh();
      if (!fresh) return;
      try {
        if (s.multi) {
          const ins = s.node.inputs;
          for (let i = 0; i < ins.length; i++) {
            ins[i].disconnect(s.node);
            ins[i].connect(fresh);
          }
        } else if (s.prev) {
          s.prev.disconnect(s.node);
          s.prev.connect(fresh);
        }
        s.node.disconnect(s.next);
        if (typeof s.nextPort === 'number') fresh.connect(s.next, 0, s.nextPort);
        else fresh.connect(s.next);
      } catch (_) {
        return;
      }
      s.node = fresh;
      this.nodes[key] = fresh;
      if (key.indexOf('eq') === 0 && key.length > 2) this.nodes.eq[Number(key.slice(2))] = fresh;
    },

    setP(key, param, value, makeFresh) {
      const ctx = this.ctx;
      let cur = 0;
      try { cur = param.value; } catch (_) { return; }
      if (Math.abs(value - cur) < 0.0001) return;
      if (this.paramDownBroken && value < cur) {
        const t = ctx.currentTime;
        this._swapThrottle = this._swapThrottle || {};
        if (this._swapThrottle[key] && t - this._swapThrottle[key] < 0.06) return;
        this._swapThrottle[key] = t;
        this.doSwap(key, makeFresh);
        return;
      }
      try { param.setTargetAtTime(value, ctx.currentTime, DB_TIME_CONSTANT); } catch (_) {}
    },

    setAutoEq(data) {
      const N = this.nodes;
      if (!N) return;
      if (this.autoeqData === data) return;
      this.autoeqData = data;
      const t = this.ctx.currentTime;
      N.autoeqIn.disconnect();
      if (!data || !Array.isArray(data.filters) || data.filters.length === 0) {
        N.autoeqIn.connect(N.autoeqOut);
        this.autoeqActive = false;
        this.autoeqCount = 0;
        this.setP('autoeqIn', N.autoeqIn.gain, 0, function () {
          const g = Engine.ctx.createGain();
          g.gain.value = 0;
          return g;
        });
        return;
      }
      const n = data.filters.length;
      let prev = N.autoeqIn;
      for (let i = 0; i < n; i++) {
        const fd = data.filters[i];
        const freq = Math.min(Math.max(fd.freq, 20), this.ctx.sampleRate / 2 - 1);
        const gain = Math.min(Math.max(fd.gain, -60), 60);
        const q = Math.min(Math.max(typeof fd.q === 'number' ? fd.q : 0.71, 0.01), 50);
        let f = this.autoeqFilters[i];
        // Broken scheduler: down-moves on a reused node never reach the
        // DSP — take a fresh node (initial state is always correct).
        if (f && this.paramDownBroken && (gain < f.gain.value || freq < f.frequency.value)) {
          f.disconnect();
          f = null;
        }
        let isNew = false;
        if (!f) {
          f = this.ctx.createBiquadFilter();
          isNew = true;
        }
        this.autoeqFilters[i] = f;
        f.disconnect();
        f.type = AUTOEQ_TYPE_MAP[fd.type] || 'peaking';
        f.Q.value = q;
        if (isNew || this.paramDownBroken) {
          f.frequency.value = freq;
          f.gain.value = gain;
        } else {
          f.frequency.setTargetAtTime(freq, t, PARAM_TIME_CONSTANT);
          f.gain.setTargetAtTime(gain, t, PARAM_TIME_CONSTANT);
        }
        prev.connect(f);
        prev = f;
      }
      prev.connect(N.autoeqOut);
      for (let i = n; i < this.autoeqFilters.length; i++) this.autoeqFilters[i].disconnect();
      this.autoeqActive = true;
      this.autoeqCount = n;
      this.setP('autoeqIn', N.autoeqIn.gain, Math.min(Math.max(data.preamp || 0, -30), 30), function () {
        const g = Engine.ctx.createGain();
        g.gain.value = Math.min(Math.max(data.preamp || 0, -30), 30);
        return g;
      });
    },

    apply(s) {
      if (!this.ctx || !this.nodes) return;
      const N = this.nodes;
      const ctx = this.ctx;

      const mkGain = function (v) {
        const g = ctx.createGain();
        g.gain.value = v;
        return g;
      };
      const mkBiquad = function (type, freq, q, gain) {
        const b = ctx.createBiquadFilter();
        b.type = type;
        b.frequency.value = freq;
        b.Q.value = q;
        b.gain.value = gain;
        return b;
      };
      const mkComp = function (c) {
        const cp = ctx.createDynamicsCompressor();
        cp.threshold.value = c.threshold;
        cp.knee.value = c.knee;
        cp.ratio.value = c.ratio;
        cp.attack.value = c.attack;
        cp.release.value = c.release;
        return cp;
      };
      const mkDelay = function (v) {
        const d = ctx.createDelay(0.08);
        d.delayTime.value = v;
        return d;
      };
      const hpFreq = s.highPass ? s.highPassFreq : 20;
      const lpFreq = s.lowPass ? s.lowPassFreq : ctx.sampleRate / 2;
      const fidelity = s.dfxFidelity / 10;
      const ambience = s.dfxAmbience / 10;
      const surround = s.dfxSurround / 10;
      const dynamicBoost = s.dfxDynamicBoost / 10;
      const hyperBass = s.dfxHyperBass / 10;
      const w = 1 + surround * 1.25;
      const bassDb = (s.bassBoost / 100) * 15;
      const trebleDb = (s.trebleBoost / 100) * 15;
      const fidelityDb = fidelity * 9;
      const presenceDb = fidelity * 6;
      const hyperBassDb = hyperBass * 15;
      const punchDb = hyperBass * 7;
      const ambWet = ambience * 0.5;
      const ambDelay = 0.018 + ambience * 0.052;
      const limAttack = s.limiterAttack / 1000;
      const limRelease = s.limiterRelease / 1000;
      const limLookahead = s.limiterLookahead / 1000;
      const limCeiling = db2gain(s.limiterCeiling);

      this.setP('volume', N.volume.gain, s.volumeBoost / 100, function () { return mkGain(s.volumeBoost / 100); });
      this.setP('hp', N.hp.frequency, hpFreq, function () { return mkBiquad('highpass', hpFreq, 1, 0); });
      this.setP('lp', N.lp.frequency, lpFreq, function () { return mkBiquad('lowpass', lpFreq, 1, 0); });
      for (let i = 0; i < EQ_BANDS.length; i++) {
        const idx = i;
        this.setP('eq' + idx, N.eq[idx].gain, s.equalizer[idx], function () {
          return mkBiquad('peaking', EQ_BANDS[idx], EQ_Q, s.equalizer[idx]);
        });
      }
      this.setP('bass', N.bass.gain, bassDb, function () { return mkBiquad('lowshelf', 250, 0.707, bassDb); });
      this.setP('treble', N.treble.gain, trebleDb, function () { return mkBiquad('highshelf', 2000, 0.707, trebleDb); });
      this.setP('dfxFidelity', N.dfxFidelity.gain, fidelityDb, function () { return mkBiquad('peaking', 4200, 0.85, fidelityDb); });
      this.setP('dfxPresence', N.dfxPresence.gain, presenceDb, function () { return mkBiquad('highshelf', 8500, 0.707, presenceDb); });
      this.setP('dfxHyperBass', N.dfxHyperBass.gain, hyperBassDb, function () { return mkBiquad('lowshelf', 85, 0.8, hyperBassDb); });
      this.setP('dfxPunch', N.dfxPunch.gain, punchDb, function () { return mkBiquad('peaking', 145, 1.1, punchDb); });
      this.setP('dfxAmbWet', N.dfxAmbWet.gain, ambWet, function () { return mkGain(ambWet); });
      this.setP('dfxAmbDelay', N.dfxAmbDelay.delayTime, ambDelay, function () { return mkDelay(ambDelay); });
      this.setP('sideOutL', N.sideOutL.gain, w, function () { return mkGain(w); });
      this.setP('sideOutR', N.sideOutR.gain, -w, function () { return mkGain(-w); });
      this.setP('pan', N.pan.pan, 0, function () {
        const p = ctx.createStereoPanner();
        p.pan.value = 0;
        return p;
      });

      if (dynamicBoost <= 0) {
        this.setCompBypass(true);
      } else {
        this.setCompBypass(false);
        const c = {
          threshold: -34 + dynamicBoost * 16,
          knee: 16 - dynamicBoost * 8,
          ratio: 2 + dynamicBoost * 6,
          attack: 0.01 - dynamicBoost * 0.007,
          release: 0.22 - dynamicBoost * 0.13,
          makeup: dynamicBoost * 10
        };
        this.setP('comp', N.comp.threshold, c.threshold, function () { return mkComp(c); });
        this.setP('comp', N.comp.knee, c.knee, function () { return mkComp(c); });
        this.setP('comp', N.comp.ratio, c.ratio, function () { return mkComp(c); });
        this.setP('comp', N.comp.attack, c.attack, function () { return mkComp(c); });
        this.setP('comp', N.comp.release, c.release, function () { return mkComp(c); });
        this.setP('makeup', N.makeup.gain, db2gain(c.makeup), function () { return mkGain(db2gain(c.makeup)); });
      }

      this.setLimBypass(!s.limiter);
      this.setP('lim', N.lim.threshold, s.limiterThreshold, function () {
        const cp = mkComp({
          threshold: s.limiterThreshold,
          knee: LIMITER.knee,
          ratio: LIMITER.ratio,
          attack: limAttack,
          release: limRelease
        });
        return cp;
      });
      this.setP('lim', N.lim.attack, limAttack, function () {
        return mkComp({ threshold: s.limiterThreshold, knee: LIMITER.knee, ratio: LIMITER.ratio, attack: limAttack, release: limRelease });
      });
      this.setP('lim', N.lim.release, limRelease, function () {
        return mkComp({ threshold: s.limiterThreshold, knee: LIMITER.knee, ratio: LIMITER.ratio, attack: limAttack, release: limRelease });
      });
      this.setP('limDelay', N.limDelay.delayTime, limLookahead, function () { return mkDelay(limLookahead); });
      this.setP('limCeiling', N.limCeiling.gain, limCeiling, function () { return mkGain(limCeiling); });
      this.setP('out', N.out.gain, 1, function () { return mkGain(1); });
    }
  };

  // ============================================================================
  // 9. Media Detection
  // ============================================================================
  const sources = new WeakMap(); // element -> { source }

  function registerMedia(el) {
    if (!el || el.nodeType !== 1) return;
    const tag = el.tagName ? el.tagName.toLowerCase() : '';
    if (tag !== 'video' && tag !== 'audio') return;
    if (el.__uae_failed) return;
    if (!settings.enabled) return; // engine off: leave element untouched

    if (el.__uae_source) {
      // element re-attached after removal (SPA)
      if (Engine.nodes) { try { el.__uae_source.connect(Engine.nodes.input); } catch (_) {} }
      return;
    }
    Engine.ensure();
    if (!Engine.ctx) { el.__uae_failed = true; return; }

    let source;
    try {
      source = Engine.ctx.createMediaElementSource(el);
    } catch (e) {
      el.__uae_failed = true;
      console.warn('[UAE] Cannot route this media element (left untouched):', e && e.message);
      return;
    }
    el.__uae_source = source;
    try { source.connect(Engine.nodes.input); } catch (_) {}
    sources.set(el, { source: source });
    // resume the context on playback (autoplay elements may lack a page gesture)
    el.addEventListener('playing', function () {
      if (settings.enabled && Engine.ctx && Engine.ctx.state === 'suspended') {
        try { Engine.ctx.resume().catch(function () {}); } catch (_) {}
      }
    });
    // shadow DOM
    if (el.shadowRoot) scanShadow(el.shadowRoot);
  }

  function scanShadow(root) {
    try {
      const els = root.querySelectorAll('video,audio');
      for (let i = 0; i < els.length; i++) registerMedia(els[i]);
      if (els.length) {
        const mo = new MutationObserver(function (muts) {
          for (const m of muts) {
            for (const n of m.addedNodes) if (n.nodeType === 1) {
              if (n.tagName && (n.tagName.toLowerCase() === 'video' || n.tagName.toLowerCase() === 'audio')) registerMedia(n);
              if (n.querySelector) {
                const inner = n.querySelectorAll('video,audio');
                for (let j = 0; j < inner.length; j++) registerMedia(inner[j]);
              }
            }
          }
        });
        mo.observe(root, { childList: true, subtree: true });
      }
    } catch (_) {}
  }

  function scanDocument() {
    try {
      const els = document.querySelectorAll('video,audio');
      for (let i = 0; i < els.length; i++) registerMedia(els[i]);
    } catch (_) {}
  }

  const mediaObserver = new MutationObserver(function (muts) {
    for (const m of muts) {
      for (const n of m.addedNodes) {
        if (n.nodeType !== 1) continue;
        const tag = n.tagName ? n.tagName.toLowerCase() : '';
        if (tag === 'video' || tag === 'audio') registerMedia(n);
        else if (n.querySelector) {
          const inner = n.querySelectorAll('video,audio');
          for (let i = 0; i < inner.length; i++) registerMedia(inner[i]);
        }
        if (n.shadowRoot) scanShadow(n.shadowRoot);
      }
    }
  });

  function startObserving() {
    try {
      const root = document.documentElement || document.body;
      if (root && !mediaObserver._started) {
        mediaObserver.observe(root, { childList: true, subtree: true });
        mediaObserver._started = true;
      }
      scanDocument();
    } catch (_) {}
  }

  function markCustom() {
    // Kept as a no-op hook for shared slider/shortcut paths after preset removal.
  }

  function markDfxCustom() {
    settings.dfxPreset = 'Custom';
    if (UI.controls.dfxPreset) UI.controls.dfxPreset.set('Custom');
  }

  function applyDfxPreset(name) {
    const preset = DFX_PRESETS[name];
    if (!preset) return;
    settings.dfxPreset = name;
    settings.dfxFidelity = preset.dfxFidelity;
    settings.dfxAmbience = preset.dfxAmbience;
    settings.dfxSurround = preset.dfxSurround;
    settings.dfxDynamicBoost = preset.dfxDynamicBoost;
    settings.dfxHyperBass = preset.dfxHyperBass;
    applyAll();
    persistSettingsNow();
    UI.syncUI();
  }

  function resetSettings() {
    const enabled = settings.enabled;
    settings = sanitizeSettings(defaultSettings());
    settings.enabled = enabled;
    applyAll();
    persistSettingsNow();
  }

  function applyAll() {
    if (settings.enabled) {
      Engine.ensure();
      scanDocument();
      Engine.apply(settings);
    } else if (Engine.ctx) {
      Engine.setAutoEq(null);
      Engine.apply(neutralSettings());
    }
    UI.updateStatus();
    UI.updateWarning();
  }

  // ============================================================================
  // 10. AutoEq
  // ============================================================================
  function parseAutoEqIndex(text) {
    const entries = [];
    const re = /^- \[(.+)\]\(\.\/([^)]+)\)\s+by\s+(.+?)(?:\s+on\s+(.+))?\s*$/;
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].trim().match(re);
      if (m) entries.push({ name: m[1], path: m[2], source: m[3], target: m[4] || '' });
    }
    return entries;
  }

  function parseAutoEqPreset(text) {
    let preamp = 0;
    const filters = [];
    const re = /^(?:Preamp:\s*([-0-9.]+)\s*dB|Filter\s+\d+:\s*ON\s+(PK|LSC|HSC)\s+Fc\s+([\d.]+)\s*Hz\s+Gain\s+([-0-9.]+)\s*dB(?:\s+Q\s+([0-9.]+))?)/;
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].trim().match(re);
      if (!m) continue;
      if (m[1] !== undefined) preamp = parseFloat(m[1]);
      else filters.push({ freq: parseFloat(m[3]), gain: parseFloat(m[4]), q: m[5] !== undefined ? parseFloat(m[5]) : 0.71, type: m[2] });
    }
    return { preamp: preamp, filters: filters };
  }

  function autoEqToGraphicEq(data) {
    const out = EQ_BANDS.map(function () { return 0; });
    if (!data || !Array.isArray(data.filters)) return out;
    const log2 = Math.log(2);
    for (let i = 0; i < data.filters.length; i++) {
      const f = data.filters[i];
      const freq = Math.min(Math.max(f.freq, 20), 20000);
      const gain = Math.min(Math.max(f.gain, EQ_GAIN_MIN), EQ_GAIN_MAX);
      const q = Math.min(Math.max(typeof f.q === 'number' ? f.q : 0.71, 0.1), 20);
      for (let b = 0; b < EQ_BANDS.length; b++) {
        const band = EQ_BANDS[b];
        let weight = 0;
        if (f.type === 'LSC') {
          weight = band <= freq ? 1 : Math.max(0, 1 - (Math.log(band / freq) / log2));
        } else if (f.type === 'HSC') {
          weight = band >= freq ? 1 : Math.max(0, 1 - (Math.log(freq / band) / log2));
        } else {
          const dist = Math.abs(Math.log(band / freq) / log2);
          const width = Math.max(0.35, 1.2 / q);
          weight = Math.exp(-(dist * dist) / (2 * width * width));
        }
        out[b] += gain * weight;
      }
    }
    return out.map(function (v) { return Math.round(Math.min(EQ_GAIN_MAX, Math.max(EQ_GAIN_MIN, v))); });
  }

  function applyAutoEqToEqualizer(data) {
    settings.equalizer = autoEqToGraphicEq(data);
    applyAll();
    persistSettingsNow();
    UI.syncEq();
  }

  function autoeqPresetUrl(entry) {
    return AUTOEQ_BASE + entry.path + '/' + encodeURIComponent(entry.name + ' ParametricEQ.txt');
  }

  function fetchText(url, cb) {
    const done = function (text, status) { try { cb(text, status); } catch (_) { cb(null, 0); } };
    if (typeof GM_xmlhttpRequest === 'function') {
      GM_xmlhttpRequest({
        method: 'GET',
        url: url,
        timeout: 15000,
        onload: function (r) { done(r.status === 200 ? r.responseText : null, r.status); },
        onerror: function () { done(null, 0); },
        ontimeout: function () { done(null, 0); }
      });
    } else if (typeof fetch === 'function') {
      fetch(url).then(function (r) {
        return r.text().then(function (t) { done(r.ok ? t : null, r.status); });
      }).catch(function () { done(null, 0); });
    } else {
      done(null, 0);
    }
  }

  const AutoEq = {
    index: null,
    fetchedAt: 0,
    selected: null,
    cached: null,
    active: false,

    refresh: function () {
      UI.autoeqBusy(true);
      fetchText(AUTOEQ_INDEX_URL, (text) => {
        UI.autoeqBusy(false);
        if (!text) { UI.autoeqError('Index could not be loaded. Check your connection.'); return; }
        const entries = parseAutoEqIndex(text);
        if (!entries.length) { UI.autoeqError('Index format not recognized.'); return; }
        this.index = entries;
        this.fetchedAt = Date.now();
        Storage.set(KEYS.autoeqIndex, { fetchedAt: this.fetchedAt, entries: entries });
        UI.autoeqError('');
        UI.renderAutoEqList();
        UI.autoeqInfo(entries.length, this.fetchedAt);
        console.info('[UAE] AutoEq index loaded: ' + entries.length + ' presets');
      });
    },

    load: function (entry) {
      if (!entry) return;
      UI.autoeqBusy(true);
      UI.autoeqError('');
      fetchText(autoeqPresetUrl(entry), (text) => {
        UI.autoeqBusy(false);
        if (!text) { UI.autoeqError('Preset download failed: ' + entry.name); return; }
        const data = parseAutoEqPreset(text);
        if (!data.filters.length) { UI.autoeqError('No filters found in preset: ' + entry.name); return; }
        this.cached = data;
        this.selected = entry;
        Storage.set(KEYS.autoeqSelected, entry);
        Storage.set(KEYS.autoeqCache, data);
        this.activate();
      });
    },

    activate: function () {
      if (!this.selected || !this.cached) return;
      this.active = true;
      if (settings.enabled) Engine.ensure();
      Engine.setAutoEq(null);
      applyAutoEqToEqualizer(this.cached);
      UI.autoeqActiveStatus(this.selected);
      console.info('[UAE] AutoEq active: ' + this.selected.name + ' (' + this.cached.filters.length + ' filters)');
    },

    unload: function () {
      this.active = false;
      this.selected = null;
      this.cached = null;
      Storage.del(KEYS.autoeqSelected);
      Storage.del(KEYS.autoeqCache);
      Engine.setAutoEq(null);
      applyAll();
      UI.autoeqActiveStatus(null);
    },

    init: function () {
      const idx = Storage.get(KEYS.autoeqIndex, null);
      if (idx && Array.isArray(idx.entries) && idx.entries.length) {
        this.index = idx.entries;
        this.fetchedAt = idx.fetchedAt || 0;
        UI.renderAutoEqList();
        UI.autoeqInfo(this.index.length, this.fetchedAt);
      } else {
        UI.autoeqInfo(0, 0);
      }
      const sel = Storage.get(KEYS.autoeqSelected, null);
      const cache = Storage.get(KEYS.autoeqCache, null);
      if (sel && cache && Array.isArray(cache.filters) && cache.filters.length) {
        this.selected = sel;
        this.cached = cache;
        this.activate();
      } else {
        UI.autoeqActiveStatus(null);
      }
    }
  };

  // ============================================================================
  // 11. User Interface
  // ============================================================================
  const UI = {
    els: {},
    controls: {},
    modalEls: {},
    activeModal: null,
    activeModals: {},
    modalZ: 2147483648,

    // ---------- helpers ----------
    h: function (tag, attrs, children) {
      const el = document.createElement(tag);
      if (attrs) {
        for (const k in attrs) {
          if (k === 'class') el.className = attrs[k];
          else if (k === 'text') el.textContent = attrs[k];
          else if (k === 'html') el.innerHTML = attrs[k];
          else el.setAttribute(k, attrs[k]);
        }
      }
      if (children) {
        if (!Array.isArray(children)) children = [children];
        for (const c of children) {
          if (typeof c === 'string') el.appendChild(document.createTextNode(c));
          else if (c) el.appendChild(c);
        }
      }
      return el;
    },

    btn: function (label, title) {
      const b = this.h('button', { class: 'uae-btn' }, label);
      if (title) b.title = title;
      return b;
    },

    fmt: {
      db: (v) => (v > 0 ? '+' : '') + v + ' dB',
      pct: (v) => Math.round(v) + '%',
      bal: (v) => v === 0 ? 'Center' : (v < 0 ? Math.abs(v) + '% L' : v + '% R'),
      ms: (v) => Math.round(v * 1000) + ' ms',
      ratio: (v) => v.toFixed(1),
      hz: (v) => Math.round(v) + ' Hz',
      khz: (v) => (Math.round(v / 100) / 10) + ' kHz'
    },

    sliderRow: function (label, opts) {
      // opts: {min,max,step,value,fmt,oninput,vertical,disabled}
      const fmtFn = typeof opts.fmt === 'function' ? opts.fmt : this.fmt[opts.fmt];
      const val = this.h('span', { class: 'uae-val', text: fmtFn(opts.value) });
      const input = this.h('input', {
        type: 'range', min: opts.min, max: opts.max, step: opts.step, value: opts.value
      });
      if (opts.vertical) input.className = 'uae-vslider';
      if (opts.disabled) input.disabled = true;
      const lbl = this.h('span', { class: 'uae-lbl', text: label });
      input.addEventListener('input', () => {
        const v = parseFloat(input.value);
        val.textContent = fmtFn(v);
        if (opts.oninput) opts.oninput(v);
      });
      const row = this.h('div', { class: 'uae-row' + (opts.vertical ? ' uae-row-v' : '') }, [
        this.h('div', { class: 'uae-row-top' }, [val, lbl]),
        input
      ]);
      const api = {
        row: row, input: input, val: val,
        set: function (v) { input.value = v; val.textContent = fmtFn(v); },
        disable: function (d) { input.disabled = d; }
      };
      return api;
    },

    toggleRow: function (label, value, oninput) {
      const input = this.h('input', { type: 'checkbox' });
      input.checked = !!value;
      input.addEventListener('change', () => oninput(input.checked));
      const row = this.h('div', { class: 'uae-trow' }, [
        this.h('label', { class: 'uae-trow-lbl' }, [label, input])
      ]);
      return { row: row, input: input, set: function (v) { input.checked = !!v; } };
    },

    // ---------- CSS ----------
    injectCss: function () {
      const css = `
#uae-root { all: initial; position: fixed; z-index: 2147483647; font-family: 'Segoe UI', system-ui, -apple-system, sans-serif; font-size: 14px; color: #e8e8ee; }
#uae-root *, #uae-root *:before, #uae-root *:after { box-sizing: border-box; }

#uae-pill { position: fixed; right: 18px; bottom: 18px; display: flex; align-items: center; gap: 8px; background: #1a1a22; border: 1px solid #2e2e3a; border-radius: 20px; padding: 8px 16px; cursor: pointer; user-select: none; font-size: 14px; color: #e8e8ee; box-shadow: 0 2px 10px rgba(0,0,0,.5); }
#uae-root.uae-hidden #uae-pill { display: none; }
#uae-pill:hover { border-color: #58c6f7; }
#uae-pill .uae-dot { width: 8px; height: 8px; border-radius: 50%; background: #6b7280; }
#uae-pill .uae-dot.on { background: #4ade80; }
#uae-pill .uae-dot.susp { background: #f59e0b; }

#uae-panel { position: fixed; width: 340px; background: #14141a; border: 1px solid #2e2e3a; border-radius: 10px; box-shadow: 0 4px 24px rgba(0,0,0,.6); display: none; flex-direction: column; max-height: calc(100vh - 40px); }
#uae-panel.open { display: flex; }
#uae-panel-head { display: flex; align-items: center; gap: 8px; padding: 9px 12px; cursor: move; border-bottom: 1px solid #2e2e3a; background: #1a1a22; border-radius: 10px 10px 0 0; }
#uae-panel.collapsed #uae-panel-head { border-radius: 10px; border-bottom: none; }
#uae-panel.collapsed #uae-panel-body { display: none; }
#uae-panel-head .uae-title { font-size: 15px; font-weight: 600; flex: 1; }
#uae-status { font-size: 13px; color: #9ca3af; }
#uae-status .uae-dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; margin-right: 4px; background: #6b7280; }
#uae-status .uae-dot.on { background: #4ade80; }
#uae-status .uae-dot.susp { background: #f59e0b; }
#uae-collapse { background: none; border: none; color: #9ca3af; font-size: 16px; cursor: pointer; padding: 0 4px; line-height: 1; }
#uae-collapse:hover { color: #e8e8ee; }

#uae-panel-body { padding: 10px 12px; overflow-y: auto; max-height: calc(100vh - 120px); }
#uae-panel-body::-webkit-scrollbar { width: 8px; }
#uae-panel-body::-webkit-scrollbar-thumb { background: #2e2e3a; border-radius: 4px; }

.uae-section { padding: 8px 0; border-bottom: 1px solid #232330; }
.uae-section:last-child { border-bottom: none; }
.uae-section-title { font-size: 13px; font-weight: 600; color: #8b93a7; text-transform: uppercase; letter-spacing: .5px; margin-bottom: 7px; }

.uae-enable-row { display: flex; align-items: center; justify-content: space-between; }
.uae-enable-row label { display: flex; align-items: center; gap: 8px; cursor: pointer; font-weight: 600; }
.uae-switch { appearance: none; -webkit-appearance: none; width: 36px; height: 20px; border-radius: 10px; background: #2e2e3a; position: relative; cursor: pointer; transition: background .15s; outline: none; }
.uae-switch:checked { background: #4ade80; }
.uae-switch:after { content: ''; position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; border-radius: 50%; background: #fff; transition: left .15s; }
.uae-switch:checked:after { left: 18px; }

.uae-row { display: flex; flex-direction: column; gap: 3px; margin: 7px 0; }
.uae-row-top { display: flex; justify-content: space-between; align-items: baseline; }
.uae-lbl { font-size: 13px; color: #c6c9d4; }
.uae-val { font-size: 13px; color: #58c6f7; font-variant-numeric: tabular-nums; }
.uae-row input[type=range] { width: 100%; accent-color: #58c6f7; height: 18px; cursor: pointer; margin: 0; }

.uae-trow { display: flex; align-items: center; margin: 5px 0; }
.uae-trow-lbl { display: flex; align-items: center; gap: 6px; font-size: 14px; cursor: pointer; }
.uae-trow-lbl input { accent-color: #58c6f7; margin: 0; cursor: pointer; }

.uae-select { width: 100%; background: #1a1a22; color: #e8e8ee; border: 1px solid #2e2e3a; border-radius: 6px; padding: 7px 9px; font-size: 14px; outline: none; }
.uae-select:focus { border-color: #58c6f7; }

.uae-btn { background: #1f1f28; color: #dfe2ea; border: 1px solid #2e2e3a; border-radius: 6px; padding: 6px 11px; font-size: 13px; cursor: pointer; }
.uae-btn:hover { border-color: #58c6f7; color: #fff; }
.uae-btn.primary { background: #234; border-color: #2d5f7a; }
.uae-btn.danger:hover { border-color: #f87171; color: #f87171; }
.uae-btn:active { transform: translateY(1px); }

.uae-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 6px; }
.uae-grid .uae-btn { width: 100%; text-align: center; font-size: 13px; }
.uae-btn-row { display: flex; gap: 6px; }
.uae-btn-row .uae-btn { flex: 1; padding: 4px 6px; text-align: center; }

.uae-warn { display: none; margin-top: 6px; padding: 7px 9px; background: #2a231a; border: 1px solid #5a4a2a; border-radius: 6px; color: #facc15; font-size: 13px; line-height: 1.4; }
.uae-warn.show { display: block; }

.uae-modal { position: fixed; left: 24px; top: 90px; width: 420px; max-width: calc(100vw - 28px); max-height: calc(100vh - 50px); display: none; flex-direction: column; background: #14141a; border: 1px solid #2e2e3a; border-radius: 10px; box-shadow: 0 6px 30px rgba(0,0,0,.7); z-index: 2147483648; }
.uae-modal-equalizer { width: 620px; }
.uae-modal.open { display: flex; }
.uae-modal-head { display: flex; align-items: center; padding: 9px 12px; border-bottom: 1px solid #2e2e3a; background: #1a1a22; border-radius: 10px 10px 0 0; cursor: move; }
.uae-modal-head .uae-title { flex: 1; font-size: 16px; font-weight: 600; }
.uae-modal-head .uae-kbd { font-size: 12px; color: #6b7280; margin-right: 8px; }
.uae-modal-close { background: none; border: none; color: #9ca3af; font-size: 20px; cursor: pointer; line-height: 1; padding: 0 2px; }
.uae-modal-close:hover { color: #fff; }
.uae-modal-body { padding: 14px; overflow-y: auto; max-height: calc(100vh - 130px); }

.uae-eq-grid { display: grid; grid-template-columns: repeat(10, 1fr); gap: 10px; align-items: end; }
.uae-eq-col { display: flex; flex-direction: column; align-items: center; gap: 4px; min-width: 0; }
.uae-eq-col .uae-val { font-size: 13px; }
.uae-eq-col .uae-lbl { font-size: 12px; color: #8b93a7; }
.uae-eq-slider-wrap { position: relative; width: 34px; height: 190px; display: flex; align-items: center; justify-content: center; }
.uae-eq-slider-wrap:before { content: ''; position: absolute; left: 50%; top: 0; bottom: 0; width: 4px; transform: translateX(-50%); border-radius: 4px; background: #2e2e3a; }
.uae-eq-slider-wrap:after { content: ''; position: absolute; left: 4px; right: 4px; top: 50%; height: 1px; background: #5b6170; }
.uae-eq-col input[type=range] { appearance: none; -webkit-appearance: none; position: absolute; left: 50%; top: 50%; width: 190px; height: 34px; margin: 0; transform: translate(-50%, -50%) rotate(-90deg); background: transparent; cursor: pointer; }
.uae-eq-col input[type=range]::-webkit-slider-runnable-track { height: 4px; border-radius: 4px; background: transparent; }
.uae-eq-col input[type=range]::-webkit-slider-thumb { -webkit-appearance: none; width: 18px; height: 18px; border-radius: 50%; background: #58c6f7; border: 2px solid #e8e8ee; margin-top: -7px; }
.uae-eq-col input[type=range]::-moz-range-track { height: 4px; border-radius: 4px; background: transparent; }
.uae-eq-col input[type=range]::-moz-range-thumb { width: 18px; height: 18px; border-radius: 50%; background: #58c6f7; border: 2px solid #e8e8ee; }

.uae-adv { display: none; margin-top: 8px; padding-top: 8px; border-top: 1px solid #232330; }
.uae-adv.open { display: block; }

.uae-list { max-height: 260px; overflow-y: auto; border: 1px solid #232330; border-radius: 6px; }
.uae-list::-webkit-scrollbar { width: 8px; }
.uae-list::-webkit-scrollbar-thumb { background: #2e2e3a; border-radius: 4px; }
.uae-list-item { display: flex; align-items: center; gap: 8px; padding: 6px 10px; border-bottom: 1px solid #1e1e28; }
.uae-list-item:last-child { border-bottom: none; }
.uae-list-item .uae-li-name { flex: 1; font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.uae-list-item .uae-li-src { font-size: 12px; color: #6b7280; }
.uae-list-item.active { background: #1a2530; }
.uae-list-item.active .uae-li-name { color: #4ade80; }

.uae-input { width: 100%; background: #1a1a22; color: #e8e8ee; border: 1px solid #2e2e3a; border-radius: 6px; padding: 7px 9px; font-size: 14px; outline: none; }
.uae-input:focus { border-color: #58c6f7; }

.uae-statusline { font-size: 13px; color: #8b93a7; margin: 5px 0; line-height: 1.4; }
.uae-statusline .ok { color: #4ade80; }
.uae-statusline .err { color: #f87171; }

.uae-kbd { font-size: 12px; color: #6b7280; background: #1a1a22; border: 1px solid #2e2e3a; border-radius: 4px; padding: 2px 6px; }
.uae-hint { font-size: 12px; color: #6b7280; margin-top: 7px; line-height: 1.4; }
.uae-busy { display: none; font-size: 13px; color: #f59e0b; margin: 5px 0; }
.uae-busy.show { display: block; }
`;
      const style = document.createElement('style');
      style.textContent = css;
      (document.head || document.documentElement).appendChild(style);
    },

    // ---------- build ----------
    build: function () {
      this.injectCss();
      const root = this.h('div', { id: 'uae-root' });
      document.documentElement.appendChild(root);
      this.els.root = root;

      // Pill
      const dot = this.h('span', { class: 'uae-dot' });
      const pill = this.h('div', { id: 'uae-pill', title: 'Ultimate Audio Enhancer (Ctrl+Shift+A)' }, [
        dot,
        this.h('span', { text: 'UAE' })
      ]);
      pill.addEventListener('click', () => this.togglePanel());
      root.appendChild(pill);
      this.els.pill = pill;
      this.els.pillDot = dot;

      // Panel
      const collapse = this.h('button', { id: 'uae-collapse', title: 'Collapse / Expand' }, '\u25A2');
      const status = this.h('span', { id: 'uae-status' }, [this.h('span', { class: 'uae-dot' }), this.h('span', { text: 'Standby' })]);
      const head = this.h('div', { id: 'uae-panel-head' }, [
        this.h('span', { class: 'uae-title', text: 'Ultimate Audio Enhancer' }),
        status,
        collapse
      ]);
      const body = this.h('div', { id: 'uae-panel-body' });
      const panel = this.h('div', { id: 'uae-panel' }, [head, body]);
      root.appendChild(panel);
      this.els.panel = panel;
      this.els.status = status;
      this.els.statusText = status.lastChild;

      this.buildPanelBody(body);

      // position + state restore
      const pos = {
        x: typeof uiState.x === 'number' ? uiState.x : Math.max(10, window.innerWidth - 360),
        y: typeof uiState.y === 'number' ? uiState.y : 80,
        collapsed: !!uiState.collapsed,
        hidden: typeof uiState.hidden === 'boolean' ? uiState.hidden : true
      };
      uiState.x = pos.x;
      uiState.y = pos.y;
      uiState.collapsed = pos.collapsed;
      uiState.hidden = pos.hidden;
      panel.style.left = pos.x + 'px';
      panel.style.top = pos.y + 'px';
      this.pos = pos;
      root.classList.toggle('uae-hidden', pos.hidden);
      if (pos.hidden) { /* keep hidden */ } else panel.classList.add('open');
      if (pos.collapsed) panel.classList.add('collapsed');

      // drag
      head.addEventListener('pointerdown', (e) => {
        if (e.target === collapse) return;
        const startX = e.clientX, startY = e.clientY;
        const ox = panel.offsetLeft, oy = panel.offsetTop;
        const move = (ev) => {
          panel.style.left = (ox + ev.clientX - startX) + 'px';
          panel.style.top = (oy + ev.clientY - startY) + 'px';
        };
        const up = () => {
          document.removeEventListener('pointermove', move);
          document.removeEventListener('pointerup', up);
          this.pos.x = panel.offsetLeft; this.pos.y = panel.offsetTop;
          uiState.x = this.pos.x; uiState.y = this.pos.y;
          persistUI();
        };
        document.addEventListener('pointermove', move);
        document.addEventListener('pointerup', up);
      });
      collapse.addEventListener('click', () => {
        panel.classList.toggle('collapsed');
        this.pos.collapsed = panel.classList.contains('collapsed');
        uiState.collapsed = this.pos.collapsed;
        persistUI();
      });
      head.addEventListener('dblclick', () => this.togglePanel());

      // Modals (single instance each)
      this.buildModal('equalizer', 'Equalizer', 'E', () => this.buildEqModal());
      this.buildModal('autoeq', 'AutoEq Presets', 'Q', () => this.buildAutoEqModal());
      this.buildModal('limiter', 'Limiter', '', () => this.buildLimiterModal());
      this.buildModal('filters', 'Filters', 'F', () => this.buildFiltersModal());

      this.syncUI();
      this.updateStatus();
      this.updateWarning();
      this.bindShortcuts();
      AutoEq.init();
    },

    togglePanel: function () {
      const p = this.els.panel;
      this.pos.hidden = !this.pos.hidden;
      uiState.hidden = this.pos.hidden;
      p.classList.toggle('open', !this.pos.hidden);
      if (this.els.root) this.els.root.classList.toggle('uae-hidden', this.pos.hidden);
      persistUI();
    },

    panelVisible: function () {
      return this.els.panel.classList.contains('open') && !this.els.panel.classList.contains('collapsed');
    },

    buildPanelBody: function (body) {
      const S = this;

      // Enable
      const enable = this.h('div', { class: 'uae-section' }, [
        this.h('div', { class: 'uae-section-title' }, 'Engine'),
        this.h('div', { class: 'uae-enable-row' }, [
          this.h('label', {}, [
            this.h('span', { text: 'Ultimate Audio Enhancer' }),
            (function () {
              const sw = S.h('input', { type: 'checkbox', class: 'uae-switch' });
              sw.checked = settings.enabled;
              sw.addEventListener('change', () => {
                setEnabled(sw.checked);
                persistSettings();
              });
              S.controls.enabled = { set: function (v) { sw.checked = v; } };
              return sw;
            })()
          ])
        ])
      ]);
      body.appendChild(enable);

      // Quick gain rows
      const volume = this.sliderRow('Volume Boost', {
        min: 25, max: 300, step: 5, value: settings.volumeBoost, fmt: 'pct',
        oninput: (v) => { settings.volumeBoost = v; markCustom(); applyAll(); persistSettings(); }
      });
      const bass = this.sliderRow('Bass Boost', {
        min: 0, max: 100, step: 5, value: settings.bassBoost, fmt: 'pct',
        oninput: (v) => {
          settings.bassBoost = v;
          if (v > 0) settings._lastBass = v;
          markCustom(); applyAll(); persistSettings();
        }
      });
      const treble = this.sliderRow('Treble Boost', {
        min: 0, max: 100, step: 5, value: settings.trebleBoost, fmt: 'pct',
        oninput: (v) => {
          settings.trebleBoost = v;
          if (v > 0) settings._lastTreble = v;
          markCustom(); applyAll(); persistSettings();
        }
      });
      this.controls.volume = volume;
      this.controls.bass = bass;
      this.controls.treble = treble;
      const gains = this.h('div', { class: 'uae-section' }, [
        this.h('div', { class: 'uae-section-title' }, 'Gain & Boost'),
        volume.row,
        bass.row,
        treble.row
      ]);
      body.appendChild(gains);

      const dfx = this.h('div', { class: 'uae-section' }, [
        this.h('div', { class: 'uae-section-title' }, 'DFX')
      ]);
      const dfxSelect = this.h('select', { class: 'uae-select' });
      Object.keys(DFX_PRESETS).forEach((name) => {
        dfxSelect.appendChild(this.h('option', { value: name, text: name }));
      });
      dfxSelect.appendChild(this.h('option', { value: 'Custom', text: 'Custom' }));
      dfxSelect.value = settings.dfxPreset;
      dfxSelect.addEventListener('change', () => {
        if (dfxSelect.value === 'Custom') {
          settings.dfxPreset = 'Custom';
          persistSettings();
          return;
        }
        applyDfxPreset(dfxSelect.value);
      });
      this.controls.dfxPreset = {
        input: dfxSelect,
        set: function (v) { dfxSelect.value = v; }
      };
      dfx.appendChild(this.h('div', { class: 'uae-row' }, [
        this.h('div', { class: 'uae-row-top' }, [
          this.h('span', { class: 'uae-val', text: '' }),
          this.h('span', { class: 'uae-lbl', text: 'DFX Preset' })
        ]),
        dfxSelect
      ]));
      const addDfx = (key, label) => {
        const ctrl = this.sliderRow(label, {
          min: 0, max: 10, step: 1, value: settings[key], fmt: (v) => String(Math.round(v)),
          oninput: (v) => { settings[key] = v; markDfxCustom(); markCustom(); applyAll(); persistSettings(); }
        });
        this.controls[key] = ctrl;
        dfx.appendChild(ctrl.row);
      };
      addDfx('dfxFidelity', 'Fidelity');
      addDfx('dfxAmbience', 'Ambience');
      addDfx('dfxSurround', '3D Surround');
      addDfx('dfxDynamicBoost', 'Dynamic Boost');
      addDfx('dfxHyperBass', 'HyperBass');
      body.appendChild(dfx);

      // Quick toggles
      const limBtn = this.btn('Limiter (X)', 'Toggle limiter (Ctrl+Shift+X)');
      const limSettingsBtn = this.btn('\u2699', 'Limiter settings');
      const resetBtn = this.btn('Reset (R)', 'Reset audio settings (R)');
      limBtn.addEventListener('click', () => { settings.limiter = !settings.limiter; markCustom(); applyAll(); persistSettings(); this.syncUI(); });
      limBtn.addEventListener('contextmenu', (e) => { e.preventDefault(); this.openModal('limiter'); });
      limSettingsBtn.addEventListener('click', () => this.openModal('limiter'));
      resetBtn.addEventListener('click', () => { resetSettings(); this.syncUI(); });
      this.els.limBtn = limBtn;
      const toggles = this.h('div', { class: 'uae-section' }, [
        this.h('div', { class: 'uae-section-title' }, 'Quick Toggles'),
        this.h('div', { class: 'uae-grid' }, [limBtn, limSettingsBtn, resetBtn])
      ]);
      body.appendChild(toggles);

      // Section buttons
      const secNames = ['equalizer', 'autoeq', 'filters'];
      const secLabels = ['Equalizer', 'AutoEq', 'Filters'];
      const secKeys = ['E', 'Q', 'F'];
      const secBtns = [];
      for (let i = 0; i < secNames.length; i++) {
        const b = this.btn(secLabels[i] + ' [' + secKeys[i] + ']', 'Open ' + secLabels[i].toLowerCase() + ' (Ctrl+Shift+' + secKeys[i] + ')');
        const name = secNames[i];
        b.addEventListener('click', () => this.openModal(name));
        secBtns.push(b);
      }
      const exportBtn = this.btn('Export', 'Export config as JSON');
      const importBtn = this.btn('Import', 'Import config from JSON');
      exportBtn.addEventListener('click', () => this.exportConfig());
      importBtn.addEventListener('click', () => this.importConfig());
      const sections = this.h('div', { class: 'uae-section' }, [
        this.h('div', { class: 'uae-section-title' }, 'Sections'),
        this.h('div', { class: 'uae-grid' }, secBtns.concat([exportBtn, importBtn]))
      ]);
      body.appendChild(sections);

      // Warning
      const warn = this.h('div', { class: 'uae-warn' },
        '[WARN] High volume selected \u2013 loud output can damage hearing. Output is limited to \u22121 dB.');
      body.appendChild(warn);
      this.els.warn = warn;
    },

    // ---------- modals ----------
    buildModal: function (name, title, key, buildBody) {
      const headChildren = [];
      if (key) headChildren.push(this.h('span', { class: 'uae-kbd', text: 'Ctrl+Shift+' + key }));
      headChildren.push(this.h('span', { class: 'uae-title', text: title }));
      headChildren.push(this.h('button', { class: 'uae-modal-close', title: 'Close (Esc)' }, '\u00D7'));
      const head = this.h('div', { class: 'uae-modal-head' }, headChildren);
      const body = this.h('div', { class: 'uae-modal-body' });
      const modal = this.h('div', { class: 'uae-modal uae-modal-' + name }, [head, body]);
      head.querySelector('.uae-modal-close').addEventListener('click', () => this.closeModal(name));
      head.addEventListener('pointerdown', (e) => {
        if (e.target && e.target.classList && e.target.classList.contains('uae-modal-close')) return;
        this.bringModalFront(name);
        const startX = e.clientX, startY = e.clientY;
        const ox = modal.offsetLeft, oy = modal.offsetTop;
        const move = (ev) => {
          const maxX = Math.max(8, window.innerWidth - modal.offsetWidth - 8);
          const maxY = Math.max(8, window.innerHeight - 42);
          const x = Math.min(maxX, Math.max(8, ox + ev.clientX - startX));
          const y = Math.min(maxY, Math.max(8, oy + ev.clientY - startY));
          modal.style.left = x + 'px';
          modal.style.top = y + 'px';
        };
        const up = () => {
          document.removeEventListener('pointermove', move);
          document.removeEventListener('pointerup', up);
          uiState.modals = uiState.modals && typeof uiState.modals === 'object' ? uiState.modals : {};
          uiState.modals[name] = { x: modal.offsetLeft, y: modal.offsetTop };
          persistUI();
        };
        document.addEventListener('pointermove', move);
        document.addEventListener('pointerup', up);
      });
      document.getElementById('uae-root').appendChild(modal);
      this.modalEls[name] = { modal: modal, body: body, built: false, title: title };
      this.modalEls[name].build = buildBody;
    },

    defaultModalPosition: function (name) {
      const widths = { equalizer: 620, autoeq: 420, limiter: 420, filters: 420 };
      const w = widths[name] || 420;
      const offset = Object.keys(this.modalEls).indexOf(name);
      return {
        x: Math.max(8, Math.floor((window.innerWidth - w) / 2) + offset * 24),
        y: Math.max(8, 90 + offset * 28)
      };
    },

    placeModal: function (name) {
      const m = this.modalEls[name];
      if (!m) return;
      uiState.modals = uiState.modals && typeof uiState.modals === 'object' ? uiState.modals : {};
      const saved = uiState.modals[name];
      const pos = saved && typeof saved.x === 'number' && typeof saved.y === 'number'
        ? saved
        : this.defaultModalPosition(name);
      const maxX = Math.max(8, window.innerWidth - m.modal.offsetWidth - 8);
      const maxY = Math.max(8, window.innerHeight - 42);
      m.modal.style.left = Math.min(maxX, Math.max(8, pos.x)) + 'px';
      m.modal.style.top = Math.min(maxY, Math.max(8, pos.y)) + 'px';
    },

    bringModalFront: function (name) {
      const m = this.modalEls[name];
      if (!m) return;
      this.modalZ += 1;
      m.modal.style.zIndex = String(this.modalZ);
      this.activeModal = name;
    },

    openModal: function (name) {
      const m = this.modalEls[name];
      if (!m) return;
      if (this.activeModals[name]) { this.closeModal(name); return; }
      if (!m.built) { m.build(); m.built = true; }
      m.modal.classList.add('open');
      this.activeModals[name] = true;
      this.placeModal(name);
      this.bringModalFront(name);
      this.activeModal = name;
    },

    closeModal: function (name) {
      name = name || this.activeModal;
      if (!name) return;
      const m = this.modalEls[name];
      if (m) m.modal.classList.remove('open');
      delete this.activeModals[name];
      this.activeModal = null;
      let topZ = -1;
      for (const k in this.activeModals) {
        const mm = this.modalEls[k];
        const z = mm ? parseInt(mm.modal.style.zIndex || '0', 10) : 0;
        if (z > topZ) { topZ = z; this.activeModal = k; }
      }
    },

    // ---------- modal bodies ----------
    buildEqModal: function () {
      const m = this.modalEls.equalizer;
      const grid = this.h('div', { class: 'uae-eq-grid' });
      this.controls.eq = [];
      for (let i = 0; i < EQ_BANDS.length; i++) {
        const idx = i;
        const lbl = EQ_BANDS[i] >= 1000 ? (EQ_BANDS[i] / 1000) + 'K' : String(EQ_BANDS[i]);
        const col = this.h('div', { class: 'uae-eq-col' });
        const val = this.h('span', { class: 'uae-val', text: this.fmt.db(settings.equalizer[i]) });
        const input = this.h('input', { type: 'range', min: EQ_GAIN_MIN, max: EQ_GAIN_MAX, step: 1, value: settings.equalizer[idx] });
        input.addEventListener('input', () => {
          const v = parseFloat(input.value);
          val.textContent = UI.fmt.db(v);
          settings.equalizer[idx] = v;
          markCustom(); applyAll(); persistSettings();
        });
        col.appendChild(val);
        col.appendChild(this.h('div', { class: 'uae-eq-slider-wrap' }, input));
        col.appendChild(this.h('span', { class: 'uae-lbl', text: lbl }));
        grid.appendChild(col);
        this.controls.eq.push({ input: input, val: val });
      }
      m.body.appendChild(grid);
      const flat = this.btn('Flat', 'Reset all bands to 0 dB');
      flat.addEventListener('click', () => {
        settings.equalizer = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
        markCustom(); applyAll(); persistSettings();
        UI.syncEq();
      });
      const btns = this.h('div', { class: 'uae-btn-row' }, [flat]);
      m.body.appendChild(btns);
      m.body.appendChild(this.h('div', { class: 'uae-hint', text: '10-band graphic equalizer, \u221215\u2026+15 dB per band.' }));
    },

    syncEq: function () {
      if (!this.controls.eq) return;
      for (let i = 0; i < EQ_BANDS.length; i++) {
        this.controls.eq[i].input.value = settings.equalizer[i];
        this.controls.eq[i].val.textContent = this.fmt.db(settings.equalizer[i]);
      }
    },

    buildAutoEqModal: function () {
      const m = this.modalEls.autoeq;
      const body = m.body;
      const status = this.h('div', { class: 'uae-statusline' }, ['No AutoEq preset active.']);
      const info = this.h('div', { class: 'uae-statusline' }, ['']);
      const busy = this.h('div', { class: 'uae-busy' }, ['Loading\u2026']);
      const err = this.h('div', { class: 'uae-statusline' }, [this.h('span', { class: 'err', text: '' })]);
      const search = this.h('input', { class: 'uae-input', placeholder: 'Search headphones\u2026' });
      const list = this.h('div', { class: 'uae-list' });
      const refreshB = this.btn('Refresh Index', 'Re-download AutoEq INDEX.md');
      const unloadB = this.btn('Unload', 'Remove active AutoEq preset');

      this.els.autoeqStatus = status;
      this.els.autoeqInfo = info;
      this.els.autoeqBusy = busy;
      this.els.autoeqErr = err;
      this.els.autoeqSearch = search;
      this.els.autoeqList = list;

      refreshB.addEventListener('click', () => AutoEq.refresh());
      unloadB.addEventListener('click', () => AutoEq.unload());
      search.addEventListener('input', () => UI.renderAutoEqList());

      body.appendChild(status);
      body.appendChild(info);
      body.appendChild(busy);
      body.appendChild(err);
      body.appendChild(this.h('div', { class: 'uae-row' }, [this.h('div', { class: 'uae-btn-row' }, [refreshB, unloadB])]));
      body.appendChild(search);
      body.appendChild(list);
      body.appendChild(this.h('div', { class: 'uae-hint', text: 'Headphone EQ presets from github.com/nextscript/AutoEq. Only the selected preset is downloaded; the index is cached locally.' }));
      UI.renderAutoEqList();
    },

    autoeqActiveStatus: function (sel) {
      const el = this.els.autoeqStatus;
      if (!el) return;
      el.textContent = sel ? 'Active: ' + sel.name + (sel.source ? '  \u00B7  ' + sel.source : '') : 'No AutoEq preset active.';
    },

    autoeqInfo: function (count, ts) {
      const el = this.els.autoeqInfo;
      if (!el) return;
      if (!count) { el.textContent = 'Index not cached \u2013 click Refresh Index.'; return; }
      const d = new Date(ts);
      const stamp = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      el.textContent = 'Index: ' + count.toLocaleString() + ' presets \u00B7 updated ' + stamp;
    },

    autoeqBusy: function (b) {
      const el = this.els.autoeqBusy;
      if (el) el.classList.toggle('show', b);
    },

    autoeqError: function (msg) {
      const el = this.els.autoeqErr;
      if (!el) return;
      el.firstChild.textContent = msg;
    },

    renderAutoEqList: function () {
      const list = this.els.autoeqList;
      if (!list || !AutoEq.index) return;
      const q = (this.els.autoeqSearch ? this.els.autoeqSearch.value : '').trim().toLowerCase();
      list.textContent = '';
      let shown = 0;
      for (const entry of AutoEq.index) {
        if (q && entry.name.toLowerCase().indexOf(q) < 0 && entry.source.toLowerCase().indexOf(q) < 0) continue;
        const active = AutoEq.selected && AutoEq.selected.name === entry.name && AutoEq.selected.path === entry.path;
        const item = this.h('div', { class: 'uae-list-item' + (active ? ' active' : '') }, [
          this.h('span', { class: 'uae-li-name', text: entry.name }),
          this.h('span', { class: 'uae-li-src', text: entry.source })
        ]);
        const lb = this.btn(active ? 'Loaded' : 'Load');
        if (active) lb.className += ' primary';
        lb.addEventListener('click', () => AutoEq.load(entry));
        item.appendChild(lb);
        list.appendChild(item);
        shown++;
        if (shown >= 400) break;
      }
      if (!shown) list.appendChild(this.h('div', { class: 'uae-list-item' }, [this.h('span', { class: 'uae-li-name', text: 'No matches' })]));
    },

    buildLimiterModal: function () {
      const m = this.modalEls.limiter;
      const body = m.body;
      const add = (key, label, min, max, step, fmt) => {
        const ctrl = this.sliderRow(label, {
          min: min, max: max, step: step, value: settings[key], fmt: fmt,
          oninput: (v) => {
            settings[key] = v;
            markCustom();
            applyAll();
            persistSettings();
          }
        });
        this.controls[key] = ctrl;
        body.appendChild(ctrl.row);
      };
      add('limiterThreshold', 'Threshold', -20, 0, 0.5, 'db');
      add('limiterRelease', 'Release', 10, 1000, 10, (v) => Math.round(v) + ' ms');
      add('limiterAttack', 'Attack', 0.1, 100, 0.1, (v) => (Math.round(v * 10) / 10) + ' ms');
      add('limiterCeiling', 'Output Ceiling', -6, 0, 0.1, 'db');
      add('limiterLookahead', 'Lookahead', 0, 20, 0.5, (v) => (Math.round(v * 10) / 10) + ' ms');
      body.appendChild(this.h('div', { class: 'uae-hint', text: 'The quick toggle only enables or bypasses the limiter. These values are kept while it is off.' }));
    },

    buildFiltersModal: function () {
      const m = this.modalEls.filters;
      const body = m.body;
      const hpf = this.toggleRow('High-Pass Filter', settings.highPass, (v) => {
        settings.highPass = v;
        markCustom(); applyAll(); persistSettings();
        UI.syncUI();
      });
      const hpfFreq = this.sliderRow('HPF Frequency', {
        min: 20, max: 500, step: 5, value: settings.highPassFreq, fmt: 'hz',
        disabled: !settings.highPass,
        oninput: (v) => { settings.highPassFreq = v; markCustom(); applyAll(); persistSettings(); }
      });
      const lpf = this.toggleRow('Low-Pass Filter', settings.lowPass, (v) => {
        settings.lowPass = v;
        markCustom(); applyAll(); persistSettings();
        UI.syncUI();
      });
      const lpfFreq = this.sliderRow('LPF Frequency', {
        min: 1000, max: 20000, step: 100, value: settings.lowPassFreq, fmt: 'khz',
        disabled: !settings.lowPass,
        oninput: (v) => { settings.lowPassFreq = v; markCustom(); applyAll(); persistSettings(); }
      });
      this.controls.hpf = hpf;
      this.controls.hpfFreq = hpfFreq;
      this.controls.lpf = lpf;
      this.controls.lpfFreq = lpfFreq;
      body.appendChild(hpf.row);
      body.appendChild(hpfFreq.row);
      body.appendChild(lpf.row);
      body.appendChild(lpfFreq.row);
      body.appendChild(this.h('div', { class: 'uae-hint', text: 'HPF removes low-frequency rumble (20\u2013500 Hz). LPF rolls off highs (1\u201320 kHz) for a warmer sound.' }));
    },

    // ---------- state sync ----------
    syncUI: function () {
      const c = this.controls;
      if (c.enabled) c.enabled.set(settings.enabled);
      if (c.volume) c.volume.set(settings.volumeBoost);
      if (c.bass) c.bass.set(settings.bassBoost);
      if (c.treble) c.treble.set(settings.trebleBoost);
      if (c.dfxPreset) c.dfxPreset.set(settings.dfxPreset);
      if (c.dfxFidelity) c.dfxFidelity.set(settings.dfxFidelity);
      if (c.dfxAmbience) c.dfxAmbience.set(settings.dfxAmbience);
      if (c.dfxSurround) c.dfxSurround.set(settings.dfxSurround);
      if (c.dfxDynamicBoost) c.dfxDynamicBoost.set(settings.dfxDynamicBoost);
      if (c.dfxHyperBass) c.dfxHyperBass.set(settings.dfxHyperBass);
      if (this.els.limBtn) this.els.limBtn.textContent = settings.limiter ? 'Limiter (X) \u2713' : 'Limiter (X)';
      if (c.limiterThreshold) c.limiterThreshold.set(settings.limiterThreshold);
      if (c.limiterRelease) c.limiterRelease.set(settings.limiterRelease);
      if (c.limiterAttack) c.limiterAttack.set(settings.limiterAttack);
      if (c.limiterCeiling) c.limiterCeiling.set(settings.limiterCeiling);
      if (c.limiterLookahead) c.limiterLookahead.set(settings.limiterLookahead);
      if (c.eq) this.syncEq();
      if (c.hpf) { c.hpf.set(settings.highPass); c.hpfFreq.disable(!settings.highPass); c.hpfFreq.set(settings.highPassFreq); }
      if (c.lpf) { c.lpf.set(settings.lowPass); c.lpfFreq.disable(!settings.lowPass); c.lpfFreq.set(settings.lowPassFreq); }
    },

    updateStatus: function () {
      const running = Engine.ctx && Engine.ctx.state === 'running';
      const suspended = Engine.ctx && Engine.ctx.state === 'suspended';
      let cls = '';
      let text = 'Standby';
      if (settings.enabled && running) { cls = 'on'; text = 'Active'; }
      else if (suspended) { cls = 'susp'; text = 'Suspended'; }
      else if (running) { cls = ''; text = 'Off'; }
      else { cls = ''; text = 'Standby'; }
      const st = this.els.status;
      if (st) {
        const dot = st.firstChild;
        const txt = st.lastChild;
        dot.className = 'uae-dot ' + cls;
        txt.textContent = text;
      }
      if (this.els.pillDot) this.els.pillDot.className = 'uae-dot ' + cls;
    },

    updateWarning: function () {
      const w = this.els.warn;
      if (!w) return;
      const extreme = settings.volumeBoost >= 200 || settings.dfxDynamicBoost >= 8 || settings.dfxHyperBass >= 8;
      w.classList.toggle('show', extreme);
    },

    // ---------- shortcuts ----------
    bindShortcuts: function () {
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          if (UI.activeModal) { e.preventDefault(); UI.closeModal(); }
          return;
        }
        const t = e.target;
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
        if (!(e.ctrlKey && e.shiftKey) || e.altKey || e.metaKey) return;
        const k = (e.key || '').toLowerCase();
        let handled = true;
        switch (k) {
          case 'a': UI.togglePanel(); break;
          case 'e': UI.openModal('equalizer'); break;
          case 'q': UI.openModal('autoeq'); break;
          case 'f': UI.openModal('filters'); break;
          case 'b': toggleBass(); break;
          case 't': toggleTreble(); break;
          case 'l': settings.highPass = !settings.highPass; afterQuick(); break;
          case 'x': settings.limiter = !settings.limiter; afterQuick(); break;
          case 'r': resetSettings(); UI.syncUI(); break;
          default: handled = false;
        }
        if (handled) e.preventDefault();
      });
    },

    // ---------- export / import ----------
    exportConfig: function () {
      const data = {
        version: VERSION,
        settings: settings,
        ui: uiState
      };
      try {
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = EXPORT_FILENAME;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
      } catch (e) { alert('Export failed: ' + e.message); }
    },

    importConfig: function () {
      const inp = document.createElement('input');
      inp.type = 'file';
      inp.accept = '.json,application/json';
      inp.addEventListener('change', () => {
        const file = inp.files && inp.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
          let data = null;
          try { data = JSON.parse(String(reader.result)); } catch (e) { alert('Invalid JSON file.'); return; }
          if (!data || typeof data !== 'object') { alert('Invalid or unsupported configuration.'); return; }
          let applied = false;
          try {
            if (data.settings) {
              settings = sanitizeSettings(data.settings);
              applied = true;
            }
            if (data.ui && typeof data.ui === 'object') {
              if (typeof data.ui.x === 'number') uiState.x = data.ui.x;
              if (typeof data.ui.y === 'number') uiState.y = data.ui.y;
              if (typeof data.ui.collapsed === 'boolean') uiState.collapsed = data.ui.collapsed;
              if (typeof data.ui.hidden === 'boolean') uiState.hidden = data.ui.hidden;
              if (data.ui.modals && typeof data.ui.modals === 'object') {
                uiState.modals = {};
                for (const k in data.ui.modals) {
                  const p = data.ui.modals[k];
                  if (p && typeof p.x === 'number' && typeof p.y === 'number') {
                    uiState.modals[k] = { x: p.x, y: p.y };
                  }
                }
              }
              applied = true;
            }
          } catch (_) { alert('Import failed: unsupported configuration.'); return; }
          if (applied) {
            persistSettingsNow(); persistUI();
            applyAll();
            UI.syncUI();
            alert('Configuration imported.');
          } else {
            alert('No supported sections found in file.');
          }
        };
        reader.readAsText(file);
      });
      document.body.appendChild(inp);
      inp.click();
      inp.remove();
    }
  };

  // ---------- shortcut helpers ----------
  function afterQuick() {
    markCustom();
    applyAll();
    persistSettings();
    UI.syncUI();
  }

  function toggleBass() {
    if (settings.bassBoost > 0) { settings._lastBass = settings.bassBoost; settings.bassBoost = 0; }
    else settings.bassBoost = settings._lastBass > 0 ? settings._lastBass : 30;
    afterQuick();
  }

  function toggleTreble() {
    if (settings.trebleBoost > 0) { settings._lastTreble = settings.trebleBoost; settings.trebleBoost = 0; }
    else settings.trebleBoost = settings._lastTreble > 0 ? settings._lastTreble : 20;
    afterQuick();
  }

  function setEnabled(v) {
    settings.enabled = v;
    if (v) {
      Engine.ensure();
    } else {
      Engine.setAutoEq(null);
    }
    applyAll();
    UI.syncUI();
  }

  // ============================================================================
  // 15. Initialization
  // ============================================================================
  function initialize() {
    try {
      UI.build();
      startObserving();
      console.info('[UAE] v' + VERSION + ' loaded. ' + (Storage.gm ? 'GM storage' : 'localStorage') + ' backend.');
    } catch (e) {
      console.error('[UAE] init failed:', e);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize, { once: true });
  } else {
    initialize();
  }
})();
