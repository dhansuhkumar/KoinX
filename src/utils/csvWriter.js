'use strict';

const path = require('path');
const fs = require('fs');
const { stringify } = require('csv-stringify');
const logger = require('./logger');

/**
 * Writes an array of plain objects to a CSV file.
 * Derives headers from the keys of the first row.
 * Creates parent directories if they do not exist.
 *
 * @param {string} filepath  Absolute or relative path for the output CSV
 * @param {Object[]} rows    Array of plain objects to serialize
 * @returns {Promise<void>}
 */
async function writeCsv(filepath, rows) {
  if (!rows || rows.length === 0) {
    logger.warn(`writeCsv: no rows to write, creating empty file at ${filepath}`);
    fs.mkdirSync(path.dirname(filepath), { recursive: true });
    fs.writeFileSync(filepath, '');
    return;
  }

  fs.mkdirSync(path.dirname(filepath), { recursive: true });

  const headers = Object.keys(rows[0]);

  return new Promise((resolve, reject) => {
    const chunks = [];

    stringify(rows, { header: true, columns: headers }, (err, output) => {
      if (err) {
        logger.error(`writeCsv: stringify error — ${err.message}`);
        return reject(err);
      }
      try {
        fs.writeFileSync(filepath, output, 'utf8');
        logger.info(`writeCsv: wrote ${rows.length} rows to ${filepath}`);
        resolve();
      } catch (writeErr) {
        logger.error(`writeCsv: file write error — ${writeErr.message}`);
        reject(writeErr);
      }
    });
  });
}

module.exports = { writeCsv };
