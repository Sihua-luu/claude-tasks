CLAUDE-TASKS
============

A distributed job scheduling system designed for Claude integration.
Schedule immediate, one-time, or recurring tasks via REST API or MCP tools.


ARCHITECTURE
------------

  claude-tasks/
  ├── packages/
  │   ├── api/          # Job Scheduling Service (Express + DynamoDB)
  │   ├── worker/       # Watcher & Worker processes (SQS consumer)
  │   └── mcp-server/   # MCP Server (Claude connector)
  ├── infra/            # Terraform IaC for AWS deployment
  └── docs/

Components:

  API Server
    REST API for creating, listing, and cancelling jobs.
    Validates requests with Zod, writes to DynamoDB, enqueues immediate
    jobs directly to SQS.

  Watcher
    Polls the JobRun table every 60 seconds, finds PENDING runs scheduled
    within the next 5 minutes, and dispatches them to SQS. Uses conditional
    writes for claim-and-mark to prevent duplicate dispatch.

  Worker
    Consumes messages from SQS, executes the action, and updates status.
    Supports retry with exponential backoff (max 3 attempts). Extends SQS
    visibility timeout every 30 seconds as a heartbeat. Failed messages
    are routed to a Dead Letter Queue.

  RecurringJobWatcher
    Monitors completed runs for recurring jobs, computes the next execution
    time from the cron schedule, and inserts a new PENDING run with
    idempotent writes.

  MCP Server
    Exposes three tools to Claude via the Model Context Protocol:
      - task.create@v1    Create a scheduled task
      - task.list@v1      Query existing tasks
      - task.cancel@v1    Cancel a task
    Each tool call is forwarded as an HTTP request to the API server.


DATABASE SCHEMA
---------------

Jobs Table (DynamoDB)
  PK: user_id    SK: job_id (ULID)
  Attributes: action, type, time, schedule, created_at, status
  GSI: user_id + created_at (for sorted listing)

JobRun Table (DynamoDB)
  PK: time_bucket (YYYYMMDDHH#S00..S31)    SK: scheduled_at#job_id
  Attributes: run_id, job_id, scheduled_at, status, action, job_type, schedule
  GSI: job_id (for lookup by job)
  The time_bucket uses hour-level partitioning with 32 shard suffixes
  to prevent hot partitions under high write throughput.

RunEvent Table (DynamoDB)
  PK: job_run_id    SK: id (ULID)
  Attributes: created_at, status
  Append-only outbox pattern. Never updated, only inserted.
  Used by RecurringJobWatcher to react to completed runs.


API ENDPOINTS
-------------

POST /v1/jobs
  Create a new job.
  Body:
    {
      "action": "summarize_news",
      "job_params": {
        "type": "immediate" | "one-time" | "recurring",
        "time": "2024-03-15T08:00:00Z",       (one-time only)
        "schedule": "0 8 * * *"                (recurring only)
      }
    }
  Returns: { ok: true, data: { job_id, run_id, status } }

GET /v1/jobs
  List jobs for the current user.
  Query params: status, start_time, end_time, pageSize (1-100), page
  Returns: { ok: true, data: [...], pagination: { next_page } }

POST /v1/jobs/:jobId/cancel
  Cancel a job.
  Returns: { ok: true, data: { job_id, status: "CANCELLED" } }

All errors return structured JSON:
  { ok: false, error: { code, message, field, expected } }


PREREQUISITES
-------------

  - Node.js 20 or later
  - Docker and Docker Compose


GETTING STARTED
---------------

1. Install dependencies:

    cd claude-tasks
    npm install

2. Start local infrastructure (DynamoDB Local + ElasticMQ):

    docker-compose up dynamodb-local elasticmq -d

3. Start the API server (terminal 1):

    npm run dev --workspace=@claude-tasks/api

   The server starts on http://localhost:3000 and auto-creates tables.

4. Start the worker (terminal 2):

    npm run dev --workspace=@claude-tasks/worker

   By default MODE=all runs Watcher + Worker + RecurringJobWatcher.
   Run individual processes:

    MODE=watcher  npm run dev --workspace=@claude-tasks/worker
    MODE=worker   npm run dev --workspace=@claude-tasks/worker
    MODE=recurring npm run dev --workspace=@claude-tasks/worker

5. Test with curl:

    curl -X POST http://localhost:3000/v1/jobs \
      -H "Content-Type: application/json" \
      -d '{"action":"summarize_news","job_params":{"type":"immediate"}}'

    curl http://localhost:3000/v1/jobs

6. Start MCP Server (for Claude Desktop):

    npm run dev --workspace=@claude-tasks/mcp-server

   Add to Claude Desktop config:

    {
      "mcpServers": {
        "claude-tasks": {
          "command": "node",
          "args": ["claude-tasks/packages/mcp-server/dist/index.js"],
          "env": { "API_BASE_URL": "http://localhost:3000" }
        }
      }
    }

7. Or start everything with Docker:

    docker-compose up --build


RUNNING TESTS
-------------

    npm test

66 tests covering:

  - Time bucket formatting and range generation
  - Boundary cases: year/month/day crossings, leap years, DST
  - Cron scheduling: daily, weekly, monthly, leap year Feb 29
  - Input validation: missing fields, invalid formats, enum values
  - Pagination token encoding roundtrip
  - Shard distribution uniformity
  - Sort key lexicographic ordering


PRODUCTION DEPLOYMENT
---------------------

Terraform configuration is provided in infra/main.tf:

  - DynamoDB tables with PAY_PER_REQUEST billing and Point-in-Time Recovery
  - SQS queue with 60s visibility timeout, max 3 receives, 14-day DLQ retention

    cd infra
    terraform init
    terraform apply


KEY DESIGN DECISIONS
--------------------

  NoSQL (DynamoDB)         High write throughput (up to 10K/sec)
  time_bucket partitioning Avoids full table scans, O(log n) query
  Watcher + SQS + Worker   Decouples scheduling from execution
  SQS Visibility Timeout   At-least-once delivery guarantee
  Append-only RunEvent     Reduces race conditions for recurring scheduling
  ULID for job_id          Time-sortable without extra indexes
  MCP tool versioning      Prevents schema changes from breaking cached tools
  32 shard suffixes        Prevents DynamoDB hot partitions under load


TECH STACK
----------

  TypeScript, Node.js, Express, Zod, DynamoDB, SQS, MCP SDK,
  Docker Compose, Terraform, Vitest
