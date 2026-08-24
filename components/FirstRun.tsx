import AddHoldingForm from "@/components/AddHoldingForm";
import ImportTransactionsForm from "@/components/ImportTransactionsForm";

// First-run welcome: shown until the account has its first holding. Calm, three clear ways in,
// with the real Add / Import forms right beside the guidance so there's nowhere to get stuck.
export default function FirstRun({ canBrokerSync }: { canBrokerSync: boolean }) {
  return (
    <div className="mt-2 grid gap-6 lg:grid-cols-3">
      <section className="lg:col-span-2 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-soft">
        <div className="border-b border-slate-100 bg-gradient-to-br from-[#edf3ee] to-white px-8 py-7">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-[#205d4a]/20 bg-white/70 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.12em] text-[#205d4a]">
            Welcome to Snowfolio
          </span>
          <h2 className="font-display mt-4 text-2xl font-medium tracking-tight text-slate-900">
            Let&apos;s build your portfolio.
          </h2>
          <p className="mt-2 max-w-md text-sm leading-relaxed text-slate-500">
            Add what you own and Snowfolio fills in the prices, dividends, and income for you. Pick
            whichever way is easiest, you can always add more later.
          </p>
        </div>
        <div className="divide-y divide-slate-100">
          <Step
            n={1}
            title="Add a holding by hand"
            body="Type a ticker like AAPL and how many shares. We fetch the live price, dividend history, and sector for you."
            href="#add-holding"
            cta="Add a holding"
            primary
          />
          <Step
            n={2}
            title="Import a spreadsheet"
            body="Have a broker export or a CSV? Bring it straight in. Imports are de-duplicated, so re-importing the same file is always safe."
            href="#import"
            cta="Import a CSV"
          />
          {canBrokerSync && (
            <Step
              n={3}
              title="Connect a brokerage"
              body="Sync your balances and positions automatically, no typing required."
              href="/dashboard/broker"
              cta="Connect a brokerage"
            />
          )}
        </div>
      </section>

      <section className="space-y-6">
        <div id="add-holding" className="scroll-mt-24 rounded-2xl border border-slate-200 bg-white p-5 shadow-soft">
          <h2 className="mb-3 text-base font-semibold">Add holding</h2>
          <AddHoldingForm />
          <p className="mt-3 text-xs text-slate-400">Symbol + exchange, e.g. AAPL / US, 0700 / HK.</p>
        </div>
        <div id="import" className="scroll-mt-24 rounded-2xl border border-slate-200 bg-white p-5 shadow-soft">
          <h2 className="mb-3 text-base font-semibold">Import CSV</h2>
          <ImportTransactionsForm />
        </div>
      </section>
    </div>
  );
}

function Step({
  n,
  title,
  body,
  href,
  cta,
  primary,
}: {
  n: number;
  title: string;
  body: string;
  href: string;
  cta: string;
  primary?: boolean;
}) {
  return (
    <div className="flex items-start gap-4 px-8 py-5">
      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#edf3ee] font-display text-sm font-medium text-[#205d4a]">
        {n}
      </div>
      <div className="min-w-0 flex-1">
        <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
        <p className="mt-0.5 text-sm leading-relaxed text-slate-500">{body}</p>
      </div>
      <a
        href={href}
        className={`mt-0.5 shrink-0 rounded-full px-3.5 py-1.5 text-sm font-medium transition ${
          primary
            ? "bg-slate-900 text-[#f7f4ec] hover:bg-slate-800"
            : "border border-slate-300 text-slate-700 hover:bg-slate-50"
        }`}
      >
        {cta}
      </a>
    </div>
  );
}
