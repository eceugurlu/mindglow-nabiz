'use client';

import { useState, useRef, useEffect, useCallback } from 'react';

// ── Tek yerden ayar ──────────────────────────────────────────
const DURATION = 30;   // saniye — 30 saniyelik canlı demo tasarımı
const START_BPM = 98;  // sınav stresi: yarışan kalp
const END_BPM = 62;    // sakin baseline
// ─────────────────────────────────────────────────────────────

type Phase = 'idle' | 'playing' | 'done';

const easeOut = (t: number) => 1 - Math.pow(1 - t, 2);

export default function NabizDemo() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [secondsLeft, setSecondsLeft] = useState(DURATION);
  const [bpm, setBpm] = useState(START_BPM);
  const [progress, setProgress] = useState(0); // 0 → 1

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const tickRef = useRef<number | null>(null);
  const fadeRef = useRef<number | null>(null);
  const startRef = useRef<number>(0);

  const clearTimers = useCallback(() => {
    if (tickRef.current !== null) window.clearInterval(tickRef.current);
    if (fadeRef.current !== null) window.clearInterval(fadeRef.current);
    tickRef.current = null;
    fadeRef.current = null;
  }, []);

  // Sesi sertçe kesmek yerine ~1 sn'de usulca kısıp durdur
  // (iOS volume'ü yok sayar ama pause yine çalışır — zararsız)
  const stopAudioGently = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    let vol = v.volume;
    if (fadeRef.current !== null) window.clearInterval(fadeRef.current);
    fadeRef.current = window.setInterval(() => {
      vol = Math.max(0, vol - 0.08);
      try { v.volume = vol; } catch {}
      if (vol <= 0) {
        if (fadeRef.current !== null) window.clearInterval(fadeRef.current);
        fadeRef.current = null;
        v.pause();
        v.currentTime = 0;
        try { v.volume = 0.5; } catch {}
      }
    }, 80);
  }, []);

  const finish = useCallback(() => {
    clearTimers();
    stopAudioGently();
    setPhase('done');
  }, [clearTimers, stopAudioGently]);

  const start = useCallback(() => {
    clearTimers();
    setPhase('playing');
    setSecondsLeft(DURATION);
    setBpm(START_BPM);
    setProgress(0);
    startRef.current = performance.now();

    // .play() KULLANICI DOKUNUŞU İÇİNDE çağrılmalı (iOS Safari kuralı).
    // Promise reddedilebilir; reddedilse bile görsel akış devam eder.
    const v = videoRef.current;
    if (v) {
      try { v.currentTime = 0; v.volume = 0.5; } catch {}
      const p = v.play();
      if (p && typeof p.catch === 'function') {
        p.catch(() => {/* ses bloklandı — görsel deneyim yine çalışır */});
      }
    }

    tickRef.current = window.setInterval(() => {
      const elapsed = (performance.now() - startRef.current) / 1000;
      const t = Math.min(1, elapsed / DURATION);
      setProgress(t);
      setSecondsLeft(Math.max(0, Math.ceil(DURATION - elapsed)));
      setBpm(Math.round(START_BPM - (START_BPM - END_BPM) * easeOut(t)));
      if (elapsed >= DURATION) finish();
    }, 100);
  }, [clearTimers, finish]);

  // Bileşen kapanırsa zamanlayıcıları temizle
  useEffect(() => clearTimers, [clearTimers]);

  const beatDuration = (60 / bpm).toFixed(2); // atış aralığı = 60 / BPM

  return (
    <div className="relative flex flex-col items-center justify-center min-h-screen bg-[#1E1B3A] text-[#F5F3FF] overflow-hidden select-none">
      <style>{`
        @keyframes heartbeat { 0%,100% { transform: scale(1); opacity: .82 } 50% { transform: scale(1.06); opacity: 1 } }
        @keyframes softPulse { 0%,100% { transform: scale(1) } 50% { transform: scale(1.04) } }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(10px) } to { opacity: 1; transform: none } }
        @keyframes ambient { 0%,100% { opacity: .25 } 50% { opacity: .5 } }
        .beat { animation: heartbeat 0.8s ease-in-out infinite; will-change: transform, opacity; }
        .btn-pulse { animation: softPulse 1.8s ease-in-out infinite; }
        .fade-in { animation: fadeIn .8s ease-out both; }
        .ambient { animation: ambient 3s ease-in-out infinite; }
      `}</style>

      {/* Gizli ses kaynağı — display:none DEĞİL (iOS çaldırmayabilir), ekran dışında.
          R2'daki dosya adın farklıysa aşağıdaki src'nin sonundaki 'weightless.mp4'i değiştir. */}
      <video
        ref={videoRef}
        src="https://pub-748f7570433143eaa18b42464d98a818.r2.dev/weightless.mp4"
        loop
        playsInline
        preload="auto"
        aria-hidden="true"
        style={{ position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none' }}
      />

      {/* DURUM 1 — Başlangıç */}
      {phase === 'idle' && (
        <div className="flex flex-col items-center text-center px-6 fade-in">
          <h1 className="text-3xl font-semibold mb-2 tracking-wide">MindGlow</h1>
          <p className="text-[#C4B5FD] font-light mb-12">Sınav stresi görünmezdir. Kalbin hariç.</p>
          <button
            type="button"
            onClick={start}
            aria-label="Nabzını hisset — deneyimi başlat"
            className="btn-pulse px-10 py-4 bg-[#FB7185] text-white rounded-full font-medium text-lg shadow-[0_0_30px_rgba(251,113,133,0.45)]"
          >
            Nabzını Hisset
          </button>
          <p className="mt-8 text-xs text-[#8B5CF6] tracking-widest">KULAKLIĞINI TAK · {DURATION} SANİYE</p>
        </div>
      )}

      {/* DURUM 2 — 30 saniyelik nabız deneyimi */}
      {phase === 'playing' && (
        <div className="flex flex-col items-center px-6">
          <p className="mb-10 text-lg font-light tracking-widest text-[#C4B5FD]">
            Kulaklığını tak. Derin bir nefes al…
          </p>

          {/* Nabız çizgisi — atış hızı BPM ile yavaşlıyor */}
          <div className="relative w-72 h-28 flex items-center justify-center">
            <div className="absolute w-56 h-56 rounded-full bg-[#FB7185] blur-3xl ambient" />
            <div className="beat relative" style={{ animationDuration: `${beatDuration}s` }}>
              <svg className="w-64 h-24 drop-shadow-[0_0_16px_rgba(251,113,133,0.65)]" viewBox="0 0 500 100">
                <polyline
                  fill="none"
                  stroke="#FB7185"
                  strokeWidth="6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  points="0,50 150,50 170,20 200,90 230,10 260,80 280,50 500,50"
                />
              </svg>
            </div>
          </div>

          {/* Görünür BPM — 98'den 62'ye canlı düşer */}
          <div className="mt-8 flex items-baseline gap-2 tabular-nums">
            <span className="text-6xl font-semibold text-[#FB7185]">{bpm}</span>
            <span className="text-lg text-[#C4B5FD] font-light">BPM</span>
          </div>
          <p className="mt-1 text-xs text-[#8B5CF6] tracking-[0.3em]">YAVAŞLIYOR</p>

          {/* Geri sayım + tükenen zaman çubuğu */}
          <div className="mt-12 w-64">
            <div className="flex justify-between text-xs text-[#8B5CF6] font-mono tabular-nums mb-2">
              <span>KALAN</span>
              <span>{secondsLeft}s</span>
            </div>
            <div className="h-1 w-full bg-white/10 rounded-full overflow-hidden">
              <div
                className="h-full bg-[#FB7185] rounded-full"
                style={{ width: `${(1 - progress) * 100}%`, transition: 'width 0.1s linear' }}
              />
            </div>
          </div>
        </div>
      )}

      {/* DURUM 3 — Kapanış */}
      {phase === 'done' && (
        <div className="flex flex-col items-center text-center px-6 fade-in">
          <h2 className="text-3xl font-semibold mb-3 text-[#FB7185]">Nabız Dengelendi.</h2>
          <p className="text-[#C4B5FD] font-light text-lg mb-1">MindGlow ile kontrol hep sende.</p>
          <p className="text-[#8B5CF6] font-light text-sm mt-6">Kulaklığını tak — gerisini bize bırak.</p>
          <button
            type="button"
            onClick={start}
            className="mt-10 px-6 py-2 border border-[#8B5CF6]/50 text-[#C4B5FD] rounded-full text-sm font-light hover:bg-white/5 transition"
          >
            Tekrar hisset
          </button>
        </div>
      )}
    </div>
  );
}