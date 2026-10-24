import { createFileRoute } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import { AppShell, PageHeader } from "@/components/app-shell";
import { Button, Card, ConfirmDialog } from "@/components/ui-kit";
import { useStore } from "@/lib/store";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings — Diligence Live" },
      {
        name: "description",
        content: "Manage saved projects and demo data for the Diligence Live prototype.",
      },
      { property: "og:title", content: "Settings — Diligence Live" },
      {
        property: "og:description",
        content: "Manage saved projects and demo data for the Diligence Live prototype.",
      },
    ],
  }),
  component: SettingsPage,
});

function SettingsPage() {
  const { projects, loadSamples, removeAllProjects } = useStore();
  const [confirm, setConfirm] = useState(false);
  const [done, setDone] = useState("");

  return (
    <AppShell>
      <div className="mx-auto max-w-3xl px-10 py-10">
        <PageHeader title="Settings" description="Everything is stored in this browser only." />
        <Card className="divide-y">
          <Row
            title="Sample projects"
            description="Add the Northstar Dental Group, Harbor Veterinary and Summit Physio demos. Projects you already have are kept."
            action={
              <Button
                variant="secondary"
                onClick={() => {
                  loadSamples();
                  setDone("Sample projects loaded.");
                }}
              >
                Load sample projects
              </Button>
            }
          />
          <Row
            title="Saved projects"
            description={`${projects.length} project${projects.length === 1 ? "" : "s"} stored in this browser. Deleting removes their plans, interviews and findings.`}
            action={
              <Button
                variant="secondary"
                disabled={!projects.length}
                onClick={() => setConfirm(true)}
              >
                Delete all projects
              </Button>
            }
          />
        </Card>
        {done && <p className="mt-3 text-sm text-success">{done}</p>}
        <ConfirmDialog
          open={confirm}
          onClose={() => setConfirm(false)}
          onConfirm={() => {
            removeAllProjects();
            setConfirm(false);
            setDone("All projects deleted.");
          }}
          title="Delete all projects?"
          description="Every project stored in this browser will be removed. The sample projects can be loaded again from here."
          confirmLabel="Delete all"
        />
      </div>
    </AppShell>
  );
}

function Row({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-6 p-5">
      <div>
        <p className="font-medium">{title}</p>
        <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
      </div>
      <div className="shrink-0">{action}</div>
    </div>
  );
}
