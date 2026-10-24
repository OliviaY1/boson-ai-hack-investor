import { Link, useParams } from "@tanstack/react-router";
import { FolderKanban, Settings, Compass } from "lucide-react";
import type { ReactNode } from "react";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";

const navItem =
  "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm text-sidebar-foreground hover:bg-sidebar-accent";

export function AppShell({ children }: { children: ReactNode }) {
  const params = useParams({ strict: false }) as { projectId?: string };
  const { projects } = useStore();
  const current = projects.find((p) => p.id === params.projectId);

  return (
    <div className="flex min-h-screen">
      <aside className="no-print sticky top-0 flex h-screen w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar px-3 py-5">
        <Link to="/" className="mb-8 flex items-center gap-2 px-2.5">
          <span className="grid size-7 place-items-center rounded-md bg-primary text-primary-foreground">
            <Compass className="size-4" />
          </span>
          <span className="font-serif text-lg font-semibold tracking-tight">Diligence Live</span>
        </Link>
        <nav className="space-y-0.5">
          <Link
            to="/"
            className={navItem}
            activeOptions={{ exact: true }}
            activeProps={{ className: "bg-sidebar-accent font-medium" }}
          >
            <FolderKanban className="size-4" /> Projects
          </Link>
        </nav>
        {current && (
          <div className="mt-6">
            <p className="px-2.5 pb-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Current project
            </p>
            <Link
              to="/projects/$projectId"
              params={{ projectId: current.id }}
              className={cn(navItem, "bg-sidebar-accent font-medium")}
            >
              <span className="size-1.5 rounded-full bg-primary" />
              <span className="truncate">{current.company || "Untitled"}</span>
            </Link>
          </div>
        )}
        <div className="mt-auto">
          <Link
            to="/settings"
            className={navItem}
            activeProps={{ className: "bg-sidebar-accent font-medium" }}
          >
            <Settings className="size-4" /> Settings
          </Link>
          <p className="mt-4 px-2.5 text-[11px] leading-relaxed text-muted-foreground">
            Frontend prototype. All experts, calls and findings are simulated.
          </p>
        </div>
      </aside>
      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
  breadcrumb,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  breadcrumb?: ReactNode;
}) {
  return (
    <div className="flex items-end justify-between gap-6 pb-6">
      <div>
        {breadcrumb && <div className="mb-2 text-xs text-muted-foreground">{breadcrumb}</div>}
        <h1 className="font-serif text-[28px] font-medium leading-tight tracking-tight">{title}</h1>
        {description && (
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}
