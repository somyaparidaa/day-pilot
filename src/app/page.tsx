export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8">
      <div className="max-w-xl text-center space-y-4">
        <h1 className="text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl">
          DayPilot
        </h1>
        <p className="text-lg text-slate-600">
          Proactive day planning &amp; execution system. Baseline setup ready.
        </p>
        <div className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-sm font-medium text-emerald-700 ring-1 ring-inset ring-emerald-600/20">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-600 animate-pulse" />
          Baseline Operational
        </div>
      </div>
    </main>
  );
}

