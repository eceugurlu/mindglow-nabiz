'use client';

import { useState, useRef, useEffect, useCallback } from 'react';

// ── Ayarlar ──────────────────────────────────────────────────
const DURATION = 30;
const START_BPM = 98;
const END_BPM = 62;
// R2 dosyan MP3 değil MP4 ise src'yi değiştirmene gerek yok, çalışır.
// Dosya adın farklıysa sadece sondaki adı düzelt.
const AUDIO_SRC = 'https://pub-748f7570433143eaa18b42464d98a818.r2.dev/weightless.mp4';
// ─────────────────────────────────────────────────────────────

type Phase = 'idle' | 'playing' | 'done';
type Sound = 'pending' | 'file' | 'synth' | 'silent';

const easeOut = (t: number) => 1 - Math.pow(1 - t, 2);

export default function NabizDemo() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [secondsLeft, setSecondsLeft] = useState(DURATION);
  const [bpm, setBpm] = useState(START_BPM);
  const [progress, setProgress] = useState(0);
  const [sound, setSound] = useState<Sound>('pending');

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const beatTimerRef = useRef<number | null>(null);
  const tickRef = useRef<number | null>(null);
  const startRef = useRef<number>(0);
  const bpmRef = useRef<number>(START_BPM);

  const clearTimers = useCallback(() => {
    if (tickRef.current !== null) window.clearInterval(tickRef.current);
    if (beatTimerRef.current !== null) window.clearTimeout(beatTimerRef.current);
    tickRef.current = null;
    beatTimerRef.current = null;
  }, []);

  // ── YEDEK SES: tarayıcıda üretilen kalp atışı (hiç dosya gerektirmez) ──
  const playSynthBeat = useCallback(() => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    const now = ctx.currentTime;

    const thump = (at: number, freq: number, gain: number) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.frequency.setValueAtTime(freq, at);
      osc.frequency.exponentialRampToValueAtTime(freq * 0.5, at + 0.14);
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(gain, at + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, at + 0.16);
      osc.connect(g).connect(ctx.destination);
      osc.start(at);
      osc.stop(at + 0.18);
    };
    // "lub-dub" — iki vuruş
    thump(now, 70, 0.28);
    thump(now + 0.13, 55, 0.20);

    // Bir sonraki atışı güncel BPM'e göre zamanla (yavaşladıkça seyrekleşir)
    const interval = (60 / bpmRef.current) * 1000;
    beatTimerRef.current = window.setTimeout(playSynthBeat, interval);
  }, []);

  const startSynth = useCallback(() => {
    try {
      const AC = window.AudioContext || (window as any).webkitAudioContext;
      if (!AC) { setSound('silent'); return; }
      const ctx = ctxRef.current ?? new AC();
      ctxRef.current = ctx;
      if (ctx.state === 'suspended') ctx.resume();
      setSound('synth');
      playSynthBeat();
    } catch {
      setSound('silent');
    }
  }, [playSynthBeat]);

  // ── Butona basıldığında: önce dosyayı dene, olmazsa synth'e düş ──
  const start = useCallback(() => {
    clearTimers();
    setPhase('playing');
    setSecondsLeft(DURATION);
    setBpm(START_BPM);
    bpmRef.current = START_BPM;
    setProgress(0);
    setSound('pending');
    startRef.current = performance.now();

    const a = audioRef.current;
    if (a) {
      try { a.currentTime = 0; a.volume = 0.6; } catch {}
      const p = a.play();
      if (p && typeof p.then === 'function') {
        p.then(() => setSound('file'))
         .catch(() => startSynth()); // dosya çalmazsa yedek ses
      } else {
        // Eski tarayıcı: promise dönmedi, garantiye al
        window.setTimeout(() => { if (a.paused) startSynth(); else setSound('file'); }, 300);
      }
    } else {
      startSynth();
    }

    tickRef.current = window.setInterval(() => {
      const elapsed = (performance.now() - startRef.current) / 1000;
      const t = Math.min(1, elapsed / DURATION);
      const nextBpm = Math.round(START_BPM - (START_BPM - END_BPM) * easeOut(t));
      bpmRef.current = nextBpm;
      setProgress(t);
      setSecondsLeft(Math.max(0, Math.ceil(DURATION - elapsed)));
      setBpm(nextBpm);
      if (elapsed >= DURATION) finish();
    }, 100);
  }, [clearTimers, startSynth]);

  const finish = useCallback(() => {
    clearTimers();
    const a = audioRef.current;
    if (a) {
      // usulca kıs
      let vol = a.volume;
      const fade = window.setInterval(() => {
        vol = Math.max(0, vol - 0.08);
        try { a.volume = vol; } catch {}
        if (vol <= 0) { window.clearInterval(fade); a.pause(); a.currentTime = 0; try { a.volume = 0.6; } catch {} }
      }, 80);
    }
    if (ctxRef.current) { try { ctxRef.current.suspend(); } catch {} }
    setPhase('done');
    setSound('pending');
  }, [clearTimers]);

  useEffect(() => () => {
    clearTimers();
    if (ctxRef.current) { try { ctxRef.current.close(); } catch {} }
  }, [clearTimers]);

  const beatDuration = (60 / bpm).toFixed(2);

  return (
    <div className="relative flex flex-col items-center justify-center min-h-screen bg-[#1E1B3A] text-[#F5F3FF] overflow-hidden select-none">
      <style>{`
        @keyframes heartbeat { 0%,100%{transform:scale(1);opacity:.82} 50%{transform:scale(1.06);opacity:1} }
        @keyframes softPulse { 0%,100%{transform:scale(1)} 50%{transform:scale(1.04)} }
        @keyframes fadeIn { from{opacity:0;transform:translateY(10px)} to{opacity:1;transform:none} }
        @keyframes ambient { 0%,100%{opacity:.25} 50%{opacity:.5} }
        .beat{animation:heartbeat .8s ease-in-out infinite;will-change:transform,opacity}
        .btn-pulse{animation:softPulse 1.8s ease-in-out infinite}
        .fade-in{animation:fadeIn .8s ease-out both}
        .ambient{animation:ambient 3s ease-in-out infinite}
      `}</style>

      {/* GERÇEK <audio> — <video>'dan daha güvenilir. crossOrigin R2 için önemli. */}
      <audio
        ref={audioRef}
        src={AUDIO_SRC}
        loop
        preload="auto"
        crossOrigin="anonymous"
        aria-hidden="true"
        style={{ position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none' }}
      />

      {/* küçük ses durumu — test ederken neyin çaldığını görürsün */}
      {phase === 'playing' && (
        <div className="absolute top-4 right-4 text-[10px] tracking-widest text-[#8B5CF6]">
          {sound === 'file' && '♪ ÇALIYOR'}
          {sound === 'synth' && '♥ NABIZ SESİ'}
          {sound === 'pending' && '…'}
          {sound === 'silent' && '🔇 SESSİZ MOD'}
        </div>
      )}

      {phase === 'idle' && (
        <div className="flex flex-col items-center text-center px-6 fade-in">
          <h1 className="text-3xl font-semibold mb-2 tracking-wide">MindGlow</h1>
          <p className="text-[#C4B5FD] font-light mb-12">Sınav stresi görünmezdir. Kalbin hariç.</p>
          <button
            type="button"
            onClick={start}
            className="btn-pulse px-10 py-4 bg-[#FB7185] text-white rounded-full font-medium text-lg shadow-[0_0_30px_rgba(251,113,133,0.45)]"
          >
            Nabzını Hisset
          </button>
          <p className="mt-8 text-xs text-[#8B5CF6] tracking-widest">KULAKLIĞINI TAK · {DURATION} SANİYE</p>
        </div>
      )}

      {phase === 'playing' && (
        <div className="flex flex-col items-center px-6">
          <p className="mb-10 text-lg font-light tracking-widest text-[#C4B5FD]">Kulaklığını tak. Derin bir nefes al…</p>
          <div className="relative w-72 h-28 flex items-center justify-center">
            <div className="absolute w-56 h-56 rounded-full bg-[#FB7185] blur-3xl ambient" />
            <div className="beat relative" style={{ animationDuration: `${beatDuration}s` }}>
              <svg className="w-64 h-24 drop-shadow-[0_0_16px_rgba(251,113,133,0.65)]" viewBox="0 0 500 100">
                <polyline fill="none" stroke="#FB7185" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round"
                  points="0,50 150,50 170,20 200,90 230,10 260,80 280,50 500,50" />
              </svg>
            </div>
          </div>
          <div className="mt-8 flex items-baseline gap-2 tabular-nums">
            <span className="text-6xl font-semibold text-[#FB7185]">{bpm}</span>
            <span className="text-lg text-[#C4B5FD] font-light">BPM</span>
          </div>
          <p className="mt-1 text-xs text-[#8B5CF6] tracking-[0.3em]">YAVAŞLIYOR</p>
          <div className="mt-12 w-64">
            <div className="flex justify-between text-xs text-[#8B5CF6] font-mono tabular-nums mb-2">
              <span>KALAN</span><span>{secondsLeft}s</span>
            </div>
            <div className="h-1 w-full bg-white/10 rounded-full overflow-hidden">
              <div className="h-full bg-[#FB7185] rounded-full"
                style={{ width: `${(1 - progress) * 100}%`, transition: 'width 0.1s linear' }} />
            </div>
          </div>
        </div>
      )}

      {phase === 'done' && (
        <div className="flex flex-col items-center text-center px-6 fade-in">
          <h2 className="text-3xl font-semibold mb-3 text-[#FB7185]">Nabız Dengelendi.</h2>
          <p className="text-[#C4B5FD] font-light text-lg mb-1">MindGlow ile kontrol hep sende.</p>
          <p className="text-[#8B5CF6] font-light text-sm mt-6">Kulaklığını tak — gerisini bize bırak.</p>
          <button type="button" onClick={start}
            className="mt-10 px-6 py-2 border border-[#8B5CF6]/50 text-[#C4B5FD] rounded-full text-sm font-light hover:bg-white/5 transition">
            Tekrar hisset
          </button>
        </div>
      )}
    </div>
  );
}