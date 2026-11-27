/* Trả file tĩnh từ frontend/ kèm Cache-Control và nén gzip qua zlib. */
const express = require('express');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const TEXT_EXT = /\.(js|css|html|svg|json|txt|md)$/i;
const IMMUTABLE_EXT = /\.(woff2?|ttf|otf|eot)$/i;
const MIME = {
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};

function createStaticHandler(frontendDir) {
  const base = path.resolve(frontendDir);
  const expressStatic = express.static(base, {
    setHeaders(res, filePath) {
      if (IMMUTABLE_EXT.test(filePath) || /vendor\//.test(filePath)) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      } else if (TEXT_EXT.test(filePath)) {
        res.setHeader('Cache-Control', 'public, max-age=3600');
      } else {
        res.setHeader('Cache-Control', 'public, max-age=86400');
      }
    },
  });

  return (req, res, next) => {
    const relative = (req.path || '/').replace(/^\/+/, '');
    const filePath = path.resolve(base, relative || 'index.html');
    if (!filePath.startsWith(base)) return next();
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile() && TEXT_EXT.test(filePath)) {
      const ae = String(req.headers['accept-encoding'] || '');
      if (ae.includes('gzip')) {
        res.setHeader('Content-Encoding', 'gzip');
        res.setHeader('Vary', 'Accept-Encoding');
        res.setHeader('Content-Type', MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream');
        fs.createReadStream(filePath).pipe(zlib.createGzip()).pipe(res);
        return;
      }
    }
    expressStatic(req, res, next);
  };
}

module.exports = createStaticHandler;
