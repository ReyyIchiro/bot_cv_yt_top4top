const fs = require('fs');
const path = require('path');

const TEMP_DIR = path.join(__dirname, '..', 'temp');

/**
 * Pastikan folder temp/ ada. Buat jika belum.
 */
function ensureTempDir() {
  if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
    console.log('[TempFiles] Folder temp/ dibuat.');
  }
}

/**
 * Hapus satu file.
 * @param {string} filePath — absolute path ke file
 */
function cleanupFile(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log(`[TempFiles] Dihapus: ${path.basename(filePath)}`);
    }
  } catch (err) {
    console.error(`[TempFiles] Gagal hapus ${filePath}:`, err.message);
  }
}

/**
 * Hapus semua file di temp/ yang lebih tua dari maxAgeMs.
 * @param {number} maxAgeMs — umur maksimal file dalam milidetik (default: 1 jam)
 */
function cleanupOldFiles(maxAgeMs = 3600000) {
  try {
    ensureTempDir();
    const files = fs.readdirSync(TEMP_DIR);
    const now = Date.now();
    let cleaned = 0;

    for (const file of files) {
      const filePath = path.join(TEMP_DIR, file);
      const stat = fs.statSync(filePath);

      if (stat.isFile() && (now - stat.mtimeMs) > maxAgeMs) {
        fs.unlinkSync(filePath);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      console.log(`[TempFiles] Cleanup: ${cleaned} file lama dihapus.`);
    }
  } catch (err) {
    console.error('[TempFiles] Error saat cleanup:', err.message);
  }
}

module.exports = { ensureTempDir, cleanupFile, cleanupOldFiles, TEMP_DIR };
