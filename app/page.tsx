'use client';

import { useState, useRef, useEffect, useCallback } from 'react';

// ── Ayarlar ──────────────────────────────────────────────────
const DURATION = 30;
const START_BPM = 98;
const END_BPM = 62;
const PHASES = [
  { key: 'in',   label: 'Nefes al', dur: 4, from: 0.60, to: 1.0 },
  { key: 'hold', label: 'Tut',      dur: 4, from: 1.0,  to: 1.0 },
  { key: 'out',  label: 'Ver',      dur: 6, from: 1.0,  to: 0.60 },
  { key: 'rest', label: 'Dur',      dur: 2, from: 0.60, to: 0.60 },
] as const;
const BREATH_CYCLE = PHASES.reduce((s, p) => s + p.dur, 0);
// A-minör pentatonik — her nota birbiriyle uyumlu, hiç disonans yok
const PENTA = [220.0, 261.63, 293.66, 329.63, 392.0, 440.0];
// ─────────────────────────────────────────────────────────────

type Phase = 'idle' | 'playing' | 'done';
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const easeOut = (t: number) => 1 - Math.pow(1 - t, 2);
const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

function breathAt(elapsed: number) {
  let pos = elapsed % BREATH_CYCLE;
  for (const p of PHASES) {
    if (pos < p.dur) {
      const bp = p.dur === 0 ? 1 : pos / p.dur;
      return { label: p.label, key: p.key, scale: p.from + (p.to - p.from) * easeInOut(bp) };
    }
    pos -= p.dur;
  }
  return { label: PHASES[0].label, key: PHASES[0].key, scale: PHASES[0].from };
}

const STARS = Array.from({ length: 26 }, (_, i) => ({
  id: i, x: (i * 61.8) % 100, y: (i * 37.5) % 100,
  s: 0.6 + ((i * 13) % 10) / 10, d: ((i * 7) % 10) / 10,
}));

export default function NabizDemo() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [secondsLeft, setSecondsLeft] = useState(DURATION);
  const [bpm, setBpm] = useState(START_BPM);
  const [progress, setProgress] = useState(0);
  const [breathScale, setBreathScale] = useState(0.60);
  const [breathLabel, setBreathLabel] = useState('Hazır ol');
  const [breathKey, setBreathKey] = useState('rest');
  const [waveAmp, setWaveAmp] = useState(1);
  const [soundOn, setSoundOn] = useState(false);
  const [cityBeats, setCityBeats] = useState(0);

  const ctxRef = useRef<AudioContext | null>(null);
  const songRef = useRef<{ stop: (fade: boolean) => void; breathGain: GainNode } | null>(null);
  const bellTimerRef = useRef<number | null>(null);
  const tickRef = useRef<number | null>(null);
  const startRef = useRef<number>(0);
  const lastKeyRef = useRef('rest');
  const bellIdxRef = useRef(0);

  const clearTick = useCallback(() => {
    if (tickRef.current !== null) window.clearInterval(tickRef.current);
    tickRef.current = null;
  }, []);
  const clearBell = useCallback(() => {
    if (bellTimerRef.current !== null) window.clearTimeout(bellTimerRef.current);
    bellTimerRef.current = null;
  }, []);
  const vibrate = (p: number | number[]) => {
    try { if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(p as any); } catch {}
  };

  // ── "KALBİNİN ŞARKISI" — tarayıcıda üretilen özgün sakin parça ──
  const startSong = useCallback(() => {
    try {
      const AC = window.AudioContext || (window as any).webkitAudioContext;
      if (!AC) return;
      const ctx = ctxRef.current ?? new AC();
      ctxRef.current = ctx;
      if (ctx.state === 'suspended') ctx.resume();
      const now = ctx.currentTime;

      const master = ctx.createGain();
      master.gain.setValueAtTime(0.0001, now);
      master.gain.exponentialRampToValueAtTime(0.16, now + 3); // usulca gir
      master.connect(ctx.destination);

      // müziğin nefesle yükselip alçalması bu düğümden
      const breathGain = ctx.createGain();
      breathGain.gain.value = 1;
      breathGain.connect(master);

      // yumuşaklık filtresi + yavaş açılan/kapanan hareket
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = 750; lp.Q.value = 0.5;
      lp.connect(breathGain);
      const fLfo = ctx.createOscillator();
      fLfo.type = 'sine'; fLfo.frequency.value = 1 / 16;
      const fLfoGain = ctx.createGain(); fLfoGain.gain.value = 220;
      fLfo.connect(fLfoGain).connect(lp.frequency); fLfo.start(now);

      // sürekli drone akoru (A-minör: sakin, hafif duygusal)
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

      // yavaş, yumuşak çan sesleri (pentatonik → hep uyumlu)
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
        bellTimerRef.current = window.setTimeout(playBell, 3400 + Math.random() * 1200);
      };
      bellTimerRef.current = window.setTimeout(playBell, 1500);

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
          drones.forEach((o) => { try { o.stop(at); } catch {} });
          try { fLfo.stop(at); } catch {}
        },
      };
      setSoundOn(true);
    } catch { setSoundOn(false); }
  }, []);

  const stopSong = useCallback((fade: boolean) => {
    clearBell();
    songRef.current?.stop(fade);
    songRef.current = null;
  }, [clearBell]);

  const finish = useCallback(() => {
    clearTick();
    stopSong(true);
    setBreathLabel('');
    setPhase('done');
    vibrate([40, 60, 40]);
  }, [clearTick, stopSong]);

  const start = useCallback(() => {
    clearTick(); clearBell();
    setPhase('playing');
    setSecondsLeft(DURATION); setBpm(START_BPM); setProgress(0);
    setWaveAmp(1); setBreathScale(0.60);
    startRef.current = performance.now();
    lastKeyRef.current = 'rest'; bellIdxRef.current = 0;

    startSong(); // anında, garanti çalar

    tickRef.current = window.setInterval(() => {
      const elapsed = (performance.now() - startRef.current) / 1000;
      const t = clamp01(elapsed / DURATION);
      setProgress(t);
      setSecondsLeft(Math.max(0, Math.ceil(DURATION - elapsed)));
      setBpm(Math.round(START_BPM - (START_BPM - END_BPM) * easeOut(t)));
      setWaveAmp(1 - 0.7 * easeOut(t));

      const b = breathAt(elapsed);
      setBreathScale(b.scale); setBreathLabel(b.label); setBreathKey(b.key);
      if (b.key !== lastKeyRef.current) { lastKeyRef.current = b.key; vibrate(20); }

      // müzik nefesle yükselsin/alçalsın
      const song = songRef.current, ctx = ctxRef.current;
      if (song && ctx) {
        const norm = (b.scale - 0.60) / 0.40; // 0..1
        song.breathGain.gain.setTargetAtTime(0.72 + 0.28 * norm, ctx.currentTime, 0.15);
      }

      if (elapsed >= DURATION) finish();
    }, 80);
  }, [clearTick, clearBell, startSong, finish]);

  useEffect(() => {
    if (phase !== 'done') return;
    const target = 4186540, dur = 1600, t0 = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const p = clamp01((now - t0) / dur);
      setCityBeats(Math.floor(easeOut(p) * target));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [phase]);

  useEffect(() => () => {
    clearTick(); stopSong(false);
    if (ctxRef.current) { try { ctxRef.current.close(); } catch {} }
  }, [clearTick, stopSong]);

  const beatDuration = (60 / bpm).toFixed(2);
  const a = waveAmp;
  const y = (o: number) => (50 + o * a).toFixed(1);
  const wavePoints = `0,50 140,50 168,${y(-28)} 184,${y(40)} 200,${y(-42)} 216,${y(28)} 232,${y(-10)} 250,50 500,50`;
  const phaseColor = breathKey === 'in' ? '#FB7185' : breathKey === 'hold' ? '#F0ABFC' : breathKey === 'out' ? '#A78BFA' : '#8B5CF6';
  const R = 130, C = 2 * Math.PI * R;

  return (
    <div className="relative flex flex-col items-center justify-center min-h-screen bg-[#1E1B3A] text-[#F5F3FF] overflow-hidden select-none">
      <style>{`
        @keyframes glowPulse{0%,100%{opacity:.35}50%{opacity:.6}}
        @keyframes softPulse{0%,100%{transform:scale(1)}50%{transform:scale(1.04)}}
        @keyframes fadeIn{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
        @keyframes beatLine{0%,100%{opacity:.85}50%{opacity:1}}
        @keyframes twinkle{0%,100%{opacity:.12}50%{opacity:.4}}
        .btn-pulse{animation:softPulse 1.8s ease-in-out infinite}
        .fade-in{animation:fadeIn .8s ease-out both}
        .glow{animation:glowPulse 3s ease-in-out infinite}
        .beatline{animation:beatLine var(--bd,1s) ease-in-out infinite}
        .star{animation:twinkle var(--td,3s) ease-in-out infinite}
        @media (prefers-reduced-motion: reduce){.btn-pulse,.glow,.beatline,.star{animation:none!important}}
      `}</style>

      <div className="absolute inset-0 pointer-events-none">
        {STARS.map((st) => (
          <span key={st.id} className="star absolute rounded-full bg-[#C4B5FD]"
            style={{ left: `${st.x}%`, top: `${st.y}%`, width: `${st.s * 2}px`, height: `${st.s * 2}px`,
              ['--td' as any]: `${phase === 'playing' ? beatDuration : '3'}s`, animationDelay: `${st.d}s`, opacity: 0.2 }} />
        ))}
      </div>

      {phase === 'playing' && (
        <div className="absolute top-4 right-4 text-[10px] tracking-widest text-[#8B5CF6] z-10">
          {soundOn ? '♪ KALBİNİN ŞARKISI' : '…'}
        </div>
      )}

      {phase === 'idle' && (
        <div className="relative z-10 flex flex-col items-center text-center px-6 fade-in">
          <h1 className="text-3xl font-semibold mb-2 tracking-wide">MindGlow</h1>
          <p className="text-[#C4B5FD] font-light mb-8">Sınav stresi görünmezdir. Kalbin hariç.</p>
          <svg className="beatline w-40 h-12 mb-8 opacity-80" style={{ ['--bd' as any]: '0.9s' }} viewBox="0 0 500 100">
            <polyline fill="none" stroke="#FB7185" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round"
              points="0,50 150,50 170,18 200,92 230,8 260,82 280,50 500,50" />
          </svg>
          <button type="button" onClick={start}
            className="btn-pulse px-10 py-4 bg-[#FB7185] text-white rounded-full font-medium text-lg shadow-[0_0_30px_rgba(251,113,133,0.45)]">
            Nabzını Hisset
          </button>
          <p className="mt-8 text-xs text-[#8B5CF6] tracking-widest">KULAKLIĞINI TAK · NEFES REHBERİ · {DURATION} SN</p>
        </div>
      )}

      {phase === 'playing' && (
        <div className="relative z-10 flex flex-col items-center px-6 w-full max-w-sm">
          <p className="mb-6 text-2xl font-light tracking-[0.25em] h-8 transition-colors duration-500"
            style={{ color: phaseColor }} aria-live="polite">{breathLabel}</p>

          <div className="relative w-72 h-72 flex items-center justify-center">
            <svg className="absolute w-72 h-72 -rotate-90" viewBox="0 0 300 300">
              <circle cx="150" cy="150" r={R} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="3" />
              <circle cx="150" cy="150" r={R} fill="none" stroke={phaseColor} strokeWidth="3" strokeLinecap="round"
                strokeDasharray={C} strokeDashoffset={C * (1 - progress)}
                style={{ transition: 'stroke-dashoffset .1s linear, stroke .5s' }} />
            </svg>
            <div className="absolute rounded-full blur-2xl glow"
              style={{ width: '15rem', height: '15rem', background: phaseColor, transform: `scale(${breathScale})`, transition: 'transform .1s linear, background .5s' }} />
            <div className="absolute rounded-full border"
              style={{ width: '14rem', height: '14rem', borderColor: `${phaseColor}66`, transform: `scale(${breathScale})`, transition: 'transform .1s linear' }} />
            <svg className="beatline relative w-52 h-24 drop-shadow-[0_0_16px_rgba(251,113,133,0.65)]"
              style={{ ['--bd' as any]: `${beatDuration}s` }} viewBox="0 0 500 100">
              <polyline fill="none" stroke="#FB7185" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round"
                points={wavePoints} style={{ transition: 'all .1s linear' }} />
            </svg>
          </div>

          <div className="mt-6 flex items-baseline gap-2 tabular-nums">
            <span className="text-6xl font-semibold text-[#FB7185]">{bpm}</span>
            <span className="text-lg text-[#C4B5FD] font-light">BPM</span>
          </div>
          <p className="mt-1 text-xs text-[#8B5CF6] tracking-[0.3em]">YAVAŞLIYOR · {secondsLeft}s</p>
        </div>
      )}

      {phase === 'done' && (
        <div className="relative z-10 flex flex-col items-center text-center px-6 fade-in">
          <h2 className="text-3xl font-semibold mb-2 text-[#FB7185]">Nabız Dengelendi.</h2>
          <p className="text-[#C4B5FD] font-light text-lg mb-6">
            Senin kalbin <span className="text-[#F5F3FF] font-medium">{START_BPM - END_BPM} atış</span> yavaşladı.
          </p>
          <div className="rounded-2xl border border-[#8B5CF6]/25 bg-white/[0.03] px-8 py-6">
            <p className="text-[10px] tracking-[0.3em] text-[#8B5CF6] mb-2">BİRLİKTE YAVAŞLIYORUZ · İSTANBUL · BUGÜN</p>
            <p className="text-4xl font-semibold tabular-nums">{cityBeats.toLocaleString('tr-TR')}</p>
            <p className="text-xs text-[#C4B5FD] font-light mt-1">atış yavaşlatıldı · <span className="text-[#FB7185]">+ senin nabzın</span></p>
          </div>
          <p className="text-[#8B5CF6] font-light text-sm mt-8">Kulaklığını tak — gerisini bize bırak.</p>
          <button type="button" onClick={start}
            className="mt-8 px-6 py-2 border border-[#8B5CF6]/50 text-[#C4B5FD] rounded-full text-sm font-light hover:bg-white/5 transition">
            Tekrar hisset
          </button>
        </div>
      )}

      {/* deploy doğrulama etiketi */}
      <div className="absolute bottom-3 left-3 text-[9px] text-[#8B5CF6]/40 tracking-widest">v3 · nefes 4-4-6-2</div>
    </div>
  );
}