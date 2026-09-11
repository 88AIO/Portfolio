import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";
import { posts } from "@/lib/content/blog";
import { releases } from "@/lib/content/changelog";

// Public, indexable pages only. The dashboard, login and auth routes are private and excluded.
export default function sitemap(): MetadataRoute.Sitemap {
  const latestRelease = releases.map((r) => r.date).sort().at(-1);
  const staticPaths: { path: string; priority: number; lastModified?: string }[] = [
    { path: "", priority: 1 },
    { path: "/pricing", priority: 0.8 },
    { path: "/about", priority: 0.6 },
    { path: "/contact", priority: 0.4 },
    { path: "/blog", priority: 0.6, lastModified: posts.map((p) => p.date).sort().at(-1) },
    { path: "/changelog", priority: 0.5, lastModified: latestRelease },
    { path: "/legal/disclaimer", priority: 0.3 },
    { path: "/legal/terms", priority: 0.3 },
    { path: "/legal/privacy", priority: 0.3 },
  ];
  return [
    ...staticPaths.map((p) => ({
      url: `${SITE_URL}${p.path}`,
      changeFrequency: "monthly" as const,
      priority: p.priority,
      ...(p.lastModified ? { lastModified: p.lastModified } : {}),
    })),
    ...posts.map((p) => ({
      url: `${SITE_URL}/blog/${p.slug}`,
      changeFrequency: "yearly" as const,
      priority: 0.5,
      lastModified: p.date,
    })),
  ];
}
