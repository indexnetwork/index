
import { AppLayout } from "components/layout/site/AppLayout";
import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import Head from "next/head";
import "../styles/main.scss";

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'Index Network | The human bridge between context and content.',
  description: 'Create composable discovery engines.',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <AppLayout>
          {children}
        </AppLayout>
      </body>
    </html>
  )
}
