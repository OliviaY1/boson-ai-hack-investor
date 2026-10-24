// Ordered, append-only schema migrations. Never edit an applied migration; add a new one.
export const MIGRATIONS: { version: number; name: string; sql: string }[] = [
  {
    version: 1,
    name: "initial_schema",
    sql: `
CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  company TEXT NOT NULL,
  objective TEXT NOT NULL,
  owner TEXT NOT NULL DEFAULT 'consultant',
  state_revision INTEGER NOT NULL DEFAULT 0,
  thesis_version INTEGER NOT NULL DEFAULT 0,
  current_plan_id TEXT,
  is_synthetic INTEGER NOT NULL DEFAULT 0,
  last_reviewed_revision INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE source_documents (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  kind TEXT NOT NULL CHECK (kind IN ('pasted','docx')),
  filename TEXT,
  stored_path TEXT,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  thesis_version INTEGER NOT NULL,
  extracted_text TEXT NOT NULL,
  is_current INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE passages (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES source_documents(id),
  project_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  text TEXT NOT NULL,
  start_offset INTEGER NOT NULL,
  end_offset INTEGER NOT NULL
);

CREATE TABLE claims (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  code TEXT NOT NULL,
  assertion TEXT NOT NULL,
  passage_ids TEXT NOT NULL DEFAULT '[]',
  priority INTEGER NOT NULL DEFAULT 2,
  scope_definition TEXT NOT NULL DEFAULT '',
  metric_definition TEXT NOT NULL DEFAULT '',
  missing_definitions TEXT NOT NULL DEFAULT '[]',
  evidence_supporting TEXT NOT NULL DEFAULT '',
  evidence_challenging TEXT NOT NULL DEFAULT '',
  assessment TEXT NOT NULL DEFAULT 'unassessed',
  assessment_rationale TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  thesis_version INTEGER NOT NULL,
  gaps TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE experts (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  name TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  organization TEXT NOT NULL DEFAULT '',
  background TEXT NOT NULL,
  source TEXT NOT NULL,
  source_system TEXT NOT NULL DEFAULT '',
  source_record_id TEXT NOT NULL DEFAULT '',
  retrieved_at TEXT,
  is_synthetic INTEGER NOT NULL DEFAULT 0,
  deleted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE research_plans (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  version INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft','approved','superseded')),
  produced_by TEXT NOT NULL,
  approved_by TEXT,
  approved_at TEXT,
  gaps TEXT NOT NULL DEFAULT '[]',
  snapshot TEXT,
  thesis_version INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(project_id, version)
);

CREATE TABLE expert_rankings (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES research_plans(id),
  expert_id TEXT NOT NULL REFERENCES experts(id),
  rank INTEGER NOT NULL,
  score INTEGER NOT NULL,
  rationale TEXT NOT NULL,
  background_quote TEXT NOT NULL,
  claim_ids TEXT NOT NULL DEFAULT '[]',
  recommended INTEGER NOT NULL DEFAULT 0,
  selected INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE questions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  code TEXT NOT NULL,
  current_revision INTEGER NOT NULL DEFAULT 1,
  priority INTEGER NOT NULL DEFAULT 2,
  claim_ids TEXT NOT NULL DEFAULT '[]',
  origin TEXT NOT NULL,
  is_original INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  fixture_key TEXT,
  created_in_interview_id TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE question_revisions (
  question_id TEXT NOT NULL REFERENCES questions(id),
  revision INTEGER NOT NULL,
  text TEXT NOT NULL,
  purpose TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (question_id, revision)
);

CREATE TABLE interviews (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  expert_id TEXT NOT NULL REFERENCES experts(id),
  plan_id TEXT,
  plan_version INTEGER,
  mode TEXT NOT NULL,
  transport TEXT NOT NULL,
  lifecycle TEXT NOT NULL,
  consent TEXT NOT NULL DEFAULT 'pending',
  pause_reason TEXT,
  termination_reason TEXT,
  control_revision INTEGER NOT NULL DEFAULT 0,
  generation INTEGER NOT NULL DEFAULT 0,
  controller_cursor INTEGER NOT NULL DEFAULT 0,
  active_slot INTEGER UNIQUE,
  join_token_hash TEXT,
  join_token_expires_at TEXT,
  local_test INTEGER NOT NULL DEFAULT 0,
  started_at TEXT,
  ended_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE interview_question_state (
  interview_id TEXT NOT NULL REFERENCES interviews(id),
  question_id TEXT NOT NULL REFERENCES questions(id),
  coverage TEXT NOT NULL DEFAULT 'pending',
  rationale TEXT NOT NULL DEFAULT '',
  answer_turn_ids TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL,
  PRIMARY KEY (interview_id, question_id)
);

CREATE TABLE delivery_attempts (
  id TEXT PRIMARY KEY,
  interview_id TEXT NOT NULL REFERENCES interviews(id),
  kind TEXT NOT NULL,
  question_id TEXT,
  question_revision INTEGER,
  authorized_text TEXT NOT NULL,
  actual_transcript TEXT,
  provider_response_id TEXT,
  provider_item_id TEXT,
  generation INTEGER NOT NULL,
  state TEXT NOT NULL,
  played_ms INTEGER,
  interruption_detail TEXT,
  decision_id TEXT,
  queued_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT
);

CREATE TABLE transcript_turns (
  id TEXT PRIMARY KEY,
  interview_id TEXT NOT NULL REFERENCES interviews(id),
  seq INTEGER NOT NULL,
  speaker TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'interview',
  source_event_id TEXT,
  input_item_id TEXT,
  delivery_id TEXT,
  context_delivery_id TEXT,
  finality TEXT NOT NULL,
  after_end INTEGER NOT NULL DEFAULT 0,
  current_version INTEGER NOT NULL DEFAULT 1,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  UNIQUE(interview_id, seq)
);
CREATE UNIQUE INDEX turns_source_event ON transcript_turns(interview_id, source_event_id) WHERE source_event_id IS NOT NULL;

CREATE TABLE transcript_versions (
  turn_id TEXT NOT NULL REFERENCES transcript_turns(id),
  version INTEGER NOT NULL,
  text TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (turn_id, version)
);

CREATE TABLE evidence (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  interview_id TEXT NOT NULL REFERENCES interviews(id),
  expert_id TEXT NOT NULL,
  turn_id TEXT NOT NULL REFERENCES transcript_turns(id),
  turn_version INTEGER NOT NULL,
  span_start INTEGER NOT NULL,
  span_end INTEGER NOT NULL,
  quote TEXT NOT NULL,
  statement TEXT NOT NULL,
  basis TEXT NOT NULL,
  period TEXT, population TEXT, metric TEXT, unit TEXT, calc_basis TEXT, value TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  superseded_by TEXT,
  status_reason TEXT,
  review_status TEXT NOT NULL DEFAULT 'unreviewed',
  decision_id TEXT,
  dedupe_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(interview_id, dedupe_key)
);

CREATE TABLE evidence_claim_links (
  evidence_id TEXT NOT NULL REFERENCES evidence(id),
  claim_id TEXT NOT NULL REFERENCES claims(id),
  relation TEXT NOT NULL,
  comparability TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  disputed INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (evidence_id, claim_id)
);

CREATE TABLE findings (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  interview_id TEXT,
  decision_id TEXT,
  kind TEXT NOT NULL,
  text TEXT NOT NULL,
  claim_ids TEXT NOT NULL DEFAULT '[]',
  evidence_ids TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'proposed',
  review_note TEXT,
  next_evidence_needed TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE controller_decisions (
  id TEXT PRIMARY KEY,
  interview_id TEXT NOT NULL REFERENCES interviews(id),
  request_id TEXT NOT NULL UNIQUE,
  trigger TEXT NOT NULL,
  expected_revision INTEGER NOT NULL,
  generation INTEGER NOT NULL,
  plan_version INTEGER,
  transcript_cursor INTEGER NOT NULL,
  provider TEXT NOT NULL,
  proposal TEXT,
  result TEXT NOT NULL,
  rejection_reasons TEXT NOT NULL DEFAULT '[]',
  rationale TEXT NOT NULL DEFAULT '',
  next_action TEXT,
  next_question_id TEXT,
  latency_ms INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE reviews (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  action TEXT NOT NULL,
  actor TEXT NOT NULL,
  rationale TEXT NOT NULL DEFAULT '',
  prior_version TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE state_events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  project_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  type TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(project_id, revision)
);

CREATE TABLE project_memory (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  kind TEXT NOT NULL,
  text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE session_handoffs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  summary TEXT NOT NULL,
  source_revision INTEGER NOT NULL,
  evidence_refs TEXT NOT NULL DEFAULT '[]',
  unresolved TEXT NOT NULL DEFAULT '[]',
  next_steps TEXT NOT NULL DEFAULT '[]',
  dependency_digest TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE copilot_messages (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  role TEXT NOT NULL,
  channel TEXT NOT NULL,
  text TEXT NOT NULL,
  tool_name TEXT,
  navigation TEXT,
  provider TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE consultant_directives (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  interview_id TEXT,
  instruction TEXT NOT NULL,
  claim_ids TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'pending',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE latency_metrics (
  id TEXT PRIMARY KEY,
  interview_id TEXT NOT NULL,
  turn_id TEXT,
  name TEXT NOT NULL,
  ms INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE provider_event_log (
  interview_id TEXT NOT NULL,
  provider_event_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (interview_id, provider_event_id)
);
`,
  },
  {
    version: 2,
    name: "consent_provenance",
    // How consent was given (spoken answer, on-screen control, scripted demo), which utterance, and when.
    sql: `
ALTER TABLE interviews ADD COLUMN consent_method TEXT;
ALTER TABLE interviews ADD COLUMN consent_turn_id TEXT;
ALTER TABLE interviews ADD COLUMN consent_at TEXT;
`,
  },
];
