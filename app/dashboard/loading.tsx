// Shown instantly on any dashboard navigation while the server renders — so moving between pages
// feels immediate instead of freezing on the old screen. A calm shimmer, not a spinner.
export default function DashboardLoading() {
  return (
    <div className="min-h-screen animate-pulse bg-slate-50 px-6 py-8">
      <div className="mx-auto max-w-6xl">
        <div className="h-7 w-40 rounded bg-slate-200" />
        <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="h-3 w-16 rounded bg-slate-200" />
              <div className="mt-3 h-6 w-24 rounded bg-slate-200" />
            </div>
          ))}
        </div>
        <div className="mt-8 rounded-2xl border border-slate-200 bg-white p-5">
          <div className="h-4 w-32 rounded bg-slate-200" />
          <div className="mt-4 space-y-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4">
                <div className="h-4 w-24 rounded bg-slate-200" />
                <div className="ml-auto h-4 w-16 rounded bg-slate-200" />
                <div className="h-4 w-16 rounded bg-slate-200" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
