'use strict';

const mongoose = require('mongoose');

/**
 * Tracks the lifecycle and aggregate results of a single reconciliation run.
 */
const reconciliationRunSchema = new mongoose.Schema(
  {
    runId: {
      type: String,
      required: true,
      unique: true,
    },
    status: {
      type: String,
      enum: ['pending', 'running', 'completed', 'failed'],
      default: 'pending',
    },
    /** Tolerance config snapshot used for this specific run */
    config: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    /** Aggregate counts produced after matching is complete */
    summary: {
      matched: { type: Number, default: 0 },
      conflicting: { type: Number, default: 0 },
      unmatchedUser: { type: Number, default: 0 },
      unmatchedExchange: { type: Number, default: 0 },
      totalUser: { type: Number, default: 0 },
      totalExchange: { type: Number, default: 0 },
      flaggedUser: { type: Number, default: 0 },
      flaggedExchange: { type: Number, default: 0 },
    },
    /** Full CSV report content stored in MongoDB (no filesystem required) */
    reportCsv: {
      type: String,
      default: null,
    },
    /** Populated only when status === 'failed' */
    errorMessage: {
      type: String,
      default: null,
    },
    startedAt: {
      type: Date,
      default: null,
    },
    completedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: { createdAt: 'createdAt', updatedAt: false },
  }
);

module.exports = mongoose.model('ReconciliationRun', reconciliationRunSchema);
