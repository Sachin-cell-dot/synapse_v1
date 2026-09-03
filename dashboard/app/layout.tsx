import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = { title: 'SYNAPSE-WX | Karnataka rainfall hindcast', description: 'Historical-performance dashboard for the frozen SYNAPSE-WX district rainfall forecasting MVP.' };

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
