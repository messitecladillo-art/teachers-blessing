"""Versioned research workflows. PostgreSQL, rather than a queue, owns state."""
from datetime import datetime
from sqlalchemy import String, Integer, Boolean, DateTime, ForeignKey, UniqueConstraint, JSON, LargeBinary
from sqlalchemy.orm import Mapped, mapped_column
from .models import Base, now, new_id


class WorkflowVersion(Base):
    __tablename__ = "workflow_versions"
    __table_args__ = (UniqueConstraint("project_id", "revision"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id"), index=True)
    revision: Mapped[int] = mapped_column(Integer)
    definition: Mapped[dict] = mapped_column(JSON)
    content_hash: Mapped[str] = mapped_column(String(64))
    created_by: Mapped[str] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class WorkflowLayout(Base):
    __tablename__ = "workflow_layouts"
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id"), primary_key=True)
    revision: Mapped[int] = mapped_column(Integer, default=0)
    layout: Mapped[dict] = mapped_column(JSON)


class WorkflowView(Base):
    __tablename__ = "workflow_views"
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id"), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), primary_key=True)
    view: Mapped[dict] = mapped_column(JSON)


class DatasetVersion(Base):
    __tablename__ = "dataset_versions"
    __table_args__ = (UniqueConstraint("origin_node_run_id"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id"), index=True)
    source_name: Mapped[str] = mapped_column(String(160))
    classification: Mapped[str] = mapped_column(String(16))
    content_hash: Mapped[str] = mapped_column(String(64))
    content: Mapped[dict] = mapped_column(JSON)
    created_by: Mapped[str] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    origin_node_run_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    origin_input_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)


class WorkflowRun(Base):
    __tablename__ = "workflow_runs"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id"), index=True)
    workflow_version_id: Mapped[str] = mapped_column(ForeignKey("workflow_versions.id"))
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    manifest: Mapped[dict] = mapped_column(JSON)
    status: Mapped[str] = mapped_column(String(32), default="queued")
    cancel_requested: Mapped[bool] = mapped_column(Boolean, default=False)
    event_sequence: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class WorkflowNodeRun(Base):
    __tablename__ = "workflow_node_runs"
    __table_args__ = (UniqueConstraint("run_id", "node_id"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id"), index=True)
    run_id: Mapped[str] = mapped_column(ForeignKey("workflow_runs.id"), index=True)
    node_id: Mapped[str] = mapped_column(String(80))
    kind: Mapped[str] = mapped_column(String(40))
    status: Mapped[str] = mapped_column(String(32), default="pending")
    attempt: Mapped[int] = mapped_column(Integer, default=0)
    input_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    inputs: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    result: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    error_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    lease_token: Mapped[str | None] = mapped_column(String(36), nullable=True)
    lease_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class WorkflowCall(Base):
    """Reserve once before external I/O; a dispatched call is never replayed."""
    __tablename__ = "workflow_calls"
    __table_args__ = (UniqueConstraint("node_run_id", "call_key"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id"), index=True)
    node_run_id: Mapped[str] = mapped_column(ForeignKey("workflow_node_runs.id"))
    call_key: Mapped[str] = mapped_column(String(100))
    status: Mapped[str] = mapped_column(String(32))
    service_id: Mapped[str] = mapped_column(String(36))
    service_revision: Mapped[int] = mapped_column(Integer)
    input_hash: Mapped[str] = mapped_column(String(64))
    output: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    error_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class WorkflowEvent(Base):
    __tablename__ = "workflow_events"
    __table_args__ = (UniqueConstraint("run_id", "sequence"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id"), index=True)
    run_id: Mapped[str] = mapped_column(ForeignKey("workflow_runs.id"), index=True)
    sequence: Mapped[int] = mapped_column(Integer)
    node_id: Mapped[str | None] = mapped_column(String(80), nullable=True)
    type: Mapped[str] = mapped_column(String(40))
    payload: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class WorkflowOutbox(Base):
    __tablename__ = "workflow_outbox"
    __table_args__ = (UniqueConstraint("node_run_id", "attempt"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id"), index=True)
    run_id: Mapped[str] = mapped_column(ForeignKey("workflow_runs.id"))
    node_run_id: Mapped[str] = mapped_column(ForeignKey("workflow_node_runs.id"))
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    attempt: Mapped[int] = mapped_column(Integer)
    available_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class WorkflowFile(Base):
    __tablename__ = "workflow_files"
    __table_args__ = (UniqueConstraint("run_id", "node_id"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id"), index=True)
    run_id: Mapped[str] = mapped_column(ForeignKey("workflow_runs.id"))
    node_id: Mapped[str] = mapped_column(String(80))
    filename: Mapped[str] = mapped_column(String(160))
    mime: Mapped[str] = mapped_column(String(120))
    content_hash: Mapped[str] = mapped_column(String(64))
    content: Mapped[bytes] = mapped_column(LargeBinary)
    input_hash: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class WorkflowGraphProposal(Base):
    __tablename__ = "workflow_graph_proposals"
    __table_args__ = (UniqueConstraint("user_id", "project_id", "idempotency_key"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id"), index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    idempotency_key: Mapped[str] = mapped_column(String(36))
    input_hash: Mapped[str] = mapped_column(String(64))
    base_revision: Mapped[int] = mapped_column(Integer)
    service_id: Mapped[str] = mapped_column(String(36))
    service_revision: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(32))
    definition: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    error_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class ReportProvenance(Base):
    __tablename__ = "report_provenance"
    report_version_id: Mapped[str] = mapped_column(ForeignKey("report_versions.id"), primary_key=True)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id"), index=True)
    classification: Mapped[str] = mapped_column(String(16))
    source: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
