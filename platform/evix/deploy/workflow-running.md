# PostgreSQL research worker

The first release runs one independent Python worker and PostgreSQL. Celery and RabbitMQ are not required dependencies or default services. FastAPI creates immutable run manifests and transactional outbox rows; it does not execute research jobs in request handlers or browser sessions. Only Python reads and writes the database. Statistics and document generation use the bounded, fixed Node subprocess.

## Setup

Apply migrations as the migration owner, then grant the non-owner API/worker role access to the new tables. Keep the same operator environment, vault keyring, invitation list and database schema across API and workers. The role does not need table ownership, superuser access or BYPASSRLS.

```powershell
docker compose -f deploy/compose.dev.yaml up -d postgres
```

Install the API environment with `uv sync --group dev` and the root Node dependencies with `npm ci`. Set `EVIX_WORKFLOW_ENABLED=true`, `EVIX_WORKFLOW_EXECUTION_PROFILE=first_release` and the absolute Node/executor/catalog paths in `api.env.example`. No broker URL is needed. Node 24.15 supports the registered source entrypoint:

```powershell
node --experimental-strip-types apps/evi-x-platform/scripts/workflow-executor.mjs
```

The entrypoint reads one bounded JSON request from stdin and returns a JSON receipt; it loads the shared TypeScript kernel directly. Worker startup does not require a frontend build. An empty XeLaTeX compiler setting leaves PDF compilation unavailable while source export remains available.

Start the independent worker from `apps/evi-x-api`:

```powershell
.venv/Scripts/python.exe -m evix_api.workflow_worker consume
```

On Linux use `.venv/bin/python` with the same module and arguments. A process manager should restart this process independently of the web API. Multiple consumers may share one schema; PostgreSQL enforces the configured global maximum of four compute tasks and two model tasks. All consumers for the same schema must use the same concurrency settings and executor build.

For a bounded deployment smoke check, `consume --once` claims one available batch, waits for those attempts and exits. It prints the actual claim count; zero means no task was claimed. Descendants scheduled by completion remain in the outbox for the next batch. `python -m evix_api.workflow_worker recover` performs one recovery sweep without executing a task.

## Claim and recovery contract

The consumer claims due outbox rows with `SELECT FOR UPDATE SKIP LOCKED`. Within the same short transaction it reserves global capacity, persists a node attempt lease/token and records dispatch. It commits before starting Node or model I/O. A node first enters internal `claimed` state (shown as queued in the API), then atomically transitions to running. Duplicate delivery of the same claim cannot start it twice.

A process killed after claim but before execution leaves a recoverable leased record. The independent recovery sweep runs every two seconds. Expired attempts with no outstanding external call receive a new attempt and token. Long healthy tasks renew their leases at most every twenty seconds. Expired, cancelled or replaced tokens cannot renew, publish files or apply results. Old completions remain fenced even when a new attempt is already running.

Before external I/O, the worker commits a dispatched call receipt with the exact personal service revision and input hash. An interrupted dispatched call becomes `outcome_unknown`; it is never automatically resent. Completed receipts are reused when an interrupted multi-persona task resumes. These mechanisms prevent automatic replay of uncertain requests; they do not promise exactly-once execution at an external vendor. A late result is retained for reconciliation and does not silently change an expired receipt to success.

Each operation checks the initiating user's invitation, project membership and personal service ownership again. Cancellation prevents new calls and result publication. A worker uses a private application database context only for discovery and revocation receipts; request handlers never set that context.

Graceful shutdown stops new claims and lets active tasks finish with their independent lease heartbeat. Forced termination is handled by persisted lease recovery. Provider calls and Node processes have their own explicit timeouts; there is no browser-lifetime fallback.

## First-release scope

The default catalog and execution validator defer condition nodes, named-result collection nodes, survey collection waits and control edges. Survey collection stays in the existing survey UI; users lock/upload an immutable dataset version before running analysis. Data edges and reference edges are supported. Existing drafts containing deferred capabilities remain readable and saveable, but execution reports concrete deferred-capability issues. The explicit `extended` profile preserves internal WIP regression coverage and is not the first-release deployment profile.

Raw tables remain in private immutable dataset versions. Events and run responses expose references, aggregate results and diagnostics. Graph definitions contain no keys, CSV or raw answers. Export files are private project-scoped database blobs with SHA-256 receipts; a future storage adapter can preserve the same authenticated contract. A changed executor/catalog build blocks continuation of an old run until its recorded build is restored or a new run is created.

Monitor queued age, claim/lease age, recovery counts, unknown calls, failed attempts and export errors. Back up PostgreSQL together with the executor build matching each frozen run manifest. The optional Celery adapter is preserved in `workflow_celery.py` behind the `celery` package extra and Compose `optional-celery` profile for future transport work; do not run it alongside the PostgreSQL consumer for the same schema.

The locking implementation follows [PostgreSQL's queue-consumer guidance for SKIP LOCKED](https://www.postgresql.org/docs/17/sql-select.html#SQL-FOR-UPDATE-SHARE) and [SQLAlchemy's with_for_update API](https://docs.sqlalchemy.org/en/20/core/selectable.html#sqlalchemy.sql.expression.GenerativeSelect.with_for_update).
