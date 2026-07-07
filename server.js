// Minimal Express static server for the Minia admin dashboard.
// Serves the existing HTML/CSS/JS in this folder exactly as-is, no templating.
//
// Usage:
//   npm start        # production-style, no auto-reload
//   npm run dev      # nodemon watches this file and the static assets
//
// Then open http://127.0.0.1:3000/

const path = require('path');
const express = require('express');

const app = express();

// Don't advertise the runtime in responses.
app.disable('x-powered-by');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '127.0.0.1';
const MAX_PORT_ATTEMPTS = 10;
const ROOT_DIR = __dirname;

// Disable HTTP caching in dev so every refresh picks up the latest HTML/CSS/JS.
app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
});

// Request log – one line per request, no extra dep.
app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// Serve every static file in the project root: index.html, assets/, fonts.*, _DataURI/, etc.
// `index: 'index.html'` + `extensions: ['html']` makes `/dashboard` resolve to `/dashboard.html` when present.
app.use(express.static(ROOT_DIR, {
  index: 'index.html',
  extensions: ['html'],
}));

// Friendly 404 (no SPA fallback – this is a multi-page template).
app.use((_req, res) => {
  res.status(404).send('Not Found');
});

// Try to bind to PORT; if it's busy (EADDRINUSE), increment the port and retry.
// Prevents nodemon from crash-looping when 3000 is held by another app.
function listenWithFallback(app, startPort, host, maxAttempts) {
  return new Promise((resolve, reject) => {
    let port = startPort;
    let attempts = 0;

    const tryOnce = () => {
      const server = app.listen(port, host);

      server.once('listening', () => {
        resolve({ server, port, attempts });
      });

      server.once('error', (err) => {
        if (err.code === 'EADDRINUSE' && attempts < maxAttempts) {
          attempts += 1;
          console.warn(`[server] Port ${port} is in use, trying ${port + 1}...`);
          port += 1;
          setImmediate(tryOnce);
        } else {
          reject(err);
        }
      });
    };

    tryOnce();
  });
}

listenWithFallback(app, PORT, HOST, MAX_PORT_ATTEMPTS)
  .then(({ server, port, attempts }) => {
    if (attempts > 0) {
      console.log(`[server] Bound after ${attempts} retry(ies).`);
    }
    console.log(`\nMinia server running at http://${HOST}:${port}`);
    console.log(`Dashboard:  http://${HOST}:${port}/`);
    console.log(`Login page: http://${HOST}:${port}/auth-login.html`);
    console.log('Press Ctrl+C to stop.\n');

    const shutdown = (signal) => {
      console.log(`\n[server] Received ${signal}, shutting down...`);
      server.close(() => process.exit(0));
      // Force-exit if close() hangs.
      setTimeout(() => process.exit(0), 2000).unref();
    };
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
  })
  .catch((err) => {
    console.error(`\n[server] Failed to start: ${err.message}`);
    if (err.code === 'EADDRINUSE') {
      console.error(
        `[server] Tried ports ${PORT}..${PORT + MAX_PORT_ATTEMPTS - 1} — all in use.\n` +
        `        Free one up, or pick a different range, e.g.:\n` +
        `          PORT=4000 npm start`
      );
    }
    process.exit(1);
  });
