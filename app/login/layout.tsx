import type { Metadata } from "next";
import { Suspense } from "react";

// The login page is a client component and cannot export metadata itself. Without this it was
// indexable under the site's generic title; a sign-in form is not a landing page.
export const metadata: Metadata = {
  title: "Sign in — Snowfolio",
  description: "Sign in to Snowfolio, or create a free account.",
  robots: { index: false, follow: false },
};

// Suspense because the page reads ?mode= / ?next= / ?error= with useSearchParams, which on a
// prerendered route needs a boundary to client-render below.
export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={null}>{children}</Suspense>;
}
