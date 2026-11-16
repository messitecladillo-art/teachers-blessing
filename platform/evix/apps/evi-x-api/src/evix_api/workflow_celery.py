"""Optional Celery adapter. The first release uses workflow_worker instead.

Install the `celery` extra before using this adapter. Never run this dispatcher
alongside the default PostgreSQL consumer for the same schema.
"""
import argparse
from functools import lru_cache
import time
from celery import Celery
from sqlalchemy import create_engine
from .settings import Settings
from .workflow_runner import WorkflowRuntime


@lru_cache(maxsize=1)
def runtime():
    settings = Settings()
    if not settings.workflow_enabled: raise RuntimeError("Workflow execution is disabled")
    engine = create_engine(settings.database_url, pool_pre_ping=True, pool_size=4, max_overflow=2)
    return WorkflowRuntime(settings, engine)


def make_celery(settings=None):
    # Loading this module for CLI inspection does not connect to a broker or DB.
    if settings is None:
        import os
        broker = os.environ.get("EVIX_WORKFLOW_BROKER_URL", "")
    else: broker = settings.workflow_broker_url
    if not broker.startswith(("amqp://", "amqps://")):
        raise RuntimeError("Optional Celery adapter requires an explicit RabbitMQ URL")
    app = Celery("evix_workflow", broker=broker)
    app.conf.update(task_serializer="json", accept_content=["json"], result_serializer="json", task_ignore_result=True,
                    task_acks_late=True, task_reject_on_worker_lost=True, worker_prefetch_multiplier=1,
                    task_default_queue="evix_research", task_default_delivery_mode="persistent",
                    broker_connection_retry_on_startup=True, broker_connection_timeout=5,
                    broker_transport_options={"confirm_publish": True},
                    worker_enable_remote_control=False,
                    task_publish_retry=False, broker_heartbeat=20,
                    task_routes={"evix.workflow.compute": {"queue": "evix_compute"}, "evix.workflow.model": {"queue": "evix_model"}})
    return app


celery_app = make_celery()


@celery_app.task(name="evix.workflow.compute", acks_late=True, reject_on_worker_lost=True)
def compute(node_run_id, user_id, attempt):
    runtime().execute(node_run_id, user_id, attempt)


@celery_app.task(name="evix.workflow.model", acks_late=True, reject_on_worker_lost=True)
def model(node_run_id, user_id, attempt):
    runtime().execute(node_run_id, user_id, attempt)


def dispatch_once(worker, transport):
    from sqlalchemy import select
    from .workflow_models import WorkflowNodeRun
    from .workflows import MODEL_KINDS
    worker.recover()
    count = 0
    for oid, nid, uid, attempt in worker.pending_messages():
        with worker.session(uid) as session:
            node = session.get(WorkflowNodeRun, nid)
            task = "evix.workflow.model" if node.kind in MODEL_KINDS else "evix.workflow.compute"
        transport.send_task(task, args=[nid, uid, attempt], task_id=oid, queue="evix_model" if task.endswith("model") else "evix_compute",
                            delivery_mode=2, retry=False)
        # If the broker confirms but this transaction fails, the next sweep
        # resends the same ID. The node receipt/lease rejects the duplicate.
        worker.acknowledge_dispatch(oid); count += 1
    return count


def main():
    parser = argparse.ArgumentParser(); parser.add_argument("mode", choices=["dispatch", "recover"])
    parser.add_argument("--once", action="store_true"); args = parser.parse_args()
    worker = runtime()
    if args.mode == "recover": worker.recover(); return
    transport = make_celery(worker.settings)
    while True:
        try: dispatch_once(worker, transport)
        except KeyboardInterrupt: return
        except Exception:
            # No secrets, model inputs or raw broker exceptions are printed.
            print("Workflow dispatcher unavailable; durable outbox retained.", flush=True)
            if args.once: raise RuntimeError("Workflow dispatch failed") from None
        if args.once: return
        time.sleep(2)


if __name__ == "__main__": main()
