import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

// Public, indexable pages only. The dashboard and auth routes are private and excluded.
export default function sitemap(): MetadataRoute.Sitemap {
  const paths = ["", "/login", "/legal/disclaimer", "/legal/terms", "/legal/privacy"];
  return paths.map((p) => ({
    url: `${SITE_URL}${p}`,
    changeFrequency: "monthly",
    priority: p === "" ? 1 : 0.5,
  }));
}
