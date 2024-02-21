import { AppLayout } from "components/layout/site/AppLayout";
import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  metadataBase: new URL("https://index.network"),
  title: "Index Network | Composable Discovery Protocol",
  description:
    "Index allows to create truly personalised and autonomous discovery experiences across the web",
  referrer: "origin-when-cross-origin",
  icons: [
    { rel: "shortcut icon", url: "/favicon-white.png" },
    { rel: "icon", url: "/favicon-white.png" },
    { rel: "apple-touch-icon", url: "/favicon-white.png" },
  ],
  twitter: {
    card: "summary_large_image",
    creator: "@indexnetwork_",
    site: "https://index.network",
    title: "Index Network | Composable Discovery Protocol",
    description:
      "Index allows to create truly personalised and autonomous discovery experiences across the web.",
    images: ["https://index.network/images/bridge.jpg?a"],
  },
  openGraph: {
    title: "Index Network | Composable Discovery Protocol",
    description:
      "Index allows to create truly personalised and autonomous discovery experiences across the web.",
    url: "https://index.network",
    images: "https://index.network/images/bridge.jpg=a",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <AppLayout>{children}</AppLayout>
      </body>
    </html>
  );
}
