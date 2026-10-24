import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowRight, Info, Wand2 } from "lucide-react";
import { useState } from "react";
import { AppShell, PageHeader } from "@/components/app-shell";
import { Button, Card, Input, Label, Textarea } from "@/components/ui-kit";
import { NETWORKS, SAMPLE_COMPANY, SAMPLE_THESIS } from "@/lib/mock-data";
import { uid } from "@/lib/mock-service";
import { useStore } from "@/lib/store";

export const Route = createFileRoute("/new")({
  head: () => ({
    meta: [
      { title: "New Diligence — Diligence Live" },
      {
        name: "description",
        content: "Start a new diligence project with a target company and investment thesis.",
      },
      { property: "og:title", content: "New Diligence — Diligence Live" },
      {
        property: "og:description",
        content: "Start a new diligence project with a target company and investment thesis.",
      },
    ],
  }),
  component: NewDiligence,
});

function NewDiligence() {
  const [company, setCompany] = useState("");
  const [thesis, setThesis] = useState("");
  const { addProject } = useStore();
  const navigate = useNavigate();

  const create = () => {
    const id = uid("p");
    addProject({
      id,
      company: company.trim(),
      thesis: thesis.trim(),
      status: "Draft",
      networks: NETWORKS.map((n) => ({ ...n })),
      experts: [],
      interviews: [],
      reviews: {},
      updatedAt: new Date().toISOString(),
    });
    navigate({ to: "/projects/$projectId/sources", params: { projectId: id } });
  };

  return (
    <AppShell>
      <div className="mx-auto max-w-3xl px-10 py-10">
        <PageHeader
          breadcrumb={
            <>
              <Link to="/" className="hover:text-foreground">
                Projects
              </Link>{" "}
              / New diligence
            </>
          }
          title="New Diligence"
          description="Describe the target and the thesis you need to validate."
          actions={
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setCompany(SAMPLE_COMPANY);
                setThesis(SAMPLE_THESIS);
              }}
            >
              <Wand2 /> Use Sample Thesis
            </Button>
          }
        />
        <Card className="space-y-6 p-6">
          <div>
            <Label htmlFor="company">Target Company</Label>
            <Input
              id="company"
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              placeholder="Enter target company name"
            />
          </div>
          <div>
            <Label htmlFor="thesis">Investment Thesis</Label>
            <Textarea
              id="thesis"
              rows={16}
              value={thesis}
              onChange={(e) => setThesis(e.target.value)}
              placeholder="Paste the investment thesis, including market attractiveness, growth opportunities, competitive advantages, and key assumptions..."
              className="min-h-80 resize-y"
            />
            <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
              <Info className="size-3.5" /> Diligence Live will identify the key assumptions in this
              thesis that require validation by experts.
            </p>
          </div>
          <div className="flex justify-end border-t pt-5">
            <Button onClick={create} disabled={!company.trim() || !thesis.trim()}>
              Continue to Expert Sources <ArrowRight />
            </Button>
          </div>
        </Card>
      </div>
    </AppShell>
  );
}
