import { Component, type ErrorInfo, type ReactNode } from 'react';

/**
 * A map or chart failure should not blank the whole page. React error
 * boundaries catch render/effect failures; a fallback keeps the rest of the
 * evidence visible.
 */
export class ErrorBoundary extends Component<
  { children: ReactNode; fallback: ReactNode; label?: string },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[${this.props.label ?? 'ui'}]`, error, info.componentStack);
  }

  render() {
    if (this.state.failed) return this.props.fallback;
    return this.props.children;
  }
}
