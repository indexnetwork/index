import { AppLayout } from "components/layout/site/AppLayout";
import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { headers } from "next/headers";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  metadataBase: new URL("https://index.network"),
  title: "Index Network | Discovery Protocol",
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
    title: "Index Network | Discovery Protocol",
    description:
      "Index allows to create truly personalised and autonomous discovery experiences across the web.",
    images: ["https://index.network/images/bridge.jpg"],
  },
  openGraph: {
    title: "Index Network | Discovery Protocol",
    description:
      "Index allows to create truly personalised and autonomous discovery experiences across the web.",
    url: "https://index.network",
    images: "https://index.network/images/bridge.jpg",
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
  const heads = headers();
  const pathname = heads.get("x-url");

  let page = "landing";
  if (pathname) {
    const urlObj1 = new URL(pathname);

    if (urlObj1.pathname !== "/") {
      page = "app";
    }
  }

  return (
    <html lang="en" id={page}>
      <body className={inter.className}>
        <AppLayout>{children}</AppLayout>
      </body>
    </html>
  );
}
