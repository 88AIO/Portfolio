import type { Metadata, Viewport } from "next";
import { Manrope, Fraunces } from "next/font/google";
import { SITE_URL } from "@/lib/site";
import "./globals.css";

// Geometric sans for the interface; a warm optical serif for headline moments.
const sans = Manrope({ subsets: ["latin"], variable: "--font-manrope", display: "swap" });
const display = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
  display: "swap",
  weight: ["400", "500", "600"],
  style: ["normal", "italic"],
});

const title = "Snowfolio — Portfolio, Dividends & Options Income";
const description =
  "A calm tracker for portfolio performance and income: dividends plus option premium, built for options sellers. Honest data, US-first.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title,
  description,
  // Resolved against metadataBase per page, so the vercel.app alias and the custom domain never
  // compete as duplicates once NEXT_PUBLIC_SITE_URL names the real one.
  alternates: { canonical: "./" },
  manifest: "/manifest.webmanifest",
  applicationName: "Snowfolio",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Snowfolio" },
  openGraph: {
    type: "website",
    siteName: "Snowfolio",
    url: SITE_URL,
    title,
    description,
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
  },
  icons: {
    icon: [
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { url: "/icon.svg", type: "image/svg+xml" },
    ],
    apple: "/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  // The app deliberately keeps its ivory paper in dark-OS contexts too (see globals.css), so the
  // browser chrome must match it — a near-black address bar over an ivory page looked broken.
  themeColor: "#f7f4ec",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${sans.variable} ${display.variable} h-full scroll-smooth antialiased`}>
      <body className="min-h-full flex flex-col font-sans">{children}</body>
    </html>
  );
}
