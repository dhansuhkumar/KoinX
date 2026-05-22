'use strict';

const path = require('path');
const fs = require('fs');
const { parse } = require('csv-parse');
const Transaction = require('../models/Transaction');
const logger = require('../utils/logger');
const {
  normalizeAsset,
  normalizeType,
  parseTimestamp,
  parseQuantity,
} = require('../utils/normalizer');

const USER_CSV = path.join(__dirname, '../../data/user_transactions.csv');
const EXCHANGE_CSV = path.join(
  __dirname,
  '../../data/exchange_transactions.csv'
);

/**
 * Parse a single CSV file and return an array of raw row objects.
 * @param {string} filepath
 * @returns {Promise<Object[]>}
 */
function parseCSV(filepath) {
  return new Promise((resolve, reject) => {
    const rows = [];
    const parser = fs.createReadStream(filepath).pipe(
      parse({
        columns: true,
        skip_empty_lines: true,
        trim: true,
        relax_column_count: true,
      })
    );

    parser.on('readable', () => {
      let row;
      while ((row = parser.read()) !== null) {
        rows.push(row);
      }
    });

    parser.on('error', (err) => {
      reject(
        new Error(
          `Failed to parse CSV at ${filepath}: ${err.message}`
        )
      );
    });

    parser.on('end', () => resolve(rows));
  });
}

/**
 * Apply all data quality checks to a parsed row, returning an object
 * ready to be inserted into MongoDB as a Transaction document.
 *
 * Rules (exhaustive — see STEP 12):
 *  1. Missing / unparseable / future timestamp
 *  2. Missing / zero / negative / non-numeric quantity
 *  3. Unknown transaction type
 *  4. Missing asset
 *  5. Missing transaction_id
 *  6. price_per_unit inconsistency (quantity × price ≠ total_value by >1%)
 *  7. Duplicate transaction_id within the source (flagged externally)
 *
 * @param {Object}  rawRow      The raw CSV row
 * @param {string}  source      'user' | 'exchange'
 * @param {string}  runId
 * @param {number}  rowIndex    0-based index within the file
 * @param {Set}     seenTxIds   Set of txIds already seen for this source (mutated)
 * @param {Set}     dupTxIds    Set of txIds known to be duplicates (mutated)
 * @returns {Object}  Transaction document data (not yet saved)
 */
function buildTransactionDoc(rawRow, source, runId, rowIndex, seenTxIds, dupTxIds) {
  const issues = [];

  // --- Timestamp ---
  const rawTs = rawRow['timestamp'] || rawRow['date'] || rawRow['time'] || '';
  const timestamp = parseTimestamp(rawTs);

  if (!timestamp) {
    issues.push('Invalid or missing timestamp');
  } else {
    const oneDayAhead = new Date(Date.now() + 24 * 60 * 60 * 1000);
    if (timestamp > oneDayAhead) {
      issues.push(
        `Future timestamp detected: ${timestamp.toISOString()}`
      );
    }
  }

  // --- Quantity ---
  const rawQty =
    rawRow['quantity'] ||
    rawRow['amount'] ||
    rawRow['qty'] ||
    '';
  const quantity = parseQuantity(rawQty);

  if (quantity === null) {
    issues.push('Invalid or missing quantity');
  } else if (quantity === 0) {
    issues.push('Quantity is zero');
  } else if (quantity < 0) {
    issues.push(`Quantity is negative: ${quantity}`);
  }

  // --- Type ---
  const rawType =
    rawRow['type'] ||
    rawRow['transaction_type'] ||
    rawRow['tx_type'] ||
    '';
  const type = normalizeType(rawType);
  if (!type) {
    issues.push(
      `Unknown transaction type: ${rawType || '(blank)'}`
    );
  }

  // --- Asset ---
  const rawAsset =
    rawRow['asset'] ||
    rawRow['coin'] ||
    rawRow['currency'] ||
    rawRow['crypto'] ||
    '';
  const asset = normalizeAsset(rawAsset);
  if (!asset) {
    issues.push('Missing asset');
  }

  // --- Transaction ID ---
  const txId =
    (
      rawRow['transaction_id'] ||
      rawRow['tx_id'] ||
      rawRow['txid'] ||
      rawRow['id'] ||
      ''
    ).trim() || null;

  if (!txId) {
    issues.push('Missing transaction_id');
  } else {
    // Rule 7: duplicate txId within same source
    if (seenTxIds.has(txId)) {
      dupTxIds.add(txId);
      issues.push(`Duplicate transaction_id within source: ${txId}`);
    } else {
      seenTxIds.add(txId);
    }
  }

  // --- price_per_unit consistency check (Rule 6) ---
  const pricePerUnit = parseQuantity(
    rawRow['price_per_unit'] ||
      rawRow['price'] ||
      rawRow['unit_price'] ||
      ''
  );
  const totalValue = parseQuantity(
    rawRow['total_value'] ||
      rawRow['total'] ||
      rawRow['amount_usd'] ||
      ''
  );

  if (
    pricePerUnit !== null &&
    totalValue !== null &&
    quantity !== null &&
    quantity !== 0
  ) {
    const implied = quantity * pricePerUnit;
    const pctDiff = Math.abs(implied - totalValue) / Math.abs(totalValue);
    if (pctDiff > 0.01) {
      issues.push(
        `Data inconsistency: quantity(${quantity}) × price_per_unit(${pricePerUnit}) = ${implied.toFixed(4)} but total_value = ${totalValue} (diff ${(pctDiff * 100).toFixed(2)}%)`
      );
    }
  }

  const isFlagged = issues.length > 0;

  if (isFlagged) {
    logger.warn(
      `[${source}] Row ${rowIndex + 1} flagged — ${issues.join(' | ')}`
    );
  }

  return {
    runId,
    source,
    rawRow,
    txId,
    timestamp,
    type,
    asset,
    quantity,
    currency:
      (rawRow['currency'] || rawRow['quote_currency'] || '').trim() || null,
    pricePerUnit,
    totalValue,
    fee: parseQuantity(rawRow['fee'] || rawRow['fees'] || ''),
    wallet: (rawRow['wallet'] || rawRow['address'] || '').trim() || null,
    notes: (rawRow['notes'] || rawRow['note'] || rawRow['memo'] || '').trim() || null,
    dataQualityIssues: issues,
    isFlagged,
  };
}

/**
 * Re-scan already-built docs to flag the FIRST occurrence of any txId
 * that was later found to be a duplicate (Rule 7 — all duplicates flagged).
 *
 * @param {Object[]} docs
 * @param {Set}      dupTxIds
 */
function retroFlagFirstDuplicates(docs, dupTxIds) {
  if (dupTxIds.size === 0) return;

  // Track which dupTxIds we have already retro-flagged
  const alreadyFlagged = new Set();

  for (const doc of docs) {
    if (doc.txId && dupTxIds.has(doc.txId) && !alreadyFlagged.has(doc.txId)) {
      // This is the first occurrence — it wasn't flagged during initial pass
      const msg = `Duplicate transaction_id within source: ${doc.txId}`;
      if (!doc.dataQualityIssues.includes(msg)) {
        doc.dataQualityIssues.unshift(msg);
        doc.isFlagged = true;
      }
      alreadyFlagged.add(doc.txId);
    }
  }
}

/**
 * Main ingestion function.
 * Reads both CSVs, applies quality checks, bulk-inserts to MongoDB.
 *
 * @param {string} runId
 * @returns {Promise<{totalUser: number, totalExchange: number, flaggedUser: number, flaggedExchange: number}>}
 */
async function ingestCSVs(runId) {
  logger.info(`[ingest] Starting ingestion for run ${runId}`);

  const [userRows, exchangeRows] = await Promise.all([
    parseCSV(USER_CSV),
    parseCSV(EXCHANGE_CSV),
  ]);

  logger.info(
    `[ingest] Parsed ${userRows.length} user rows, ${exchangeRows.length} exchange rows`
  );

  // Build transaction docs with quality checks
  const userSeenIds = new Set();
  const userDupIds = new Set();
  const userDocs = userRows.map((row, i) =>
    buildTransactionDoc(row, 'user', runId, i, userSeenIds, userDupIds)
  );
  retroFlagFirstDuplicates(userDocs, userDupIds);

  const exSeenIds = new Set();
  const exDupIds = new Set();
  const exchangeDocs = exchangeRows.map((row, i) =>
    buildTransactionDoc(row, 'exchange', runId, i, exSeenIds, exDupIds)
  );
  retroFlagFirstDuplicates(exchangeDocs, exDupIds);

  // Bulk insert
  const allDocs = [...userDocs, ...exchangeDocs];
  await Transaction.insertMany(allDocs, { ordered: false });

  const flaggedUser = userDocs.filter((d) => d.isFlagged).length;
  const flaggedExchange = exchangeDocs.filter((d) => d.isFlagged).length;

  logger.info(
    `[ingest] Inserted ${allDocs.length} transactions (flaggedUser=${flaggedUser}, flaggedExchange=${flaggedExchange})`
  );

  return {
    totalUser: userDocs.length,
    totalExchange: exchangeDocs.length,
    flaggedUser,
    flaggedExchange,
  };
}

module.exports = { ingestCSVs };
