'use strict';

const { Router } = require('express');
const {
  postReconcile,
  getReport,
  getReportSummary,
  getUnmatched,
  downloadReport,
} = require('../controllers/reconcile.controller');

const router = Router();

/**
 * GET /api/health
 * Liveness probe used by Render (and any uptime monitor) to confirm the
 * service is running and accepting connections.
 */
router.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

/**
 * POST /api/reconcile
 * Start a new reconciliation run.
 * Body (optional): { timestampToleranceSeconds, quantityTolerancePct }
 */
router.post('/reconcile', postReconcile);

/**
 * GET /api/report/:runId/summary
 * Get status and summary counts for a run.
 * NOTE: Registered before /report/:runId to avoid route shadowing.
 */
router.get('/report/:runId/summary', getReportSummary);

/**
 * GET /api/report/:runId/unmatched
 * Get only unmatched_user and unmatched_exchange entries for a run.
 */
router.get('/report/:runId/unmatched', getUnmatched);

/**
 * GET /api/report/:runId/download
 * Download the reconciliation report as a CSV file attachment.
 */
router.get('/report/:runId/download', downloadReport);

/**
 * GET /api/report/:runId
 * Get all report entries for a run as JSON.
 */
router.get('/report/:runId', getReport);

module.exports = router;
