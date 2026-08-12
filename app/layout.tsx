import type { Metadata, Viewport } from 'next';
import { Space_Grotesk, Fraunces, Space_Mono } from 'next/font/google';
import './globals.css';

// Arayüz: modern/tekno grotesk
const grotesk = Space_Grotesk({
  subsets: ['latin', 'latin-ext'],
  weight: ['300', '400', '500', '600', '700'],
  variable: '--font-grotesk',
  display: 'swap',
});

// Duygusal başlıklar: zarif serif
const serif = Fraunces({
  subsets: ['latin', 'latin-ext'],
  weight: ['400', '500', '600'],
  style: ['normal', 'italic'],
  variable: '--font-serif',
  display: 'swap',
});

// Sayılar / BPM: biyometrik mono
const mono = Space_Mono({
  subsets: ['latin', 'latin-ext'],
  weight: ['400', '700'],
  variable: '--font-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'NABIZ · MindGlow',
  description: 'Sınav stresi görünmezdir. Kalbin hariç. Nabzını gör, 5 dakikada yavaşlat.',
};

// iPhone "resim gibi yakınlaştırma" düzeltmesi
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: '#110C26',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="tr" className={`${grotesk.variable} ${serif.variable} ${mono.variable}`}>
      <body
        style={{
          margin: 0,
          padding: 0,
          background: '#110C26',
          overscrollBehavior: 'none',
          WebkitFontSmoothing: 'antialiased',
          MozOsxFontSmoothing: 'grayscale',
        }}
      >
        {children}
      </body>
    </html>
  );
}