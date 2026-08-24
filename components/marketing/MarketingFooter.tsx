import Link from "next/link";
import BrandMark from "@/components/BrandMark";
import { APP_NAME, CONTACT_EMAIL } from "@/lib/legal";

// Shared footer for the public marketing pages.
export default function MarketingFooter() {
  return (
    <footer className="border-t border-slate-200 bg-[#f4f0e6]">
      <div className="mx-auto max-w-6xl px-6 py-14">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <Link href="/" className="flex items-center gap-2.5">
              <BrandMark className="h-8 w-8" />
              <span className="text-lg font-semibold tracking-tight text-slate-900">Snowfolio</span>
            </Link>
            <p className="mt-3 max-w-xs text-sm leading-relaxed text-slate-500">
              Your whole portfolio, in one honest view. Dividends and option income together, calm by
              default.
            </p>
          </div>

          <FooterCol title="Product" links={[["Features", "/#features"], ["Pricing", "/pricing"], ["Sign in", "/login"]]} />
          <FooterCol title="Company" links={[["About", "/about"], ["Contact", "/contact"], ["Get started", "/login"]]} />
          <FooterCol
            title="Legal"
            links={[["Disclaimer", "/legal/disclaimer"], ["Terms", "/legal/terms"], ["Privacy", "/legal/privacy"]]}
          />
        </div>

        <div className="mt-12 flex flex-col gap-3 border-t border-slate-200 pt-6 text-sm text-slate-400 sm:flex-row sm:items-center sm:justify-between">
          <span>© {new Date().getFullYear()} {APP_NAME}</span>
          <span className="max-w-md text-xs">
            Informational only, not financial advice. Questions?{" "}
            <a href={`mailto:${CONTACT_EMAIL}`} className="underline decoration-slate-300 hover:text-slate-600">
              {CONTACT_EMAIL}
            </a>
          </span>
        </div>
      </div>
    </footer>
  );
}

function FooterCol({ title, links }: { title: string; links: [string, string][] }) {
  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">{title}</h3>
      <ul className="mt-3 space-y-2 text-sm">
        {links.map(([label, href]) => (
          <li key={label}>
            <Link href={href} className="text-slate-600 transition hover:text-[#205d4a]">
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
