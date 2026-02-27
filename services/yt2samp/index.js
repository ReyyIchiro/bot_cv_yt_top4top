const { downloadAudio, formatDuration } = require('./downloader');
const { uploadToTop4top } = require('./uploader');
const { cleanupFile } = require('../../utils/tempFiles');

// Rate limiter — Map<userId, {count, firstUsed}>
const rateLimitMap = new Map();
const RATE_LIMIT_MAX = 2;              // Maks 2 request
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000; // per 10 menit

// Active requests — Set<userId>
const activeRequests = new Set();

/**
 * Cek apakah user masih dalam rate limit.
 * @param {string} userId
 * @returns {{ limited: boolean, remainingMs: number }}
 */
function checkRateLimit(userId) {
  const entry = rateLimitMap.get(userId);
  if (!entry) return { limited: false, remainingMs: 0 };

  const elapsed = Date.now() - entry.firstUsed;

  // Window sudah lewat → reset
  if (elapsed >= RATE_LIMIT_WINDOW_MS) {
    rateLimitMap.delete(userId);
    return { limited: false, remainingMs: 0 };
  }

  // Masih dalam window, cek jumlah pemakaian
  if (entry.count >= RATE_LIMIT_MAX) {
    return { limited: true, remainingMs: RATE_LIMIT_WINDOW_MS - elapsed };
  }

  return { limited: false, remainingMs: 0 };
}

/**
 * Cek apakah user punya request yang sedang berjalan.
 * @param {string} userId
 * @returns {boolean}
 */
function isUserBusy(userId) {
  return activeRequests.has(userId);
}

/**
 * Validasi URL YouTube.
 * @param {string} url
 * @returns {boolean}
 */
function isValidYoutubeUrl(url) {
  const patterns = [
    /^(https?:\/\/)?(www\.)?youtube\.com\/watch\?v=[\w-]+/,
    /^(https?:\/\/)?(www\.)?youtube\.com\/shorts\/[\w-]+/,
    /^(https?:\/\/)?youtu\.be\/[\w-]+/,
    /^(https?:\/\/)?(www\.)?youtube\.com\/embed\/[\w-]+/,
    /^(https?:\/\/)?m\.youtube\.com\/watch\?v=[\w-]+/,
  ];

  return patterns.some((pattern) => pattern.test(url));
}

/**
 * Proses utama: download dari YouTube → upload ke top4top.io.
 *
 * @param {string} youtubeUrl
 * @param {string} userId — Discord user ID (untuk rate limiting)
 * @returns {Promise<{title: string, duration: string, directLink: string, pageLink: string}>}
 */
async function processYt2Samp(youtubeUrl, userId) {
  // Validasi URL
  if (!isValidYoutubeUrl(youtubeUrl)) {
    throw new Error('URL tidak valid. Hanya mendukung link dari youtube.com dan youtu.be.');
  }

  // Cek rate limit
  const rateCheck = checkRateLimit(userId);
  if (rateCheck.limited) {
    const remainSec = Math.ceil(rateCheck.remainingMs / 1000);
    throw new Error(`⏳ Rate limit — tunggu ${remainSec} detik lagi sebelum request berikutnya.`);
  }

  // Cek active request
  if (isUserBusy(userId)) {
    throw new Error('Masih memproses request sebelumnya. Tunggu hingga selesai.');
  }

  let filePath = null;

  try {
    // Tandai user sebagai busy
    activeRequests.add(userId);

    // Update rate limit counter
    const entry = rateLimitMap.get(userId);
    if (entry) {
      entry.count++;
    } else {
      rateLimitMap.set(userId, { count: 1, firstUsed: Date.now() });
    }

    // Step 1: Download audio
    console.log(`[Orchestrator] Step 1/2: Download audio...`);
    const downloadResult = await downloadAudio(youtubeUrl);
    filePath = downloadResult.filePath;

    // Step 2: Upload ke top4top.io
    console.log(`[Orchestrator] Step 2/2: Upload ke top4top.io...`);
    const uploadResult = await uploadToTop4top(filePath);

    // Format durasi
    const durationStr = formatDuration(downloadResult.duration);

    console.log(`[Orchestrator] Selesai! "${downloadResult.title}" → ${uploadResult.directLink}`);

    return {
      title: downloadResult.title,
      duration: durationStr,
      directLink: uploadResult.directLink,
      pageLink: uploadResult.pageLink,
      youtubeUrl,
    };
  } finally {
    // Selalu cleanup
    activeRequests.delete(userId);

    if (filePath) {
      cleanupFile(filePath);
    }
  }
}

module.exports = {
  processYt2Samp,
  isValidYoutubeUrl,
  checkRateLimit,
  isUserBusy,
};
