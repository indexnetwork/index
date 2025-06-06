import type { Metadata } from "next";
import Script from "next/script";
import "./globals.css";
import { AuthProvider } from "@/contexts/AuthContext";

export const metadata: Metadata = {
  title: "Index Network | Discovery Protocol",
  description: "Let autonomous agents run in the background, reading signals from your files and matching you with the right people-right when it matters.",
  icons: {
    icon: '/favicon-white.png',
    shortcut: '/favicon-white.png',
    apple: '/favicon-white.png',
  },
  openGraph: {
    type: "website",
    url: "https://index.network/",
    title: "Index Network | Discovery Protocol",
    description: "Let autonomous agents run in the background, reading signals from your files and matching you with the right people-right when it matters.",
    images: [
      {
        url: "https://index.network/bridge.jpg",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Index Network | Discovery Protocol",
    description: "Let autonomous agents run in the background, reading signals from your files and matching you with the right people-right when it matters.",
    images: ["https://index.network/bridge.jpg"],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`antialiased`}>
        <Script
          defer
          data-domain="index.network"
          src="https://plausible.io/js/script.outbound-links.js"
        />
        <AuthProvider>
          {children}
        </AuthProvider>
      </body>
    </html>
  );
}

