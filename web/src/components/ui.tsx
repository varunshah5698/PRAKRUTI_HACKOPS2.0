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
  variant?: 'default' | 'lime' | 'teal' | 'outline' | 'ghost' | 'dark' | 'ink' | 'danger' | 'subtle';
  size?: 'sm' | 'md' | 'lg' | 'icon';
}) {
  const variants: Record<string, string> = {
    default: 'bg-[#4e9b3f] text-white hover:bg-[#448a36] border border-[#3f8432] shadow-[0_10px_24px_-16px_rgba(52,110,41,.7)]',
    lime: 'bg-[#d3f8a1] text-[#142016] hover:bg-[#c7f28b] border border-[#b3df7c]',
    teal: 'bg-[#2d7c94] text-white hover:bg-[#256b80] border border-[#246a7f] shadow-[0_12px_26px_-16px_rgba(35,110,132,.75)]',
    outline: 'bg-white/70 text-[#223328] border border-[#d5e0d1] hover:bg-white hover:border-[#bfd0b9]',
    ghost: 'bg-transparent text-[#4d5e52] hover:text-[#142016] hover:bg-white/70 border border-transparent',
    dark: 'bg-white/80 text-[#223328] border border-[#d5e0d1] hover:bg-white hover:border-[#bfd0b9]',
    ink: 'bg-[#111310] text-white border border-[#111310] hover:bg-[#1e2a21] shadow-[0_18px_40px_-26px_rgba(17,19,16,.85)]',
    danger: 'bg-[#c94a50] text-white hover:bg-[#b84046] border border-transparent',
    subtle: 'bg-[#edf2e9] text-[#223328] hover:bg-[#e3ebe0] border border-transparent',
  };
  const sizes: Record<string, string> = {
    sm: 'min-h-8 px-3 py-1.5 text-xs rounded-full gap-1.5',
    md: 'min-h-10 px-4 py-2 text-sm rounded-full gap-2',
    lg: 'min-h-12 px-6 py-3 text-[15px] rounded-full gap-2',
    icon: 'h-9 w-9 rounded-full justify-center',
  };
  return (
    <button
      className={classNames(
        'inline-flex items-center justify-center font-semibold transition-all duration-200 disabled:pointer-events-none disabled:opacity-45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8fc47a] focus-visible:ring-offset-2 focus-visible:ring-offset-transparent',
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
    <div className={classNames('glass-card rounded-[24px]', className)} {...props}>
      {children}
    </div>
  );
}

export function CardHeader({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={classNames('flex items-start justify-between gap-3 border-b border-dashed border-[#dbe5d6] px-5 py-4', className)}>{children}</div>;
}

export function CardTitle({ className, children }: { className?: string; children: React.ReactNode }) {
  return <h3 className={classNames('text-[15px] font-semibold tracking-[-0.01em] text-[#142016]', className)}>{children}</h3>;
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
    neutral: 'bg-white/70 text-[#53645a] border-[#d9e3d5]',
    green: 'bg-[#e8f6e4] text-[#2f7d33] border-[#c4e3bd]',
    lime: 'bg-[#eefbdc] text-[#3f7d2a] border-[#cbe8a5]',
    amber: 'bg-[#fdf5df] text-[#8a6710] border-[#eddeae]',
    red: 'bg-[#fdeeee] text-[#a83c41] border-[#f0cdce]',
    teal: 'bg-[#e8f5f3] text-[#1f766d] border-[#bfe2dd]',
    outline: 'bg-transparent text-[#44564a] border-[#cdd9c9]',
    dark: 'bg-[#edf2e9] text-[#34463a] border-[#dbe4d7]',
  };
  return (
    <span
      className={classNames(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.08em]',
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
        'h-11 w-full rounded-xl border border-[#d9e3d5] bg-white/80 px-3.5 text-sm text-[#142016] placeholder:text-[#66766b] focus:border-[#8fc47a] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#b9e0a8]/40 disabled:opacity-50',
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
        'h-[52px] w-full rounded-2xl border border-ink/10 bg-white px-4 text-sm text-ink shadow-[inset_0_1px_2px_rgba(17,19,16,.04)] placeholder:text-ink/30 focus:border-ink/40 focus:outline-none focus:ring-4 focus:ring-lime/30',
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
        'h-10 w-full rounded-xl border border-[#d9e3d5] bg-white/80 px-3 text-sm text-[#223328] focus:border-[#8fc47a] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#b9e0a8]/40',
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
        'h-[52px] w-full rounded-2xl border border-ink/10 bg-white px-3 text-sm text-ink shadow-[inset_0_1px_2px_rgba(17,19,16,.04)] focus:border-ink/40 focus:outline-none focus:ring-4 focus:ring-lime/30',
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
        'w-full rounded-xl border border-[#d9e3d5] bg-white/80 px-3.5 py-3 text-sm text-[#142016] placeholder:text-[#66766b] focus:border-[#8fc47a] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#b9e0a8]/40',
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
    <label htmlFor={htmlFor} className={classNames('mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.1em] text-[#5d6e63]', className)}>
      {children}
    </label>
  );
}

export function PublicLabel({ children, className, htmlFor }: { children: React.ReactNode; className?: string; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className={classNames('mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.14em] text-ink/45', className)}>
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
    <div className={classNames('flex min-h-[160px] flex-col items-center justify-center gap-3 text-[#66766b]', className)}>
      <Spinner className="text-[#4e9b3f]" />
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
      {icon ? <div className="mb-3 text-[#66766b]">{icon}</div> : null}
      <p className="text-sm font-semibold text-[#26362a]">{title}</p>
      <p className="mt-1 max-w-sm text-xs leading-relaxed text-[#5f7065]">{description}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function DataLabel({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={classNames('text-[10px] font-semibold uppercase tracking-[0.14em] text-[#66766b]', className)}>
      {children}
    </span>
  );
}

export function StatusDot({ status, className }: { status: string; className?: string }) {
  const color =
    status === 'CONNECTED' || status === 'ONLINE' || status === 'LIVE' || status === 'COMPLETED'
      ? 'bg-emerald-500'
      : status === 'STALE' || status === 'WATCH' || status === 'DEGRADED'
        ? 'bg-amber-500'
        : status === 'FAILED' || status === 'CRITICAL' || status === 'OFFLINE'
          ? 'bg-red-500'
          : 'bg-slate-400';
  return <span className={classNames('inline-block h-1.5 w-1.5 rounded-full', color, className)} />;
}

export function Divider({ className }: { className?: string }) {
  return <div className={classNames('h-px w-full bg-[#dce5d8]', className)} />;
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
    <div className={classNames('flex flex-wrap gap-1 rounded-full border border-white/80 bg-white/55 p-1 shadow-pill backdrop-blur', className)}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onChange(tab.id)}
          className={classNames(
            'rounded-full px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] transition',
            value === tab.id ? 'bg-[#4e9b3f] text-white shadow-sm' : 'text-[#66766b] hover:bg-white/80 hover:text-[#142016]',
          )}
        >
          {tab.label}
          {tab.count !== undefined ? <span className={classNames('ml-1.5', value === tab.id ? 'text-white/65' : 'text-[#66766b]')}>{tab.count}</span> : null}
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
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-[#15251a]/35 backdrop-blur-sm data-[state=open]:animate-in" />
      <DialogPrimitive.Content
        className={classNames(
          'fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-[24px] border border-white/85 bg-[#fdfefb]/95 p-6 shadow-2xl backdrop-blur-2xl',
          className,
        )}
      >
        <DialogPrimitive.Title className="text-lg font-semibold text-[#142016]">{title}</DialogPrimitive.Title>
        {description ? <DialogPrimitive.Description className="mt-1 text-xs text-[#66766b]">{description}</DialogPrimitive.Description> : null}
        <DialogPrimitive.Close className="absolute right-4 top-4 rounded-full p-1.5 text-[#66766b] hover:bg-[#edf2e9] hover:text-[#142016]">
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
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-[#15251a]/30 backdrop-blur-sm" />
        <DialogPrimitive.Content
          className={classNames(
            'fixed top-0 z-50 flex h-full w-full max-w-[560px] flex-col border-white/80 bg-[#fbfdf9]/95 shadow-2xl outline-none backdrop-blur-2xl',
            side === 'right' ? 'right-0 border-l' : 'left-0 border-r',
            className,
          )}
        >
          <div className="flex items-start justify-between gap-4 border-b border-dashed border-[#dbe5d6] px-5 py-4">
            <div>
              <DialogPrimitive.Title className="text-base font-semibold text-[#142016]">{title}</DialogPrimitive.Title>
              {description ? <DialogPrimitive.Description className="mt-0.5 text-xs text-[#5f7065]">{description}</DialogPrimitive.Description> : null}
            </div>
            <DialogPrimitive.Close className="rounded-full p-1.5 text-[#66766b] hover:bg-[#edf2e9] hover:text-[#142016]">
              <X className="h-4 w-4" />
            </DialogPrimitive.Close>
          </div>
          <div className="scrollbar-thin flex-1 overflow-y-auto">{children}</div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export function ProgressBar({ value, tone = '#4e9b3f' }: { value: number; tone?: string }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#e4ece0]">
      <div className="h-full rounded-full transition-all" style={{ width: `${Math.max(0, Math.min(100, value))}%`, background: tone }} />
    </div>
  );
}
