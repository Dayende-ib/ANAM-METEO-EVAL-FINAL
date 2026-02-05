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
    bar: "from-primary-500 to-primary-700",
    chip: "bg-primary-50 dark:bg-primary-900/30",
    icon: "text-primary-600 dark:text-primary-400",
    text: "text-primary-600 dark:text-primary-400",
  },
  secondary: {
    bar: "from-secondary-400 to-secondary-700",
    chip: "bg-secondary-50 dark:bg-secondary-700/20",
    icon: "text-secondary-600 dark:text-secondary-400",
    text: "text-secondary-600 dark:text-secondary-400",
  },
  accent: {
    bar: "from-accent-400 to-accent-600",
    chip: "bg-accent-50 dark:bg-accent-600/15",
    icon: "text-accent-600 dark:text-accent-400",
    text: "text-accent-600 dark:text-accent-400",
  },
  gold: {
    bar: "from-sky-400 to-indigo-600",
    chip: "bg-sky-50 dark:bg-sky-900/20",
    icon: "text-sky-600 dark:text-sky-400",
    text: "text-sky-600 dark:text-sky-400",
  },
};

export function StatCard({ icon, label, value, delta, deltaTone = "positive", accent = "primary" }: StatCardProps) {
  const colors = colorMap[accent];

  return (
    <div className="surface-panel soft relative flex min-w-[160px] flex-1 flex-col gap-4 p-5 transition-all duration-300 hover:-translate-y-1 hover:shadow-xl">
      <div className={`absolute inset-x-0 top-0 h-1 rounded-t-[1.25rem] bg-gradient-to-r ${colors.bar}`} />
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
              deltaTone === "positive" ? "text-primary-600 dark:text-primary-400" : "text-red-600"
            }`}
          >
            {deltaTone === "positive" ? "north_east" : "south_east"}
          </span>
          <span className={deltaTone === "positive" ? "text-ink" : "text-red-700"}>{delta}</span>
        </div>
      )}
    </div>
  );
}
