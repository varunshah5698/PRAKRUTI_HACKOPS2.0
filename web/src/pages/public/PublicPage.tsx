import { Link } from 'react-router-dom';
import { ArrowLeft, ShieldCheck } from 'lucide-react';
import { Logo } from '../../components/Logo';
import { PublicBadge } from '../../components/ui';

export function PublicPage({ children, title, kicker }: { children: React.ReactNode; title: string; kicker: string }) {
  return (
    <div className="min-h-screen bg-paper">
      <header className="border-b border-ink/10">
        <div className="mx-auto flex h-[72px] max-w-[1200px] items-center justify-between px-5 lg:px-10">
          <Logo />
          <Link to="/" className="inline-flex items-center gap-2 text-xs font-semibold text-ink/55 hover:text-ink">
            <ArrowLeft className="h-3.5 w-3.5" /> Back to home
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-[1000px] px-5 py-12 lg:px-10 lg:py-16">
        <PublicBadge tone="soft">{kicker}</PublicBadge>
        <h1 className="display mt-4 text-[40px] font-bold leading-[1] sm:text-[56px]">{title}</h1>
        <div className="mt-10">{children}</div>
      </main>
      <footer className="border-t border-ink/10 px-5 py-8 text-center text-[11px] text-ink/40">
        <p>प्रकृति · Demonstration deployment · <Link to="/privacy" className="underline">Privacy</Link> · <Link to="/terms" className="underline">Terms</Link></p>
      </footer>
    </div>
  );
}

export function Prose({ children }: { children: React.ReactNode }) {
  return <div className="space-y-5 text-[14px] leading-relaxed text-ink/65 [&_h2]:display [&_h2]:mt-9 [&_h2]:text-[24px] [&_h2]:font-bold [&_h2]:tracking-[-0.03em] [&_h2]:text-ink [&_h3]:mt-6 [&_h3]:text-sm [&_h3]:font-semibold [&_h3]:text-ink [&_strong]:text-ink [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-5 [&_a]:underline [&_a]:underline-offset-2">{children}</div>;
}

export function Callout({ title, children, tone = 'lime' }: { title: string; children: React.ReactNode; tone?: 'lime' | 'amber' }) {
  return (
    <div className={`rounded-2xl border p-5 text-[13px] leading-relaxed ${tone === 'amber' ? 'border-amber-300/60 bg-amber-50 text-amber-900' : 'border-ink/10 bg-lime/40 text-ink/70'}`}>
      <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.12em]">
        <ShieldCheck className="h-3.5 w-3.5" /> {title}
      </div>
      <div className="mt-2">{children}</div>
    </div>
  );
}
