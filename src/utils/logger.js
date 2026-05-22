'use strict';

const path = require('path');
const winston = require('winston');

const logDir = path.join(__dirname, '../../logs');

const { combine, timestamp, colorize, printf, errors } = winston.format;

// Human-readable format for console
const consoleFormat = combine(
  colorize({ all: true }),
  timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  errors({ stack: true }),
  printf(({ level, message, timestamp: ts, stack }) => {
    return stack
      ? `[${ts}] ${level}: ${message}\n${stack}`
      : `[${ts}] ${level}: ${message}`;
  })
);

// Structured format for file transports
const fileFormat = combine(
  timestamp(),
  errors({ stack: true }),
  winston.format.json()
);

const logger = winston.createLogger({
  level: 'info',
  transports: [
    new winston.transports.Console({
      format: consoleFormat,
    }),
    new winston.transports.File({
      filename: path.join(logDir, 'error.log'),
      level: 'error',
      format: fileFormat,
    }),
    new winston.transports.File({
      filename: path.join(logDir, 'combined.log'),
      format: fileFormat,
    }),
  ],
});

module.exports = logger;
