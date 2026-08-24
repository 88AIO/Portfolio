import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";
import { posts } from "@/lib/content/blog";

// Public, indexable pages only. The dashboard and auth routes are private and excluded.
export default function sitemap(): MetadataRoute.Sitemap {
  const paths = [
    "",
    "/pricing",
    "/about",
    "/contact",
    "/blog",
    "/changelog",
    "/login",
    "/legal/disclaimer",
    "/legal/terms",
    "/legal/privacy",
    ...posts.map((p) => `/blog/${p.slug}`),
  ];
  return paths.map((p) => ({
    url: `${SITE_URL}${p}`,
    changeFrequency: "monthly",
    priority: p === "" ? 1 : 0.5,
  }));
}
