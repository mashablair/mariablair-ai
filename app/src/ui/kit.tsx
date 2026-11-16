// Small shared UI kit so every screen has the same look as the marketing page.
import { useEffect, useRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import { Link, type LinkProps } from 'react-router'

const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(' ')

const BTN_BASE =
  'inline-flex items-center justify-center gap-2 min-h-11 px-5 text-[13px] tracking-[0.14em] uppercase font-medium border transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer no-underline'
const BTN_VARIANTS = {
  primary: 'bg-btn text-btn-ink border-btn hover:bg-transparent hover:text-ink',
  outline: 'bg-transparent text-ink border-ink/40 hover:border-ink',
  quiet: 'bg-transparent text-muted border-transparent hover:text-ink px-2',
  danger: 'bg-transparent text-danger border-danger/50 hover:border-danger',
}
type Variant = keyof typeof BTN_VARIANTS

export function Button({ variant = 'primary', className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return <button type="button" {...props} className={cx(BTN_BASE, BTN_VARIANTS[variant], className)} />
}
export function LinkButton({ variant = 'primary', className, ...props }: LinkProps & { variant?: Variant }) {
  return <Link {...props} className={cx(BTN_BASE, BTN_VARIANTS[variant], className)} />
}

const FIELD = 'w-full min-h-11 bg-bg text-ink border border-line px-3 py-2 placeholder:text-muted/60 focus:border-brass focus:outline-none'

export function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string | null; children: ReactNode }) {
  return (
    <label className="block">
      <span className="block text-sm font-medium text-ink mb-1">{label}</span>
      {children}
      {hint && !error && <span className="block text-sm text-muted mt-1">{hint}</span>}
      {error && <span role="alert" className="block text-sm text-danger mt-1">{error}</span>}
    </label>
  )
}
export const Input = ({ className, ...p }: InputHTMLAttributes<HTMLInputElement>) => <input {...p} className={cx(FIELD, className)} />
export const Textarea = ({ className, ...p }: TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea rows={3} {...p} className={cx(FIELD, className)} />
export const Select = ({ className, ...p }: SelectHTMLAttributes<HTMLSelectElement>) => <select {...p} className={cx(FIELD, className)} />

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cx('border border-line bg-bg p-5', className)}>{children}</section>
}

export function PageHeader({ label, title, actions }: { label?: string; title: string; actions?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-3 mb-6">
      <div>
        {label && <p className="label-caps mb-1">{label}</p>}
        <h1 className="text-4xl md:text-[44px] leading-none">{title}</h1>
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  )
}

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'brass' | 'ok' | 'danger' }) {
  const tones = { neutral: 'border-line text-muted', brass: 'border-brass/50 text-brass', ok: 'border-ok/50 text-ok', danger: 'border-danger/50 text-danger' }
  return <span className={cx('inline-block border px-2 py-0.5 text-xs tracking-wide uppercase whitespace-nowrap', tones[tone])}>{children}</span>
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="text-muted border border-dashed border-line p-6 text-center">{children}</p>
}

export function Notice({ tone = 'neutral', children }: { tone?: 'neutral' | 'danger' | 'ok'; children: ReactNode }) {
  const tones = { neutral: 'border-line bg-sand', danger: 'border-danger/50 text-danger', ok: 'border-ok/50 text-ok' }
  return <div role={tone === 'danger' ? 'alert' : 'status'} className={cx('border p-3 text-[15px]', tones[tone])}>{children}</div>
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return <p className="text-muted p-6" role="status">{label}…</p>
}

export function Modal({ title, open, onClose, children }: { title: string; open: boolean; onClose(): void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className="m-auto w-[min(640px,calc(100vw-24px))] max-h-[calc(100dvh-24px)] bg-bg text-ink border border-line p-0 backdrop:bg-deep/60"
    >
      {open && (
        <div className="p-5">
          <div className="flex items-start justify-between gap-4 mb-4">
            <h2 className="text-3xl leading-tight">{title}</h2>
            <button type="button" onClick={onClose} aria-label="Close" className="text-2xl leading-none text-muted hover:text-ink min-h-11 min-w-11 cursor-pointer">×</button>
          </div>
          {children}
        </div>
      )}
    </dialog>
  )
}

export function Brand({ to = '/' }: { to?: string }) {
  return (
    <a href={to} className="grid leading-tight no-underline text-ink">
      <b className="font-display text-2xl font-semibold">Maria Blair</b>
      <span className="label-caps !text-[10px]">AI Consulting</span>
    </a>
  )
}

export { cx }
