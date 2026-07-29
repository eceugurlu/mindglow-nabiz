'use client';
import { useState, useRef } from 'react';

export default function NabizDemo() {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isFinished, setIsFinished] = useState(false);
  
  // MP4 (video) formatı çaldığımız için video referansı kullanıyoruz
  const videoRef = useRef<HTMLVideoElement | null>(null); 

  const startExperience = () => {
    if (videoRef.current) {
      videoRef.current.volume = 0.5;
      videoRef.current.play();
      setIsPlaying(true);

      // TAM 1 DAKİKA (60.000 milisaniye) SONRA ÇALIŞACAK ZAMANLAYICI
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.pause(); // Sesi durdur
        }
        setIsPlaying(false); // Nabız animasyonunu kapat
        setIsFinished(true); // Final ekranını göster
      }, 60000); 
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-[#1E1B3A] text-[#F5F3FF] overflow-hidden">
      
      {/* 
        GİZLİ VİDEO OYNATICI VE R2 LİNKİN
        Eğer R2'daki dosyanın adı farklıysa, aşağıdaki linkin en sonundaki 'weightless.mp4' kısmını kendi dosya adınla değiştir.
      */}
      <video 
        ref={videoRef} 
        src="https://pub-748f7570433143eaa18b42464d98a818.r2.dev/weightless.mp4" 
        loop 
        playsInline 
        className="hidden" 
      />

      {/* DURUM 1: Başlangıç Ekranı */}
      {!isPlaying && !isFinished && (
        <div className="flex flex-col items-center text-center px-6">
          <h1 className="text-3xl font-semibold mb-2 tracking-wide">MindGlow</h1>
          <p className="text-[#C4B5FD] font-light mb-12">Sınav stresi görünmezdir. Kalbin hariç.</p>
          <button
            onClick={startExperience}
            className="px-10 py-4 bg-[#FB7185] text-white rounded-full font-medium text-lg animate-pulse shadow-[0_0_30px_rgba(251,113,133,0.4)]"
          >
            Nabzını Hisset
          </button>
        </div>
      )}

      {/* DURUM 2: 1 Dakikalık Nabız Animasyonu */}
      {isPlaying && (
        <div className="flex flex-col items-center">
          <p className="mb-12 text-xl font-light tracking-widest text-[#C4B5FD] animate-pulse">
            Kulaklığını tak. Derin bir nefes al...
          </p>
          
          <div className="relative w-64 h-32 flex items-center justify-center">
             <svg className="w-full h-full drop-shadow-[0_0_15px_rgba(251,113,133,0.6)]" viewBox="0 0 500 100">
                <polyline
                  fill="none"
                  stroke="#FB7185"
                  strokeWidth="6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  points="0,50 150,50 170,20 200,90 230,10 260,80 280,50 500,50"
                  className="animate-[pulse_1.5s_ease-in-out_infinite]"
                />
              </svg>
          </div>
          
          <p className="mt-12 text-sm text-[#8B5CF6] font-mono">BPM YAVAŞLIYOR</p>
        </div>
      )}

      {/* DURUM 3: 1 Dakika Dolduktan Sonra Çıkacak Final Ekranı */}
      {isFinished && (
        <div className="flex flex-col items-center text-center px-6 animate-[fadeIn_1s_ease-in-out]">
          <h2 className="text-3xl font-semibold mb-4 text-[#FB7185]">Nabız Dengelendi.</h2>
          <p className="text-[#C4B5FD] font-light text-lg">MindGlow ile kontrol hep sende.</p>
        </div>
      )}

    </div>
  );
}