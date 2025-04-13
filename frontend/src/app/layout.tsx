import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import Navigation from "@/components/Navigation";
import { IntentProvider } from '@/contexts/IntentContext';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { ThemeToggle } from '@/components/ThemeToggle';

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
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.className} antialiased bg-gray-50 dark:bg-gray-900`}>
        <ThemeProvider>
          <IntentProvider>
            <div className="min-h-screen">
              <div className="fixed top-4 right-4 z-50">
                <ThemeToggle />
              </div>
              <Navigation />
              <main className="pl-72">
                <div className="max-w-7xl mx-auto p-8">
                  {children}
                </div>
              </main>
            </div>
          </IntentProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
