import type { Metadata } from "next";
import Link from "next/link";
import LegalShell, { H2, P, UL } from "@/components/LegalShell";
import { APP_NAME, COMPANY, CONTACT_EMAIL, GOVERNING_LAW, MIN_AGE } from "@/lib/legal";

export const metadata: Metadata = { title: `Terms of Service — ${APP_NAME}` };

export default function TermsPage() {
  return (
    <LegalShell title="Terms of Service">
      <P>
        These Terms of Service (&ldquo;Terms&rdquo;) govern your use of {APP_NAME} (the
        &ldquo;Service&rdquo;), operated by {COMPANY} (&ldquo;we,&rdquo; &ldquo;us&rdquo;). By creating
        an account or using the Service, you agree to these Terms. If you do not agree, do not use the
        Service.
      </P>

      <H2>1. Eligibility</H2>
      <P>
        You must be at least {MIN_AGE} years old and able to form a binding contract to use the
        Service. The Service is not directed to children, and we do not knowingly collect information
        from anyone under 13.
      </P>

      <H2>2. What the Service is</H2>
      <P>
        {APP_NAME} is an informational tool for tracking and viewing your own investment holdings,
        dividends, and option activity. It is <strong>not</strong> investment, tax, or financial
        advice, and we are not a registered investment adviser or broker-dealer. See our{" "}
        <Link href="/legal/disclaimer" className="text-indigo-600 underline">Disclaimer</Link>, which is
        part of these Terms.
      </P>

      <H2>3. Your account</H2>
      <UL>
        <li>You are responsible for keeping your login credentials secure and for all activity under
          your account.</li>
        <li>Provide accurate information and keep it current.</li>
        <li>Notify us promptly of any unauthorized use at{" "}
          <a href={`mailto:${CONTACT_EMAIL}`} className="text-indigo-600 underline">{CONTACT_EMAIL}</a>.</li>
      </UL>

      <H2>4. Acceptable use</H2>
      <P>You agree not to:</P>
      <UL>
        <li>Access data or accounts that are not yours, or attempt to circumvent security or access
          controls.</li>
        <li>Disrupt, overload, scrape, or reverse-engineer the Service.</li>
        <li>Use the Service to violate any law or third party&rsquo;s rights.</li>
        <li>Upload malicious code or misuse any import, connection, or notification feature.</li>
      </UL>

      <H2>5. Third-party data and connections</H2>
      <P>
        The Service displays market data and may import account data from third parties (for example,
        market-data providers and brokerage-connection services). We do not control and are not
        responsible for the accuracy, availability, or practices of those third parties. Brokerage
        connections, where available, are <strong>read-only</strong>; the Service cannot place trades.
        Your use of a third-party connection is also governed by that third party&rsquo;s terms.
      </P>

      <H2>6. Intellectual property</H2>
      <P>
        The Service, including its software, design, and content (excluding your own data), is owned by
        {" "}{COMPANY} and protected by law. We grant you a limited, revocable, non-transferable license
        to use the Service for your personal, non-commercial use. You retain ownership of the data you
        enter or import.
      </P>

      <H2>7. Disclaimer of warranties</H2>
      <P>
        THE SERVICE IS PROVIDED &ldquo;AS IS&rdquo; AND &ldquo;AS AVAILABLE,&rdquo; WITHOUT WARRANTIES OF
        ANY KIND, EXPRESS OR IMPLIED, INCLUDING MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE,
        NON-INFRINGEMENT, AND ANY WARRANTY REGARDING ACCURACY, TIMELINESS, OR RELIABILITY OF DATA. We do
        not warrant that the Service will be uninterrupted, error-free, or secure.
      </P>

      <H2>8. Limitation of liability</H2>
      <P>
        TO THE MAXIMUM EXTENT PERMITTED BY LAW, {COMPANY.toUpperCase()} AND ITS OPERATORS WILL NOT BE
        LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR EXEMPLARY DAMAGES, OR FOR ANY
        INVESTMENT OR TRADING LOSSES, LOST PROFITS, OR LOSS OF DATA, ARISING FROM OR RELATED TO YOUR USE
        OF (OR INABILITY TO USE) THE SERVICE. OUR TOTAL LIABILITY FOR ANY CLAIM WILL NOT EXCEED THE
        GREATER OF (A) THE AMOUNT YOU PAID US IN THE 12 MONTHS BEFORE THE CLAIM, OR (B) US$100.
      </P>

      <H2>9. Indemnification</H2>
      <P>
        You agree to indemnify and hold harmless {COMPANY} from claims arising out of your use of the
        Service or your violation of these Terms.
      </P>

      <H2>10. Termination</H2>
      <P>
        You may stop using the Service and delete your account at any time. We may suspend or terminate
        access if you violate these Terms or to protect the Service. Provisions that by their nature
        should survive (disclaimers, liability limits, indemnity) survive termination.
      </P>

      <H2>11. Changes to the Service and these Terms</H2>
      <P>
        We may modify the Service or these Terms. If we make material changes, we will update the
        &ldquo;last updated&rdquo; date and, where appropriate, notify you. Continued use after changes
        take effect means you accept the updated Terms.
      </P>

      <H2>12. Governing law and disputes</H2>
      <P>
        These Terms are governed by the laws of {GOVERNING_LAW}, without regard to conflict-of-laws
        rules. The courts located in {GOVERNING_LAW} will have exclusive jurisdiction, unless applicable
        law requires otherwise.
      </P>

      <H2>13. Contact</H2>
      <P>
        <a href={`mailto:${CONTACT_EMAIL}`} className="text-indigo-600 underline">{CONTACT_EMAIL}</a>
      </P>
    </LegalShell>
  );
}
