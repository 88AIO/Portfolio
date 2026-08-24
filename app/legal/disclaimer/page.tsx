import type { Metadata } from "next";
import LegalShell, { H2, P, UL } from "@/components/LegalShell";
import { APP_NAME, CONTACT_EMAIL } from "@/lib/legal";

export const metadata: Metadata = { title: `Disclaimer — ${APP_NAME}` };

export default function DisclaimerPage() {
  return (
    <LegalShell title="Disclaimer">
      <P>
        {APP_NAME} is a personal portfolio-tracking tool. It helps you organize and view your own
        holdings, dividends, and option activity. It is provided for <strong>informational and
        educational purposes only</strong>.
      </P>

      <H2>Not financial advice</H2>
      <P>
        Nothing in {APP_NAME} — no number, chart, score, alert, benchmark, forecast, or other output —
        is investment, tax, accounting, legal, or financial advice, or a recommendation to buy, sell,
        or hold any security or to pursue any strategy. {APP_NAME} does not know your full financial
        situation, goals, or risk tolerance, and does not tailor anything to them.
      </P>
      <P>
        {APP_NAME} is <strong>not</strong> a registered investment adviser, broker-dealer, or
        financial planner, and is not registered with or endorsed by any securities regulator. We do
        not manage money, place trades, or provide brokerage services. You are solely responsible for
        your own investment decisions. Consult a licensed professional (financial adviser, CPA, or
        attorney) before acting.
      </P>

      <H2>Data may be delayed, incomplete, or wrong</H2>
      <UL>
        <li>Prices and quotes are supplied by third-party providers and may be <strong>delayed</strong>,
          inaccurate, or unavailable. We show a &ldquo;prices as of&rdquo; time where we can, but do not
          guarantee freshness or accuracy.</li>
        <li>Holdings imported from brokerages or files may be incomplete or misclassified. Some brokers
          provide only limited history, so reconstructed performance can differ from your true history.</li>
        <li>Distribution figures for high-yield and options-income funds may include <strong>return of
          capital</strong> rather than true income. Treat yield and income numbers as estimates.</li>
        <li>Currency conversions use approximate exchange rates and are estimates.</li>
        <li>Options and margin involve substantial risk and are not suitable for every investor.</li>
      </UL>
      <P>
        Always verify against your brokerage&rsquo;s own statements, which are the authoritative record
        of your accounts. Where {APP_NAME} and your broker disagree, your broker is correct.
      </P>

      <H2>No guarantee of results</H2>
      <P>
        Past performance is not indicative of future results. Any benchmark comparison (for example,
        against the S&amp;P 500) is a simplified illustration, not a promise. {APP_NAME} makes no
        guarantee that using it will improve your investment outcomes.
      </P>

      <H2>Questions</H2>
      <P>
        Questions about this disclaimer? Contact us at{" "}
        <a href={`mailto:${CONTACT_EMAIL}`} className="text-indigo-600 underline">{CONTACT_EMAIL}</a>.
      </P>
    </LegalShell>
  );
}
