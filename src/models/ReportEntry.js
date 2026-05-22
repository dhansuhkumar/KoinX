'use strict';

const mongoose = require('mongoose');

/**
 * Stores the outcome of comparing a single pair (or lone transaction)
 * during reconciliation matching.
 */
const reportEntrySchema = new mongoose.Schema(
  {
    runId: {
      type: String,
      required: true,
      index: true,
    },
    category: {
      type: String,
      enum: ['matched', 'conflicting', 'unmatched_user', 'unmatched_exchange'],
      required: true,
    },
    /** Human-readable explanation of why this entry is in its category */
    reason: {
      type: String,
      default: '',
    },
    /** MongoDB _id (as String) of the user Transaction document */
    userTxId: {
      type: String,
      default: null,
    },
    /** MongoDB _id (as String) of the exchange Transaction document */
    exchangeTxId: {
      type: String,
      default: null,
    },
    /** Snapshot of the user rawRow for report portability */
    userRow: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    /** Snapshot of the exchange rawRow for report portability */
    exchangeRow: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    /**
     * Populated only for 'conflicting' entries.
     * {
     *   field: 'quantity' | 'timestamp' | 'both',
     *   userValue: ...,
     *   exchangeValue: ...,
     *   delta: number
     * }
     */
    conflictDetails: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
  },
  {
    timestamps: { createdAt: 'createdAt', updatedAt: false },
  }
);

module.exports = mongoose.model('ReportEntry', reportEntrySchema);
