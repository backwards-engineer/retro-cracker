import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Cracklab ’97 — Reverse Engineering Playground',
  description: 'A local retro crackme game. Follow the assembly, patch a few bytes, and unlock fictional shareware.',
  icons: { icon: '/cracklab.svg' },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
