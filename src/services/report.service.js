'use strict';

const ReportEntry = require('../models/ReportEntry');
const ReconciliationRun = require('../models/ReconciliationRun');
const { csvToString } = require('../utils/csvWriter');
const logger = require('../utils/logger');

/**
 * Persists all match results to MongoDB, computes summary counts, and
 * stores the CSV report as a string on the ReconciliationRun document.
 * No filesystem writes — compatible with ephemeral hosts like Render.
 *
 * @param {string}   runId
 * @param {Object[]} matchResults  Array returned by runMatching()
 * @returns {Promise<Object>} { summary }
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

  const csvContent = await csvToString(csvRows);

  await ReconciliationRun.findOneAndUpdate(
    { runId },
    { reportCsv: csvContent }
  );

  logger.info(`[report] CSV content stored in MongoDB for run ${runId}`);

  return { summary };
}

module.exports = { generateReport };
