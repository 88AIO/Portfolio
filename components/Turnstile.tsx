"use client";

import { useEffect, useRef, useState } from "react";

// Cloudflare Turnstile, the CAPTCHA Supabase Auth checks on sign-up, sign-in and password reset
// once "Bot and Abuse Protection" is switched on in the Supabase dashboard. Off by default: with no
// NEXT_PUBLIC_TURNSTILE_SITE_KEY this renders nothing and callers send no token, which is exactly
// what Supabase expects while its CAPTCHA setting is off. Turn on the key first, redeploy, then
// flip the Supabase setting; the other order locks everyone out of signing in.
//
// Each token is single-use. Callers remount the widget (change its `key`) after every auth call,
// successful or not, so the next attempt gets a fresh token.
export const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim() ?? "";
export const CAPTCHA_REQUIRED = TURNSTILE_SITE_KEY !== "";

type TurnstileApi = {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string;
  remove: (id: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let loading: Promise<TurnstileApi> | null = null;
function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  loading ??= new Promise<TurnstileApi>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    s.async = true;
    s.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error("turnstile missing")));
    s.onerror = () => {
      loading = null;
      reject(new Error("turnstile failed to load"));
    };
    document.head.appendChild(s);
  });
  return loading;
}

export default function Turnstile({ onToken }: { onToken: (token: string | null) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const report = useRef(onToken);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    report.current = onToken;
  });

  useEffect(() => {
    if (!CAPTCHA_REQUIRED) return;
    let widgetId: string | null = null;
    let cancelled = false;
    loadTurnstile()
      .then((api) => {
        if (cancelled || !box.current) return;
        widgetId = api.render(box.current, {
          sitekey: TURNSTILE_SITE_KEY,
          callback: (token: string) => report.current(token),
          "expired-callback": () => report.current(null),
          "error-callback": () => report.current(null),
        });
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      if (widgetId && window.turnstile) window.turnstile.remove(widgetId);
    };
  }, []);

  if (!CAPTCHA_REQUIRED) return null;
  return (
    <div>
      <div ref={box} className="min-h-[65px]" />
      {failed && (
        <p role="alert" className="text-xs text-rose-600">
          The security check didn&apos;t load. Check your connection or ad blocker, then refresh the page.
        </p>
      )}
    </div>
  );
}
