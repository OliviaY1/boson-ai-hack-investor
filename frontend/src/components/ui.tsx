import type { ButtonHTMLAttributes, ReactNode } from "react";
import { useState } from "react";
import type { Tone } from "../lib/format";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");
export { cx };

type Variant = "primary" | "secondary" | "ghost" | "danger";
export function Button({ variant = "secondary", size = "md", className, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md" }) {
  return (
    <button
      {...p}
      className={cx(
        "inline-flex items-center justify-center gap-1.5 rounded-md border font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        size === "sm" ? "px-2 py-1 text-xs" : "px-3 py-1.5 text-sm",
        variant === "primary" && "border-accent-700 bg-accent-600 text-white hover:bg-accent-700",
        variant === "secondary" && "border-line bg-white text-ink hover:bg-surface",
        variant === "ghost" && "border-transparent bg-transparent text-muted hover:bg-surface hover:text-ink",
        variant === "danger" && "border-red-300 bg-white text-red-700 hover:bg-red-50",
        className,
      )}
    />
  );
}

/** A button whose async action shows progress and surfaces its error inline. */
export function ActionButton({ action, children, onFail, ...p }: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onClick" | "onError"> & { action: () => Promise<unknown>; variant?: Variant; size?: "sm" | "md"; onFail?: (msg: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col items-start">
      <Button
        {...p}
        disabled={busy || p.disabled}
        onClick={async () => {
          setBusy(true);
          setErr(null);
          try {
            await action();
          } catch (e) {
            const m = (e as Error).message;
            if (onFail) onFail(m);
            else setErr(m);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? <Spinner /> : null}
        {children}
      </Button>
      {err ? <span className="mt-1 max-w-xs text-xs text-red-700">{err}</span> : null}
    </span>
  );
}

const TONES: Record<Tone, string> = {
  neutral: "border-line bg-surface text-muted",
  accent: "border-accent-100 bg-accent-50 text-accent-700",
  good: "border-emerald-200 bg-emerald-50 text-emerald-800",
  warn: "border-amber-200 bg-amber-50 text-amber-800",
  bad: "border-red-200 bg-red-50 text-red-800",
  info: "border-sky-200 bg-sky-50 text-sky-800",
};

export function Badge({ tone = "neutral", children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return (
    <span title={title} className={cx("inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium", TONES[tone])}>
      {children}
    </span>
  );
}

export function SyntheticBadge() {
  return <Badge tone="warn" title="Fictional demonstration record">Synthetic</Badge>;
}

export function Card({ title, actions, children, className }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx("rounded-lg border border-line bg-white", className)}>
      {title || actions ? (
        <header className="flex items-center justify-between gap-2 border-b border-line px-4 py-2.5">
          <h2 className="text-sm font-semibold">{title}</h2>
          <div className="flex items-center gap-2">{actions}</div>
        </header>
      ) : null}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Spinner() {
  return <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-r-transparent" aria-label="Loading" />;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-md border border-dashed border-line px-4 py-6 text-center text-sm text-muted">{children}</div>;
}

export function Notice({ tone = "info", children }: { tone?: Tone; children: ReactNode }) {
  return <div className={cx("rounded-md border px-3 py-2 text-sm", TONES[tone])}>{children}</div>;
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-muted">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-xs text-muted">{hint}</span> : null}
    </label>
  );
}

export const inputCls = "w-full rounded-md border border-line bg-white px-2.5 py-1.5 text-sm outline-none focus:border-accent-600 focus:ring-2 focus:ring-accent-100";

export function Th({ children, className }: { children?: ReactNode; className?: string }) {
  return <th className={cx("border-b border-line px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted", className)}>{children}</th>;
}

export function Td({ children, className }: { children?: ReactNode; className?: string }) {
  return <td className={cx("border-b border-line px-3 py-2 align-top", className)}>{children}</td>;
}
