import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import { logCrashTelemetry } from '../lib/crashTelemetry'

type AppCrashBoundaryProps = {
  areaLabel: string
  children: ReactNode
}

type AppCrashBoundaryState = {
  hasError: boolean
  message: string
}

class AppCrashBoundary extends Component<AppCrashBoundaryProps, AppCrashBoundaryState> {
  state: AppCrashBoundaryState = {
    hasError: false,
    message: '',
  }

  static getDerivedStateFromError(error: Error) {
    return {
      hasError: true,
      message: error.message || 'Unexpected runtime failure.',
    }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    logCrashTelemetry({
      route: typeof window === 'undefined' ? this.props.areaLabel : window.location.pathname,
      error,
      extra: {
        areaLabel: this.props.areaLabel,
        componentStack: info.componentStack,
      },
    })

    console.error(`AppCrashBoundary (${this.props.areaLabel}) captured an error`, {
      message: error.message,
      stack: error.stack,
      componentStack: info.componentStack,
    })
  }

  render() {
    if (!this.state.hasError) {
      return this.props.children
    }

    return (
      <section className="app-shell" aria-label={`${this.props.areaLabel} recovery`}>
        <section className="queue-panel" role="status" aria-live="polite">
          <p className="eyebrow">Recovery mode</p>
          <h1>{this.props.areaLabel} hit an unexpected error</h1>
          <p className="subcopy">
            {this.state.message || 'Something went wrong. You can retry this screen without restarting the whole app.'}
          </p>
          <div className="hero-actions no-margin-bottom">
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                this.setState({ hasError: false, message: '' })
              }}
            >
              Retry screen
            </button>
            <button
              type="button"
              className="primary-button"
              onClick={() => {
                window.location.reload()
              }}
            >
              Reload app
            </button>
          </div>
        </section>
      </section>
    )
  }
}

export default AppCrashBoundary
