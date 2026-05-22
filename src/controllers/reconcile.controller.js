'use strict';

const { v4: uuidv4 } = require('uuid');
const config = require('../config');
const ReconciliationRun = require('../models/ReconciliationRun');
const ReportEntry = require('../models/ReportEntry');
const { ingestCSVs } = require('../services/ingestion.service');
const { runMatching } = require('../services/matching.service');
const { generateReport } = require('../services/report.service');
const logger = require('../utils/logger');

/**
 * Runs the full reconciliation pipeline in the background.
 * Updates the ReconciliationRun document on completion or failure.
 *
 * @param {string} runId
 * @param {Object} runConfig
 */
async function _runPipeline(runId, runConfig) {
  try {
    // Ingestion
    const ingestionStats = await ingestCSVs(runId);

    // Matching
    const matchResults = await runMatching(runId, runConfig);

    // Report generation
    const { summary, csvPath } = await generateReport(runId, matchResults);

    // Update run with final state
    await ReconciliationRun.findOneAndUpdate(
      { runId },
      {
        status: 'completed',
        summary: {
          ...summary,
          totalUser: ingestionStats.totalUser,
          totalExchange: ingestionStats.totalExchange,
          flaggedUser: ingestionStats.flaggedUser,
          flaggedExchange: ingestionStats.flaggedExchange,
        },
        reportCsvPath: csvPath,
        completedAt: new Date(),
      }
    );

    logger.info(`[controller] Run ${runId} completed successfully`);
  } catch (err) {
    logger.error(`[controller] Run ${runId} failed: ${err.message}`, {
      stack: err.stack,
    });
    await ReconciliationRun.findOneAndUpdate(
      { runId },
      {
        status: 'failed',
        errorMessage: err.message,
        completedAt: new Date(),
      }
    );
  }
}

/**
 * POST /api/reconcile
 * Accepts optional { timestampToleranceSeconds, quantityTolerancePct } in body.
 * Returns 202 immediately; pipeline runs asynchronously.
 */
async function postReconcile(req, res) {
  try {
    const runConfig = {
      timestampToleranceSeconds:
        req.body?.timestampToleranceSeconds !== undefined
          ? parseInt(req.body.timestampToleranceSeconds, 10)
          : config.timestampToleranceSeconds,
      quantityTolerancePct:
        req.body?.quantityTolerancePct !== undefined
          ? parseFloat(req.body.quantityTolerancePct)
          : config.quantityTolerancePct,
    };

    // Validate config values
    if (
      isNaN(runConfig.timestampToleranceSeconds) ||
      runConfig.timestampToleranceSeconds < 0
    ) {
      return res.status(400).json({
        error: true,
        message: 'timestampToleranceSeconds must be a non-negative number',
        code: 'INVALID_CONFIG',
      });
    }
    if (
      isNaN(runConfig.quantityTolerancePct) ||
      runConfig.quantityTolerancePct < 0
    ) {
      return res.status(400).json({
        error: true,
        message: 'quantityTolerancePct must be a non-negative number',
        code: 'INVALID_CONFIG',
      });
    }

    const runId = uuidv4();

    // Create the run record
    await ReconciliationRun.create({
      runId,
      status: 'running',
      config: runConfig,
      startedAt: new Date(),
    });

    // Fire-and-forget pipeline
    _runPipeline(runId, runConfig).catch((err) => {
      // Safety net — errors are also handled inside _runPipeline
      logger.error(`[controller] Unhandled pipeline error for run ${runId}: ${err.message}`);
    });

    return res.status(202).json({
      runId,
      status: 'running',
      message: 'Reconciliation started. Use GET /api/report/:runId/summary to poll status.',
    });
  } catch (err) {
    logger.error(`[postReconcile] ${err.message}`, { stack: err.stack });
    return res.status(500).json({
      error: true,
      message: 'Failed to start reconciliation',
      code: 'INTERNAL_ERROR',
    });
  }
}

/**
 * GET /api/report/:runId
 * Returns all ReportEntry documents for the run as a JSON array.
 */
async function getReport(req, res) {
  try {
    const { runId } = req.params;

    const run = await ReconciliationRun.findOne({ runId }).lean();
    if (!run) {
      return res.status(404).json({
        error: true,
        message: `Run ${runId} not found`,
        code: 'RUN_NOT_FOUND',
      });
    }

    const entries = await ReportEntry.find({ runId }).lean();

    return res.status(200).json({
      runId,
      status: run.status,
      totalEntries: entries.length,
      entries,
    });
  } catch (err) {
    logger.error(`[getReport] ${err.message}`, { stack: err.stack });
    return res.status(500).json({
      error: true,
      message: 'Failed to retrieve report',
      code: 'INTERNAL_ERROR',
    });
  }
}

/**
 * GET /api/report/:runId/summary
 * Returns the ReconciliationRun document (runId, status, summary, config, timestamps).
 */
async function getReportSummary(req, res) {
  try {
    const { runId } = req.params;

    const run = await ReconciliationRun.findOne({ runId }).lean();
    if (!run) {
      return res.status(404).json({
        error: true,
        message: `Run ${runId} not found`,
        code: 'RUN_NOT_FOUND',
      });
    }

    return res.status(200).json({
      runId: run.runId,
      status: run.status,
      summary: run.summary,
      config: run.config,
      reportCsvPath: run.reportCsvPath,
      errorMessage: run.errorMessage || null,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
      createdAt: run.createdAt,
    });
  } catch (err) {
    logger.error(`[getReportSummary] ${err.message}`, { stack: err.stack });
    return res.status(500).json({
      error: true,
      message: 'Failed to retrieve summary',
      code: 'INTERNAL_ERROR',
    });
  }
}

/**
 * GET /api/report/:runId/unmatched
 * Returns only unmatched_user and unmatched_exchange entries.
 */
async function getUnmatched(req, res) {
  try {
    const { runId } = req.params;

    const run = await ReconciliationRun.findOne({ runId }).lean();
    if (!run) {
      return res.status(404).json({
        error: true,
        message: `Run ${runId} not found`,
        code: 'RUN_NOT_FOUND',
      });
    }

    const entries = await ReportEntry.find({
      runId,
      category: { $in: ['unmatched_user', 'unmatched_exchange'] },
    }).lean();

    return res.status(200).json({
      runId,
      status: run.status,
      totalUnmatched: entries.length,
      entries: entries.map((e) => ({
        category: e.category,
        reason: e.reason,
        userTxId: e.userTxId,
        exchangeTxId: e.exchangeTxId,
        row: e.userRow || e.exchangeRow,
      })),
    });
  } catch (err) {
    logger.error(`[getUnmatched] ${err.message}`, { stack: err.stack });
    return res.status(500).json({
      error: true,
      message: 'Failed to retrieve unmatched entries',
      code: 'INTERNAL_ERROR',
    });
  }
}

module.exports = {
  postReconcile,
  getReport,
  getReportSummary,
  getUnmatched,
};
