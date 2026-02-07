type StatusPanelProps = {
  message: string;
  containerClassName?: string;
  textClassName?: string;
  onRetry?: () => void;
};

export function LoadingPanel({
  message,
  containerClassName,
  textClassName,
}: StatusPanelProps) {
  return (
    <div
      className={
        containerClassName ??
        "surface-panel soft flex h-44 items-center justify-center"
      }
    >
      <div className="flex items-center gap-3 text-sm text-muted">
        <div className="h-9 w-9 animate-spin rounded-full border-2 border-transparent border-t-primary border-r-primary pulse-soft" />
        <span className={textClassName}>{message}</span>
      </div>
    </div>
  );
}

export function ErrorPanel({
  message,
  containerClassName,
  textClassName,
  onRetry,
}: StatusPanelProps) {
  return (
    <div
      className={
        containerClassName ??
        "surface-panel flex flex-col sm:flex-row items-center gap-3 border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
      }
    >
      <div className="flex items-center gap-3">
        <span className="material-symbols-outlined text-base text-red-600">error</span>
        <span className={textClassName}>{message}</span>
      </div>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-2 sm:mt-0 px-3 py-1 bg-red-100 hover:bg-red-200 text-red-700 rounded text-sm transition-colors"
        >
          Réessayer
        </button>
      )}
    </div>
  );
}
