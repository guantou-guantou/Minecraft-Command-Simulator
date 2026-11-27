import { Component, type ErrorInfo, type ReactNode } from 'react';

/** Shows what went wrong instead of an empty window when something in the interface throws while drawing. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div style={{ padding: 24, color: '#ddd', fontFamily: 'sans-serif' }}>
        <h3>Something went wrong / 出错了</h3>
        <pre style={{ whiteSpace: 'pre-wrap' }}>{error.stack ?? error.message}</pre>
        <button onClick={() => location.reload()}>Reload / 重新加载</button>
      </div>
    );
  }
}