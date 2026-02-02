export type StatCardProps = {
  icon: string;
  label: string;
  value: string;
  delta?: string;
  deltaTone?: "positive" | "negative";
  accent?: "primary" | "secondary" | "accent" | "gold";
};

const colorMap: Record<
  NonNullable<StatCardProps["accent"]>,
  { bar: string; chip: string; icon: string; text: string }
> = {
  primary: {
    bar: "from-emerald-500 to-teal-600",
    chip: "bg-emerald-50",
    icon: "text-emerald-700",
    text: "text-emerald-700",
  },
  secondary: {
    bar: "from-blue-500 to-indigo-600",
    chip: "bg-blue-50",
    icon: "text-blue-700",
    text: "text-blue-700",
  },
  accent: {
    bar: "from-amber-500 to-orange-600",
    chip: "bg-amber-50",
    icon: "text-amber-700",
    text: "text-amber-700",
  },
  gold: {
    bar: "from-slate-600 to-slate-800",
    chip: "bg-slate-100",
    icon: "text-slate-700",
    text: "text-slate-700",
  },
};

export function StatCard({ icon, label, value, delta, deltaTone = "positive", accent = "primary" }: StatCardProps) {
  const colors = colorMap[accent];
  
  return (
    <div className="surface-panel soft relative flex min-w-[160px] flex-1 flex-col gap-4 p-5 transition-all duration-300 hover:-translate-y-1">
      <div className={`absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${colors.bar}`} />
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <p className="text-[11px] uppercase tracking-[0.32em] text-muted">{label}</p>
          <p className="mt-2 text-3xl font-semibold text-ink font-mono">{value}</p>
          {delta && <p className="mt-2 text-xs font-medium text-muted">{delta}</p>}
        </div>
        <div className={`${colors.chip} rounded-2xl p-3`}>
          <span className={`material-symbols-outlined ${colors.icon} text-2xl`}>{icon}</span>
        </div>
      </div>
      {delta && (
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em]">
          <span
            className={`material-symbols-outlined text-base ${
              deltaTone === "positive" ? "text-emerald-600" : "text-red-600"
            }`}
          >
            {deltaTone === "positive" ? "north_east" : "south_east"}
          </span>
          <span className={deltaTone === "positive" ? "text-emerald-700" : "text-red-700"}>{delta}</span>
        </div>
      )}
    </div>
  );
}

