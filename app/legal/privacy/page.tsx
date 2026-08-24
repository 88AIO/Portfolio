import type { Metadata } from "next";
import LegalShell, { H2, P, UL } from "@/components/LegalShell";
import { APP_NAME, COMPANY, CONTACT_EMAIL } from "@/lib/legal";

export const metadata: Metadata = { title: `Privacy Policy — ${APP_NAME}` };

export default function PrivacyPage() {
  return (
    <LegalShell title="Privacy Policy">
      <P>
        This Privacy Policy explains what {APP_NAME} (operated by {COMPANY}, &ldquo;we,&rdquo;
        &ldquo;us&rdquo;) collects, how we use it, and the choices you have. By using {APP_NAME}, you
        agree to this Policy.
      </P>

      <H2>Information we collect</H2>
      <UL>
        <li><strong>Account information</strong> — your email address and authentication credentials
          (passwords are salted and hashed by our authentication provider; we never see them in plain
          text).</li>
        <li><strong>Portfolio data you provide</strong> — holdings, transactions, dividends, option
          trades, cash entries, and notes you enter or import (for example, via CSV).</li>
        <li><strong>Brokerage data (only if you connect an account)</strong> — via a third-party
          brokerage-connection service, we receive <strong>read-only</strong> holdings, balances,
          account type, transaction history, and a <strong>masked</strong> account number (we store
          only the last four digits). We cannot place trades or move money.</li>
        <li><strong>Notification preferences</strong> — whether you opted into alert and digest emails.</li>
        <li><strong>Technical data</strong> — standard server logs and strictly-necessary cookies used
          to keep you signed in. We do not use advertising or cross-site tracking cookies.</li>
      </UL>

      <H2>How we use it</H2>
      <UL>
        <li>To provide the Service — compute your dashboard, performance, income, and option views from
          your data.</li>
        <li>To send emails you opt into (alerts and the weekly income digest). You can turn these off at
          any time in the app.</li>
        <li>To secure, maintain, debug, and improve the Service.</li>
        <li>To comply with legal obligations.</li>
      </UL>
      <P>We do <strong>not</strong> sell or rent your personal information, and we do not use it for
        third-party advertising.</P>

      <H2>Service providers we share data with</H2>
      <P>We use a small set of vendors to run the Service. They process data on our behalf under their
        own terms:</P>
      <UL>
        <li><strong>Supabase</strong> — database, authentication, and storage.</li>
        <li><strong>Vercel</strong> — application hosting.</li>
        <li><strong>SnapTrade</strong> — brokerage account connections (only if you connect one).</li>
        <li><strong>Resend</strong> — sending the emails you opt into.</li>
        <li><strong>Market-data providers</strong> (such as Yahoo Finance or EODHD) — we request prices,
          dividends, and reference data for the tickers in your portfolio.</li>
      </UL>
      <P>We may also disclose information if required by law or to protect rights, safety, and the
        integrity of the Service.</P>

      <H2>Data retention</H2>
      <P>
        We keep your data while your account is active and as needed to provide the Service. Your daily
        value history is retained so your long-term performance record persists. You can delete your
        account and associated personal data by contacting us; some records may be retained where
        required by law.
      </P>

      <H2>Security</H2>
      <P>
        Data is encrypted in transit (HTTPS) and at rest by our infrastructure providers. Access to
        your data is restricted to your own account through database row-level security. No system is
        perfectly secure; we cannot guarantee absolute security, and you use the Service at your own
        risk.
      </P>

      <H2>Your choices and rights</H2>
      <P>
        Depending on where you live (for example, California under the CCPA/CPRA, or the EU/UK under the
        GDPR), you may have the right to access, correct, delete, or port your personal information, to
        opt out of certain processing, and to not be discriminated against for exercising these rights.
        We honor these rights regardless of location where practical.
      </P>
      <UL>
        <li>Most of your data is viewable and editable directly in the app.</li>
        <li>Turn off emails anytime via notification settings.</li>
        <li>To request access, correction, deletion, or a copy of your data, email{" "}
          <a href={`mailto:${CONTACT_EMAIL}`} className="text-indigo-600 underline">{CONTACT_EMAIL}</a>.
          We will respond within the time required by applicable law.</li>
      </UL>

      <H2>Children</H2>
      <P>
        {APP_NAME} is intended for adults and is not directed to children under 18. We do not knowingly
        collect personal information from anyone under 13; if you believe a child has provided us
        information, contact us and we will delete it.
      </P>

      <H2>International users</H2>
      <P>
        The Service is operated from the United States and data is processed there. If you access it
        from elsewhere, you consent to that transfer and processing.
      </P>

      <H2>Changes</H2>
      <P>
        We may update this Policy; we will change the &ldquo;last updated&rdquo; date and, for material
        changes, provide additional notice where appropriate.
      </P>

      <H2>Contact</H2>
      <P>
        Privacy questions or requests:{" "}
        <a href={`mailto:${CONTACT_EMAIL}`} className="text-indigo-600 underline">{CONTACT_EMAIL}</a>
      </P>
    </LegalShell>
  );
}
