/*
 * Author: madhusudhan
 * Check the LICENSE in the GitHub repo (https://github.com/Lumorix-studios/Struct) for more information on permissions to use this code.
 */
import { Component, createContext, useContext, useState, type ErrorInfo, type ReactNode } from "react";
import ErrorTab from "../components/ErrorTab";

interface ErrorContextValue {
  /** Report an error anywhere — opens the global error tab with the message. */
  reportError: (error: unknown) => void;
}

const ErrorContext = createContext<ErrorContextValue>({ reportError: () => {} });

/** Hook for any component to open the error tab: `const { reportError } = useErrorHandler();` */
export function useErrorHandler(): ErrorContextValue {
  return useContext(ErrorContext);
}

/**
 * Global error provider.
 *
 * - `reportError(message)` — call from any `catch` block: opens the error tab
 *   with the message so the user sees what went wrong.
 * - `ErrorBoundary` — wraps children, catches render errors and opens the tab too.
 */
export function ErrorProvider({ children }: { children: ReactNode }) {
  const [errorTabOpen, setErrorTabOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | undefined>(undefined);

  const reportError = (message: unknown) => {
    console.error(message);
    const text =
      message instanceof Error
        ? message.message
        : typeof message === "string"
          ? message
          : undefined;
    setErrorMessage(text);
    setErrorTabOpen(true);
  };

  return (
    <ErrorContext.Provider value={{ reportError }}>
      <ErrorBoundary reportError={reportError}>
        {children}
      </ErrorBoundary>
      {/* The global error tab that opens on ANY error in the app */}
      <ErrorTab
        isOpen={errorTabOpen}
        onClose={() => setErrorTabOpen(false)}
        message={errorMessage}
      />
    </ErrorContext.Provider>
  );
}

interface ErrorBoundaryProps {
  children: ReactNode;
  reportError: (message: unknown) => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

/**
 * Catches uncaught render/lifecycle errors and funnels them into the
 * global error tab so the user always sees the empty tab on a "big bug".
 */
class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Preserve the bundle location and React component path. Minified desktop
    // builds otherwise reduce TDZ failures to messages like "Cannot access
    // 'G' before initialization", which cannot identify the offending module.
    const details = [error.stack || error.message, info.componentStack]
      .filter(Boolean)
      .join("\n\nComponent stack:");
    this.props.reportError(details);
  }

  render() {
    if (this.state.hasError) {
      // Keep rendering a minimal shell so the app doesn't white-screen.
      return null;
    }
    return this.props.children;
  }
}
