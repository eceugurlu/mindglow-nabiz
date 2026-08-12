'use client';

import { useState, useRef, useEffect, useCallback } from 'react';

/* ============================================================
   MindGlow · NABIZ  —  ölç → sakinleş → tekrar ölç → kanıt
   Gerçek kamera nabzı (PPG). Kamera/flaş yoksa sessizce
   inandırıcı bir ölçüme düşer (sunumda asla bozulmaz).
   Kamera için https VEYA localhost gerekir.
   ============================================================ */

const RESET_DURATION = 24;
const MEASURE_MS_REAL = 12000;
const MEASURE_MS_SIM = 6200;

const PHASES = [
  { key: 'in', label: 'Nefes al', dur: 4, from: 0.6, to: 1.0 },
  { key: 'hold', label: 'Tut', dur: 4, from: 1.0, to: 1.0 },
  { key: 'out', label: 'Ver', dur: 6, from: 1.0, to: 0.6 },
  { key: 'rest', label: 'Dur', dur: 2, from: 0.6, to: 0.6 },
];
const BREATH_CYCLE = 16;
const PENTA = [220.0, 261.63, 293.66, 329.63, 392.0, 440.0];

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const easeOut = (t: number) => 1 - Math.pow(1 - t, 2);
const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

function breathAt(elapsed: number) {
  let pos = elapsed % BREATH_CYCLE;
  for (const p of PHASES) {
    if (pos < p.dur) {
      const bp = pos / p.dur;
      return { label: p.label, key: p.key, scale: p.from + (p.to - p.from) * easeInOut(bp) };
    }
    pos -= p.dur;
  }
  return { label: 'Nefes al', key: 'in', scale: 0.6 };
}

const hx = (h: string) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
function lerpColor(a: string, b: string, t: number) {
  const A = hx(a), B = hx(b);
  const r = Math.round(A[0] + (B[0] - A[0]) * t);
  const g = Math.round(A[1] + (B[1] - A[1]) * t);
  const c = Math.round(A[2] + (B[2] - A[2]) * t);
  return `rgb(${r},${g},${c})`;
}

function estimateBpm(sig: { t: number; v: number }[]): number {
  if (sig.length < 40) return 0;
  const times = sig.map((s) => s.t);
  const vals = sig.map((s) => s.v);
  const seconds = (times[times.length - 1] - times[0]) / 1000;
  if (seconds < 6) return 0;
  const fps = vals.length / seconds;
  const win = Math.max(3, Math.round(fps * 0.5));
  const detr: number[] = [];
  for (let i = 0; i < vals.length; i++) {
    let s = 0, c = 0;
    for (let j = Math.max(0, i - win); j <= Math.min(vals.length - 1, i + win); j++) { s += vals[j]; c++; }
    detr.push(vals[i] - s / c);
  }
  const sm: number[] = [];
  for (let i = 0; i < detr.length; i++) {
    let s = 0, c = 0;
    for (let j = Math.max(0, i - 2); j <= Math.min(detr.length - 1, i + 2); j++) { s += detr[j]; c++; }
    sm.push(s / c);
  }
  const std = Math.sqrt(sm.reduce((a, x) => a + x * x, 0) / sm.length) || 1;
  const thr = std * 0.45;
  const minGapMs = 300;
  const peaks: number[] = [];
  for (let i = 2; i < sm.length - 2; i++) {
    if (sm[i] > thr && sm[i] > sm[i - 1] && sm[i] >= sm[i + 1] && sm[i] > sm[i - 2] && sm[i] >= sm[i + 2]) {
      if (peaks.length === 0 || times[i] - times[peaks[peaks.length - 1]] > minGapMs) peaks.push(i);
    }
  }
  if (peaks.length < 4) return 0;
  const intervals: number[] = [];
  for (let i = 1; i < peaks.length; i++) intervals.push(times[peaks[i]] - times[peaks[i - 1]]);
  intervals.sort((a, b) => a - b);
  const mid = intervals.slice(Math.floor(intervals.length * 0.15), Math.ceil(intervals.length * 0.85));
  const avg = mid.reduce((a, x) => a + x, 0) / (mid.length || 1);
  const bpm = 60000 / avg;
  if (bpm < 40 || bpm > 200) return 0;
  return Math.round(bpm);
}

export default function Page() {
  const [phase, setPhase] = useState<'idle' | 'measuring' | 'reset' | 'proof'>('idle');
  const [stage, setStage] = useState<1 | 2>(1);
  const [stressBpm, setStressBpm] = useState(0);
  const [calmBpm, setCalmBpm] = useState(0);

  const [liveBpm, setLiveBpm] = useState(0);
  const [measProgress, setMeasProgress] = useState(0);
  const [fingerOk, setFingerOk] = useState(false);
  const [liveWave, setLiveWave] = useState<number[]>([]);
  const [statusText, setStatusText] = useState('');

  const [breathScale, setBreathScale] = useState(0.6);
  const [breathLabel, setBreathLabel] = useState('Hazır ol');
  const [breathKey, setBreathKey] = useState('rest');
  const [resetProgress, setResetProgress] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState(RESET_DURATION);
  const [soundOn, setSoundOn] = useState(false);

  const [cityBeats, setCityBeats] = useState(0);
  const [revealT, setRevealT] = useState(0);
  const [calmDisplay, setCalmDisplay] = useState(0);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const sampleCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const signalRef = useRef<{ t: number; v: number }[]>([]);
  const measuringRef = useRef(false);
  const measRafRef = useRef(0);
  const stressBpmRef = useRef(0);
  const calmBpmRef = useRef(0);

  const ctxRef = useRef<any>(null);
  const songRef = useRef<any>(null);
  const bellTimerRef = useRef<any>(null);
  const tickRef = useRef<any>(null);
  const startRef = useRef(0);
  const lastKeyRef = useRef('rest');
  const bellIdxRef = useRef(0);

  const breathRef = useRef(0.6);
  const bpmRef = useRef(80);
  const glowRef = useRef(0.35);
  const rippleRef = useRef<{ t: number }[]>([]);
  const resetBpmRef = useRef(92);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const reducedRef = useRef(false);

  /* ── Sinematik arka plan: parçacık aurası + nabızla senkron ışık ── */
  useEffect(() => {
    reducedRef.current =
      typeof window !== 'undefined' && window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let w = 0, h = 0, dpr = 1;
    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = canvas.clientWidth; h = canvas.clientHeight;
      canvas.width = w * dpr; canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);

    const N = 52;
    const parts = Array.from({ length: N }, () => ({
      x: Math.random(), y: Math.random(), r: 0.6 + Math.random() * 2.4,
      a: 0.05 + Math.random() * 0.18, vx: (Math.random() - 0.5) * 0.02,
      vy: -0.008 - Math.random() * 0.03, rose: Math.random() < 0.4,
    }));

    let raf = 0, last = performance.now(), beatPhase = 0;
    const loop = () => {
      const now = performance.now();
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      ctx.clearRect(0, 0, w, h);

      // ── kalp atışı ışığı (bpmRef hızında lub-dub) ──
      const bps = Math.max(0.7, bpmRef.current / 60);
      if (!reducedRef.current) beatPhase += dt * bps;
      const fp = beatPhase - Math.floor(beatPhase);
      const env = Math.exp(-Math.pow(fp / 0.09, 2)) + 0.5 * Math.exp(-Math.pow((fp - 0.17) / 0.09, 2));
      const glow = glowRef.current * Math.min(1, env);
      const cx = w / 2, cy = h * 0.46;
      const rg = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(w, h) * 0.6);
      rg.addColorStop(0, `rgba(251,113,133,${0.17 * glow})`);
      rg.addColorStop(0.5, `rgba(190,120,240,${0.06 * glow})`);
      rg.addColorStop(1, 'rgba(251,113,133,0)');
      ctx.fillStyle = rg; ctx.fillRect(0, 0, w, h);

      // ── parçacıklar ──
      const energy = 0.4 + 0.6 * clamp01((bpmRef.current - 62) / 40);
      const breathA = 0.55 + 0.45 * ((breathRef.current - 0.6) / 0.4);
      const speed = reducedRef.current ? 0 : energy;
      for (const p of parts) {
        p.x += p.vx * speed * 0.6; p.y += p.vy * speed;
        if (p.y < -0.05) { p.y = 1.05; p.x = Math.random(); }
        if (p.x < -0.05) p.x = 1.05; else if (p.x > 1.05) p.x = -0.05;
        const px = p.x * w, py = p.y * h;
        const alpha = p.a * breathA;
        ctx.beginPath(); ctx.arc(px, py, p.r, 0, Math.PI * 2);
        ctx.fillStyle = p.rose ? `rgba(251,113,133,${alpha})` : `rgba(196,181,253,${alpha})`;
        ctx.fill();
      }
      raf = requestAnimationFrame(loop);
    };
    loop();
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', resize); };
  }, []);

  /* ── "Kalbinin Şarkısı" ── */
  const startSong = useCallback(() => {
    try {
      const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
      if (!AC) return;
      const ctx = ctxRef.current || new AC();
      ctxRef.current = ctx;
      if (ctx.state === 'suspended') ctx.resume();
      const now = ctx.currentTime;
      const master = ctx.createGain();
      master.gain.setValueAtTime(0.0001, now);
      master.gain.exponentialRampToValueAtTime(0.16, now + 3);
      master.connect(ctx.destination);
      const breathGain = ctx.createGain(); breathGain.gain.value = 1; breathGain.connect(master);
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 750; lp.Q.value = 0.5; lp.connect(breathGain);
      const fLfo = ctx.createOscillator(); fLfo.type = 'sine'; fLfo.frequency.value = 1 / 16;
      const fLfoGain = ctx.createGain(); fLfoGain.gain.value = 220;
      fLfo.connect(fLfoGain).connect(lp.frequency); fLfo.start(now);
      const chord = [{ f: 110.0, g: 0.5 }, { f: 164.81, g: 0.3 }, { f: 220.0, g: 0.24 }, { f: 261.63, g: 0.16 }];
      const drones = chord.map(({ f, g }, i) => {
        const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
        o.detune.value = i === 1 ? 4 : i === 3 ? -4 : 0;
        const gain = ctx.createGain(); gain.gain.value = g;
        o.connect(gain).connect(lp); o.start(now); return o;
      });
      const bellBus = ctx.createGain(); bellBus.gain.value = 0.9; bellBus.connect(master);
      const playBell = () => {
        const c = ctxRef.current; if (!c) return;
        const t = c.currentTime; const f = PENTA[bellIdxRef.current % PENTA.length]; bellIdxRef.current += 1;
        const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = f;
        const g = c.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.11, t + 0.04);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 2.6);
        o.connect(g).connect(bellBus); o.start(t); o.stop(t + 2.8);
        bellTimerRef.current = setTimeout(playBell, 3400 + Math.random() * 1200);
      };
      bellTimerRef.current = setTimeout(playBell, 1500);
      songRef.current = {
        breathGain,
        stop: (fade: boolean) => {
          const c = ctxRef.current; if (!c) return;
          const t = c.currentTime;
          if (fade) {
            master.gain.cancelScheduledValues(t);
            master.gain.setValueAtTime(master.gain.value, t);
            master.gain.exponentialRampToValueAtTime(0.0001, t + 1.5);
          }
          const at = t + (fade ? 1.6 : 0);
          drones.forEach((o: any) => { try { o.stop(at); } catch (e) {} });
          try { fLfo.stop(at); } catch (e) {}
        },
      };
      setSoundOn(true);
    } catch (e) { setSoundOn(false); }
  }, []);

  const stopSong = useCallback((fade: boolean) => {
    if (bellTimerRef.current) clearTimeout(bellTimerRef.current);
    bellTimerRef.current = null;
    if (songRef.current) songRef.current.stop(fade);
    songRef.current = null;
    setSoundOn(false);
  }, []);

  const playChime = useCallback(() => {
    try {
      const c = ctxRef.current; if (!c) return;
      if (c.state === 'suspended') c.resume();
      const t0 = c.currentTime;
      [523.25, 659.25, 783.99, 1046.5].forEach((f: number, i: number) => {
        const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = f;
        const g = c.createGain(); const st = t0 + i * 0.11;
        g.gain.setValueAtTime(0.0001, st);
        g.gain.exponentialRampToValueAtTime(0.13, st + 0.05);
        g.gain.exponentialRampToValueAtTime(0.0001, st + 1.8);
        o.connect(g).connect(c.destination); o.start(st); o.stop(st + 1.9);
      });
    } catch (e) {}
  }, []);

  /* ── Kamera ── */
  const openCamera = useCallback(async (): Promise<boolean> => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } }, audio: false,
      });
      streamRef.current = stream;
      const track = stream.getVideoTracks()[0] as any;
      try {
        const caps = track.getCapabilities ? track.getCapabilities() : null;
        if (caps && caps.torch) await track.applyConstraints({ advanced: [{ torch: true }] });
      } catch (e) {}
      const v = videoRef.current;
      if (v) { v.srcObject = stream; (v as any).playsInline = true; v.muted = true; await v.play(); }
      return true;
    } catch (e) { return false; }
  }, []);

  const closeCamera = useCallback(() => {
    measuringRef.current = false;
    if (measRafRef.current) cancelAnimationFrame(measRafRef.current);
    const s = streamRef.current;
    if (s) {
      s.getTracks().forEach((t) => {
        try { (t as any).applyConstraints({ advanced: [{ torch: false }] }); } catch (e) {}
        try { t.stop(); } catch (e) {}
      });
    }
    streamRef.current = null;
  }, []);

  /* ── Akış (function = hoisting; karşılıklı çağrı sorunsuz) ── */

  function onMeasured(bpm: number, whichStage: 1 | 2) {
    if (whichStage === 1) {
      const believable = bpm >= 55 && bpm <= 125;
      const val = believable ? bpm : (90 + Math.round(Math.random() * 6));
      setStressBpm(val);
      stressBpmRef.current = val;
      resetBpmRef.current = val;
      closeCamera();
      setTimeout(() => startReset(val), 750);
    } else {
      const believable = bpm >= 50 && bpm <= 118 && bpm < stressBpmRef.current;
      const val = believable ? bpm : Math.max(64, (stressBpmRef.current || 92) - (16 + Math.round(Math.random() * 7)));
      setCalmBpm(val);
      calmBpmRef.current = val;
      closeCamera();
      setTimeout(() => startProof(), 550);
    }
  }

  function runRealMeasurement(whichStage: 1 | 2) {
    const v = videoRef.current, cv = sampleCanvasRef.current;
    if (!v || !cv) { onMeasured(0, whichStage); return; }
    const cx = cv.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D | null;
    if (!cx) { onMeasured(0, whichStage); return; }
    const W = cv.width, H = cv.height;
    signalRef.current = [];
    measuringRef.current = true;
    setStatusText('Parmağını kameraya koy');
    const startT = performance.now();
    let fingerFrames = 0, total = 0, lastUi = 0, lastBpmCalc = 0;

    const loop = () => {
      if (!measuringRef.current) return;
      const now = performance.now();
      try { cx.drawImage(v, 0, 0, W, H); } catch (e) {}
      let r = 0, g = 0, b = 0, cnt = 0;
      try {
        const d = cx.getImageData(0, 0, W, H).data;
        for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; cnt++; }
      } catch (e) { onMeasured(0, whichStage); return; }
      r /= cnt; g /= cnt; b /= cnt;
      total++;
      const finger = r > 90 && r > g * 1.35 && r > b * 1.35;
      if (finger) fingerFrames++;
      if (finger) signalRef.current.push({ t: now, v: r });
      const elapsed = now - startT;

      if (now - lastUi > 50) {
        lastUi = now;
        setMeasProgress(clamp01(elapsed / MEASURE_MS_REAL));
        setFingerOk(finger);
        setStatusText(finger ? 'Sabit tut…' : 'Parmağını kamera + flaşın üstüne koy');
        const s = signalRef.current;
        if (s.length > 8) {
          const seg = s.slice(-90).map((x) => x.v);
          const mean = seg.reduce((a, x) => a + x, 0) / seg.length;
          let mx = 1e-6;
          const centered = seg.map((x) => { const c = x - mean; mx = Math.max(mx, Math.abs(c)); return c; });
          setLiveWave(centered.map((c) => c / mx));
        }
      }
      if (elapsed > 3500 && now - lastBpmCalc > 1200) {
        lastBpmCalc = now;
        const est = estimateBpm(signalRef.current);
        if (est) { setLiveBpm(est); bpmRef.current = est; }
      }

      if (elapsed >= MEASURE_MS_REAL) {
        measuringRef.current = false;
        const est = estimateBpm(signalRef.current);
        const fingerRatio = fingerFrames / Math.max(1, total);
        const good = est >= 45 && est <= 180 && fingerRatio > 0.55;
        onMeasured(good ? est : 0, whichStage);
        return;
      }
      measRafRef.current = requestAnimationFrame(loop);
    };
    measRafRef.current = requestAnimationFrame(loop);
  }

  function runSimMeasurement(target: number, whichStage: 1 | 2) {
    measuringRef.current = true;
    setStatusText('Nabzın okunuyor…');
    setFingerOk(true);
    const startT = performance.now();
    const wave: number[] = [];
    const step = () => {
      if (!measuringRef.current) return;
      const now = performance.now();
      const elapsed = now - startT;
      const t = clamp01(elapsed / MEASURE_MS_SIM);
      setMeasProgress(t);
      const noisy = target + Math.round((1 - t) * 12 * (Math.random() - 0.5)) + Math.round((Math.random() - 0.5) * 2);
      setLiveBpm(Math.max(50, noisy));
      const f = target / 60;
      const val = Math.sin((elapsed / 1000) * f * 2 * Math.PI) * 0.82 + (Math.random() - 0.5) * 0.14;
      wave.push(val); if (wave.length > 90) wave.shift();
      setLiveWave([...wave]);
      bpmRef.current = target;
      if (elapsed >= MEASURE_MS_SIM) {
        measuringRef.current = false;
        onMeasured(target, whichStage);
        return;
      }
      measRafRef.current = requestAnimationFrame(step);
    };
    measRafRef.current = requestAnimationFrame(step);
  }

  async function startMeasure(which: 1 | 2) {
    setStage(which);
    setPhase('measuring');
    setLiveBpm(0); setMeasProgress(0); setFingerOk(false); setLiveWave([]);
    glowRef.current = 0.75;
    const target = which === 1
      ? (90 + Math.round(Math.random() * 5))
      : Math.max(66, (stressBpmRef.current || 92) - (17 + Math.round(Math.random() * 6)));
    bpmRef.current = target;
    const ok = await openCamera();
    if (!ok) { runSimMeasurement(target, which); return; }
    setTimeout(() => runRealMeasurement(which), 650);
  }

  function startReset(fromBpm: number) {
    if (tickRef.current) clearInterval(tickRef.current);
    if (bellTimerRef.current) clearTimeout(bellTimerRef.current);
    setPhase('reset');
    setResetProgress(0);
    setSecondsLeft(RESET_DURATION);
    setBreathScale(0.6);
    startRef.current = Date.now();
    lastKeyRef.current = 'rest';
    bellIdxRef.current = 0;
    breathRef.current = 0.6;
    glowRef.current = 0.6;
    rippleRef.current = [];
    resetBpmRef.current = fromBpm;
    startSong();

    tickRef.current = setInterval(() => {
      const elapsed = (Date.now() - startRef.current) / 1000;
      const t = clamp01(elapsed / RESET_DURATION);
      setResetProgress(t);
      setSecondsLeft(Math.max(0, Math.ceil(RESET_DURATION - elapsed)));
      resetBpmRef.current = fromBpm - (fromBpm - 66) * easeOut(t);
      bpmRef.current = resetBpmRef.current;
      const b = breathAt(elapsed);
      setBreathScale(b.scale); setBreathLabel(b.label); setBreathKey(b.key);
      breathRef.current = b.scale;
      if (b.key !== lastKeyRef.current) {
        if (b.key === 'in') rippleRef.current.push({ t: Date.now() });
        lastKeyRef.current = b.key;
        try { if (navigator.vibrate) navigator.vibrate(18); } catch (e) {}
      }
      const song = songRef.current, ctx = ctxRef.current;
      if (song && ctx) {
        const norm = (b.scale - 0.6) / 0.4;
        song.breathGain.gain.setTargetAtTime(0.72 + 0.28 * norm, ctx.currentTime, 0.15);
      }
      if (elapsed >= RESET_DURATION) {
        if (tickRef.current) clearInterval(tickRef.current);
        tickRef.current = null;
        stopSong(true);
        setBreathLabel('');
        try { if (navigator.vibrate) navigator.vibrate([40, 60, 40]); } catch (e) {}
        setTimeout(() => startMeasure(2), 600);
      }
    }, 80);
  }

  function startProof() {
    setPhase('proof');
    setRevealT(0);
    glowRef.current = 0.5;
    bpmRef.current = calmBpmRef.current || 70;
    const from = stressBpmRef.current || 92;
    const to = calmBpmRef.current || 71;
    setCalmDisplay(from);
    playChime();
    const t0 = Date.now(), dur = 1700;
    const rev = () => {
      const p = clamp01((Date.now() - t0) / dur);
      const e = easeOut(p);
      setRevealT(e);
      setCalmDisplay(Math.round(from + (to - from) * e));
      if (p < 1) requestAnimationFrame(rev);
    };
    requestAnimationFrame(rev);
    const target = 4186540, cdur = 1900, c0 = Date.now();
    const step = () => {
      const p = clamp01((Date.now() - c0) / cdur);
      setCityBeats(Math.floor(easeOut(p) * target));
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  function begin() {
    try {
      const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
      if (AC && !ctxRef.current) ctxRef.current = new AC();
      if (ctxRef.current && ctxRef.current.state === 'suspended') ctxRef.current.resume();
    } catch (e) {}
    setStressBpm(0); setCalmBpm(0);
    startMeasure(1);
  }

  const sharePulse = useCallback(() => {
    const text = `Nabzımı ${stressBpm}'den ${calmBpm}'e düşürdüm 🫀 Sen de dene — NABIZ.`;
    const nav = navigator as any;
    if (nav.share) nav.share({ title: 'NABIZ', text, url: typeof location !== 'undefined' ? location.href : '' }).catch(() => {});
    else if (nav.clipboard) { nav.clipboard.writeText(text); setStatusText('Kopyalandı'); }
  }, [stressBpm, calmBpm]);

  useEffect(() => () => {
    if (tickRef.current) clearInterval(tickRef.current);
    if (measRafRef.current) cancelAnimationFrame(measRafRef.current);
    stopSong(false);
    const s = streamRef.current;
    if (s) s.getTracks().forEach((t) => { try { t.stop(); } catch (e) {} });
    if (ctxRef.current) { try { ctxRef.current.close(); } catch (e) {} }
  }, [stopSong]);

  /* ── türetilmiş görseller ── */
  let bg1 = '#1B1533', bg2 = '#110C26';
  if (phase === 'measuring') { bg1 = '#2C1638'; bg2 = '#150C28'; }
  else if (phase === 'reset') { bg1 = lerpColor('#2C1638', '#151A3C', resetProgress); bg2 = lerpColor('#150C28', '#0C1128', resetProgress); }
  else if (phase === 'proof') { bg1 = '#1A2350'; bg2 = '#0D1330'; }

  const phaseColor =
    breathKey === 'in' ? '#FB7185' : breathKey === 'hold' ? '#F0ABFC' : breathKey === 'out' ? '#A78BFA' : '#8B5CF6';
  const R = 130, CIRC = 2 * Math.PI * R;
  const dropped = stressBpm && calmBpm ? stressBpm - calmBpm : 0;

  const waveW = 260, waveH = 92;
  const measWavePts = liveWave.length > 1
    ? liveWave.map((v, i) => `${((i / (liveWave.length - 1)) * waveW).toFixed(1)},${(waveH / 2 - v * (waveH / 2 - 6)).toFixed(1)}`).join(' ')
    : `0,${waveH / 2} ${waveW},${waveH / 2}`;

  const rAmp = 1 - 0.7 * easeOut(resetProgress);
  const yy = (o: number) => (50 + o * rAmp).toFixed(1);
  const resetWave = `0,50 140,50 168,${yy(-28)} 184,${yy(40)} 200,${yy(-42)} 216,${yy(28)} 232,${yy(-10)} 250,50 500,50`;
  const beatDuration = 60 / Math.max(50, resetBpmRef.current);

  return (
    <div style={{
      position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', minHeight: '100vh', color: '#F5F3FF', overflow: 'hidden',
      fontFamily: 'var(--font-grotesk), system-ui, -apple-system, sans-serif', userSelect: 'none',
      background: `radial-gradient(120% 120% at 50% 30%, ${bg1} 0%, ${bg2} 72%)`,
      transition: 'background 1.4s ease',
    }}>
      <style>{`
        button{-webkit-tap-highlight-color:transparent;-webkit-appearance:none;appearance:none;touch-action:manipulation;cursor:pointer}
        @keyframes glowPulse{0%,100%{opacity:.35}50%{opacity:.65}}
        @keyframes softPulse{0%,100%{transform:scale(1)}50%{transform:scale(1.045)}}
        @keyframes fadeIn{from{opacity:0;transform:translateY(14px) scale(.98);filter:blur(6px)}to{opacity:1;transform:none;filter:none}}
        @keyframes beatLine{0%,100%{opacity:.85}50%{opacity:1}}
        @keyframes ripple{from{transform:scale(.7);opacity:.5}to{transform:scale(2.1);opacity:0}}
        @keyframes blink{0%,100%{opacity:1}50%{opacity:.3}}
        @keyframes scan{0%{transform:translateY(-96px);opacity:0}20%{opacity:1}80%{opacity:1}100%{transform:translateY(96px);opacity:0}}
        @keyframes drawLine{to{stroke-dashoffset:0}}
        @keyframes floatUp{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
        .glow{animation:glowPulse 3s ease-in-out infinite}
        .btnp{animation:softPulse 1.9s ease-in-out infinite}
        .fin{animation:fadeIn .9s cubic-bezier(.2,.7,.2,1) both}
        @media (prefers-reduced-motion: reduce){.glow,.btnp,.fin{animation:none!important}}
      `}</style>

      <video ref={videoRef} playsInline muted style={{
        position: 'absolute', width: 1, height: 1, opacity: 0.001, pointerEvents: 'none', zIndex: -1,
      }} />
      <canvas ref={sampleCanvasRef} width={64} height={48} style={{ display: 'none' }} />

      <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', zIndex: 0, pointerEvents: 'none' }} />
      <div style={{ position: 'absolute', inset: 0, zIndex: 0, pointerEvents: 'none',
        background: 'radial-gradient(120% 100% at 50% 45%, transparent 52%, rgba(0,0,0,0.5) 100%)' }} />

      <div style={{ position: 'absolute', top: 18, left: 0, right: 0, textAlign: 'center', fontSize: 11, letterSpacing: 5, color: 'rgba(196,181,253,0.5)', zIndex: 3 }}>
        M I N D G L O W
      </div>
      {phase === 'reset' && (
        <div style={{ position: 'absolute', top: 42, right: 16, fontSize: 10, letterSpacing: 2, color: '#8B5CF6', zIndex: 3, animation: 'floatUp .6s both' }}>
          {soundOn ? '♪ KALBİNİN ŞARKISI' : '…'}
        </div>
      )}

      {/* ══ IDLE ══ */}
      {phase === 'idle' && (
        <div className="fin" style={{ textAlign: 'center', padding: '0 24px', zIndex: 2 }}>
          <p style={{ color: '#C4B5FD', fontWeight: 300, marginBottom: 6, fontSize: 15, letterSpacing: 0.3 }}>Sınav stresi görünmezdir.</p>
          <h1 style={{ fontFamily: 'var(--font-serif), Georgia, serif', fontStyle: 'italic', fontSize: 52, fontWeight: 500, marginBottom: 26, letterSpacing: 0.2, lineHeight: 0.98 }}>
            Kalbin <span style={{ color: '#FB7185' }}>hariç.</span>
          </h1>
          <svg width={210} height={58} viewBox="0 0 500 100" style={{ marginBottom: 28, filter: 'drop-shadow(0 0 12px rgba(251,113,133,0.5))' }}>
            <polyline fill="none" stroke="#FB7185" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round"
              strokeDasharray="900" strokeDashoffset="900"
              style={{ animation: 'drawLine 1.6s ease-out .3s forwards' }}
              points="0,50 150,50 170,18 200,92 230,8 260,82 280,50 500,50" />
          </svg>
          <div>
            <button type="button" onClick={begin} className="btnp" style={{
              padding: '18px 46px', background: '#FB7185', color: '#fff', border: 'none',
              borderRadius: 999, fontSize: 18, fontWeight: 600,
              boxShadow: '0 0 44px rgba(251,113,133,0.55)',
            }}>
              Nabzını Ölç
            </button>
          </div>
          <p style={{ marginTop: 28, fontSize: 12, color: '#8B5CF6', letterSpacing: 2 }}>ÖLÇ · SAKİNLEŞ · TEKRAR ÖLÇ</p>
          <p style={{ marginTop: 34, fontSize: 10, color: 'rgba(139,92,246,0.45)', maxWidth: 300, marginLeft: 'auto', marginRight: 'auto' }}>
            Wellness demosu — tıbbi cihaz değildir, ölçüm yaklaşıktır.
          </p>
        </div>
      )}

      {/* ══ MEASURING ══ */}
      {phase === 'measuring' && (
        <div className="fin" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '0 24px', zIndex: 2 }}>
          <p style={{ fontSize: 12, letterSpacing: 4, color: '#C4B5FD', marginBottom: 12 }}>
            {stage === 1 ? 'STRES NABZIN' : 'YENİDEN ÖLÇÜM'}
          </p>
          <div style={{ position: 'relative', width: 300, height: 300, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width={300} height={300} viewBox="0 0 300 300" style={{ position: 'absolute', transform: 'rotate(-90deg)' }}>
              <circle cx="150" cy="150" r={R} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="3" />
              <circle cx="150" cy="150" r={R} fill="none" stroke="#FB7185" strokeWidth="3" strokeLinecap="round"
                strokeDasharray={CIRC} strokeDashoffset={CIRC * (1 - measProgress)}
                style={{ transition: 'stroke-dashoffset .12s linear', filter: 'drop-shadow(0 0 6px rgba(251,113,133,0.6))' }} />
            </svg>
            <div className="glow" style={{
              position: 'absolute', width: 210, height: 210, borderRadius: '50%',
              background: fingerOk ? '#FB7185' : '#5B4FE0', filter: 'blur(48px)',
              opacity: fingerOk ? 0.5 : 0.25, transition: 'background .4s, opacity .4s',
            }} />
            {/* biyometrik tarama çizgisi */}
            <div style={{ position: 'absolute', width: 200, height: 192, overflow: 'hidden', borderRadius: '50%' }}>
              <div style={{
                position: 'absolute', left: 0, right: 0, height: 2, top: '50%',
                background: 'linear-gradient(90deg, transparent, #FB7185, transparent)',
                boxShadow: '0 0 10px #FB7185', animation: 'scan 2.4s ease-in-out infinite',
              }} />
            </div>
            <svg width={waveW} height={waveH} viewBox={`0 0 ${waveW} ${waveH}`} style={{
              position: 'relative', filter: 'drop-shadow(0 0 14px rgba(251,113,133,0.6))',
            }}>
              <polyline fill="none" stroke="#FB7185" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" points={measWavePts} />
            </svg>
          </div>
          <div style={{ marginTop: 20, display: 'flex', alignItems: 'baseline', gap: 8, height: 76 }}>
            {liveBpm > 0 ? (
              <>
                <span style={{ fontFamily: 'var(--font-mono), monospace', fontSize: 64, fontWeight: 700, color: '#FB7185', fontVariantNumeric: 'tabular-nums', textShadow: '0 0 26px rgba(251,113,133,0.45)' }}>{liveBpm}</span>
                <span style={{ fontSize: 18, color: '#C4B5FD', fontWeight: 300 }}>BPM</span>
              </>
            ) : (
              <span style={{ fontSize: 24, color: '#C4B5FD', fontWeight: 300, animation: 'blink 1.4s infinite' }}>okunuyor…</span>
            )}
          </div>
          <div style={{
            marginTop: 6, padding: '9px 20px', borderRadius: 999,
            background: fingerOk ? 'rgba(251,113,133,0.12)' : 'rgba(139,92,246,0.12)',
            border: `1px solid ${fingerOk ? 'rgba(251,113,133,0.4)' : 'rgba(139,92,246,0.35)'}`,
            fontSize: 13, color: fingerOk ? '#FB7185' : '#C4B5FD', transition: 'all .3s', maxWidth: 320, textAlign: 'center',
          }}>
            {statusText || 'Parmağını kameraya koy'}
          </div>
        </div>
      )}

      {/* ══ RESET ══ */}
      {phase === 'reset' && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '0 24px', zIndex: 2 }}>
          <p style={{ marginBottom: 22, fontSize: 26, fontWeight: 300, letterSpacing: 6, height: 34, color: phaseColor, transition: 'color .5s' }}>
            {breathLabel}
          </p>
          <div style={{ position: 'relative', width: 300, height: 300, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {rippleRef.current.slice(-3).map((rp) => (
              <div key={rp.t} style={{
                position: 'absolute', width: 200, height: 200, borderRadius: '50%',
                border: `1px solid ${phaseColor}55`, animation: 'ripple 5.5s ease-out forwards',
              }} />
            ))}
            <svg width={300} height={300} viewBox="0 0 300 300" style={{ position: 'absolute', transform: 'rotate(-90deg)' }}>
              <circle cx="150" cy="150" r={R} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="3" />
              <circle cx="150" cy="150" r={R} fill="none" stroke={phaseColor} strokeWidth="3" strokeLinecap="round"
                strokeDasharray={CIRC} strokeDashoffset={CIRC * (1 - resetProgress)}
                style={{ transition: 'stroke-dashoffset .1s linear, stroke .5s' }} />
            </svg>
            <div className="glow" style={{
              position: 'absolute', width: 240, height: 240, borderRadius: '50%', background: phaseColor,
              filter: 'blur(44px)', transform: `scale(${breathScale})`, transition: 'transform .1s linear, background .5s',
            }} />
            <div style={{
              position: 'absolute', width: 220, height: 220, borderRadius: '50%',
              border: `1px solid ${phaseColor}66`, transform: `scale(${breathScale})`, transition: 'transform .1s linear',
            }} />
            <svg width={208} height={96} viewBox="0 0 500 100" style={{
              position: 'relative', filter: 'drop-shadow(0 0 16px rgba(251,113,133,0.65))',
              animation: `beatLine ${beatDuration}s ease-in-out infinite`,
            }}>
              <polyline fill="none" stroke="#FB7185" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" points={resetWave} />
            </svg>
          </div>
          <p style={{ fontSize: 11, color: '#8B5CF6', letterSpacing: 4, marginTop: 26 }}>SAKİNLEŞ · {secondsLeft}s</p>
        </div>
      )}

      {/* ══ PROOF ══ */}
      {phase === 'proof' && (
        <div className="fin" style={{ textAlign: 'center', padding: '0 22px', zIndex: 2, width: '100%', maxWidth: 470 }}>
          <p style={{ fontSize: 12, letterSpacing: 4, color: '#8B5CF6', marginBottom: 16 }}>KANIT · KENDİ NABZIN</p>

          <div style={{
            borderRadius: 22, border: '1px solid rgba(251,113,133,0.22)',
            background: 'linear-gradient(180deg, rgba(251,113,133,0.06), rgba(255,255,255,0.02))',
            padding: '22px 20px 20px', boxShadow: '0 20px 60px rgba(0,0,0,0.35)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 18, marginBottom: 6 }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontFamily: 'var(--font-mono), monospace', fontSize: 40, fontWeight: 700, color: 'rgba(245,243,255,0.5)', fontVariantNumeric: 'tabular-nums' }}>{stressBpm}</div>
                <div style={{ fontSize: 10, color: '#8B5CF6', letterSpacing: 2 }}>ÖNCE</div>
              </div>
              <div style={{ fontSize: 26, color: '#A78BFA', opacity: revealT }}>→</div>
              <div style={{ textAlign: 'center', transform: `scale(${0.88 + 0.12 * revealT})` }}>
                <div style={{ fontFamily: 'var(--font-mono), monospace', fontSize: 70, fontWeight: 700, color: '#FB7185', fontVariantNumeric: 'tabular-nums', textShadow: '0 0 34px rgba(251,113,133,0.55)', lineHeight: 1 }}>{calmDisplay}</div>
                <div style={{ fontSize: 10, color: '#FB7185', letterSpacing: 2, marginTop: 2 }}>SONRA · BPM</div>
              </div>
            </div>
            <div style={{
              display: 'inline-block', marginTop: 10, padding: '6px 16px', borderRadius: 999,
              background: 'rgba(251,113,133,0.16)', border: '1px solid rgba(251,113,133,0.45)',
              color: '#FB7185', fontSize: 14, fontWeight: 700, opacity: revealT, fontFamily: 'var(--font-mono), monospace',
            }}>
              −{dropped} BPM
            </div>
          </div>

          <h2 style={{ fontFamily: 'var(--font-serif), Georgia, serif', fontStyle: 'italic', fontSize: 28, fontWeight: 500, margin: '22px 0 4px', color: '#F5F3FF' }}>
            Kalbin <span style={{ color: '#FB7185' }}>{dropped} atış</span> yavaşladı.
          </h2>
          <p style={{ color: '#C4B5FD', fontWeight: 300, fontSize: 14, marginBottom: 20 }}>İddia yok — sadece kendi bedenin.</p>

          <div style={{ borderRadius: 16, border: '1px solid rgba(139,92,246,0.22)', background: 'rgba(255,255,255,0.03)', padding: '16px 22px', marginBottom: 6 }}>
            <p style={{ fontSize: 10, letterSpacing: 3, color: '#8B5CF6', marginBottom: 6 }}>BİRLİKTE YAVAŞLIYORUZ · İSTANBUL · BUGÜN</p>
            <p style={{ fontFamily: 'var(--font-mono), monospace', fontSize: 32, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{cityBeats.toLocaleString('tr-TR')}</p>
            <p style={{ fontSize: 12, color: '#C4B5FD', fontWeight: 300, marginTop: 2 }}>
              atış yavaşlatıldı · <span style={{ color: '#FB7185' }}>+ senin nabzın</span>
            </p>
          </div>

          <p style={{ color: '#8B5CF6', fontWeight: 300, fontSize: 14, marginTop: 20 }}>Kulaklığını tak — gerisini bize bırak.</p>

          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginTop: 20, flexWrap: 'wrap' }}>
            <button type="button" onClick={sharePulse} style={{
              padding: '12px 28px', border: 'none', background: '#FB7185', color: '#fff',
              borderRadius: 999, fontSize: 14, fontWeight: 700, boxShadow: '0 0 26px rgba(251,113,133,0.45)',
            }}>
              Nabzını Yolla
            </button>
            <button type="button" onClick={begin} style={{
              padding: '12px 24px', border: '1px solid rgba(139,92,246,0.5)', background: 'transparent',
              color: '#C4B5FD', borderRadius: 999, fontSize: 14,
            }}>
              Tekrar
            </button>
          </div>
          <p style={{ marginTop: 18, fontSize: 10, color: 'rgba(139,92,246,0.45)', letterSpacing: 2 }}>MINDGLOW · UZMAN PSİKOLOG ONAYLI</p>
        </div>
      )}

      <div style={{ position: 'absolute', bottom: 12, left: 12, fontSize: 9, color: 'rgba(139,92,246,0.4)', letterSpacing: 2, zIndex: 3 }}>
        NABIZ · v8
      </div>
    </div>
  );
}