// The site's public base URL, used for metadata, sitemap, and auth redirect links.
// Override with NEXT_PUBLIC_SITE_URL once a custom domain is live; otherwise fall back to
// Vercel's production URL, then localhost for dev.
export const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ||
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : "http://localhost:3000");
