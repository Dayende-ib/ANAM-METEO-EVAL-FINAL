import { useState } from "react";
import { Layout } from "../components/Layout";
import { MonthlyMetricsContent } from "../components/MonthlyMetricsContent";
import { JsonMetricsContent } from "../components/JsonMetricsContent";

const viewOptions = [
  { value: "base", label: "Base de données" },
  { value: "manual", label: "Import manuel" },
] as const;

type ViewOption = (typeof viewOptions)[number]["value"];

export function UnifiedMetricsPage() {
  const [activeView, setActiveView] = useState<ViewOption>("base");

  return (
    <Layout title="Métriques unifiées">
      <div className="space-y-6">
        <div className="surface-panel p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-ink">Métriques unifiées</h2>
              <p className="text-sm text-muted">
                Vue base: métriques calculées depuis la base. Vue manuelle: import
                et calcul.
              </p>
            </div>
            <div className="inline-flex rounded-full border border-[var(--border)] bg-[var(--canvas-strong)] p-1">
              {viewOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setActiveView(option.value)}
                  className={`rounded-full px-4 py-2 text-xs font-semibold transition ${
                    activeView === option.value
                      ? "bg-primary-600 text-white shadow"
                      : "text-ink hover:bg-[var(--surface)]"
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {activeView === "base" && <MonthlyMetricsContent />}

        {activeView === "manual" && (
          <div className="surface-panel p-6">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-ink">Import manuel JSON/CSV</h3>
              <span className="text-xs text-muted">Visualisation et calcul</span>
            </div>
            <JsonMetricsContent showInsertButton />
          </div>
        )}
      </div>
    </Layout>
  );
}
