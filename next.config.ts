import type { NextConfig } from "next";

// The Supabase project origin, so the connect-src rule names exactly one host rather than every
// *.supabase.co project on the internet. Falls back to the wildcard when the env isn't set (e.g. a
// bare `next build` in CI with placeholder values).
const supabaseOrigin = (() => {
  try {
    const u = process.env.NEXT_PUBLIC_SUPABASE_URL;
    return u ? new URL(u).origin : null;
  } catch {
    return null;
  }
})();
const supabaseSources = supabaseOrigin
  ? `${supabaseOrigin} ${supabaseOrigin.replace(/^http/, "ws")}`
  : "https://*.supabase.co wss://*.supabase.co";

// Content-Security-Policy. The app loads no third-party scripts, so this is nearly a self-only
// policy. 'unsafe-inline' on script-src is the one concession: Next.js App Router streams its
// hydration payload as inline <script> tags and a nonce-based policy would need the middleware to
// run on every page — it is deliberately narrowed to the app routes (see proxy.ts). Everything
// else is closed: no framing (clickjacking), no foreign fetch targets for data exfiltration, no
// plugins, no base-tag hijack, forms post only to us. vercel.live is Vercel's preview toolbar.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === "production" ? "" : " 'unsafe-eval'"} https://vercel.live`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self' ${supabaseSources} https://vercel.live`,
  "frame-src https://vercel.live",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
  "upgrade-insecure-requests",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()" },
  // Vercel adds HSTS on its own domains; set it here too so a custom domain or a self-hosted
  // `next start` gets the same guarantee.
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
];

const nextConfig: NextConfig = {
  // Server-only Node libraries; keep them out of the client bundle.
  serverExternalPackages: ["yahoo-finance2", "snaptrade-typescript-sdk"],
  // No reason to advertise the framework on every response.
  poweredByHeader: false,
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

export default nextConfig;
