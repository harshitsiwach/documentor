const fs = require('fs');
const path = require('path');

const SUPPORTED_EXTENSIONS = ['.pdf', '.xlsx', '.xls', '.csv'];

/**
 * Recursively scans a directory for supported document files.
 * @param {string} dirPath - Absolute path to the directory
 * @returns {Array} Array of file metadata objects
 */
function scanFolder(dirPath) {
  const results = [];

  if (!dirPath || !fs.existsSync(dirPath)) {
    return results;
  }

  const stat = fs.statSync(dirPath);
  if (!stat.isDirectory()) {
    return results;
  }

  function walkDir(currentPath) {
    try {
      const entries = fs.readdirSync(currentPath, { withFileTypes: true });

      for (const entry of entries) {
        // Skip hidden files/folders
        if (entry.name.startsWith('.')) continue;

        const fullPath = path.join(currentPath, entry.name);

        if (entry.isDirectory()) {
          walkDir(fullPath);
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          if (SUPPORTED_EXTENSIONS.includes(ext)) {
            try {
              const fileStat = fs.statSync(fullPath);
              results.push({
                name: entry.name,
                path: fullPath,
                relativePath: path.relative(dirPath, fullPath),
                extension: ext,
                type: getFileType(ext),
                size: fileStat.size,
                sizeFormatted: formatBytes(fileStat.size),
                lastModified: fileStat.mtime.toISOString(),
                parsed: false,
                parseError: null
              });
            } catch (err) {
              // Skip files we can't stat
            }
          }
        }
      }
    } catch (err) {
      console.error(`Error scanning directory ${currentPath}:`, err.message);
    }
  }

  walkDir(dirPath);
  return results;
}

function getFileType(ext) {
  switch (ext) {
    case '.pdf': return 'PDF';
    case '.xlsx':
    case '.xls': return 'Excel';
    case '.csv': return 'CSV';
    default: return 'Unknown';
  }
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

module.exports = { scanFolder, SUPPORTED_EXTENSIONS };
