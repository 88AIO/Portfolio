import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import MarketingNav from "@/components/marketing/MarketingNav";
import MarketingFooter from "@/components/marketing/MarketingFooter";
import { posts, getPost, formatDate, type Block } from "@/lib/content/blog";

export function generateStaticParams() {
  return posts.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const post = getPost(slug);
  if (!post) return { title: "Post not found — Snowfolio" };
  return {
    title: `${post.title} — Snowfolio`,
    description: post.excerpt,
    openGraph: { title: post.title, description: post.excerpt, type: "article" },
    twitter: { card: "summary_large_image", title: post.title, description: post.excerpt },
  };
}

export default async function BlogPost({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = getPost(slug);
  if (!post) notFound();

  return (
    <div className="bg-[#f7f4ec] text-slate-800">
      <MarketingNav />

      <article className="mx-auto max-w-2xl px-6 pb-20 pt-14">
        <Link href="/blog" className="text-sm font-medium text-slate-500 hover:text-slate-800">← All posts</Link>

        <div className="mt-6 flex items-center gap-2 text-xs text-slate-400">
          <span className="rounded-full bg-[#edf3ee] px-2 py-0.5 font-medium text-[#205d4a]">{post.tag}</span>
          <span>·</span>
          <span>{formatDate(post.date)}</span>
          <span>·</span>
          <span>{post.readMins} min read</span>
        </div>

        <h1 className="font-display mt-4 text-4xl font-medium leading-[1.1] tracking-tight text-slate-900">{post.title}</h1>
        <p className="mt-4 text-lg leading-relaxed text-slate-500">{post.excerpt}</p>

        <div className="mt-8 border-t border-slate-200 pt-8">
          {post.body.map((block, i) => (
            <BlockView key={i} block={block} />
          ))}
        </div>

        {/* End CTA */}
        <div className="mt-12 rounded-2xl border border-[#205d4a]/20 bg-gradient-to-br from-[#edf3ee] to-white p-6 text-center shadow-soft">
          <p className="font-display text-lg font-medium text-slate-900">See what your portfolio really pays you.</p>
          <Link
            href="/login"
            className="mt-4 inline-flex items-center gap-2 rounded-full bg-slate-900 px-5 py-2.5 text-sm font-medium text-[#f7f4ec] hover:bg-slate-800"
          >
            Get started free
            <span aria-hidden className="text-[#8fbfad]">→</span>
          </Link>
        </div>
      </article>

      <MarketingFooter />
    </div>
  );
}

function BlockView({ block }: { block: Block }) {
  switch (block.type) {
    case "h2":
      return <h2 className="font-display mt-9 text-2xl font-medium tracking-tight text-slate-900">{block.text}</h2>;
    case "ul":
      return (
        <ul className="mt-4 space-y-2">
          {block.items.map((it, i) => (
            <li key={i} className="flex items-start gap-2.5 text-[17px] leading-relaxed text-slate-600">
              <span aria-hidden className="mt-0.5 text-[#205d4a]">✓</span>
              <span>{it}</span>
            </li>
          ))}
        </ul>
      );
    case "quote":
      return (
        <blockquote className="my-8 border-l-2 border-[#205d4a] pl-5">
          <p className="font-display text-xl font-medium italic leading-relaxed text-slate-800">{block.text}</p>
        </blockquote>
      );
    default:
      return <p className="mt-5 text-[17px] leading-relaxed text-slate-600">{block.text}</p>;
  }
}
