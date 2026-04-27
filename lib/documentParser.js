const fs = require('fs');
const path = require('path');
const pdfParse = require('pdf-parse');
const XLSX = require('xlsx');
const Papa = require('papaparse');

/**
 * Parse a document file and extract its text content.
 * @param {string} filePath - Absolute path to the file
 * @returns {Object} { text, metadata, tables, pageCount, sheetNames }
 */
async function parseDocument(filePath) {
  const ext = path.extname(filePath).toLowerCase();

  switch (ext) {
    case '.pdf':
      return await parsePDF(filePath);
    case '.xlsx':
    case '.xls':
      return parseExcel(filePath);
    case '.csv':
      return parseCSV(filePath);
    default:
      throw new Error(`Unsupported file type: ${ext}`);
  }
}

/**
 * Extract text from a PDF file.
 */
async function parsePDF(filePath) {
  const buffer = fs.readFileSync(filePath);
  const data = await pdfParse(buffer);

  return {
    text: data.text || '',
    metadata: {
      title: data.info?.Title || path.basename(filePath),
      author: data.info?.Author || 'Unknown',
      creator: data.info?.Creator || '',
      producer: data.info?.Producer || '',
      creationDate: data.info?.CreationDate || '',
    },
    pageCount: data.numpages || 0,
    tables: [],
    sheetNames: [],
    charCount: (data.text || '').length,
    wordCount: (data.text || '').split(/\s+/).filter(Boolean).length
  };
}

/**
 * Parse an Excel workbook, extracting text from all sheets.
 */
function parseExcel(filePath) {
  const workbook = XLSX.readFile(filePath, { type: 'file' });
  const sheetNames = workbook.SheetNames;
  const tables = [];
  let fullText = '';

  for (const sheetName of sheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const jsonData = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

    if (jsonData.length === 0) continue;

    // Build a text representation of the sheet
    let sheetText = `\n--- Sheet: ${sheetName} ---\n`;

    // Use first row as headers if it looks like headers
    const headers = jsonData[0];
    const dataRows = jsonData.slice(1);

    // Create a table representation
    if (headers && headers.length > 0) {
      sheetText += headers.join(' | ') + '\n';
      sheetText += headers.map(() => '---').join(' | ') + '\n';

      for (const row of dataRows) {
        if (row.some(cell => cell !== '')) {
          sheetText += row.join(' | ') + '\n';
        }
      }
    }

    fullText += sheetText;
    tables.push({
      sheetName,
      headers: headers || [],
      rowCount: dataRows.length,
      columnCount: headers ? headers.length : 0,
      preview: dataRows.slice(0, 5)
    });
  }

  return {
    text: fullText.trim(),
    metadata: {
      title: path.basename(filePath),
    },
    pageCount: 0,
    tables,
    sheetNames,
    charCount: fullText.length,
    wordCount: fullText.split(/\s+/).filter(Boolean).length
  };
}

/**
 * Parse a CSV file.
 */
function parseCSV(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const result = Papa.parse(content, {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: true
  });

  const headers = result.meta.fields || [];
  let fullText = '';

  if (headers.length > 0) {
    fullText += headers.join(' | ') + '\n';
    fullText += headers.map(() => '---').join(' | ') + '\n';

    for (const row of result.data) {
      const values = headers.map(h => row[h] ?? '');
      fullText += values.join(' | ') + '\n';
    }
  }

  return {
    text: fullText.trim(),
    metadata: {
      title: path.basename(filePath),
      delimiter: result.meta.delimiter
    },
    pageCount: 0,
    tables: [{
      sheetName: 'CSV',
      headers,
      rowCount: result.data.length,
      columnCount: headers.length,
      preview: result.data.slice(0, 5)
    }],
    sheetNames: [],
    charCount: fullText.length,
    wordCount: fullText.split(/\s+/).filter(Boolean).length
  };
}

module.exports = { parseDocument };
