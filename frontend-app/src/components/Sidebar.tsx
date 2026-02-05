import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { NAV_ITEMS, type NavItem } from "../navigation";
import logoANAM from "../assets/logoANAMoriginal.png";

type SidebarProps = {
  navItems?: NavItem[];
  isMobileOpen?: boolean;
  isDesktopOpen?: boolean;
  onClose?: () => void;
  onDesktopToggle?: () => void;
};

export function Sidebar({
  navItems = NAV_ITEMS,
  isMobileOpen = false,
  isDesktopOpen = true,
  onClose,
  onDesktopToggle,
}: SidebarProps) {
  const location = useLocation();
  const navigate = useNavigate();

  const navigationContent = (
    <>
      <div className="flex items-center justify-center p-6 border-b border-[var(--border)]">
        <img src={logoANAM} alt="ANAM Logo" className="h-16 object-contain" />
      </div>
      <nav className="flex flex-col gap-1 p-4 flex-grow overflow-y-auto">
        {/* Back to home button */}
        <button
          onClick={() => navigate("/")}
          className="flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 hover:bg-[var(--canvas-strong)] text-muted mb-2"
        >
          <span className="material-symbols-outlined">home</span>
          <p className="text-sm font-medium leading-normal">Retour a l'accueil</p>
        </button>
        {navItems.map((item) => {
          const isActive = location.pathname === item.to;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={onClose}
              className={({ isActive: isNavActive }) =>
                `flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 ${
                  isNavActive || isActive
                    ? "bg-gradient-to-r from-primary-500 to-primary-600 text-white shadow-md shadow-primary-500/25"
                    : "hover:bg-[var(--canvas-strong)] text-muted"
                }`
              }
            >
              <span className={`material-symbols-outlined ${isActive ? "text-white" : ""}`}>{item.icon}</span>
              <p className="text-sm font-medium leading-normal">{item.label}</p>
            </NavLink>
          );
        })}
      </nav>
      <div className="p-4 border-t border-[var(--border)]">
        <div className="text-xs text-muted text-center mb-2">
          ANAM MÉTÉO ÉVAL {new Date().getFullYear()}
        </div>
        <button className="flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-[var(--canvas-strong)] text-muted w-full transition-colors">
          <span className="material-symbols-outlined">logout</span>
          <p className="text-sm font-medium leading-normal">Déconnexion</p>
        </button>
      </div>
    </>
  );

  return (
    <>
      <div
        className={`hidden lg:flex lg:fixed lg:inset-y-0 w-64 flex-shrink-0 bg-[var(--surface)] flex-col border-r border-[var(--border)] shadow-lg transition-transform duration-300 ${
          isDesktopOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)]">
          <h2 className="text-base font-semibold text-ink">Navigation</h2>
          <button
            type="button"
            className="rounded-lg border border-[var(--border)] px-2 py-1 text-sm text-muted hover:bg-[var(--canvas-strong)] transition-colors"
            onClick={onDesktopToggle}
          >
            Réduire
          </button>
        </div>
        {navigationContent}
      </div>

      <div
        className={`fixed inset-0 z-40 bg-black/30 transition-opacity lg:hidden ${
          isMobileOpen ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
        onClick={onClose}
      />
      <div
        className={`fixed inset-y-0 left-0 z-50 w-72 transform bg-[var(--surface)] shadow-2xl border-r border-[var(--border)] transition-transform lg:hidden ${
          isMobileOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)]">
          <h2 className="text-base font-semibold text-ink">Navigation</h2>
          <button
            type="button"
            className="rounded-lg border border-[var(--border)] px-2 py-1 text-sm text-muted hover:bg-[var(--canvas-strong)] transition-colors"
            onClick={onClose}
          >
            Fermer
          </button>
        </div>
        <div className="flex h-[calc(100%-56px)] flex-col">{navigationContent}</div>
      </div>
    </>
  );
}
