// Basic backend-validated access token for consultant views when ACCESS_TOKEN is configured.
import { useEffect, useState } from "react";
import { Outlet } from "react-router-dom";
import { api, ApiError } from "../lib/api";
import { Button, Card, Field, inputCls, Notice } from "../components/ui";

export function AuthGate() {
  const [state, setState] = useState<"checking" | "ok" | "login" | "down">("checking");
  const [token, setToken] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const check = () =>
    api
      .get("/api/projects")
      .then(() => setState("ok"))
      .catch((e) => setState(e instanceof ApiError && e.status === 401 ? "login" : "down"));
  useEffect(() => {
    void check();
  }, []);
  if (state === "ok") return <Outlet />;
  if (state === "checking") return <div className="p-8 text-muted">Loading…</div>;
  if (state === "down")
    return (
      <div className="mx-auto max-w-md p-8">
        <Notice tone="bad">The backend is unreachable. Start it with <code>npm run dev</code> and reload.</Notice>
      </div>
    );
  return (
    <div className="mx-auto max-w-sm p-8">
      <Card title="Diligence Live access">
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await api.post("/api/login", { token });
              setState("ok");
            } catch (e2) {
              setErr((e2 as Error).message);
            }
          }}
        >
          <Field label="Access token" hint="Configured on the backend as ACCESS_TOKEN.">
            <input className={inputCls} type="password" value={token} onChange={(e) => setToken(e.target.value)} autoFocus />
          </Field>
          {err ? <Notice tone="bad">{err}</Notice> : null}
          <Button variant="primary" type="submit">Continue</Button>
        </form>
      </Card>
    </div>
  );
}
