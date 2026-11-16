"""Durable, project-scoped workflows and immutable input snapshots."""
from alembic import op

revision = "0005_workflows"
down_revision = "0004_project_reports"
branch_labels = None
depends_on = None


def upgrade():
    statements = [
        """CREATE TABLE report_provenance (report_version_id VARCHAR(36) PRIMARY KEY REFERENCES report_versions(id), project_id VARCHAR(36) NOT NULL REFERENCES projects(id), classification VARCHAR(16) NOT NULL CHECK(classification IN ('actual','simulated','unknown')), source JSON NOT NULL, created_at TIMESTAMPTZ NOT NULL)""",
        """CREATE TABLE workflow_versions (id VARCHAR(36) PRIMARY KEY, project_id VARCHAR(36) NOT NULL REFERENCES projects(id), revision INTEGER NOT NULL CHECK(revision>0), definition JSON NOT NULL, content_hash VARCHAR(64) NOT NULL, created_by VARCHAR(36) NOT NULL REFERENCES users(id), created_at TIMESTAMPTZ NOT NULL, UNIQUE(project_id,revision))""",
        """CREATE TABLE workflow_layouts (project_id VARCHAR(36) PRIMARY KEY REFERENCES projects(id), revision INTEGER NOT NULL CHECK(revision>=0), layout JSON NOT NULL)""",
        """CREATE TABLE workflow_views (project_id VARCHAR(36) NOT NULL REFERENCES projects(id), user_id VARCHAR(36) NOT NULL REFERENCES users(id), view JSON NOT NULL, PRIMARY KEY(project_id,user_id))""",
        """CREATE TABLE dataset_versions (id VARCHAR(36) PRIMARY KEY, project_id VARCHAR(36) NOT NULL REFERENCES projects(id), source_name VARCHAR(160) NOT NULL, classification VARCHAR(16) NOT NULL CHECK(classification IN ('actual','simulated')), content_hash VARCHAR(64) NOT NULL, content JSON NOT NULL, created_by VARCHAR(36) NOT NULL REFERENCES users(id), created_at TIMESTAMPTZ NOT NULL, origin_node_run_id VARCHAR(36) UNIQUE, origin_input_hash VARCHAR(64))""",
        """CREATE TABLE workflow_runs (id VARCHAR(36) PRIMARY KEY, project_id VARCHAR(36) NOT NULL REFERENCES projects(id), workflow_version_id VARCHAR(36) NOT NULL REFERENCES workflow_versions(id), user_id VARCHAR(36) NOT NULL REFERENCES users(id), manifest JSON NOT NULL, status VARCHAR(32) NOT NULL, cancel_requested BOOLEAN NOT NULL, event_sequence INTEGER NOT NULL, created_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL)""",
        """CREATE TABLE workflow_node_runs (id VARCHAR(36) PRIMARY KEY, project_id VARCHAR(36) NOT NULL REFERENCES projects(id), run_id VARCHAR(36) NOT NULL REFERENCES workflow_runs(id), node_id VARCHAR(80) NOT NULL, kind VARCHAR(40) NOT NULL, status VARCHAR(32) NOT NULL, attempt INTEGER NOT NULL, input_hash VARCHAR(64), inputs JSON, result JSON, error_code VARCHAR(64), lease_token VARCHAR(36), lease_until TIMESTAMPTZ, started_at TIMESTAMPTZ, finished_at TIMESTAMPTZ, UNIQUE(run_id,node_id))""",
        """CREATE TABLE workflow_calls (id VARCHAR(36) PRIMARY KEY, project_id VARCHAR(36) NOT NULL REFERENCES projects(id), node_run_id VARCHAR(36) NOT NULL REFERENCES workflow_node_runs(id), call_key VARCHAR(100) NOT NULL, status VARCHAR(32) NOT NULL, service_id VARCHAR(36) NOT NULL, service_revision INTEGER NOT NULL, input_hash VARCHAR(64) NOT NULL, output JSON, error_code VARCHAR(64), created_at TIMESTAMPTZ NOT NULL, finished_at TIMESTAMPTZ, UNIQUE(node_run_id,call_key))""",
        """CREATE TABLE workflow_events (id VARCHAR(36) PRIMARY KEY, project_id VARCHAR(36) NOT NULL REFERENCES projects(id), run_id VARCHAR(36) NOT NULL REFERENCES workflow_runs(id), sequence INTEGER NOT NULL, node_id VARCHAR(80), type VARCHAR(40) NOT NULL, payload JSON NOT NULL, created_at TIMESTAMPTZ NOT NULL, UNIQUE(run_id,sequence))""",
        """CREATE TABLE workflow_outbox (id VARCHAR(36) PRIMARY KEY, project_id VARCHAR(36) NOT NULL REFERENCES projects(id), run_id VARCHAR(36) NOT NULL REFERENCES workflow_runs(id), node_run_id VARCHAR(36) NOT NULL REFERENCES workflow_node_runs(id), user_id VARCHAR(36) NOT NULL REFERENCES users(id), attempt INTEGER NOT NULL, available_at TIMESTAMPTZ NOT NULL, sent_at TIMESTAMPTZ, UNIQUE(node_run_id,attempt))""",
        """CREATE TABLE workflow_files (id VARCHAR(36) PRIMARY KEY, project_id VARCHAR(36) NOT NULL REFERENCES projects(id), run_id VARCHAR(36) NOT NULL REFERENCES workflow_runs(id), node_id VARCHAR(80) NOT NULL, filename VARCHAR(160) NOT NULL, mime VARCHAR(120) NOT NULL, content_hash VARCHAR(64) NOT NULL, input_hash VARCHAR(64) NOT NULL, content BYTEA NOT NULL, created_at TIMESTAMPTZ NOT NULL, UNIQUE(run_id,node_id))""",
        """CREATE TABLE workflow_graph_proposals (id VARCHAR(36) PRIMARY KEY, project_id VARCHAR(36) NOT NULL REFERENCES projects(id), user_id VARCHAR(36) NOT NULL REFERENCES users(id), idempotency_key VARCHAR(36) NOT NULL, input_hash VARCHAR(64) NOT NULL, base_revision INTEGER NOT NULL, service_id VARCHAR(36) NOT NULL, service_revision INTEGER NOT NULL, status VARCHAR(32) NOT NULL, definition JSON, error_code VARCHAR(64), created_at TIMESTAMPTZ NOT NULL, finished_at TIMESTAMPTZ, UNIQUE(user_id,project_id,idempotency_key))""",
    ]
    for statement in statements:
        op.execute(statement)
    for table in ("workflow_versions", "dataset_versions", "workflow_runs", "workflow_node_runs", "workflow_calls", "workflow_events", "workflow_outbox", "workflow_files", "workflow_graph_proposals", "report_provenance"):
        op.execute(f"CREATE INDEX ix_{table}_project_id ON {table}(project_id)")
    for table in ("workflow_node_runs", "workflow_events"):
        op.execute(f"CREATE INDEX ix_{table}_run_id ON {table}(run_id)")
    op.execute("CREATE INDEX ix_workflow_outbox_due ON workflow_outbox(available_at,sent_at)")
    op.execute("CREATE INDEX ix_workflow_node_runs_lease ON workflow_node_runs(status,lease_until)")
    for table in ("workflow_versions", "workflow_layouts", "workflow_views", "dataset_versions", "workflow_runs", "workflow_node_runs", "workflow_calls", "workflow_events", "workflow_outbox", "workflow_files", "workflow_graph_proposals", "report_provenance"):
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
        member = f"EXISTS(SELECT 1 FROM projects p JOIN memberships m ON m.team_id=p.team_id WHERE p.id={table}.project_id AND m.user_id=current_setting('evix.user_id',true))"
        editor = f"EXISTS(SELECT 1 FROM projects p JOIN memberships m ON m.team_id=p.team_id WHERE p.id={table}.project_id AND m.user_id=current_setting('evix.user_id',true) AND m.role IN ('owner','editor'))"
        # Worker scope is set only by the fixed runner. Each operation separately
        # rechecks the initiating user's invitation/membership/service authority.
        worker = "current_setting('evix.workflow_worker',true)='on'"
        personal = f" AND {table}.user_id=current_setting('evix.user_id',true)" if table == "workflow_views" else ""
        op.execute(f"CREATE POLICY scoped_read ON {table} FOR SELECT USING (({member}{personal}) OR ({worker}))")
        if table in ("workflow_versions", "dataset_versions"):
            op.execute(f"CREATE POLICY scoped_insert ON {table} FOR INSERT WITH CHECK (({editor} AND created_by=current_setting('evix.user_id',true)) OR ({worker}))")
            op.execute(f"CREATE TRIGGER immutable_{table} BEFORE UPDATE OR DELETE ON {table} FOR EACH ROW EXECUTE FUNCTION evix_immutable_version()")
        elif table in ("workflow_events", "workflow_files", "report_provenance"):
            op.execute(f"CREATE POLICY scoped_insert ON {table} FOR INSERT WITH CHECK (({editor}) OR ({worker}))")
            op.execute(f"CREATE TRIGGER immutable_{table} BEFORE UPDATE OR DELETE ON {table} FOR EACH ROW EXECUTE FUNCTION evix_immutable_version()")
        else:
            writer = member if table == "workflow_views" else editor
            op.execute(f"CREATE POLICY scoped_write ON {table} FOR ALL USING (({writer}{personal}) OR ({worker})) WITH CHECK (({writer}{personal}) OR ({worker}))")


def downgrade():
    raise RuntimeError("Destructive downgrade disabled; restore a verified backup")
