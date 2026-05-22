'use strict';

/**
 * Centralized configuration module.
 * Reads from process.env with safe defaults. Config is frozen to prevent mutation.
 */
module.exports = Object.freeze({
  port: process.env.PORT || 3000,
  mongoUri:
    process.env.MONGODB_URI ||
    'mongodb://localhost:27017/koinx_reconciliation',
  timestampToleranceSeconds:
    parseInt(process.env.TIMESTAMP_TOLERANCE_SECONDS, 10) || 300,
  quantityTolerancePct:
    parseFloat(process.env.QUANTITY_TOLERANCE_PCT) || 0.01,
});
