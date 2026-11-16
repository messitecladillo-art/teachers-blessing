"""Independent PostgreSQL consumer for the fixed research executor.

No broker, browser lifetime, request background task or result backend owns jobs.
Each claim commits the node's lease and dispatch receipt before starting I/O.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
from functools import lru_cache
import json
from threading import Event, Thread
import time

from sqlalchemy import create_engine

from .settings import Settings
from .workflow_runner import WorkflowRuntime


@lru_cache(maxsize=1)
def runtime():
    settings = Settings()
    if not settings.workflow_enabled: raise RuntimeError("Workflow execution is disabled")
    engine = create_engine(settings.database_url, pool_pre_ping=True, pool_size=8, max_overflow=2)
    return WorkflowRuntime(settings, engine)


class PostgresConsumer:
    """Bounded local executors; persisted global capacity is checked at claim time."""
    def __init__(self, worker, *, recovery_seconds=2):
        self.worker = worker
        self.limits = {"compute": worker.settings.workflow_parallel_compute, "model": worker.settings.workflow_parallel_model}
        self.pools = {lane: ThreadPoolExecutor(max_workers=limit, thread_name_prefix="evix-" + lane) for lane, limit in self.limits.items()}
        self.active = {lane: {} for lane in self.limits}
        self.recovery_seconds, self.next_recovery = recovery_seconds, 0
        self.closed = False

    def _execute(self, claim):
        stopped = Event()
        interval = min(20, max(0.05, self.worker.settings.workflow_lease_seconds / 3))

        def heartbeat():
            delay = interval
            while not stopped.wait(delay):
                try:
                    # False means the token was fenced/expired/cancelled. A busy
                    # row (None) or unavailable DB is retried, never resurrected.
                    renewed = self.worker.renew_claim(claim)
                    if renewed is False: return
                    delay = interval if renewed is True else min(1, interval / 4)
                except Exception:
                    delay = min(1, interval / 4)

        monitor = Thread(target=heartbeat, daemon=True, name="evix-lease")
        monitor.start()
        try: self.worker.execute_claim(claim)
        finally:
            stopped.set(); monitor.join(timeout=1)

    def _reap(self):
        for futures in self.active.values():
            for future in list(futures):
                if future.done():
                    try: future.result()
                    except BaseException:
                        # Do not print inputs, credentials, provider errors or
                        # raw exceptions. Recovery owns abandoned attempt state.
                        print("Workflow attempt interrupted; durable lease retained.", flush=True)
                    del futures[future]

    def tick(self):
        if self.closed: raise RuntimeError("Consumer is closed")
        self._reap()
        if time.monotonic() >= self.next_recovery:
            self.worker.recover()
            self.next_recovery = time.monotonic() + self.recovery_seconds
        claimed = 0
        for lane, limit in self.limits.items():
            while len(self.active[lane]) < limit:
                claim = self.worker.claim_next(lane)
                if claim is None: break
                future = self.pools[lane].submit(self._execute, claim)
                self.active[lane][future] = claim
                claimed += 1
        return claimed

    def run_until_idle(self, *, timeout=30, poll_seconds=0.05):
        deadline, count = time.monotonic() + timeout, 0
        while time.monotonic() < deadline:
            claimed = self.tick(); count += claimed
            if not claimed and not any(self.active.values()): return count
            time.sleep(poll_seconds)
        raise TimeoutError("Worker did not settle within the explicit bound")

    def close(self):
        self.closed = True
        # Active tasks retain their independent heartbeat until completion.
        # A process-manager forced termination instead uses durable recovery.
        for pool in self.pools.values(): pool.shutdown(wait=True, cancel_futures=False)
        self._reap()


def main():
    parser = argparse.ArgumentParser(description="Consume durable PostgreSQL research tasks")
    parser.add_argument("mode", nargs="?", default="consume", choices=["consume", "recover"])
    parser.add_argument("--once", action="store_true", help="Claim one available batch, finish it and exit")
    parser.add_argument("--poll-seconds", type=float, default=0.25)
    args = parser.parse_args()
    if not 0.05 <= args.poll_seconds <= 5: parser.error("poll-seconds must be between 0.05 and 5")
    worker = runtime()
    if args.mode == "recover":
        worker.recover(); print(json.dumps({"transport": "postgres", "recovered": True})); return
    consumer = PostgresConsumer(worker)
    try:
        if args.once:
            count = consumer.tick()
            consumer.close()
            print(json.dumps({"transport": "postgres", "claimed": count})); return
        while True:
            try: consumer.tick()
            except Exception:
                print("Workflow consumer unavailable; durable outbox retained.", flush=True)
            time.sleep(args.poll_seconds)
    except KeyboardInterrupt:
        return
    finally:
        if not consumer.closed: consumer.close()


if __name__ == "__main__": main()
