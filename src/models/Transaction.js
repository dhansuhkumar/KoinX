'use strict';

const mongoose = require('mongoose');

/**
 * Represents a single raw transaction row ingested from a CSV file.
 * Every row is stored — none are silently dropped.
 * Rows that fail data quality checks are flagged but still persisted.
 */
const transactionSchema = new mongoose.Schema(
  {
    runId: {
      type: String,
      required: true,
      index: true,
    },
    source: {
      type: String,
      enum: ['user', 'exchange'],
      required: true,
    },
    /** Original parsed CSV row, stored verbatim for auditability */
    rawRow: {
      type: mongoose.Schema.Types.Mixed,
    },
    /** transaction_id column value, if present */
    txId: {
      type: String,
      default: null,
    },
    /** Parsed UTC timestamp; null when the raw value is unparseable */
    timestamp: {
      type: Date,
      default: null,
    },
    /** Normalized transaction type (BUY, SELL, TRANSFER_IN, TRANSFER_OUT) */
    type: {
      type: String,
      default: null,
    },
    /** Normalized asset ticker symbol */
    asset: {
      type: String,
      default: null,
    },
    /** Parsed numeric quantity; null when the raw value is invalid */
    quantity: {
      type: Number,
      default: null,
    },
    currency: {
      type: String,
      default: null,
    },
    pricePerUnit: {
      type: Number,
      default: null,
    },
    totalValue: {
      type: Number,
      default: null,
    },
    fee: {
      type: Number,
      default: null,
    },
    wallet: {
      type: String,
      default: null,
    },
    notes: {
      type: String,
      default: null,
    },
    /** Human-readable list of every data quality problem detected in this row */
    dataQualityIssues: {
      type: [String],
      default: [],
    },
    /** true when dataQualityIssues is non-empty */
    isFlagged: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: { createdAt: 'createdAt', updatedAt: false },
  }
);

module.exports = mongoose.model('Transaction', transactionSchema);
