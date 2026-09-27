import type { Metadata } from "next";

// Kept in the layout so the page stays a thin server wrapper around the form. Without this it was
// indexable under the site's generic title; a sign-in form is not a landing page.
export const metadata: Metadata = {
  title: "Sign in — Snowfolio",
  description: "Sign in to Snowfolio, or create a free account.",
  robots: { index: false, follow: false },
};

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children;
}
