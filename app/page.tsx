'use client';

import { useState, useRef, useEffect, useCallback } from 'react';

const DURATION = 30;
const START_BPM = 98;
const END_BPM = 62;
// as const YOK — dur "number" kalsın, TS "no overlap" hatası vermesin
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

export default function Page() {
  const [phase, setPhase] = useState('idle');
  const [secondsLeft, setSecondsLeft] = useState(DURATION);
  const [bpm, setBpm] = useState(START_BPM);
  const [progress, setProgress] = useState(0);
  const [breathScale, setBreathScale] = useState(0.6);
  const [breathLabel, setBreathLabel] = useState('Hazır ol');
  const [breathKey, setBreathKey] = useState('rest');
  const [soundOn, setSoundOn] = useState(false);
  const [cityBeats, setCityBeats] = useState(0);
  const [history, setHistory] = useState<number[]>([]);

  const ctxRef = useRef<any>(null);
  const songRef = useRef<any>(null);
  const bellTimerRef = useRef<any>(null);
  const tickRef = useRef<any>(null);
  const startRef = useRef(0);
  const lastKeyRef = useRef('rest');
  const bellIdxRef = useRef(0);
  const lastSampleRef = useRef(-1);

  // rAF köprüleri (state → animasyon)
  const breathRef = useRef(0.6);
  const bpmRef = useRef(START_BPM);
  const playingRef = useRef(false);
  const rippleRef = useRef<{ t: number }[]>([]);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const reducedRef = useRef(false);

  // ── Parçacık aurası ──────────────────────────────────────────
  useEffect(() => {
    reducedRef.current =
      typeof window !== 'undefined' &&
      window.matchMedia &&
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

    const N = 46;
    const parts = Array.from({ length: N }, () => ({
      x: Math.random(), y: Math.random(),
      r: 0.6 + Math.random() * 2.2,
      a: 0.06 + Math.random() * 0.18,
      vx: (Math.random() - 0.5) * 0.02,
      vy: -0.01 - Math.random() * 0.03,
      rose: Math.random() < 0.35,
    }));

    let raf = 0;
    const loop = () => {
      ctx.clearRect(0, 0, w, h);
      const energy = playingRef.current ? 0.4 + 0.6 * (bpmRef.current - END_BPM) / (START_BPM - END_BPM) : 0.5;
      const breathA = 0.55 + 0.45 * ((breathRef.current - 0.6) / 0.4);
      const speed = reducedRef.current ? 0 : energy;
      for (const p of parts) {
        p.x += p.vx * speed * 0.6;
        p.y += p.vy * speed;
        if (p.y < -0.05) { p.y = 1.05; p.x = Math.random(); }
        if (p.x < -0.05) p.x = 1.05; else if (p.x > 1.05) p.x = -0.05;
        const px = p.x * w, py = p.y * h;
        const alpha = p.a * breathA;
        ctx.beginPath();
        ctx.arc(px, py, p.r, 0, Math.PI * 2);
        ctx.fillStyle = p.rose ? `rgba(251,113,133,${alpha})` : `rgba(196,181,253,${alpha})`;
        ctx.fill();
      }
      raf = requestAnimationFrame(loop);
    };
    loop();
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', resize); };
  }, []);

  // ── "Kalbinin Şarkısı" — özgün, tarayıcıda üretilen sakin parça ──
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

      const breathGain = ctx.createGain();
      breathGain.gain.value = 1;
      breathGain.connect(master);

      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = 750; lp.Q.value = 0.5;
      lp.connect(breathGain);

      const fLfo = ctx.createOscillator();
      fLfo.type = 'sine'; fLfo.frequency.value = 1 / 16;
      const fLfoGain = ctx.createGain(); fLfoGain.gain.value = 220;
      fLfo.connect(fLfoGain).connect(lp.frequency); fLfo.start(now);

      const chord = [
        { f: 110.0, g: 0.5 }, { f: 164.81, g: 0.3 },
        { f: 220.0, g: 0.24 }, { f: 261.63, g: 0.16 },
      ];
      const drones = chord.map(({ f, g }, i) => {
        const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
        o.detune.value = i === 1 ? 4 : i === 3 ? -4 : 0;
        const gain = ctx.createGain(); gain.gain.value = g;
        o.connect(gain).connect(lp); o.start(now); return o;
      });

      const bellBus = ctx.createGain(); bellBus.gain.value = 0.9; bellBus.connect(master);
      const playBell = () => {
        const c = ctxRef.current; if (!c) return;
        const t = c.currentTime;
        const f = PENTA[bellIdxRef.current % PENTA.length];
        bellIdxRef.current += 1;
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
  }, []);

  const finish = useCallback(() => {
    if (tickRef.current) clearInterval(tickRef.current);
    tickRef.current = null;
    playingRef.current = false;
    stopSong(true);
    setBreathLabel('');
    setPhase('done');
    try { if (navigator.vibrate) navigator.vibrate([40, 60, 40]); } catch (e) {}
  }, [stopSong]);

  const start = useCallback(() => {
    if (tickRef.current) clearInterval(tickRef.current);
    if (bellTimerRef.current) clearTimeout(bellTimerRef.current);
    setPhase('playing');
    setSecondsLeft(DURATION);
    setBpm(START_BPM);
    setProgress(0);
    setBreathScale(0.6);
    setHistory([START_BPM]);
    startRef.current = Date.now();
    lastKeyRef.current = 'rest';
    bellIdxRef.current = 0;
    lastSampleRef.current = -1;
    playingRef.current = true;
    bpmRef.current = START_BPM;
    breathRef.current = 0.6;
    rippleRef.current = [];

    startSong();

    tickRef.current = setInterval(() => {
      const elapsed = (Date.now() - startRef.current) / 1000;
      const t = clamp01(elapsed / DURATION);
      const curBpm = Math.round(START_BPM - (START_BPM - END_BPM) * easeOut(t));
      setProgress(t);
      setSecondsLeft(Math.max(0, Math.ceil(DURATION - elapsed)));
      setBpm(curBpm);
      bpmRef.current = curBpm;

      const b = breathAt(elapsed);
      setBreathScale(b.scale);
      setBreathLabel(b.label);
      setBreathKey(b.key);
      breathRef.current = b.scale;

      if (b.key !== lastKeyRef.current) {
        if (b.key === 'in') rippleRef.current.push({ t: Date.now() });
        lastKeyRef.current = b.key;
        try { if (navigator.vibrate) navigator.vibrate(18); } catch (e) {}
      }

      const bucket = Math.floor(elapsed / 0.4);
      if (bucket !== lastSampleRef.current) {
        lastSampleRef.current = bucket;
        setHistory((h) => (h.length > 90 ? h : [...h, curBpm]));
      }

      const song = songRef.current, ctx = ctxRef.current;
      if (song && ctx) {
        const norm = (b.scale - 0.6) / 0.4;
        song.breathGain.gain.setTargetAtTime(0.72 + 0.28 * norm, ctx.currentTime, 0.15);
      }

      if (elapsed >= DURATION) finish();
    }, 80);
  }, [startSong, finish]);

  useEffect(() => {
    if (phase !== 'done') return;
    const target = 4186540, dur = 1600, t0 = Date.now();
    let raf = 0;
    const step = () => {
      const p = clamp01((Date.now() - t0) / dur);
      setCityBeats(Math.floor(easeOut(p) * target));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [phase]);

  useEffect(() => () => {
    if (tickRef.current) clearInterval(tickRef.current);
    stopSong(false);
    if (ctxRef.current) { try { ctxRef.current.close(); } catch (e) {} }
  }, [stopSong]);

  // ── türetilmiş görsel değerler ──
  const calm = easeOut(progress);
  const bg1 = lerpColor('#241C3E', '#141A30', calm);
  const bg2 = lerpColor('#1A1533', '#0F1428', calm);
  const beatDuration = 60 / bpm;
  const phaseColor =
    breathKey === 'in' ? '#FB7185' : breathKey === 'hold' ? '#F0ABFC' : breathKey === 'out' ? '#A78BFA' : '#8B5CF6';
  const R = 130, CIRC = 2 * Math.PI * R;

  // kalp çizgisi: sivri (stres) → yumuşak (sakin)
  const amp = 1 - 0.7 * calm;
  const yy = (o: number) => (50 + o * amp).toFixed(1);
  const wavePoints = `0,50 140,50 168,${yy(-28)} 184,${yy(40)} 200,${yy(-42)} 216,${yy(28)} 232,${yy(-10)} 250,50 500,50`;

  // sparkline
  const spW = 200, spH = 46, n = history.length;
  const sparkPts = n > 1
    ? history.map((v, i) => {
        const x = (i / (n - 1)) * spW;
        const y = spH - ((v - (END_BPM - 6)) / (START_BPM + 6 - (END_BPM - 6))) * spH;
        return `${x.toFixed(1)},${clamp01(y / spH) * spH}`;
      }).join(' ')
    : '';

  return (
    <div style={{
      position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', minHeight: '100vh', color: '#F5F3FF', overflow: 'hidden',
      fontFamily: 'system-ui, -apple-system, sans-serif', userSelect: 'none',
      background: `radial-gradient(120% 120% at 50% 30%, ${bg1} 0%, ${bg2} 70%)`,
      transition: 'background 1.2s ease',
    }}>
      <style>{`
        @keyframes glowPulse{0%,100%{opacity:.35}50%{opacity:.6}}
        @keyframes softPulse{0%,100%{transform:scale(1)}50%{transform:scale(1.04)}}
        @keyframes fadeIn{from{opacity:0;transform:translateY(10px)}to{opacity:1}}
        @keyframes beatLine{0%,100%{opacity:.85}50%{opacity:1}}
        @keyframes ripple{from{transform:scale(.7);opacity:.5}to{transform:scale(2.1);opacity:0}}
        .glow{animation:glowPulse 3s ease-in-out infinite}
        .btnp{animation:softPulse 1.8s ease-in-out infinite}
        .fin{animation:fadeIn .8s ease-out both}
        @media (prefers-reduced-motion: reduce){.glow,.btnp{animation:none!important}}
      `}</style>

      {/* parçacık aurası */}
      <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', zIndex: 0 }} />
      {/* vinyet */}
      <div style={{ position: 'absolute', inset: 0, zIndex: 0, pointerEvents: 'none',
        background: 'radial-gradient(120% 100% at 50% 45%, transparent 55%, rgba(0,0,0,0.45) 100%)' }} />

      {phase === 'playing' && (
        <div style={{ position: 'absolute', top: 16, right: 16, fontSize: 10, letterSpacing: 2, color: '#8B5CF6', zIndex: 3 }}>
          {soundOn ? '♪ KALBİNİN ŞARKISI' : '…'}
        </div>
      )}

      {/* DURUM 1 */}
      {phase === 'idle' && (
        <div className="fin" style={{ textAlign: 'center', padding: '0 24px', zIndex: 2 }}>
          <h1 style={{ fontSize: 32, fontWeight: 600, marginBottom: 8, letterSpacing: 0.5 }}>MindGlow</h1>
          <p style={{ color: '#C4B5FD', fontWeight: 300, marginBottom: 28 }}>Sınav stresi görünmezdir. Kalbin hariç.</p>
          <svg width={168} height={48} viewBox="0 0 500 100" style={{ marginBottom: 28, opacity: 0.8, animation: 'beatLine .9s ease-in-out infinite' }}>
            <polyline fill="none" stroke="#FB7185" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round"
              points="0,50 150,50 170,18 200,92 230,8 260,82 280,50 500,50" />
          </svg>
          <div>
            <button onClick={start} className="btnp" style={{
              padding: '16px 40px', background: '#FB7185', color: '#fff', border: 'none',
              borderRadius: 999, fontSize: 18, fontWeight: 500, cursor: 'pointer',
              boxShadow: '0 0 34px rgba(251,113,133,0.5)',
            }}>
              Nabzını Hisset
            </button>
          </div>
          <p style={{ marginTop: 32, fontSize: 12, color: '#8B5CF6', letterSpacing: 2 }}>
            KULAKLIĞINI TAK · NEFES REHBERİ · {DURATION} SN
          </p>
        </div>
      )}

      {/* DURUM 2 */}
      {phase === 'playing' && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '0 24px', zIndex: 2 }}>
          <p style={{ marginBottom: 22, fontSize: 24, fontWeight: 300, letterSpacing: 5, height: 32, color: phaseColor, transition: 'color .5s' }}>
            {breathLabel}
          </p>

          <div style={{ position: 'relative', width: 300, height: 300, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {/* nefes dalgaları */}
            {rippleRef.current.slice(-3).map((rp) => (
              <div key={rp.t} style={{
                position: 'absolute', width: 200, height: 200, borderRadius: '50%',
                border: `1px solid ${phaseColor}55`, animation: 'ripple 5.5s ease-out forwards',
              }} />
            ))}
            {/* dolan halka */}
            <svg width={300} height={300} viewBox="0 0 300 300" style={{ position: 'absolute', transform: 'rotate(-90deg)' }}>
              <circle cx="150" cy="150" r={R} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="3" />
              <circle cx="150" cy="150" r={R} fill="none" stroke={phaseColor} strokeWidth="3" strokeLinecap="round"
                strokeDasharray={CIRC} strokeDashoffset={CIRC * (1 - progress)}
                style={{ transition: 'stroke-dashoffset .1s linear, stroke .5s' }} />
            </svg>
            {/* nefes küresi */}
            <div className="glow" style={{
              position: 'absolute', width: 240, height: 240, borderRadius: '50%', background: phaseColor,
              filter: 'blur(42px)', transform: `scale(${breathScale})`, transition: 'transform .1s linear, background .5s',
            }} />
            <div style={{
              position: 'absolute', width: 220, height: 220, borderRadius: '50%',
              border: `1px solid ${phaseColor}66`, transform: `scale(${breathScale})`, transition: 'transform .1s linear',
            }} />
            {/* kalp çizgisi */}
            <svg width={208} height={96} viewBox="0 0 500 100" style={{
              position: 'relative', filter: 'drop-shadow(0 0 16px rgba(251,113,133,0.65))',
              animation: `beatLine ${beatDuration}s ease-in-out infinite`,
            }}>
              <polyline fill="none" stroke="#FB7185" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round"
                points={wavePoints} style={{ transition: 'all .1s linear' }} />
            </svg>
          </div>

          <div style={{ marginTop: 22, display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span style={{ fontSize: 62, fontWeight: 600, color: '#FB7185', fontVariantNumeric: 'tabular-nums' }}>{bpm}</span>
            <span style={{ fontSize: 18, color: '#C4B5FD', fontWeight: 300 }}>BPM</span>
          </div>

          {/* canlı nabız düşüş grafiği */}
          <svg width={spW} height={spH} viewBox={`0 0 ${spW} ${spH}`} style={{ marginTop: 8, opacity: 0.9 }}>
            <line x1="0" y1={spH - 1} x2={spW} y2={spH - 1} stroke="rgba(255,255,255,0.08)" strokeWidth="1" />
            {sparkPts && (
              <polyline fill="none" stroke="#A78BFA" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" points={sparkPts} />
            )}
          </svg>
          <p style={{ fontSize: 11, color: '#8B5CF6', letterSpacing: 4, marginTop: 2 }}>NABZIN DÜŞÜYOR · {secondsLeft}s</p>
        </div>
      )}

      {/* DURUM 3 */}
      {phase === 'done' && (
        <div className="fin" style={{ textAlign: 'center', padding: '0 24px', zIndex: 2 }}>
          <h2 style={{ fontSize: 32, fontWeight: 600, marginBottom: 8, color: '#FB7185' }}>Nabız Dengelendi.</h2>
          <p style={{ color: '#C4B5FD', fontWeight: 300, fontSize: 18, marginBottom: 24 }}>
            Senin kalbin <b style={{ color: '#F5F3FF' }}>{START_BPM - END_BPM} atış</b> yavaşladı.
          </p>
          <div style={{ borderRadius: 18, border: '1px solid rgba(139,92,246,0.25)', background: 'rgba(255,255,255,0.03)', padding: '24px 34px' }}>
            <p style={{ fontSize: 10, letterSpacing: 3, color: '#8B5CF6', marginBottom: 8 }}>BİRLİKTE YAVAŞLIYORUZ · İSTANBUL · BUGÜN</p>
            <p style={{ fontSize: 38, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{cityBeats.toLocaleString('tr-TR')}</p>
            <p style={{ fontSize: 12, color: '#C4B5FD', fontWeight: 300, marginTop: 4 }}>
              atış yavaşlatıldı · <span style={{ color: '#FB7185' }}>+ senin nabzın</span>
            </p>
          </div>
          <p style={{ color: '#8B5CF6', fontWeight: 300, fontSize: 14, marginTop: 32 }}>Kulaklığını tak — gerisini bize bırak.</p>
          <button onClick={start} style={{
            marginTop: 28, padding: '8px 24px', border: '1px solid rgba(139,92,246,0.5)',
            background: 'transparent', color: '#C4B5FD', borderRadius: 999, fontSize: 14, cursor: 'pointer',
          }}>
            Tekrar hisset
          </button>
        </div>
      )}

      <div style={{ position: 'absolute', bottom: 12, left: 12, fontSize: 9, color: 'rgba(139,92,246,0.4)', letterSpacing: 2, zIndex: 3 }}>
        v5 · nefes 4-4-6-2 · aura + sparkline
      </div>
    </div>
  );
}