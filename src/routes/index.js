'use strict';

const { Router } = require('express');
const {
  postReconcile,
  getReport,
  getReportSummary,
  getUnmatched,
} = require('../controllers/reconcile.controller');

const router = Router();

/**
 * POST /api/reconcile
 * Start a new reconciliation run.
 * Body (optional): { timestampToleranceSeconds, quantityTolerancePct }
 */
router.post('/reconcile', postReconcile);

/**
 * GET /api/report/:runId/summary
 * Get status and summary counts for a run.
 * NOTE: Must be registered before /report/:runId to avoid route shadowing.
 */
router.get('/report/:runId/summary', getReportSummary);

/**
 * GET /api/report/:runId/unmatched
 * Get only unmatched_user and unmatched_exchange entries for a run.
 */
router.get('/report/:runId/unmatched', getUnmatched);

/**
 * GET /api/report/:runId
 * Get all report entries for a run.
 */
router.get('/report/:runId', getReport);

module.exports = router;
