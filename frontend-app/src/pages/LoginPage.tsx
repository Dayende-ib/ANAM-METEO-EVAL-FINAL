import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import logoANAM from "../assets/logoANAMoriginal.png";
import { fetchAuthMe, getAuthToken, loginAuth, setAuthToken } from "../services/api";

const THEME_KEY = "anam-theme";

const getStoredTheme = () => {
  const stored = window.localStorage.getItem(THEME_KEY);
  if (stored === "dark" || stored === "light") return stored;
  return null;
};

const getInitialTheme = () => {
  const stored = getStoredTheme();
  if (stored === "dark") return true;
  if (stored === "light") return false;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
};

export function LoginPage() {
  const navigate = useNavigate();
  const [isDarkMode, setIsDarkMode] = useState(getInitialTheme);
  const [isThemeLocked, setIsThemeLocked] = useState(() => getStoredTheme() !== null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", isDarkMode);
    if (isThemeLocked) {
      window.localStorage.setItem(THEME_KEY, isDarkMode ? "dark" : "light");
    }
  }, [isDarkMode, isThemeLocked]);

  useEffect(() => {
    let cancelled = false;
    const checkSession = async () => {
      const token = getAuthToken();
      if (!token) return;
      try {
        await fetchAuthMe();
        if (!cancelled) {
          navigate("/dashboard");
        }
      } catch {
        if (!cancelled) {
          setAuthToken(null);
        }
      }
    };
    checkSession();
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const response = await loginAuth(email.trim(), password);
      setAuthToken(response.access_token, rememberMe);
      navigate("/dashboard");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Connexion impossible.";
      setErrorMessage(message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[var(--canvas)] relative overflow-hidden">
      {/* ===== DOT PATTERN BACKGROUND ===== */}
      <div className="absolute inset-0 overflow-hidden">
        {/* Dot grid pattern */}
        <svg className="absolute inset-0 w-full h-full opacity-[0.4] dark:opacity-[0.15]" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <pattern id="dotPattern" x="0" y="0" width="24" height="24" patternUnits="userSpaceOnUse">
              <circle cx="2" cy="2" r="1" fill="var(--muted)" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#dotPattern)" />
        </svg>

        {/* Gradient overlays */}
        <div className="absolute top-0 left-0 w-[600px] h-[600px] bg-gradient-to-br from-primary-500/20 to-transparent rounded-full blur-3xl -translate-x-1/2 -translate-y-1/2" />
        <div className="absolute top-1/4 right-0 w-[500px] h-[500px] bg-gradient-to-bl from-secondary-400/15 to-transparent rounded-full blur-3xl translate-x-1/3" />
        <div className="absolute bottom-0 left-1/3 w-[400px] h-[400px] bg-gradient-to-t from-sky-400/10 to-transparent rounded-full blur-3xl translate-y-1/2" />

        {/* Animated weather elements */}
        <div className="absolute top-[15%] left-[10%] animate-float" style={{ animationDelay: "0s" }}>
          <div className="w-16 h-16 rounded-full bg-gradient-to-br from-amber-300/30 to-orange-400/20 blur-sm" />
          <span className="material-symbols-outlined absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-amber-400/60 text-3xl">
            wb_sunny
          </span>
        </div>
        <div className="absolute top-[25%] right-[15%] animate-float" style={{ animationDelay: "1s" }}>
          <span className="material-symbols-outlined text-slate-400/40 text-4xl">cloud</span>
        </div>
        <div className="absolute top-[60%] left-[8%] animate-float" style={{ animationDelay: "2s" }}>
          <span className="material-symbols-outlined text-blue-400/30 text-3xl">water_drop</span>
        </div>
        <div className="absolute bottom-[20%] right-[10%] animate-float" style={{ animationDelay: "1.5s" }}>
          <span className="material-symbols-outlined text-sky-400/40 text-4xl">air</span>
        </div>
        <div className="absolute top-[45%] right-[25%] animate-float" style={{ animationDelay: "0.5s" }}>
          <span className="material-symbols-outlined text-indigo-400/30 text-2xl">thunderstorm</span>
        </div>
        <div className="absolute bottom-[35%] left-[20%] animate-float" style={{ animationDelay: "2.5s" }}>
          <span className="material-symbols-outlined text-cyan-400/30 text-3xl">foggy</span>
        </div>

        {/* More scattered dots - larger ones */}
        {[...Array(20)].map((_, i) => (
          <div
            key={i}
            className="absolute rounded-full bg-primary-500/20 dark:bg-primary-400/10 animate-glow-pulse"
            style={{
              width: `${4 + Math.random() * 6}px`,
              height: `${4 + Math.random() * 6}px`,
              top: `${Math.random() * 100}%`,
              left: `${Math.random() * 100}%`,
              animationDelay: `${Math.random() * 3}s`,
            }}
          />
        ))}
      </div>

      {/* ===== HEADER ===== */}
      <header className="relative z-20 flex items-center justify-between px-6 py-4">
        <div className="flex items-center gap-4">
          {/* Back button */}
          <button
            onClick={() => navigate("/")}
            className="flex items-center justify-center size-10 rounded-full bg-[var(--surface)] border border-[var(--border)] text-ink hover:bg-[var(--canvas-strong)] transition-colors shadow-sm"
            aria-label="Retour a l'accueil"
          >
            <span className="material-symbols-outlined text-lg">arrow_back</span>
          </button>
          <button
            onClick={() => navigate("/")}
            className="flex items-center group"
          >
          <img src={logoANAM} alt="ANAM Logo" className="h-12 object-contain group-hover:scale-105 transition-transform" />
        </button>
        </div>
        <button
          type="button"
          onClick={() => {
            setIsThemeLocked(true);
            setIsDarkMode((prev) => !prev);
          }}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--surface)] border border-[var(--border)] text-ink hover:bg-[var(--canvas-strong)] transition-colors shadow-sm"
          aria-label="Basculer le theme"
        >
          <span className="material-symbols-outlined text-lg">
            {isDarkMode ? "light_mode" : "dark_mode"}
          </span>
        </button>
      </header>

      {/* ===== MAIN CONTENT ===== */}
      <main className="relative z-10 flex items-center justify-center min-h-[calc(100vh-80px)] px-4">
        <div className="w-full max-w-xl animate-rise">
          {/* Login Card */}
          <div className="relative">
            {/* Card glow effect */}
            <div className="absolute -inset-1 bg-gradient-to-r from-primary-500/20 via-secondary-500/20 to-sky-500/20 rounded-[1.75rem] blur-xl opacity-60" />

            <div className="relative bg-[var(--surface)]/80 backdrop-blur-xl border border-[var(--border)] rounded-3xl shadow-2xl shadow-primary-900/10 dark:shadow-black/30 overflow-hidden">
              {/* Decorative top bar */}
              <div className="h-1.5 bg-gradient-to-r from-primary-500 via-secondary-500 to-sky-400" />

              <div className="p-8 sm:p-10">
                {/* Header */}
                <div className="text-center mb-8">
                  <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-primary-500/10 to-secondary-500/10 border border-primary-200/30 dark:border-primary-700/30 mb-4">
                    <span className="material-symbols-outlined text-primary-500 text-3xl">lock_open</span>
                  </div>
                  <h1 className="text-2xl font-bold text-ink font-display mb-2">Bienvenue</h1>
                  <p className="text-sm text-muted">Connectez-vous a votre compte ANAM</p>
                </div>

                {/* Form */}
                <form onSubmit={handleSubmit} className="space-y-5">
                  {/* Email field */}
                  <div className="space-y-2">
                    <label htmlFor="email" className="block text-sm font-medium text-ink">
                      Adresse email
                    </label>
                    <div className="relative">
                      <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-muted text-lg">
                        mail
                      </span>
                      <input
                        id="email"
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="exemple@anam.bf"
                        className="w-full pl-12 pr-4 py-3.5 rounded-xl border border-[var(--border)] bg-[var(--canvas)]/50 text-ink placeholder:text-muted/60 focus:outline-none focus:ring-2 focus:ring-primary-500/30 focus:border-primary-500 transition-all"
                        required
                      />
                    </div>
                  </div>

                  {/* Password field */}
                  <div className="space-y-2">
                    <label htmlFor="password" className="block text-sm font-medium text-ink">
                      Mot de passe
                    </label>
                    <div className="relative">
                      <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-muted text-lg">
                        lock
                      </span>
                      <input
                        id="password"
                        type={showPassword ? "text" : "password"}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="Entrez votre mot de passe"
                        className="w-full pl-12 pr-12 py-3.5 rounded-xl border border-[var(--border)] bg-[var(--canvas)]/50 text-ink placeholder:text-muted/60 focus:outline-none focus:ring-2 focus:ring-primary-500/30 focus:border-primary-500 transition-all"
                        required
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-4 top-1/2 -translate-y-1/2 text-muted hover:text-ink transition-colors"
                      >
                        <span className="material-symbols-outlined text-lg">
                          {showPassword ? "visibility_off" : "visibility"}
                        </span>
                      </button>
                    </div>
                  </div>

                  {/* Remember me & Forgot password */}
                  <div className="flex items-center justify-between">
                    <label className="flex items-center gap-2 cursor-pointer group">
                      <div className="relative">
                        <input
                          type="checkbox"
                          checked={rememberMe}
                          onChange={(e) => setRememberMe(e.target.checked)}
                          className="sr-only peer"
                        />
                        <div className="w-5 h-5 rounded-md border-2 border-[var(--border)] bg-[var(--canvas)] peer-checked:bg-primary-500 peer-checked:border-primary-500 transition-all flex items-center justify-center">
                          {rememberMe && (
                            <span className="material-symbols-outlined text-white text-sm">check</span>
                          )}
                        </div>
                      </div>
                      <span className="text-sm text-muted group-hover:text-ink transition-colors">
                        Se souvenir de moi
                      </span>
                    </label>
                  <button
                    type="button"
                    className="text-sm text-primary-500 hover:text-primary-600 dark:hover:text-primary-400 font-medium transition-colors"
                  >
                    Mot de passe oublie ?
                  </button>
                </div>

                {errorMessage && (
                  <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                    {errorMessage}
                  </div>
                )}

                {/* Submit button */}
                <button
                  type="submit"
                  disabled={isLoading}
                    className="relative w-full py-3.5 rounded-xl bg-gradient-to-r from-primary-500 to-primary-600 text-white font-semibold shadow-lg shadow-primary-500/25 hover:shadow-primary-500/40 hover:from-primary-600 hover:to-primary-700 disabled:opacity-70 disabled:cursor-not-allowed transition-all duration-200 overflow-hidden group"
                  >
                    {isLoading ? (
                      <div className="flex items-center justify-center gap-2">
                        <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        <span>Connexion en cours...</span>
                      </div>
                    ) : (
                      <div className="flex items-center justify-center gap-2">
                        <span>Se connecter</span>
                        <span className="material-symbols-outlined text-lg group-hover:translate-x-0.5 transition-transform">
                          arrow_forward
                        </span>
                      </div>
                    )}
                    {/* Shimmer effect */}
                    <div className="absolute inset-0 -translate-x-full group-hover:translate-x-full transition-transform duration-700 bg-gradient-to-r from-transparent via-white/20 to-transparent" />
                  </button>
                </form>

                {/* Divider */}
                <div className="relative my-8">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-[var(--border)]" />
                  </div>
                  <div className="relative flex justify-center">
                    <span className="px-4 text-xs text-muted bg-[var(--surface)]/80 uppercase tracking-wider">
                      ou continuez avec
                    </span>
                  </div>
                </div>

                {/* Social login buttons */}
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    className="flex items-center justify-center gap-2 py-3 rounded-xl border border-[var(--border)] bg-[var(--canvas)]/50 text-ink hover:bg-[var(--canvas-strong)] transition-all"
                  >
                    <svg className="w-5 h-5" viewBox="0 0 24 24">
                      <path
                        fill="currentColor"
                        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                      />
                      <path
                        fill="currentColor"
                        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                      />
                      <path
                        fill="currentColor"
                        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                      />
                      <path
                        fill="currentColor"
                        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                      />
                    </svg>
                    <span className="text-sm font-medium">Google</span>
                  </button>
                  <button
                    type="button"
                    className="flex items-center justify-center gap-2 py-3 rounded-xl border border-[var(--border)] bg-[var(--canvas)]/50 text-ink hover:bg-[var(--canvas-strong)] transition-all"
                  >
                    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
                    </svg>
                    <span className="text-sm font-medium">GitHub</span>
                  </button>
                </div>

                {/* Sign up link */}
                <p className="text-center text-sm text-muted mt-8">
                  Pas encore de compte ?{" "}
                  <button
                    type="button"
                    className="text-primary-500 hover:text-primary-600 dark:hover:text-primary-400 font-semibold transition-colors"
                  >
                    Creer un compte
                  </button>
                </p>
              </div>
            </div>
          </div>

          {/* Footer text */}
          <p className="text-center text-xs text-muted mt-6">
            En vous connectant, vous acceptez nos{" "}
            <button className="text-primary-500 hover:underline">Conditions d'utilisation</button>
            {" "}et notre{" "}
            <button className="text-primary-500 hover:underline">Politique de confidentialite</button>
          </p>
        </div>
      </main>
    </div>
  );
}
