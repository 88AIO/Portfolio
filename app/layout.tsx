import type { Metadata, Viewport } from "next";
import { Manrope, Fraunces } from "next/font/google";
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

export const metadata: Metadata = {
  title: "Snowfolio — Portfolio, Dividends & Options Income",
  description:
    "A calm tracker for portfolio performance and income — dividends plus option premium — built for options sellers. Honest data, US-first.",
  manifest: "/manifest.webmanifest",
  applicationName: "Snowfolio",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Snowfolio" },
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
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f4ec" },
    { media: "(prefers-color-scheme: dark)", color: "#1b1914" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${sans.variable} ${display.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col font-sans">{children}</body>
    </html>
  );
}
