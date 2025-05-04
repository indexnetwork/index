import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import Navigation from "@/components/Navigation";
import { IntentProvider } from '@/contexts/IntentContext';
import { FileProvider } from '@/contexts/FileContext';
import { IntegrationProvider } from '@/contexts/IntegrationContext';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { ThemeToggle } from '@/components/ThemeToggle';
import ClientLayout from '@/components/ClientLayout';

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Index Network",
  description: "A protocol for discovery",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.className} antialiased `}>
        <ThemeProvider>
          <IntentProvider>
            <FileProvider>
              <IntegrationProvider>
                <ClientLayout>{children}</ClientLayout>
              </IntegrationProvider>
            </FileProvider>
          </IntentProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
