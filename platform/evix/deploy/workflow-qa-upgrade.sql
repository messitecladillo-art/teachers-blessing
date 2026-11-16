-- Additive repair for the synthetic QA schema that loaded this unpublished
-- migration before its review was complete. Production uses alembic head.
DO $$ BEGIN
  IF current_database() <> 'evix_p0_test' OR current_schema() <> 'qa_fullflow_20261011' THEN
    RAISE EXCEPTION 'This patch is restricted to the named synthetic QA schema';
  END IF;
END $$;
CREATE TABLE IF NOT EXISTS report_provenance (
  report_version_id VARCHAR(36) PRIMARY KEY REFERENCES report_versions(id),
  project_id VARCHAR(36) NOT NULL REFERENCES projects(id),
  classification VARCHAR(16) NOT NULL CHECK(classification IN ('actual','simulated','unknown')),
  source JSON NOT NULL, created_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_report_provenance_project_id ON report_provenance(project_id);
ALTER TABLE report_provenance ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_provenance FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname=current_schema() AND tablename='report_provenance' AND policyname='scoped_read') THEN
    CREATE POLICY scoped_read ON report_provenance FOR SELECT USING (
      EXISTS(SELECT 1 FROM projects p JOIN memberships m ON m.team_id=p.team_id WHERE p.id=report_provenance.project_id AND m.user_id=current_setting('evix.user_id',true))
      OR current_setting('evix.workflow_worker',true)='on');
    CREATE POLICY scoped_insert ON report_provenance FOR INSERT WITH CHECK (
      EXISTS(SELECT 1 FROM projects p JOIN memberships m ON m.team_id=p.team_id WHERE p.id=report_provenance.project_id AND m.user_id=current_setting('evix.user_id',true) AND m.role IN ('owner','editor'))
      OR current_setting('evix.workflow_worker',true)='on');
    CREATE TRIGGER immutable_report_provenance BEFORE UPDATE OR DELETE ON report_provenance FOR EACH ROW EXECUTE FUNCTION evix_immutable_version();
  END IF;
END $$;
ALTER TABLE dataset_versions ADD COLUMN IF NOT EXISTS origin_node_run_id VARCHAR(36);
ALTER TABLE dataset_versions ADD COLUMN IF NOT EXISTS origin_input_hash VARCHAR(64);
CREATE UNIQUE INDEX IF NOT EXISTS uq_dataset_versions_origin ON dataset_versions(origin_node_run_id);
ALTER TABLE workflow_files ADD COLUMN IF NOT EXISTS input_hash VARCHAR(64);
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM workflow_files WHERE input_hash IS NULL) THEN
    RAISE EXCEPTION 'Existing QA workflow files lack frozen input hashes; preserve them and create a fresh QA schema';
  END IF;
END $$;
ALTER TABLE workflow_files ALTER COLUMN input_hash SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_workflow_files_origin ON workflow_files(run_id,node_id);
GRANT SELECT,INSERT,UPDATE,DELETE ON report_provenance TO evix_app;
