'use strict';

const { stringify } = require('csv-stringify');
const logger = require('./logger');

/**
 * Serializes an array of plain objects to a CSV string.
 * Headers are derived from the keys of the first row.
 *
 * @param {Object[]} rows
 * @returns {Promise<string>} CSV-formatted string
 */
async function csvToString(rows) {
  if (!rows || rows.length === 0) {
    logger.warn('csvToString: called with empty rows array — returning empty string');
    return '';
  }

  const headers = Object.keys(rows[0]);

  return new Promise((resolve, reject) => {
    stringify(rows, { header: true, columns: headers }, (err, output) => {
      if (err) {
        logger.error(`csvToString: stringify error — ${err.message}`);
        return reject(err);
      }
      resolve(output);
    });
  });
}

module.exports = { csvToString };
