'use strict';

const Transaction = require('../models/Transaction');
const logger = require('../utils/logger');
const { typesArePerspectiveMatch } = require('../utils/normalizer');

/**
 * Determine if a quantity delta exceeds the configured tolerance.
 * Uses percentage of the larger value to avoid division-by-zero edge cases.
 *
 * @param {number} userQty
 * @param {number} exchQty
 * @param {number} tolerancePct   e.g. 0.01 means 1 %
 * @returns {boolean} true when the delta is WITHIN tolerance (OK)
 */
function quantityWithinTolerance(userQty, exchQty, tolerancePct) {
  const divisor = Math.max(Math.abs(userQty), Math.abs(exchQty));
  if (divisor === 0) return true;
  const pct = Math.abs(userQty - exchQty) / divisor;
  return pct <= tolerancePct;
}

/**
 * Determine if a timestamp delta exceeds the configured tolerance.
 *
 * @param {Date} userTs
 * @param {Date} exchTs
 * @param {number} toleranceSec
 * @returns {boolean} true when WITHIN tolerance
 */
function timestampWithinTolerance(userTs, exchTs, toleranceSec) {
  const diffSec = Math.abs(userTs.getTime() - exchTs.getTime()) / 1000;
  return diffSec <= toleranceSec;
}

/**
 * Build a conflictDetails object describing what field(s) are out of tolerance.
 *
 * @param {Object} userTx
 * @param {Object} exchTx
 * @param {Object} config
 * @returns {{ field, userValue, exchangeValue, delta } | null}
 */
function buildConflictDetails(userTx, exchTx, config) {
  const { timestampToleranceSeconds, quantityTolerancePct } = config;

  const hasValidQty =
    userTx.quantity !== null && exchTx.quantity !== null;
  const hasValidTs =
    userTx.timestamp !== null && exchTx.timestamp !== null;

  const qtyBad =
    hasValidQty &&
    !quantityWithinTolerance(userTx.quantity, exchTx.quantity, quantityTolerancePct);
  const tsBad =
    hasValidTs &&
    !timestampWithinTolerance(userTx.timestamp, exchTx.timestamp, timestampToleranceSeconds);

  if (!qtyBad && !tsBad) return null;

  if (qtyBad && tsBad) {
    return {
      field: 'both',
      userValue: {
        quantity: userTx.quantity,
        timestamp: userTx.timestamp,
      },
      exchangeValue: {
        quantity: exchTx.quantity,
        timestamp: exchTx.timestamp,
      },
      delta: {
        quantity: Math.abs(userTx.quantity - exchTx.quantity),
        timestampSeconds:
          Math.abs(userTx.timestamp.getTime() - exchTx.timestamp.getTime()) / 1000,
      },
    };
  }

  if (qtyBad) {
    return {
      field: 'quantity',
      userValue: userTx.quantity,
      exchangeValue: exchTx.quantity,
      delta: Math.abs(userTx.quantity - exchTx.quantity),
    };
  }

  return {
    field: 'timestamp',
    userValue: userTx.timestamp,
    exchangeValue: exchTx.timestamp,
    delta:
      Math.abs(userTx.timestamp.getTime() - exchTx.timestamp.getTime()) / 1000,
  };
}

/**
 * Core matching algorithm.
 *
 * Phase 1 — ID-based matching:
 *   Match on identical txId, then check tolerances. Conflicts are noted but
 *   the pair is still considered "matched" (just with conflictDetails).
 *
 * Phase 2 — Proximity-based matching:
 *   For remaining transactions match on asset + (type == OR perspective) +
 *   timestamp within tolerance + quantity within tolerance.
 *   On ties, pick the candidate with the smallest timestamp delta.
 *
 * Phase 3 — Leftovers:
 *   Any unmatched exchange transactions become unmatched_exchange entries.
 *
 * @param {string} runId
 * @param {{ timestampToleranceSeconds: number, quantityTolerancePct: number }} config
 * @returns {Promise<Object[]>} array of match result objects
 */
async function runMatching(runId, config) {
  logger.info(`[matching] Starting matching for run ${runId}`);

  // Fetch all transactions for this run
  const userTxs = await Transaction.find({ runId, source: 'user' }).lean();
  const exchTxs = await Transaction.find({ runId, source: 'exchange' }).lean();

  logger.info(
    `[matching] Loaded ${userTxs.length} user txs, ${exchTxs.length} exchange txs`
  );

  const usedUserIds = new Set();
  const usedExchIds = new Set();
  const results = [];

  // Build index for exchange txs by txId for O(1) Phase 1 lookups
  const exchByTxId = new Map();
  for (const etx of exchTxs) {
    if (etx.txId) {
      if (!exchByTxId.has(etx.txId)) {
        exchByTxId.set(etx.txId, []);
      }
      exchByTxId.get(etx.txId).push(etx);
    }
  }

  // ─── Phase 1: ID-based matching ────────────────────────────────────────────
  logger.info('[matching] Phase 1 — ID-based matching');

  for (const userTx of userTxs) {
    if (!userTx.txId) continue;
    if (usedUserIds.has(String(userTx._id))) continue;

    const candidates = exchByTxId.get(userTx.txId) || [];
    // Filter to unused exchange candidates
    const available = candidates.filter(
      (e) => !usedExchIds.has(String(e._id))
    );
    if (available.length === 0) continue;

    // Pick the first available (txId should be unique, but handle multiples gracefully)
    const exchTx = available[0];

    const conflictDetails = buildConflictDetails(userTx, exchTx, config);
    const category = conflictDetails ? 'conflicting' : 'matched';

    results.push({
      category,
      reason: conflictDetails
        ? `ID match found but ${conflictDetails.field} out of tolerance`
        : 'Matched by transaction_id',
      userTxId: String(userTx._id),
      exchangeTxId: String(exchTx._id),
      userRow: userTx.rawRow,
      exchangeRow: exchTx.rawRow,
      conflictDetails,
    });

    usedUserIds.add(String(userTx._id));
    usedExchIds.add(String(exchTx._id));
  }

  logger.info(
    `[matching] Phase 1 done — ${results.length} pairs found`
  );

  // ─── Phase 2: Proximity-based matching ─────────────────────────────────────
  logger.info('[matching] Phase 2 — Proximity-based matching');

  const remainingUser = userTxs.filter(
    (t) => !usedUserIds.has(String(t._id))
  );
  const remainingExch = exchTxs.filter(
    (t) => !usedExchIds.has(String(t._id))
  );

  for (const userTx of remainingUser) {
    // Must have asset and type to proximity-match
    if (!userTx.asset || !userTx.type) {
      results.push({
        category: 'unmatched_user',
        reason: 'Missing asset or type — cannot proximity-match',
        userTxId: String(userTx._id),
        exchangeTxId: null,
        userRow: userTx.rawRow,
        exchangeRow: null,
        conflictDetails: null,
      });
      usedUserIds.add(String(userTx._id));
      continue;
    }

    const candidates = remainingExch.filter((exchTx) => {
      if (usedExchIds.has(String(exchTx._id))) return false;
      if (!exchTx.asset || !exchTx.type) return false;

      // Asset must match
      if (exchTx.asset !== userTx.asset) return false;

      // Type must match exactly OR be a perspective match
      const typeOk =
        userTx.type === exchTx.type ||
        typesArePerspectiveMatch(userTx.type, exchTx.type);
      if (!typeOk) return false;

      // Both must have valid timestamps within tolerance
      if (!userTx.timestamp || !exchTx.timestamp) return false;
      if (
        !timestampWithinTolerance(
          userTx.timestamp,
          exchTx.timestamp,
          config.timestampToleranceSeconds
        )
      ) {
        return false;
      }

      // Both must have valid quantities within tolerance
      if (userTx.quantity === null || exchTx.quantity === null) return false;
      if (
        !quantityWithinTolerance(
          userTx.quantity,
          exchTx.quantity,
          config.quantityTolerancePct
        )
      ) {
        return false;
      }

      return true;
    });

    if (candidates.length === 0) {
      results.push({
        category: 'unmatched_user',
        reason: 'No matching exchange transaction found',
        userTxId: String(userTx._id),
        exchangeTxId: null,
        userRow: userTx.rawRow,
        exchangeRow: null,
        conflictDetails: null,
      });
      usedUserIds.add(String(userTx._id));
      continue;
    }

    // Pick the best candidate (smallest timestamp delta)
    candidates.sort((a, b) => {
      const deltaA = Math.abs(
        userTx.timestamp.getTime() - a.timestamp.getTime()
      );
      const deltaB = Math.abs(
        userTx.timestamp.getTime() - b.timestamp.getTime()
      );
      return deltaA - deltaB;
    });

    const best = candidates[0];
    // Note: within Phase 2, candidates already pass tolerance checks,
    // so there should be no conflict. But run buildConflictDetails anyway
    // to be safe (e.g. floating-point edge cases).
    const conflictDetails = buildConflictDetails(userTx, best, config);
    const category = conflictDetails ? 'conflicting' : 'matched';

    results.push({
      category,
      reason: conflictDetails
        ? `Proximity match found but ${conflictDetails.field} out of tolerance`
        : 'Matched by asset, type, timestamp, and quantity proximity',
      userTxId: String(userTx._id),
      exchangeTxId: String(best._id),
      userRow: userTx.rawRow,
      exchangeRow: best.rawRow,
      conflictDetails,
    });

    usedUserIds.add(String(userTx._id));
    usedExchIds.add(String(best._id));
  }

  // ─── Phase 3: Remaining exchange transactions ───────────────────────────────
  logger.info('[matching] Phase 3 — Unmatched exchange transactions');

  for (const exchTx of exchTxs) {
    if (usedExchIds.has(String(exchTx._id))) continue;
    results.push({
      category: 'unmatched_exchange',
      reason: 'No matching user transaction found',
      userTxId: null,
      exchangeTxId: String(exchTx._id),
      userRow: null,
      exchangeRow: exchTx.rawRow,
      conflictDetails: null,
    });
  }

  const matched = results.filter((r) => r.category === 'matched').length;
  const conflicting = results.filter((r) => r.category === 'conflicting').length;
  const unmatchedUser = results.filter((r) => r.category === 'unmatched_user').length;
  const unmatchedExchange = results.filter(
    (r) => r.category === 'unmatched_exchange'
  ).length;

  logger.info(
    `[matching] Done — matched=${matched}, conflicting=${conflicting}, unmatchedUser=${unmatchedUser}, unmatchedExchange=${unmatchedExchange}`
  );

  return results;
}

module.exports = { runMatching };
