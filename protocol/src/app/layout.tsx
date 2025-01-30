import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import Script from 'next/script';

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Index Network | Discovery Protocol",
  description: "Index connects you with the right ideas and people. All while respecting your privacy.",
  metadataBase: new URL('https://index.network'),
  openGraph: {
    title: "Index Network | Discovery Protocol",
    description: "Index connects you with the right ideas and people. All while respecting your privacy.",
    url: "https://index.network/",
    images: [{ url: "/bridge.jpg" }]
  },
  twitter: {
    card: "summary_large_image",
    site: "https://index.network",
    creator: "@indexnetwork_",
    title: "Index Network | Discovery Protocol",
    description: "Index connects you with the right ideas and people. All while respecting your privacy.",
    images: ["/bridge.jpg"]
  },
  icons: {
    icon: "/favicon-white.png",
    shortcut: "/favicon-white.png",
    apple: "/favicon-white.png"
  },
  referrer: "origin-when-cross-origin"
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <head>
        <script defer data-domain="index.network" src="https://plausible.io/js/script.js"></script>
      </head>
      <body className={`${inter.className} min-h-screen`}>
        <main className="container mx-auto px-4 py-8">
          {children}
        </main>
      </body>
    </html>
  );
}
