import type { Metadata, Viewport } from "next";
import { Manrope, Fraunces } from "next/font/google";
import { SITE_URL } from "@/lib/site";
import "./globals.css";

// Geometric sans for the interface; a warm optical serif for headline moments.
//
// Both "optional", not "swap": on a slow first visit the page paints before the fonts arrive, and
// swapping them in reflowed text that was already on screen (0.07 on the hero from the serif, 0.06
// on the pricing cards from the sans, mobile). Optional keeps the fallback for that one view — the
// fonts are preloaded and cached for the next — so nothing moves. On a normal connection they
// arrive inside the first paint and are used straight away.
const sans = Manrope({ subsets: ["latin"], variable: "--font-manrope", display: "optional" });
const display = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
  display: "optional",
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
