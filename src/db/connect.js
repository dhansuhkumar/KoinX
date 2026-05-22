'use strict';

const mongoose = require('mongoose');
const config = require('../config');
const logger = require('../utils/logger');

/**
 * Establishes a connection to MongoDB.
 * Exits the process if the connection fails on initial attempt.
 */
async function connectDB() {
  try {
    await mongoose.connect(config.mongoUri, {
      serverSelectionTimeoutMS: 5000,
    });
    logger.info(`MongoDB connected: ${config.mongoUri}`);
  } catch (err) {
    logger.error(`MongoDB connection failed: ${err.message}`);
    process.exit(1);
  }
}

module.exports = connectDB;
