# KoinX Transaction Reconciliation Engine

A production-grade Node.js backend that ingests two CSV files of crypto transactions (one from a user, one from an exchange), matches them intelligently with configurable tolerances, and exposes a REST API to trigger reconciliation runs and query the resulting reports.

---

## Overview

The engine solves a common crypto accounting problem: a user's local transaction records rarely match the exchange's records perfectly. Timestamps drift, quantities differ slightly, and the same transfer appears as a "send" on one side and a "receive" on the other. This system:

1. **Ingests** both CSVs into MongoDB, flagging (but never dropping) rows with data quality issues.
2. **Matches** transactions in two phases — exact ID match first, then proximity match on asset + type + timestamp + quantity.
3. **Reports** every pair as `matched`, `conflicting`, `unmatched_user`, or `unmatched_exchange`, writing both a MongoDB collection and a flat CSV report.

---

## Setup

### Prerequisites

- Node.js v18 or later
- MongoDB 6+ running locally (or a MongoDB Atlas connection string)
- npm v9+

### Installation

```bash
git clone [<repo-url>](https://github.com/dhansuhkumar/KoinX.git)
cd reconciliation-engine
npm install
```

### Environment

```bash
cp .env.example .env
# Edit .env with your values
```

`.env` variables:

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | HTTP server port |
| `MONGODB_URI` | `mongodb://localhost:27017/koinx_reconciliation` | MongoDB connection string |
| `TIMESTAMP_TOLERANCE_SECONDS` | `300` | Max timestamp difference (seconds) for a proximity match |
| `QUANTITY_TOLERANCE_PCT` | `0.01` | Max quantity difference as a decimal fraction (0.01 = 1%) |

### MongoDB Setup

Start MongoDB locally:

```bash
# macOS/Linux (Homebrew)
brew services start mongodb-community

# Windows
net start MongoDB
```

Or use Docker:

```bash
docker run -d -p 27017:27017 --name mongo mongo:6
```

---

## Running

```bash
# Development (auto-restart on file changes)
npm run dev

# Production
npm start
```

On startup you will see:
```
[2024-01-15 10:00:00] info: MongoDB connected: mongodb://localhost:27017/koinx_reconciliation
[2024-01-15 10:00:00] info: KoinX Reconciliation Engine running on port 3000
```

---

## API Reference

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/reconcile` | Start a new reconciliation run (async, returns 202) |
| `GET` | `/api/report/:runId/summary` | Run status, config, and aggregate counts |
| `GET` | `/api/report/:runId/unmatched` | All unmatched_user and unmatched_exchange entries |
| `GET` | `/api/report/:runId/download` | Download the full report as a CSV file attachment |
| `GET` | `/api/report/:runId` | All report entries as JSON |
| `GET` | `/api/health` | Liveness probe — returns `{ status: "ok", timestamp }` |


### 1. Start a Reconciliation Run

**`POST /api/reconcile`**

Triggers a new reconciliation run asynchronously. Returns immediately with the `runId`.

**Request body** (all fields optional — overrides global `.env` config for this run only):

```json
{
  "timestampToleranceSeconds": 600,
  "quantityTolerancePct": 0.02
}
```

**Response `202 Accepted`:**

```json
{
  "runId": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "status": "running",
  "message": "Reconciliation started. Use GET /api/report/:runId/summary to poll status."
}
```

---

### 2. Get Run Summary

**`GET /api/report/:runId/summary`**

Returns the run's status, configuration, and aggregate counts.

**Response `200 OK`:**

```json
{
  "runId": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "status": "completed",
  "summary": {
    "matched": 14,
    "conflicting": 2,
    "unmatchedUser": 5,
    "unmatchedExchange": 3,
    "totalUser": 26,
    "totalExchange": 22,
    "flaggedUser": 6,
    "flaggedExchange": 0
  },
  "config": {
    "timestampToleranceSeconds": 300,
    "quantityTolerancePct": 0.01
  },
  "reportCsvPath": "/path/to/reports/f47ac10b-....csv",
  "errorMessage": null,
  "startedAt": "2024-01-15T10:00:00.000Z",
  "completedAt": "2024-01-15T10:00:02.500Z"
}
```

**Response `404 Not Found`:**

```json
{
  "error": true,
  "message": "Run f47ac10b not found",
  "code": "RUN_NOT_FOUND"
}
```

---

### 3. Get Full Report

**`GET /api/report/:runId`**

Returns all `ReportEntry` documents (matched, conflicting, unmatched) for the run.

**Response `200 OK`:**

```json
{
  "runId": "f47ac10b-...",
  "status": "completed",
  "totalEntries": 24,
  "entries": [
    {
      "_id": "...",
      "runId": "f47ac10b-...",
      "category": "matched",
      "reason": "Matched by transaction_id",
      "userTxId": "65abc...",
      "exchangeTxId": "65def...",
      "userRow": { "transaction_id": "TXN-U-001", ... },
      "exchangeRow": { "transaction_id": "TXN-U-001", ... },
      "conflictDetails": null
    },
    {
      "category": "conflicting",
      "reason": "ID match found but quantity out of tolerance",
      "conflictDetails": {
        "field": "quantity",
        "userValue": 0.25,
        "exchangeValue": 0.255,
        "delta": 0.005
      }
    }
  ]
}
```

---

### 4. Get Unmatched Entries

**`GET /api/report/:runId/unmatched`**

Returns only `unmatched_user` and `unmatched_exchange` entries.

**Response `200 OK`:**

```json
{
  "runId": "f47ac10b-...",
  "status": "completed",
  "totalUnmatched": 8,
  "entries": [
    {
      "category": "unmatched_user",
      "reason": "No matching exchange transaction found",
      "userTxId": "65abc...",
      "exchangeTxId": null,
      "row": { "transaction_id": "TXN-U-021", ... }
    },
    {
      "category": "unmatched_exchange",
      "reason": "No matching user transaction found",
      "userTxId": null,
      "exchangeTxId": "65def...",
      "row": { "transaction_id": "EX-ONLY-001", ... }
    }
  ]
}
```

---

### 5. Download Report as CSV

**`GET /api/report/:runId/download`**

Returns the reconciliation report as a downloadable CSV file. The CSV is stored in MongoDB — no filesystem access required.

**Response `200 OK`** — `Content-Type: text/csv`, `Content-Disposition: attachment; filename="report-<runId>.csv"`

**Response `404 Not Found`** (run not found or pipeline still running):

```json
{
  "error": true,
  "message": "Report not available"
}
```

---

### 6. Health Check

**`GET /api/health`**

Liveness probe used by Render and uptime monitors.

**Response `200 OK`:**

```json
{
  "status": "ok",
  "timestamp": "2024-01-15T10:00:00.000Z"
}
```

---

## Configuration

All tolerances can be set globally via `.env` or overridden per-run via the request body to `POST /api/reconcile`.

| Setting | Default | Meaning |
|---|---|---|
| `timestampToleranceSeconds` | `300` | Two timestamps are considered matching if they differ by ≤ this many seconds |
| `quantityTolerancePct` | `0.01` | Two quantities are considered matching if `abs(a-b) / max(a,b) ≤ this value` |

---

## Data Quality Handling

Every row from both CSVs is **always stored in MongoDB**. No row is silently dropped. Rows failing any check receive:

- A non-empty `dataQualityIssues` array listing every problem found.
- `isFlagged: true`.
- A `warn`-level log entry.

### Exhaustive Flag Conditions

| Condition | Issue String |
|---|---|
| Timestamp is blank or unparseable | `"Invalid or missing timestamp"` |
| Timestamp is more than 1 day in the future | `"Future timestamp detected: <ISO>"` |
| Quantity is blank or non-numeric | `"Invalid or missing quantity"` |
| Quantity is zero | `"Quantity is zero"` |
| Quantity is negative | `"Quantity is negative: <value>"` |
| Type is blank or not in the known map | `"Unknown transaction type: <raw>"` |
| Asset is blank | `"Missing asset"` |
| `transaction_id` is blank | `"Missing transaction_id"` |
| `quantity × price_per_unit ≠ total_value` by > 1% | `"Data inconsistency: ..."` |
| Duplicate `transaction_id` within same source | `"Duplicate transaction_id within source: <id>"` — **all** occurrences are flagged, including the first |

Flagged rows **still participate in matching** unless they lack the minimum fields (asset, type, timestamp, quantity) needed for proximity matching.

---

## Matching Algorithm

### Phase 1 — ID-based Matching

For every user transaction that has a non-empty `txId`:

1. Look up exchange transactions with the same `txId` in O(1) via an in-memory Map.
2. If found, check quantity and timestamp against configured tolerances.
3. Both within tolerance → `matched`.
4. Either out of tolerance → `conflicting` with a `conflictDetails` object.
5. Both sides are marked used and excluded from Phase 2.

**Why ID-first?** Transaction IDs are the most reliable signal. Relying on them first prevents weaker proximity matches from stealing pairs that have an explicit ID link.

### Phase 2 — Proximity-based Matching

For all remaining (unused) user transactions:

1. **Filter** exchange candidates by:
   - Same normalized `asset` ticker.
   - `type` is identical **OR** a perspective match (see below).
   - Both have valid timestamps within `timestampToleranceSeconds`.
   - Both have valid quantities within `quantityTolerancePct`.
2. **Zero candidates** → `unmatched_user`.
3. **One candidate** → `matched` (or `conflicting` if an edge-case tolerance breach is detected).
4. **Multiple candidates** → pick the one with the **smallest timestamp delta**.

### TRANSFER_IN ↔ TRANSFER_OUT Perspective Matching

A user sending BTC records it as `TRANSFER_OUT`. The exchange receiving it records it as `TRANSFER_IN`. These are the same economic event viewed from opposite ends. The `typesArePerspectiveMatch()` function returns `true` for this pair in either direction, ensuring such transactions are correctly reconciled rather than left unmatched.

### Phase 3 — Remaining Exchange Transactions

Any exchange transaction not consumed by Phase 1 or 2 becomes an `unmatched_exchange` entry.

### Conflict Detection

A pair is `conflicting` (rather than `matched`) when a valid match is found but one or both tolerance checks fail. The `conflictDetails` object specifies:

```json
{
  "field": "quantity" | "timestamp" | "both",
  "userValue": ...,
  "exchangeValue": ...,
  "delta": ...
}
```

This preserves the match relationship while surfacing the discrepancy for human review.

---

## Key Design Decisions

### 1. Rows are never dropped — only flagged

Silently dropping bad rows would hide data from the reconciliation result, potentially causing false "unmatched" on the other side and making audits impossible. By storing every row and attaching a `dataQualityIssues` list, operators can:
- See the full picture in reports.
- Investigate and correct source data.
- Re-run reconciliation after a fix without losing historical context.

### 2. Reconciliation runs asynchronously

CSV ingestion, matching across potentially thousands of rows, MongoDB writes, and CSV report generation are all I/O-heavy. Running them synchronously would block the HTTP response for seconds or minutes and risk timeout errors. The API returns a `202 Accepted` immediately with a `runId`, and the pipeline fires in the background. Clients poll `GET /api/report/:runId/summary` to check `status`.

### 3. TRANSFER_IN ↔ TRANSFER_OUT perspective matching

Cross-party transfers always appear as opposite types on each side. Treating type equality as the only match condition would leave all transfers unmatched. The `typesArePerspectiveMatch()` utility handles this explicitly so that the matching engine sees through the perspective difference.

### 4. Smallest timestamp delta wins on ties

When multiple exchange candidates pass all filters for a single user transaction, choosing arbitrarily could produce incorrect pairs (or worse, steal a candidate from a different user transaction). Picking the one with the smallest timestamp delta is the most principled heuristic — it selects the temporally closest event, which is most likely to be the true counterpart.

### 5. MongoDB schema: three collections

| Collection | Purpose |
|---|---|
| `transactions` | Raw + normalized rows from both CSVs; the source of truth for all field values |
| `reconciliationruns` | One document per run; tracks lifecycle (status, config, summary, CSV path) |
| `reportentries` | One document per matched/unmatched pair; links user↔exchange transactions by `_id`; stores row snapshots for independent querying without joins |

Splitting into three collections provides:
- **Independent queryability** — the report API doesn't need to join across collections.
- **Auditability** — raw transaction data is preserved separately from the matching outcome.
- **Re-runnability** — running reconciliation again creates a new `runId` and a new set of entries without overwriting old data.

### 6. Per-run config overrides

Global tolerances in `.env` act as system-wide defaults. Each `POST /api/reconcile` can override them via the request body. The chosen values are snapshotted into the `ReconciliationRun.config` field so that the exact parameters used for every run are permanently recorded — critical for audit trails and reproducibility.

---

## Output CSV Report

The CSV report is generated after each run and stored as a string in the `ReconciliationRun` document in MongoDB (field: `reportCsv`). Download it via `GET /api/report/:runId/download`. No filesystem writes occur.

Columns:

| Column | Description |
|---|---|
| `category` | `matched` / `conflicting` / `unmatched_user` / `unmatched_exchange` |
| `reason` | Human-readable explanation |
| `user_tx_id` | MongoDB `_id` of the user Transaction |
| `user_timestamp` | Raw timestamp from user CSV |
| `user_type` | Raw type from user CSV |
| `user_asset` | Raw asset from user CSV |
| `user_quantity` | Raw quantity from user CSV |
| `exchange_tx_id` | MongoDB `_id` of the exchange Transaction |
| `exchange_timestamp` | Raw timestamp from exchange CSV |
| `exchange_type` | Raw type from exchange CSV |
| `exchange_asset` | Raw asset from exchange CSV |
| `exchange_quantity` | Raw quantity from exchange CSV |
| `conflict_field` | `quantity` / `timestamp` / `both` (conflicting entries only) |
| `conflict_user_value` | User-side value that is out of tolerance |
| `conflict_exchange_value` | Exchange-side value that is out of tolerance |
| `conflict_delta` | Absolute difference |

---

## Logs

Logs are written to `logs/` (git-ignored):

| File | Contents |
|---|---|
| `logs/combined.log` | All levels (JSON format) |
| `logs/error.log` | Errors only (JSON format) |

Console output is colorized and human-readable.

---

## Deploying to Render

### Prerequisites

1. Create a free [MongoDB Atlas](https://mongodb.com/atlas) account and spin up a free **M0** cluster.
2. Under **Database Access**, create a database user with read/write permissions.
3. Under **Network Access**, add `0.0.0.0/0` to allow connections from any IP.
4. Go to **Connect → Drivers**, copy the connection string, and replace `<password>` with your user's password.

### Steps

1. Push this repository to a public GitHub repo.
2. Sign up at [render.com](https://render.com) (free tier is sufficient).
3. Click **New → Web Service** and connect your GitHub repo.
4. Render auto-detects `render.yaml` — confirm **Build Command** `npm install` and **Start Command** `npm start`.
5. Under **Environment Variables**, set `MONGODB_URI` to your Atlas connection string.
6. Click **Deploy**. The service will be live in 2–3 minutes.

### Testing the live deployment

```bash
# Start a run
curl -X POST https://your-app.onrender.com/api/reconcile

# Poll until status is "completed"
curl https://your-app.onrender.com/api/report/<runId>/summary

# Download the CSV
curl -o report.csv https://your-app.onrender.com/api/report/<runId>/download
```

> **Note:** Render free-tier services spin down after 15 minutes of inactivity. The first request after idle may take ~30 seconds to cold-start.

---

## Version Control Notes

The repository contains 14 commits, each representing one logical unit of work:

| Commit | Message |
|---|---|
| `beaa295` | `chore: initialize project, install dependencies` |
| `168c6d9` | `feat: add mongoose models (Transaction, ReconciliationRun, ReportEntry)` |
| `348248e` | `feat: add config, logger, and normalizer utilities` |
| `585abf4` | `feat: implement CSV ingestion service with data quality flagging` |
| `8d0ef0a` | `feat: implement Phase 1 ID-based matching` |
| `e0c1e88` | `feat: implement Phase 2 proximity-based matching and conflict detection` |
| `120c2f8` | `feat: implement report generation service and CSV writer` |
| `0d94f57` | `feat: add REST API endpoints and controller` |
| `25d320e` | `docs: add README with setup, API reference, and design decisions` |
| `13e8380` | `fix: production-readiness audit — indexes, dead code, magic numbers, flagged-row reason` |
| `29724c9` | `feat: store report CSV in MongoDB instead of filesystem for Render compatibility` |
| `f9868b6` | `feat: add GET /report/:runId/download and GET /health endpoints` |
| `1dc5581` | `chore: add render.yaml for one-click Render deployment` |
| `bd35ad7` | `docs: add Render deployment instructions to README` |

All commit messages follow the `type: description` convention (`feat:`, `chore:`, `fix:`, `docs:`). No squashed "initial commit" or "wip" messages. Each commit leaves the codebase in a working, testable state.
