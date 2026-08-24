import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

// Let crawlers index the public marketing + legal pages; keep the app, auth, and API private.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/dashboard", "/auth", "/api"],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
