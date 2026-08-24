// Minimal transactional-email sender via Resend's REST API. No SDK — just fetch, so it adds no
// dependency. If RESEND_API_KEY is unset it no-ops (returns false) rather than throwing, so the
// notification crons run harmlessly until email is configured.

export type EmailResult = { sent: boolean; skipped?: string; error?: string };

export async function sendEmail(to: string, subject: string, html: string): Promise<EmailResult> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { sent: false, skipped: "RESEND_API_KEY not set" };
  const from = process.env.EMAIL_FROM || "Snowfolio <onboarding@resend.dev>";
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to, subject, html }),
    });
    if (!res.ok) return { sent: false, error: `Resend ${res.status}: ${(await res.text()).slice(0, 200)}` };
    return { sent: true };
  } catch (e) {
    return { sent: false, error: String(e).slice(0, 200) };
  }
}

// A calm, on-brand HTML shell for our emails (inline styles — email clients ignore <style>).
export function emailShell(title: string, bodyHtml: string): string {
  return `<!doctype html><html><body style="margin:0;background:#f8fafc;padding:24px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0f172a">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:16px;overflow:hidden">
    <div style="padding:20px 24px;border-bottom:1px solid #eef2f7;display:flex;align-items:center;gap:8px">
      <span style="display:inline-block;width:22px;height:22px;border-radius:999px;background:linear-gradient(135deg,#38bdf8,#6366f1)"></span>
      <span style="font-weight:700">Snowfolio</span>
    </div>
    <div style="padding:24px">
      <h1 style="margin:0 0 12px;font-size:18px">${title}</h1>
      ${bodyHtml}
    </div>
    <div style="padding:16px 24px;border-top:1px solid #eef2f7;font-size:12px;color:#94a3b8">
      You're getting this because you turned on notifications in Snowfolio. Informational only, never advice.
    </div>
  </div>
</body></html>`;
}
