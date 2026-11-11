import { Component, type ErrorInfo, type ReactNode } from 'react'

type Props = { children: ReactNode }
type State = { failed: boolean }

/**
 * Last line of defence for rendering errors. Without it React unmounts the whole
 * tree and the user is left with a blank page and no way forward.
 */
export class AppErrorBoundary extends Component<Props, State> {
  state: State = { failed: false }

  static getDerivedStateFromError(): State {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[app] Render failed:', error.message, info.componentStack)
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <main role="alert" className="grid min-h-screen place-items-center bg-canvas px-6 text-center">
        <div className="max-w-sm">
          <h1 className="font-display text-xl font-bold text-ink">Đã có lỗi xảy ra</h1>
          <p className="mt-2 text-sm leading-6 text-ink/60">Trang không hiển thị được. Dữ liệu của bạn vẫn an toàn; hãy tải lại để tiếp tục.</p>
          <button type="button" onClick={() => window.location.reload()} className="mt-5 rounded-full bg-ink px-5 py-2.5 text-sm font-bold text-white">
            Tải lại trang
          </button>
        </div>
      </main>
    )
  }
}
