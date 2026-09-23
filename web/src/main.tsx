import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

/**
 * Preview safety net — scaffold-owned. Do not edit or remove.
 *
 * React unmounts the ENTIRE tree when a render throws, so without this a single
 * bad read (commonly a property off a record that a dynamic route param didn't
 * match) leaves a blank white page: no error text, no UI, nothing to report.
 * This keeps the failure legible instead of silent.
 */
type PreviewErrorState = { error: Error | null }

class PreviewErrorBoundary extends Component<{ children: ReactNode }, PreviewErrorState> {
  state: PreviewErrorState = { error: null }

  static getDerivedStateFromError(error: Error): PreviewErrorState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[preview] render error:', error, info.componentStack)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <div
        role="alert"
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px',
          background: '#fafafa',
          color: '#18181b',
          fontFamily: 'ui-sans-serif, system-ui, sans-serif',
        }}
      >
        <div style={{ maxWidth: '560px', width: '100%' }}>
          <p
            style={{
              margin: '0 0 8px',
              fontSize: '12px',
              fontWeight: 600,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              color: '#a1a1aa',
            }}
          >
            Runtime error
          </p>
          <h1 style={{ margin: '0 0 12px', fontSize: '20px', fontWeight: 600 }}>
            This page failed to render
          </h1>
          <pre
            style={{
              margin: '0 0 20px',
              padding: '12px 14px',
              borderRadius: '8px',
              border: '1px solid #e4e4e7',
              background: '#f4f4f5',
              fontFamily: 'ui-monospace, SFMono-Regular, monospace',
              fontSize: '13px',
              lineHeight: 1.5,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            {String(error.message || error)}
          </pre>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              padding: '8px 16px',
              borderRadius: '6px',
              border: '1px solid #d4d4d8',
              background: '#ffffff',
              fontSize: '14px',
              cursor: 'pointer',
            }}
          >
            Reload preview
          </button>
        </div>
      </div>
    )
  }
}

createRoot(document.getElementById('root')!).render(
  <PreviewErrorBoundary>
    <App />
  </PreviewErrorBoundary>
)
