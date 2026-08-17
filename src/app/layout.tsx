import type { Metadata, Viewport } from 'next';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: 'MakerWorld Resale Tracker',
  description: 'Trending 3D-printable models scored for resale potential on Vinted/OLX',
};

// The swipe feed is meant to be used from a phone.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  themeColor: '#0e1116',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <nav className="app-nav">
          <Link href="/">Dashboard</Link>
          <Link href="/swipe">Swipe</Link>
          <Link href="/liked">Liked</Link>
        </nav>
        {children}
      </body>
    </html>
  );
}
