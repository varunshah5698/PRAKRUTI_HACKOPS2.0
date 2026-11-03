import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { classNames } from '../lib/format';

export function Button({
  className,
  variant = 'default',
  size = 'md',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'default' | 'lime' | 'outline' | 'ghost' | 'dark' | 'danger' | 'subtle';
  size?: 'sm' | 'md' | 'lg' | 'icon';
}) {
  const variants: Record<string, string> = {
    default: 'bg-ink text-white hover:bg-ink/90 border border-transparent',
    lime: 'bg-lime text-ink hover:bg-[#a8ef55] border border-ink/10',
    outline: 'bg-transparent text-ink border border-ink/25 hover:border-ink hover:bg-ink/5',
    ghost: 'bg-transparent text-ink/70 hover:text-ink hover:bg-ink/5 border border-transparent',
    dark: 'bg-[#202730] text-[#f3f5f7] border border-[#303945] hover:bg-[#29323d]',
    danger: 'bg-[#dc555b] text-white hover:bg-[#c94b50] border border-transparent',
    subtle: 'bg-[#f0f1ea] text-ink hover:bg-[#e7e9df] border border-transparent',
  };
  const sizes: Record<string, string> = {
    sm: 'h-8 px-3 text-xs rounded-lg gap-1.5',
    md: 'h-10 px-4 text-sm rounded-xl gap-2',
    lg: 'h-12 px-6 text-[15px] rounded-2xl gap-2',
    icon: 'h-9 w-9 rounded-lg justify-center',
  };
  return (
    <button
      className={classNames(
        'inline-flex items-center justify-center font-semibold transition-all duration-200 disabled:pointer-events-none disabled:opacity-45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime focus-visible:ring-offset-2 focus-visible:ring-offset-transparent',
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    />
  );
}

export function Card({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={classNames('rounded-2xl border border-[#303945] bg-[#181d23]', className)} {...props}>
      {children}
    </div>
  );
}

export function CardHeader({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={classNames('flex items-start justify-between gap-3 border-b border-[#2b333e] px-4 py-3.5', className)}>{children}</div>;
}

export function CardTitle({ className, children }: { className?: string; children: React.ReactNode }) {
  return <h3 className={classNames('text-sm font-semibold tracking-tight text-[#f3f5f7]', className)}>{children}</h3>;
}

export function Badge({
  children,
  tone = 'neutral',
  className,
  dot,
}: {
  children: React.ReactNode;
  tone?: 'neutral' | 'green' | 'lime' | 'amber' | 'red' | 'teal' | 'outline' | 'dark';
  className?: string;
  dot?: boolean;
}) {
  const tones: Record<string, string> = {
    neutral: 'bg-[#252d37] text-[#b8c2cd] border-[#37414d]',
    green: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/25',
    lime: 'bg-[#b5e36b]/12 text-[#c8ef8d] border-[#b5e36b]/25',
    amber: 'bg-amber-500/10 text-amber-300 border-amber-500/25',
    red: 'bg-red-500/10 text-red-300 border-red-500/25',
    teal: 'bg-teal-500/10 text-teal-300 border-teal-500/25',
    outline: 'bg-transparent text-[#c4ced8] border-[#46515e]',
    dark: 'bg-[#101317] text-[#aeb8c3] border-[#303945]',
  };
  return (
    <span
      className={classNames(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.08em]',
        tones[tone],
        className,
      )}
    >
      {dot ? <span className="h-1.5 w-1.5 rounded-full bg-current" /> : null}
      {children}
    </span>
  );
}

export function PublicBadge({ children, tone = 'outline', className }: { children: React.ReactNode; tone?: string; className?: string }) {
  const tones: Record<string, string> = {
    lime: 'bg-lime text-ink border-ink/10',
    outline: 'bg-transparent text-ink border-ink/20',
    dark: 'bg-ink text-white border-ink',
    soft: 'bg-[#efefe7] text-ink/70 border-ink/10',
  };
  return (
    <span className={classNames('inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.08em]', tones[tone] ?? tones.outline, className)}>
      {children}
    </span>
  );
}

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={classNames(
        'h-11 w-full rounded-xl border border-[#303945] bg-[#101317] px-3.5 text-sm text-[#f3f5f7] placeholder:text-[#687482] focus:border-[#b5e36b]/60 focus:outline-none focus:ring-2 focus:ring-[#b5e36b]/15 disabled:opacity-50',
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = 'Input';

export const PublicInput = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={classNames(
        'h-12 w-full rounded-xl border border-ink/20 bg-white px-4 text-sm text-ink placeholder:text-ink/35 focus:border-ink focus:outline-none focus:ring-2 focus:ring-lime/50',
        className,
      )}
      {...props}
    />
  ),
);
PublicInput.displayName = 'PublicInput';

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, children, ...props }, ref) => (
    <select
      ref={ref}
      className={classNames(
        'h-10 w-full rounded-xl border border-[#303945] bg-[#101317] px-3 text-sm text-[#e8edf2] focus:border-[#b5e36b]/60 focus:outline-none focus:ring-2 focus:ring-[#b5e36b]/15',
        className,
      )}
      {...props}
    >
      {children}
    </select>
  ),
);
Select.displayName = 'Select';

export const PublicSelect = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, children, ...props }, ref) => (
    <select
      ref={ref}
      className={classNames(
        'h-12 w-full rounded-xl border border-ink/20 bg-white px-3 text-sm text-ink focus:border-ink focus:outline-none focus:ring-2 focus:ring-lime/50',
        className,
      )}
      {...props}
    >
      {children}
    </select>
  ),
);
PublicSelect.displayName = 'PublicSelect';

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={classNames(
        'w-full rounded-xl border border-[#303945] bg-[#101317] px-3.5 py-3 text-sm text-[#f3f5f7] placeholder:text-[#687482] focus:border-[#b5e36b]/60 focus:outline-none focus:ring-2 focus:ring-[#b5e36b]/15',
        className,
      )}
      {...props}
    />
  ),
);
Textarea.displayName = 'Textarea';

export const PublicTextarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={classNames(
        'w-full rounded-xl border border-ink/20 bg-white px-4 py-3 text-sm text-ink placeholder:text-ink/35 focus:border-ink focus:outline-none focus:ring-2 focus:ring-lime/50',
        className,
      )}
      {...props}
    />
  ),
);
PublicTextarea.displayName = 'PublicTextarea';

export function Label({ children, className, htmlFor }: { children: React.ReactNode; className?: string; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className={classNames('mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.1em] text-[#95a1ae]', className)}>
      {children}
    </label>
  );
}

export function PublicLabel({ children, className, htmlFor }: { children: React.ReactNode; className?: string; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className={classNames('mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.1em] text-ink/60', className)}>
      {children}
    </label>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      className={classNames('inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent', className)}
      aria-label="Loading"
    />
  );
}

export function LoadingBlock({ label = 'Loading data', className }: { label?: string; className?: string }) {
  return (
    <div className={classNames('flex min-h-[160px] flex-col items-center justify-center gap-3 text-[#788493]', className)}>
      <Spinner className="text-[#b5e36b]" />
      <span className="text-xs font-medium uppercase tracking-[0.12em]">{label}</span>
    </div>
  );
}

export function EmptyState({
  title,
  description,
  icon,
  action,
  className,
}: {
  title: string;
  description: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={classNames('flex flex-col items-center justify-center px-6 py-12 text-center', className)}>
      {icon ? <div className="mb-3 text-[#5e6b78]">{icon}</div> : null}
      <p className="text-sm font-semibold text-[#dbe2e9]">{title}</p>
      <p className="mt-1 max-w-sm text-xs leading-relaxed text-[#8d99a6]">{description}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function DataLabel({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={classNames('text-[10px] font-semibold uppercase tracking-[0.14em] text-[#788493]', className)}>
      {children}
    </span>
  );
}

export function StatusDot({ status, className }: { status: string; className?: string }) {
  const color =
    status === 'CONNECTED' || status === 'ONLINE' || status === 'LIVE' || status === 'COMPLETED'
      ? 'bg-emerald-400'
      : status === 'STALE' || status === 'WATCH' || status === 'DEGRADED'
        ? 'bg-amber-400'
        : status === 'FAILED' || status === 'CRITICAL' || status === 'OFFLINE'
          ? 'bg-red-400'
          : 'bg-slate-500';
  return <span className={classNames('inline-block h-1.5 w-1.5 rounded-full', color, className)} />;
}

export function Divider({ className }: { className?: string }) {
  return <div className={classNames('h-px w-full bg-[#2b333e]', className)} />;
}

export function Tabs({
  tabs,
  value,
  onChange,
  className,
}: {
  tabs: Array<{ id: string; label: string; count?: number }>;
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  return (
    <div className={classNames('flex flex-wrap gap-1 rounded-xl border border-[#303945] bg-[#101317] p-1', className)}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onChange(tab.id)}
          className={classNames(
            'rounded-lg px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] transition',
            value === tab.id ? 'bg-[#29323d] text-[#f3f5f7]' : 'text-[#8d99a6] hover:text-[#dbe2e9]',
          )}
        >
          {tab.label}
          {tab.count !== undefined ? <span className="ml-1.5 text-[#788493]">{tab.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function DialogContent({
  children,
  className,
  title,
  description,
}: {
  children: React.ReactNode;
  className?: string;
  title: string;
  description?: string;
}) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm data-[state=open]:animate-in" />
      <DialogPrimitive.Content
        className={classNames(
          'fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border border-[#303945] bg-[#181d23] p-6 shadow-2xl',
          className,
        )}
      >
        <DialogPrimitive.Title className="text-lg font-semibold text-[#f3f5f7]">{title}</DialogPrimitive.Title>
        {description ? <DialogPrimitive.Description className="mt-1 text-xs text-[#95a1ae]">{description}</DialogPrimitive.Description> : null}
        <DialogPrimitive.Close className="absolute right-4 top-4 rounded-lg p-1.5 text-[#95a1ae] hover:bg-[#29323d] hover:text-white">
          <X className="h-4 w-4" />
        </DialogPrimitive.Close>
        <div className="mt-4">{children}</div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function Sheet({
  open,
  onOpenChange,
  children,
  title,
  description,
  side = 'right',
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
  title: string;
  description?: string;
  side?: 'right' | 'left';
  className?: string;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/55 backdrop-blur-sm" />
        <DialogPrimitive.Content
          className={classNames(
            'fixed top-0 z-50 flex h-full w-full max-w-[560px] flex-col border-[#303945] bg-[#14191f] shadow-2xl outline-none',
            side === 'right' ? 'right-0 border-l' : 'left-0 border-r',
            className,
          )}
        >
          <div className="flex items-start justify-between gap-4 border-b border-[#2b333e] px-5 py-4">
            <div>
              <DialogPrimitive.Title className="text-base font-semibold text-[#f3f5f7]">{title}</DialogPrimitive.Title>
              {description ? <DialogPrimitive.Description className="mt-0.5 text-xs text-[#8d99a6]">{description}</DialogPrimitive.Description> : null}
            </div>
            <DialogPrimitive.Close className="rounded-lg p-1.5 text-[#95a1ae] hover:bg-[#29323d] hover:text-white">
              <X className="h-4 w-4" />
            </DialogPrimitive.Close>
          </div>
          <div className="scrollbar-thin flex-1 overflow-y-auto">{children}</div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export function ProgressBar({ value, tone = '#b5e36b' }: { value: number; tone?: string }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#29323d]">
      <div className="h-full rounded-full transition-all" style={{ width: `${Math.max(0, Math.min(100, value))}%`, background: tone }} />
    </div>
  );
}
