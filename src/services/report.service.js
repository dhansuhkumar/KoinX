'use strict';

const path = require('path');
const fs = require('fs');
const ReportEntry = require('../models/ReportEntry');
const { writeCsv } = require('../utils/csvWriter');
const logger = require('../utils/logger');

const REPORTS_DIR = path.join(__dirname, '../../reports');

/**
 * Persists all match results to MongoDB, computes summary counts, and
 * writes a flat CSV report to disk.
 *
 * @param {string}   runId
 * @param {Object[]} matchResults  Array returned by runMatching()
 * @returns {Promise<Object>} { summary, csvPath }
 */
async function generateReport(runId, matchResults) {
  logger.info(
    `[report] Generating report for run ${runId} (${matchResults.length} entries)`
  );

  const docs = matchResults.map((r) => ({
    runId,
    category: r.category,
    reason: r.reason,
    userTxId: r.userTxId || null,
    exchangeTxId: r.exchangeTxId || null,
    userRow: r.userRow || null,
    exchangeRow: r.exchangeRow || null,
    conflictDetails: r.conflictDetails || null,
  }));

  await ReportEntry.insertMany(docs, { ordered: false });
  logger.info(`[report] Inserted ${docs.length} ReportEntry documents`);

  const summary = {
    matched: matchResults.filter((r) => r.category === 'matched').length,
    conflicting: matchResults.filter((r) => r.category === 'conflicting').length,
    unmatchedUser: matchResults.filter((r) => r.category === 'unmatched_user').length,
    unmatchedExchange: matchResults.filter(
      (r) => r.category === 'unmatched_exchange'
    ).length,
  };

  const csvRows = matchResults.map((r) => {
    const uRow = r.userRow || {};
    const eRow = r.exchangeRow || {};
    const cd = r.conflictDetails || {};

    return {
      category: r.category,
      reason: r.reason,

      user_tx_id: r.userTxId || '',
      user_timestamp: uRow.timestamp || uRow.date || uRow.time || '',
      user_type: uRow.type || uRow.transaction_type || '',
      user_asset: uRow.asset || uRow.coin || uRow.currency || '',
      user_quantity: uRow.quantity || uRow.amount || uRow.qty || '',

      exchange_tx_id: r.exchangeTxId || '',
      exchange_timestamp: eRow.timestamp || eRow.date || eRow.time || '',
      exchange_type: eRow.type || eRow.transaction_type || '',
      exchange_asset: eRow.asset || eRow.coin || eRow.currency || '',
      exchange_quantity: eRow.quantity || eRow.amount || eRow.qty || '',

      conflict_field: cd.field || '',
      conflict_user_value: cd.userValue !== undefined
        ? JSON.stringify(cd.userValue)
        : '',
      conflict_exchange_value: cd.exchangeValue !== undefined
        ? JSON.stringify(cd.exchangeValue)
        : '',
      conflict_delta: cd.delta !== undefined
        ? JSON.stringify(cd.delta)
        : '',
    };
  });

  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  const csvPath = path.join(REPORTS_DIR, `${runId}.csv`);
  await writeCsv(csvPath, csvRows);

  logger.info(`[report] CSV written to ${csvPath}`);

  return { summary, csvPath };
}

module.exports = { generateReport };
