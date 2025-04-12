import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import Navigation from "@/components/Navigation";
import { IntentProvider } from '@/contexts/IntentContext';

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Index Protocol",
  description: "A protocol for discovery",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className={`${inter.className} antialiased`}>
        <IntentProvider>
          <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
            <Navigation />
            <main className="pl-72">
              <div className="max-w-7xl mx-auto p-8">
                {children}
              </div>
            </main>
          </div>
        </IntentProvider>
      </body>
    </html>
  );
}
