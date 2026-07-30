'use client';

import { useState, useRef, useEffect, useCallback } from 'react';

// ── Ayarlar ──────────────────────────────────────────────────
const DURATION = 30;
const START_BPM = 98;
const END_BPM = 62;
// Nefes fazları (saniye) — al / tut / ver / dur ≈ 16sn döngü
const PHASES = [
  { key: 'in',   label: 'Nefes al', dur: 4, from: 0.60, to: 1.0 },
  { key: 'hold', label: 'Tut',      dur: 4, from: 1.0,  to: 1.0 },
  { key: 'out',  label: 'Ver',      dur: 6, from: 1.0,  to: 0.60 },
  { key: 'rest', label: 'Dur',      dur: 2, from: 0.60, to: 0.60 },
] as const;
const BREATH_CYCLE = PHASES.reduce((s, p) => s + p.dur, 0);
const AUDIO_SRC = 'https://pub-748f7570433143eaa18b42464d98a818.r2.dev/vidssavecom-marconi-union-weightless-official-video-low-kkwkx4.mp3';
// ─────────────────────────────────────────────────────────────

type Phase = 'idle' | 'playing' | 'done';
type Sound = 'pending' | 'file' | 'ambient' | 'silent';

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const easeOut = (t: number) => 1 - Math.pow(1 - t, 2);
const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

// süre içinde bulunduğumuz nefes fazı + ilerlemesi
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
  id: i,
  x: (i * 61.8) % 100,
  y: (i * 37.5) % 100,
  s: 0.6 + ((i * 13) % 10) / 10,
  d: ((i * 7) % 10) / 10,
}));

export default function NabizDemo() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [secondsLeft, setSecondsLeft] = useState(DURATION);
  const [bpm, setBpm] = useState(START_BPM);
  const [progress, setProgress] = useState(0);
  const [breathScale, setBreathScale] = useState(0.60);
  const [breathLabel, setBreathLabel] = useState('Hazır ol');
  const [breathKey, setBreathKey] = useState<string>('rest');
  const [waveAmp, setWaveAmp] = useState(1);
  const [sound, setSound] = useState<Sound>('pending');
  const [cityBeats, setCityBeats] = useState(0);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const ambientRef = useRef<{ osc: OscillatorNode[]; master: GainNode; lfo?: OscillatorNode } | null>(null);
  const tickRef = useRef<number | null>(null);
  const startRef = useRef<number>(0);
  const lastKeyRef = useRef<string>('rest');

  const clearTick = useCallback(() => {
    if (tickRef.current !== null) window.clearInterval(tickRef.current);
    tickRef.current = null;
  }, []);

  const vibrate = (p: number | number[]) => {
    try { if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(p as any); } catch {}
  };

  // ── YEDEK SES ──
  const startAmbient = useCallback(() => {
    try {
      const AC = window.AudioContext || (window as any).webkitAudioContext;
      if (!AC) { setSound('silent'); return; }
      const ctx = ctxRef.current ?? new AC();
      ctxRef.current = ctx;
      if (ctx.state === 'suspended') ctx.resume();
      const now = ctx.currentTime;
      const master = ctx.createGain();
      master.gain.setValueAtTime(0.0001, now);
      master.gain.exponentialRampToValueAtTime(0.13, now + 3);
      master.connect(ctx.destination);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = 700; lp.Q.value = 0.6; lp.connect(master);
      const osc = [110.0, 164.81, 220.0].map((f, i) => {
        const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
        o.detune.value = i === 1 ? 4 : i === 2 ? -3 : 0;
        const g = ctx.createGain(); g.gain.value = i === 0 ? 0.5 : 0.32;
        o.connect(g).connect(lp); o.start(now); return o;
      });
      const lfo = ctx.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 0.1;
      const lg = ctx.createGain(); lg.gain.value = 0.04; lfo.connect(lg).connect(master.gain); lfo.start(now);
      ambientRef.current = { osc, master, lfo };
      setSound('ambient');
    } catch { setSound('silent'); }
  }, []);

  const stopAmbient = useCallback((fade = true) => {
    const ctx = ctxRef.current; const n = ambientRef.current;
    if (!ctx || !n) return;
    const now = ctx.currentTime;
    if (fade) {
      n.master.gain.cancelScheduledValues(now);
      n.master.gain.setValueAtTime(n.master.gain.value, now);
      n.master.gain.exponentialRampToValueAtTime(0.0001, now + 1.5);
    }
    const stopAt = now + (fade ? 1.6 : 0);
    n.osc.forEach((o) => { try { o.stop(stopAt); } catch {} });
    if (n.lfo) { try { n.lfo.stop(stopAt); } catch {} }
    ambientRef.current = null;
  }, []);

  const finish = useCallback(() => {
    clearTick();
    const a = audioRef.current;
    if (a && !a.paused) {
      let vol = a.volume;
      const fade = window.setInterval(() => {
        vol = Math.max(0, vol - 0.06);
        try { a.volume = vol; } catch {}
        if (vol <= 0) { window.clearInterval(fade); a.pause(); a.currentTime = 0; try { a.volume = 0.6; } catch {} }
      }, 80);
    }
    stopAmbient(true);
    setBreathLabel('');
    setPhase('done');
    setSound('pending');
    vibrate([40, 60, 40]);
  }, [clearTick, stopAmbient]);

  const start = useCallback(() => {
    clearTick();
    setPhase('playing');
    setSecondsLeft(DURATION);
    setBpm(START_BPM);
    setProgress(0);
    setWaveAmp(1);
    setBreathScale(0.60);
    setSound('pending');
    startRef.current = performance.now();
    lastKeyRef.current = 'rest';

    const a = audioRef.current;
    if (a) {
      try { a.currentTime = 0; a.volume = 0.6; } catch {}
      const p = a.play();
      if (p && typeof p.then === 'function') {
        p.then(() => setSound('file')).catch(() => startAmbient());
      } else {
        window.setTimeout(() => { if (a.paused) startAmbient(); else setSound('file'); }, 300);
      }
    } else { startAmbient(); }

    tickRef.current = window.setInterval(() => {
      const elapsed = (performance.now() - startRef.current) / 1000;
      const t = clamp01(elapsed / DURATION);
      setProgress(t);
      setSecondsLeft(Math.max(0, Math.ceil(DURATION - elapsed)));
      setBpm(Math.round(START_BPM - (START_BPM - END_BPM) * easeOut(t)));
      setWaveAmp(1 - 0.7 * easeOut(t));

      const b = breathAt(elapsed);
      setBreathScale(b.scale);
      setBreathLabel(b.label);
      setBreathKey(b.key);
      if (b.key !== lastKeyRef.current) { lastKeyRef.current = b.key; vibrate(20); }

      if (elapsed >= DURATION) finish();
    }, 80);
  }, [clearTick, startAmbient, finish]);

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
    clearTick(); stopAmbient(false);
    if (ctxRef.current) { try { ctxRef.current.close(); } catch {} }
  }, [clearTick, stopAmbient]);

  const beatDuration = (60 / bpm).toFixed(2);
  const a = waveAmp;
  const y = (o: number) => (50 + o * a).toFixed(1);
  const wavePoints = `0,50 140,50 168,${y(-28)} 184,${y(40)} 200,${y(-42)} 216,${y(28)} 232,${y(-10)} 250,50 500,50`;

  // faz rengi (hafif kayma)
  const phaseColor = breathKey === 'in' ? '#FB7185' : breathKey === 'hold' ? '#F0ABFC' : breathKey === 'out' ? '#A78BFA' : '#8B5CF6';

  // progress ring
  const R = 130, C = 2 * Math.PI * R;

  return (
    <div className="relative flex flex-col items-center justify-center min-h-screen bg-[#1E1B3A] text-[#F5F3FF] overflow-hidden select-none">
      <style>{`
        @keyframes glowPulse { 0%,100%{opacity:.35} 50%{opacity:.6} }
        @keyframes softPulse { 0%,100%{transform:scale(1)} 50%{transform:scale(1.04)} }
        @keyframes fadeIn { from{opacity:0;transform:translateY(10px)} to{opacity:1;transform:none} }
        @keyframes beatLine { 0%,100%{opacity:.85} 50%{opacity:1} }
        @keyframes twinkle { 0%,100%{opacity:.12} 50%{opacity:.4} }
        .btn-pulse{animation:softPulse 1.8s ease-in-out infinite}
        .fade-in{animation:fadeIn .8s ease-out both}
        .glow{animation:glowPulse 3s ease-in-out infinite}
        .beatline{animation:beatLine var(--bd,1s) ease-in-out infinite}
        .star{animation:twinkle var(--td,3s) ease-in-out infinite}
        @media (prefers-reduced-motion: reduce){
          .btn-pulse,.glow,.beatline,.star{animation:none!important}
        }
      `}</style>

      <audio ref={audioRef} src={AUDIO_SRC} loop preload="auto" crossOrigin="anonymous" aria-hidden="true"
        style={{ position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none' }} />

      {/* yıldız alanı — nabızla senkron titreşim hızı */}
      <div className="absolute inset-0 pointer-events-none">
        {STARS.map((st) => (
          <span key={st.id} className="star absolute rounded-full bg-[#C4B5FD]"
            style={{
              left: `${st.x}%`, top: `${st.y}%`,
              width: `${st.s * 2}px`, height: `${st.s * 2}px`,
              ['--td' as any]: `${(phase === 'playing' ? beatDuration : '3')}s`,
              animationDelay: `${st.d}s`,
              opacity: 0.2,
            }} />
        ))}
      </div>

      {phase === 'playing' && (
        <div className="absolute top-4 right-4 text-[10px] tracking-widest text-[#8B5CF6] z-10" aria-live="polite">
          {sound === 'file' && '♪ MÜZİK ÇALIYOR'}
          {sound === 'ambient' && '♪ SAKİN MOD'}
          {sound === 'pending' && '…'}
          {sound === 'silent' && '🔇 SESSİZ'}
        </div>
      )}

      {/* DURUM 1 */}
      {phase === 'idle' && (
        <div className="relative z-10 flex flex-col items-center text-center px-6 fade-in">
          <h1 className="text-3xl font-semibold mb-2 tracking-wide">MindGlow</h1>
          <p className="text-[#C4B5FD] font-light mb-8">Sınav stresi görünmezdir. Kalbin hariç.</p>
          <svg className="beatline w-40 h-12 mb-8 opacity-80" style={{ ['--bd' as any]: '0.9s' }} viewBox="0 0 500 100">
            <polyline fill="none" stroke="#FB7185" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round"
              points="0,50 150,50 170,18 200,92 230,8 260,82 280,50 500,50" />
          </svg>
          <button type="button" onClick={start}
            aria-label="Nabzını hisset — nefes ve sakinleşme deneyimini başlat"
            className="btn-pulse px-10 py-4 bg-[#FB7185] text-white rounded-full font-medium text-lg shadow-[0_0_30px_rgba(251,113,133,0.45)]">
            Nabzını Hisset
          </button>
          <p className="mt-8 text-xs text-[#8B5CF6] tracking-widest">KULAKLIĞINI TAK · NEFES REHBERİ · {DURATION} SN</p>
          <p className="mt-10 text-[10px] text-[#8B5CF6]/60 font-light max-w-xs leading-relaxed">
            Demoda örnekleme amacıyla “Weightless” (Marconi Union) kullanılmıştır; gerçek kampanyada lisanslı ya da özgün “Kalbinin Şarkısı” bestelenir.
          </p>
        </div>
      )}

      {/* DURUM 2 */}
      {phase === 'playing' && (
        <div className="relative z-10 flex flex-col items-center px-6 w-full max-w-sm">
          <p className="mb-6 text-2xl font-light tracking-[0.25em] h-8 transition-colors duration-500"
            style={{ color: phaseColor }} aria-live="polite">
            {breathLabel}
          </p>

          <div className="relative w-72 h-72 flex items-center justify-center">
            {/* progress ring */}
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

      {/* DURUM 3 */}
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
    </div>
  );
}