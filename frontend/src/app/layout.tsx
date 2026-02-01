import type { Metadata } from "next";
import Script from "next/script";
import "./globals.css";
import { ThemeProvider } from "@/components/ThemeProvider";
import { AuthProvider } from "@/contexts/AuthContext";
import { APIProvider } from "@/contexts/APIContext";
import { NotificationProvider } from "@/contexts/NotificationContext";
import { DiscoveryFilterProvider } from "@/contexts/DiscoveryFilterContext";
import { AIChatSessionsProvider } from "@/contexts/AIChatSessionsContext";
import { AIChatProvider } from "@/contexts/AIChatContext";
import ClientWrapper from "@/components/ClientWrapper";

export const metadata: Metadata = {
  title: "Index Network",
  description: "You know that moment when you meet the right person and your next move clicks into place? That sense of magic? You shouldn't have to wait for luck. Index helps your others find you.",
  icons: {
    icon: '/favicon-white.png',
    shortcut: '/favicon-white.png',
    apple: '/favicon-white.png',
  },
  openGraph: {
    type: "website",
    url: "https://index.network/",
    title: "Index Network",
    description: "You know that moment when you meet the right person and your next move clicks into place? That sense of magic? You shouldn't have to wait for luck. Index helps your others find you.",
    images: [
      {
        url: "https://index.network/link-preview.png",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Index Network",
    description: "You know that moment when you meet the right person and your next move clicks into place? That sense of magic? You shouldn't have to wait for luck. Index helps your others find you.",
    images: ["https://index.network/link-preview.png"],
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
        <ThemeProvider>
          <AuthProvider>
            <APIProvider>
              <NotificationProvider>
                <DiscoveryFilterProvider>
                  <AIChatSessionsProvider>
                    <AIChatProvider>
                      <ClientWrapper>
                        {children}
                      </ClientWrapper>
                    </AIChatProvider>
                  </AIChatSessionsProvider>
                </DiscoveryFilterProvider>
              </NotificationProvider>
            </APIProvider>
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}

