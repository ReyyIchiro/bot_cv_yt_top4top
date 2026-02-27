const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { TEMP_DIR, ensureTempDir } = require('../../utils/tempFiles');

const DOWNLOAD_TIMEOUT_MS = 2 * 60 * 1000;
const MAX_DURATION_SECONDS = 600;
const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;

// Path ke cookies.txt (untuk deploy di server)
const COOKIES_FILE = path.join(__dirname, '..', '..', 'cookies.txt');

// Browser lokal untuk cookies (hanya dipakai kalau cookies.txt tidak ada)
const COOKIES_BROWSER = process.env.COOKIES_BROWSER || '';

/**
 * Tentukan strategi cookies yang akan dipakai.
 * Prioritas: cookies.txt > cookies-from-browser > tanpa cookies
 */
function getCookieStrategy() {
  if (fs.existsSync(COOKIES_FILE)) {
    return { type: 'file', label: 'cookies.txt' };
  }
  if (COOKIES_BROWSER && COOKIES_BROWSER !== 'none') {
    return { type: 'browser', label: `browser ${COOKIES_BROWSER}` };
  }
  return { type: 'none', label: 'tanpa cookies' };
}

/**
 * Jalankan yt-dlp dengan args tertentu.
 * @returns {Promise<{stdout: string, stderr: string, code: number}>}
 */
function runYtdlp(args) {
  return new Promise((resolve) => {
    const proc = spawn('yt-dlp', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';

    proc.stdout.on('data', (d) => (stdout += d));
    proc.stderr.on('data', (d) => (stderr += d));

    const timer = setTimeout(() => {
      proc.kill('SIGTERM');
      resolve({ stdout, stderr: stderr + '\nTimeout', code: -1 });
    }, DOWNLOAD_TIMEOUT_MS);

    proc.on('close', (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, code: code ?? 1 });
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      resolve({ stdout, stderr: err.message, code: -1 });
    });
  });
}

/**
 * Cek apakah error adalah bot detection.
 */
function isBotDetection(stderr) {
  return stderr.includes('Sign in to confirm') || stderr.includes('not a bot');
}

/**
 * Download audio dari YouTube dengan smart cookie fallback.
 * Strategi: tanpa cookies → cookies.txt → cookies-from-browser
 *
 * @param {string} youtubeUrl
 * @returns {Promise<{filePath: string, title: string, duration: number}>}
 */
async function downloadAudio(youtubeUrl) {
  ensureTempDir();

  const outputTemplate = path.join(TEMP_DIR, '%(id)s.%(ext)s');
  const baseArgs = [
    '-x', '--audio-format', 'mp3', '--audio-quality', '0',
    '-f', 'ba/b',
    '--js-runtimes', 'node',
    '--print-json', '--no-playlist', '--no-warnings',
    '-o', outputTemplate,
  ];

  // Buat daftar strategi untuk dicoba
  const strategies = [];

  // 1) Coba tanpa cookies dulu (paling ideal untuk server)
  strategies.push({ args: [...baseArgs, youtubeUrl], label: 'tanpa cookies' });

  // 2) Kalau ada cookies.txt, coba pakai itu
  if (fs.existsSync(COOKIES_FILE)) {
    strategies.push({
      args: [...baseArgs, '--cookies', COOKIES_FILE, youtubeUrl],
      label: 'cookies.txt',
    });
  }

  // 3) Kalau ada browser lokal, coba pakai cookies dari browser
  if (COOKIES_BROWSER && COOKIES_BROWSER !== 'none') {
    strategies.push({
      args: [...baseArgs, '--cookies-from-browser', COOKIES_BROWSER, youtubeUrl],
      label: `browser ${COOKIES_BROWSER}`,
    });
  }

  console.log(`[Downloader] Memulai download: ${youtubeUrl}`);

  let lastError = '';

  for (const strategy of strategies) {
    console.log(`[Downloader] Mencoba: ${strategy.label}...`);

    const result = await runYtdlp(strategy.args);

    if (result.code === 0) {
      // Berhasil! Parse metadata
      return parseResult(result.stdout, youtubeUrl);
    }

    console.log(`[Downloader] ${strategy.label} gagal (exit ${result.code})`);
    lastError = result.stderr;

    // Kalau bukan bot detection, jangan coba strategi lain (error-nya beda)
    if (!isBotDetection(result.stderr)) {
      break;
    }

    console.log('[Downloader] Bot detection terdeteksi, mencoba strategi berikutnya...');
  }

  // Semua strategi gagal — throw error
  throw createUserError(lastError);
}

/**
 * Parse output JSON dari yt-dlp dan validasi file.
 */
function parseResult(stdout, youtubeUrl) {
  const lines = stdout.trim().split('\n');
  let metadata = null;

  for (let i = lines.length - 1; i >= 0; i--) {
    try { metadata = JSON.parse(lines[i]); break; } catch { /* skip */ }
  }

  if (!metadata) throw new Error('Gagal parse metadata dari yt-dlp.');

  const title = metadata.title || 'Unknown Title';
  const duration = metadata.duration || 0;
  const videoId = metadata.id || 'unknown';

  if (duration > MAX_DURATION_SECONDS) {
    const f = path.join(TEMP_DIR, `${videoId}.mp3`);
    if (fs.existsSync(f)) fs.unlinkSync(f);
    throw new Error(`Video terlalu panjang (${formatDuration(duration)}). Maksimal ${formatDuration(MAX_DURATION_SECONDS)}.`);
  }

  let filePath = path.join(TEMP_DIR, `${videoId}.mp3`);
  if (!fs.existsSync(filePath)) {
    const match = fs.readdirSync(TEMP_DIR).find((f) => f.includes(videoId));
    if (match) filePath = path.join(TEMP_DIR, match);
    else throw new Error('File MP3 tidak ditemukan setelah download.');
  }

  const fileSize = fs.statSync(filePath).size;
  if (fileSize > MAX_FILE_SIZE_BYTES) {
    fs.unlinkSync(filePath);
    throw new Error(`File terlalu besar (${(fileSize / 1024 / 1024).toFixed(1)}MB). Maksimal 50MB.`);
  }

  console.log(`[Downloader] ✅ Selesai: "${title}" (${formatDuration(duration)}) → ${path.basename(filePath)}`);
  return { filePath, title, duration };
}

/**
 * Buat pesan error yang user-friendly.
 */
function createUserError(stderr) {
  if (isBotDetection(stderr)) {
    return new Error('YouTube memblokir request. Taruh file cookies.txt di root project, atau set COOKIES_BROWSER di .env.');
  }
  if (stderr.includes('Private video')) return new Error('Video private, tidak bisa diakses.');
  if (stderr.includes('Video unavailable') || stderr.includes('not available')) return new Error('Video tidak tersedia atau dihapus.');
  if (stderr.includes('confirm your age') || (stderr.includes('Sign in') && stderr.includes('age'))) return new Error('Video dibatasi umur.');
  if (stderr.includes('is not a valid URL') || stderr.includes('Unsupported URL')) return new Error('URL tidak valid.');
  return new Error(`yt-dlp gagal: ${stderr.slice(0, 200)}`);
}

function formatDuration(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

module.exports = { downloadAudio, formatDuration };
