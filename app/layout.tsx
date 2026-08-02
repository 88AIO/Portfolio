import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Snowfolio — Portfolio & Dividend Tracker",
  description: "Track your portfolio and dividends across US and Asian markets.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col font-sans">{children}</body>
    </html>
  );
}
