import LoginForm from "@/components/LoginForm";
import { safeNextPath } from "@/lib/safeNext";

// Server-rendered so the form arrives in the HTML. It used to read the URL on the client, which
// pushed the whole page below a client-only boundary: on a phone over 4G nothing showed until
// ~300 KB of JavaScript had loaded (a 3.2 s Largest Contentful Paint, past Google's 2.5 s line).
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const one = (key: string) => {
    const v = params[key];
    return (Array.isArray(v) ? v[0] : v) ?? null;
  };
  return (
    <LoginForm
      // Only ever a path on this site: `next` comes from the URL (see lib/safeNext.ts).
      next={safeNextPath(one("next"))}
      initialMode={one("mode") === "signup" ? "signup" : "signin"}
      initialError={one("error")}
    />
  );
}
