'use strict';

require('dotenv').config();

const express = require('express');
const connectDB = require('./db/connect');
const routes = require('./routes');
const config = require('./config');
const logger = require('./utils/logger');

const app = express();

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api', routes);

// ── 404 handler ───────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({
    error: true,
    message: `Route ${req.method} ${req.originalUrl} not found`,
    code: 'NOT_FOUND',
  });
});

// ── Global error handler ──────────────────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  logger.error(`Unhandled error: ${err.message}`, { stack: err.stack });
  res.status(500).json({
    error: true,
    message: 'An unexpected error occurred',
    code: 'INTERNAL_ERROR',
  });
});

// ── Bootstrap ─────────────────────────────────────────────────────────────────
async function bootstrap() {
  await connectDB();
  app.listen(config.port, () => {
    logger.info(
      `KoinX Reconciliation Engine running on port ${config.port} (env: ${process.env.NODE_ENV || 'development'})`
    );
  });
}

bootstrap();

module.exports = app; // exported for testing
