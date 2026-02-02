type StatusState = {
  activeRequests: number;
  lastError: string | null;
  pipelineRunning: boolean;
  scrapeRunning: boolean;
};

type Listener = () => void;

let state: StatusState = {
  activeRequests: 0,
  lastError: null,
  pipelineRunning: false,
  scrapeRunning: false,
};

const listeners = new Set<Listener>();

const emit = () => {
  listeners.forEach((listener) => listener());
};

const setState = (next: Partial<StatusState>) => {
  state = { ...state, ...next };
  emit();
};

export const statusStore = {
  getState: () => state,
  subscribe: (listener: Listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

export const startRequest = () => {
  setState({ activeRequests: state.activeRequests + 1 });
};

export const finishRequest = () => {
  setState({ activeRequests: Math.max(0, state.activeRequests - 1) });
};

export const reportError = (message: string) => {
  if (!message) return;
  setState({ lastError: message });
};

export const clearError = () => {
  setState({ lastError: null });
};

export const setPipelineRunning = (value: boolean) => {
  setState({ pipelineRunning: value });
};

export const setScrapeRunning = (value: boolean) => {
  setState({ scrapeRunning: value });
};

export const clearTransientStatus = () => {
  setState({ lastError: null, pipelineRunning: false, scrapeRunning: false });
};
