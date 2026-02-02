import { Layout } from "../components/Layout";
import { Link } from "react-router-dom";

export function NotFoundPage() {
 return (
  <Layout title="Page introuvable">
   <div className="flex flex-col items-center justify-center text-center py-20 gap-6">
    <div className="rounded-full bg-amber-100 text-amber-700 px-4 py-1 text-xs font-semibold uppercase tracking-[0.3em]">
     404
    </div>
    <h1 className="text-4xl font-black text-ink">Cette page n'existe pas</h1>
    <p className="text-sm text-muted max-w-md">
     La ressource demandee est introuvable ou a ete deplacee.
    </p>
    <div className="flex flex-wrap gap-3 justify-center">
     <Link
      to="/dashboard"
      className="rounded-full bg-emerald-600 px-5 py-2 text-sm font-semibold text-white hover:bg-emerald-700 transition-colors"
     >
      Retour au tableau de bord
     </Link>
     <Link
      to="/exploration-bulletins"
      className="rounded-full border border-[var(--border)] px-5 py-2 text-sm font-semibold text-ink hover:bg-[var(--canvas-strong)] transition-colors"
     >
      Explorer les bulletins
     </Link>
    </div>
   </div>
  </Layout>
 );
}
