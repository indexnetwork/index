import type { Metadata } from "next";
import "./globals.css";
import RootLayoutClient from "@/components/RootLayoutClient";

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
        <RootLayoutClient>{children}</RootLayoutClient>
      </body>
    </html>
  );
}

