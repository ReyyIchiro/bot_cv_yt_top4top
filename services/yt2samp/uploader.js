const https = require('https');
const fs = require('fs');
const path = require('path');

const UPLOAD_TIMEOUT_MS = 5 * 60 * 1000; // 5 menit
const TOP4TOP_IP = '188.165.137.170';

/**
 * Custom DNS lookup: resolve top4top.io ke IP aslinya
 * (bypass Cloudflare WARP / adblocker yang block domain ini)
 */
function customLookup(hostname, options, callback) {
  // Handle both (hostname, options, cb) and (hostname, cb) signatures
  if (typeof options === 'function') {
    callback = options;
    options = {};
  }
  if (hostname === 'top4top.io' || hostname.endsWith('.top4top.io')) {
    // Node.js v24+ passes {all: true} → callback expects [{address, family}]
    if (options.all) {
      return callback(null, [{ address: TOP4TOP_IP, family: 4 }]);
    }
    return callback(null, TOP4TOP_IP, 4);
  }
  require('dns').lookup(hostname, options, callback);
}

/**
 * HTTP GET request dengan custom DNS.
 * @returns {Promise<{status: number, headers: object, body: string, cookies: string[]}>}
 */
function httpGet(url) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const timer = setTimeout(() => reject(new Error('GET timeout')), 60000);

    const req = https.request(
      {
        hostname: parsed.hostname,
        port: 443,
        path: parsed.pathname + parsed.search,
        method: 'GET',
        lookup: customLookup,
        rejectUnauthorized: false,
        headers: {
          Host: parsed.hostname,
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
        },
      },
      (res) => {
        clearTimeout(timer);
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf-8'),
            cookies: res.headers['set-cookie'] || [],
          });
        });
      }
    );

    req.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    req.end();
  });
}

/**
 * HTTP POST multipart/form-data dengan custom DNS.
 * @returns {Promise<{status: number, headers: object, body: string}>}
 */
function httpPostMultipart(url, fields, fileField, cookieStr) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const boundary = '----WebKitFormBoundary' + Math.random().toString(36).slice(2);
    const timer = setTimeout(() => reject(new Error('POST upload timeout')), UPLOAD_TIMEOUT_MS);

    // Construct multipart body
    const parts = [];

    // Text fields
    for (const [name, value] of Object.entries(fields)) {
      parts.push(
        Buffer.from(
          `--${boundary}\r\n` +
            `Content-Disposition: form-data; name="${name}"\r\n\r\n` +
            `${value}\r\n`
        )
      );
    }

    // File field
    const fileData = fs.readFileSync(fileField.path);
    const filePart =
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="${fileField.name}"; filename="${fileField.filename}"\r\n` +
      `Content-Type: ${fileField.contentType || 'audio/mpeg'}\r\n\r\n`;

    parts.push(Buffer.from(filePart));
    parts.push(fileData);
    parts.push(Buffer.from('\r\n'));

    // End boundary
    parts.push(Buffer.from(`--${boundary}--\r\n`));

    const body = Buffer.concat(parts);

    const req = https.request(
      {
        hostname: parsed.hostname,
        port: 443,
        path: parsed.pathname + parsed.search,
        method: 'POST',
        lookup: customLookup,
        rejectUnauthorized: false,
        headers: {
          Host: parsed.hostname,
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': body.length,
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          Referer: 'https://top4top.io/',
          Origin: 'https://top4top.io',
          Cookie: cookieStr || '',
        },
      },
      (res) => {
        clearTimeout(timer);
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf-8'),
          });
        });
      }
    );

    req.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });

    req.write(body);
    req.end();
  });
}

/**
 * Follow redirect dan GET halaman result.
 */
async function followRedirect(location, cookieStr) {
  // Jika location relative, jadikan absolute
  if (location.startsWith('/')) {
    location = `https://top4top.io${location}`;
  }

  console.log(`[Uploader] Following redirect: ${location}`);

  const res = await httpGet(location);

  // Handle chain redirect
  if (res.status >= 300 && res.status < 400 && res.headers.location) {
    return followRedirect(res.headers.location, cookieStr);
  }

  return res;
}

/**
 * Ekstrak direct link dari HTML result page.
 * Format yang dicari: http(s)://X.top4top.io/m_XXXX.mp3 atau /p_XXXX atau /downloadf-XXXX
 *
 * @param {string} html
 * @returns {string|null}
 */
function extractDirectLink(html) {
  // Pattern 1: Direct media link (e.g., http://e.top4top.io/m_3683r08ec0.mp3)
  const mediaPattern = /https?:\/\/[a-z]\.top4top\.io\/[mp]_[a-zA-Z0-9]+\.\w{2,4}/g;
  const mediaMatches = html.match(mediaPattern);
  if (mediaMatches) {
    console.log(`[Uploader] Direct media links found:`, mediaMatches);
    // Prefer audio file extensions
    const audioLink = mediaMatches.find((l) => /\.(mp3|m4a|ogg|wav|aac)$/i.test(l));
    return audioLink || mediaMatches[0];
  }

  // Pattern 2: Download link (e.g., https://top4top.io/downloadf-XXXX)
  const dlPattern = /https?:\/\/(?:www\.)?top4top\.io\/downloadf-[a-zA-Z0-9]+/g;
  const dlMatches = html.match(dlPattern);
  if (dlMatches) {
    console.log(`[Uploader] Download page links found:`, dlMatches);
    return dlMatches[0];
  }

  // Pattern 3: Any link containing /p_ or /d_
  const pPattern = /https?:\/\/[a-z]\.top4top\.io\/[dpf]_[a-zA-Z0-9]+[^"'\s<]*/g;
  const pMatches = html.match(pPattern);
  if (pMatches) {
    console.log(`[Uploader] File links found:`, pMatches);
    return pMatches[0];
  }

  // Pattern 4: Search in input/textarea values
  const inputPattern = /value="(https?:\/\/[^"]*top4top[^"]*)"/g;
  let match;
  while ((match = inputPattern.exec(html)) !== null) {
    console.log(`[Uploader] Link from input value:`, match[1]);
    return match[1];
  }

  return null;
}

/**
 * Upload file ke top4top.io via HTTP (tanpa Playwright).
 *
 * @param {string} filePath — absolute path ke file MP3
 * @returns {Promise<{directLink: string, pageLink: string}>}
 */
async function uploadToTop4top(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File tidak ditemukan: ${filePath}`);
  }

  const fileName = path.basename(filePath);
  console.log(`[Uploader] Memulai upload: ${fileName}`);

  // ────────────────────────────────────────────
  // 1. GET halaman utama → ambil SID & cookies
  // ────────────────────────────────────────────
  console.log('[Uploader] Mengambil session dari top4top.io...');
  const mainPage = await httpGet('https://top4top.io/');

  if (mainPage.status !== 200) {
    throw new Error(`Gagal membuka top4top.io (HTTP ${mainPage.status})`);
  }

  // Ekstrak SID dari hidden input
  const sidMatch = mainPage.body.match(/name=["']sid["']\s+value=["']([^"']+)["']/i)
    || mainPage.body.match(/name=["']sid["'][^>]*value=["']([^"']+)["']/i)
    || mainPage.body.match(/value=["']([^"']+)["']\s+name=["']sid["']/i);

  if (!sidMatch) {
    console.error('[Uploader] HTML snippet (500 chars):', mainPage.body.slice(0, 500));
    throw new Error('Gagal menemukan session ID (sid) di halaman top4top.io');
  }

  const sid = sidMatch[1];
  console.log(`[Uploader] SID ditemukan: ${sid.slice(0, 20)}...`);

  // Kumpulkan cookies
  const cookieStr = mainPage.cookies
    .map((c) => c.split(';')[0])
    .join('; ');
  console.log(`[Uploader] Cookies: ${cookieStr.slice(0, 50)}...`);

  // ────────────────────────────────────────────
  // 2. POST file upload
  // ────────────────────────────────────────────
  console.log('[Uploader] Mengupload file...');

  const postResult = await httpPostMultipart(
    'https://top4top.io/',
    {
      sid: sid,
      submitr: '[ رفع الملفات ]',
    },
    {
      name: 'file_1_',
      filename: fileName,
      path: filePath,
      contentType: 'audio/mpeg',
    },
    cookieStr
  );

  console.log(`[Uploader] POST response status: ${postResult.status}`);

  // ────────────────────────────────────────────
  // 3. Handle response (redirect atau inline result)
  // ────────────────────────────────────────────
  let resultHtml = postResult.body;
  let pageLink = null;

  // Jika redirect, follow
  if (postResult.status >= 300 && postResult.status < 400 && postResult.headers.location) {
    const redirectResult = await followRedirect(postResult.headers.location, cookieStr);
    resultHtml = redirectResult.body;
    pageLink = postResult.headers.location;
    if (pageLink.startsWith('/')) pageLink = `https://top4top.io${pageLink}`;
  }

  // Debug: simpan result HTML untuk troubleshooting
  const debugPath = path.join(path.dirname(filePath), `debug-result-${Date.now()}.html`);
  fs.writeFileSync(debugPath, resultHtml);
  console.log(`[Uploader] Result HTML disimpan di: ${debugPath}`);

  // ────────────────────────────────────────────
  // 4. Ekstrak direct link
  // ────────────────────────────────────────────
  const directLink = extractDirectLink(resultHtml);

  if (!directLink) {
    console.error('[Uploader] Result HTML snippet (1000 chars):', resultHtml.slice(0, 1000));
    throw new Error(
      'Upload mungkin berhasil, tapi gagal menemukan link download. ' +
        'Cek file debug-result-*.html di folder temp/.'
    );
  }

  if (!pageLink) pageLink = directLink;

  console.log(`[Uploader] ✅ Upload selesai!`);
  console.log(`[Uploader] Direct link : ${directLink}`);
  console.log(`[Uploader] Page link   : ${pageLink}`);

  return { directLink, pageLink };
}

module.exports = { uploadToTop4top };
