import type { Metadata } from 'next';
import { SessionProvider } from '@/lib/session-context';
import './globals.css';

export const metadata: Metadata = {
  title: 'Delivery360',
  description: 'Gestão completa para restaurantes e deliverys',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>
        <SessionProvider>{children}</SessionProvider>
      </body>
    </html>
  );
}
