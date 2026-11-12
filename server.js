import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { initializeApp, cert, getApps, getApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3000;

function getFleetDataPath() {
  const p1 = path.join(__dirname, 'fleet_data.json');
  if (fs.existsSync(p1)) return p1;
  const p2 = path.join(process.cwd(), 'fleet_data.json');
  if (fs.existsSync(p2)) return p2;
  return p1;
}

const FLEET_DATA_PATH = getFleetDataPath();

// Firebase Admin Initialization for Server-Side Hardware Telemetry (routeiq-d2104)
let adminDb = null;
let adminApp = null;
const SERVICE_ACCOUNT_FILE = path.join(__dirname, 'routeiq-d2104-8599cf6363fd.json');

try {
  if (getApps().length === 0) {
    if (fs.existsSync(SERVICE_ACCOUNT_FILE)) {
      // Local development: use service account JSON file
      const sa = JSON.parse(fs.readFileSync(SERVICE_ACCOUNT_FILE, 'utf8'));
      adminApp = initializeApp({ credential: cert(sa) });
      console.log('✅ Firebase Admin SDK initialized with local service account for RouteIQ');
    } else if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
      // Vercel/Production: use environment variable with JSON string
      const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
      adminApp = initializeApp({ credential: cert(sa) });
      console.log('✅ Firebase Admin SDK initialized with FIREBASE_SERVICE_ACCOUNT_JSON env var');
    } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      adminApp = initializeApp();
      console.log('✅ Firebase Admin SDK initialized with GOOGLE_APPLICATION_CREDENTIALS');
    } else {
      console.warn('⚠️ No Firebase credentials found. Telemetry API will be disabled.');
    }
  } else {
    adminApp = getApp();
  }
  if (adminApp) {
    adminDb = getFirestore(adminApp);
  }
} catch (adminErr) {
  console.warn('⚠️ Note: Firebase Admin initialization notice:', adminErr.message);
}

// Hardware Device Authentication Secret Token
const ROUTEIQ_DEVICE_TOKEN = process.env.ROUTEIQ_DEVICE_TOKEN || 'routeiq_hw_sec_9a748879b565b17c';

// Mapping between bus plates and routes
const BUS_ROUTE_MAP = {
  'TS-08-UB-4503': 'Route 03',
  'TS-08-UB-4513': 'Route 13',
  'TS-08-UB-4516': 'Route 16',
  'TS-08-UB-4519': 'Route 19A',
  'TS-08-UB-4525': 'Route 25',
  'Route 03': 'Route 03',
  'Route 13': 'Route 13',
  'Route 16': 'Route 16',
  'Route 19A': 'Route 19A',
  'Route 25': 'Route 25'
};

const ROUTE_BUS_MAP = {
  'Route 03': 'TS-08-UB-4503',
  'Route 13': 'TS-08-UB-4513',
  'Route 16': 'TS-08-UB-4516',
  'Route 19A': 'TS-08-UB-4519',
  'Route 25': 'TS-08-UB-4525'
};

// Rate limiting & duplicate tracking
const deviceRateLimits = new Map(); // busId -> lastRequestTimestampMs
const deviceLastGpsTimestamp = new Map(); // busId -> lastGpsTimestamp
const liveTelemetryMemory = new Map(); // busId -> latest packet

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.manifest': 'application/manifest+json',
  '.webmanifest': 'application/manifest+json',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf'
};

const handler = (req, res) => {
  // CORS headers for local development
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Device-Token');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  let pathname = decodeURIComponent(parsedUrl.pathname);


  // API Route: /api/fleet-data
  if (pathname === '/api/fleet-data') {
    if (req.method === 'GET') {
      fs.readFile(FLEET_DATA_PATH, 'utf-8', (err, data) => {
        if (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Failed to read fleet data' }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(data);
      });
      return;
    } else if (req.method === 'POST') {
      let body = '';
      req.on('data', chunk => {
        body += chunk;
      });
      req.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          fs.writeFile(FLEET_DATA_PATH, JSON.stringify(parsed, null, 2), 'utf-8', (err) => {
            if (err) {
              res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Failed to save fleet data' }));
              return;
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, message: 'Fleet data updated successfully' }));
          });
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid JSON payload' }));
        }
      });
      return;
    }
  }

  // API Route: /api/telemetry (Secure ESP32 & Cellular GPS Ingestion)
  if (pathname === '/api/telemetry') {
    if (req.method === 'GET') {
      // Returns current status of telemetry ingestion and active buses
      const activeBuses = [];
      const now = Date.now();
      liveTelemetryMemory.forEach((data, bId) => {
        const ageSec = Math.round((now - data.receivedAtMs) / 1000);
        activeBuses.push({
          busId: bId,
          routeId: data.routeId,
          latitude: data.latitude,
          longitude: data.longitude,
          speed: data.speed,
          satellites: data.satellites,
          fixStatus: data.fixStatus,
          status: ageSec < 30 ? 'online' : (ageSec < 120 ? 'stale' : 'offline'),
          ageSeconds: ageSec,
          lastSeenIST: data.lastSeenIST
        });
      });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'active',
        service: 'RouteIQ ESP32 Telemetry Gateway',
        firestoreConnected: Boolean(adminDb),
        totalActiveBuses: activeBuses.length,
        buses: activeBuses
      }, null, 2));
      return;
    }

    if (req.method === 'POST') {
      // 1. Device Token Authentication
      const authHeader = req.headers['authorization'] || '';
      const deviceTokenHeader = req.headers['x-device-token'] || '';
      let providedToken = deviceTokenHeader;

      if (!providedToken && authHeader.toLowerCase().startsWith('bearer ')) {
        providedToken = authHeader.substring(7).trim();
      }

      if (!providedToken || providedToken !== ROUTEIQ_DEVICE_TOKEN) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: 'Unauthorized: Invalid or missing hardware device token (x-device-token or Bearer token required)'
        }));
        return;
      }

      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', async () => {
        try {
          const payload = JSON.parse(body);

          // 2. Extract and sanitize fields
          const rawBusId = String(payload.busId || payload.bus_id || payload.busPlate || '').trim();
          if (!rawBusId) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Missing required field: busId (or bus_id)' }));
            return;
          }

          const busId = rawBusId.startsWith('Route ')
            ? (ROUTE_BUS_MAP[rawBusId] || rawBusId)
            : rawBusId;
          const resolvedRouteId = payload.routeId || payload.route_id || BUS_ROUTE_MAP[busId] || BUS_ROUTE_MAP[rawBusId] || 'Route 16';

          const lat = parseFloat(payload.latitude);
          const lng = parseFloat(payload.longitude);
          const speed = parseFloat(payload.speed !== undefined ? payload.speed : payload.speed_kmh) || 0;
          const heading = parseFloat(payload.heading) || 0;
          const satellites = parseInt(payload.satellites, 10) || 0;
          const fixStatus = String(payload.fixStatus || payload.fix_status || (satellites >= 4 ? '3D Fix' : 'No Fix')).trim();
          const accuracy = parseFloat(payload.accuracy) || (satellites >= 6 ? 4.5 : 12.0);
          const gpsTimestamp = payload.gpsTimestamp || payload.timestamp || new Date().toISOString();

          // 3. Validation
          if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Invalid coordinate range: latitude must be [-90, 90], longitude [-180, 180]' }));
            return;
          }

          // Reject invalid zero coordinates or explicit No Fix
          if ((Math.abs(lat) < 0.0001 && Math.abs(lng) < 0.0001) || fixStatus.toLowerCase() === 'no fix') {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Rejected invalid fix: GPS coordinates are 0.0 or fixStatus is No Fix' }));
            return;
          }

          const nowMs = Date.now();

          // 4. Rate Limiting (Min 3000ms between requests per device)
          const lastRequestTime = deviceRateLimits.get(busId) || 0;
          if (nowMs - lastRequestTime < 3000) {
            res.writeHead(429, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              error: 'Rate limit exceeded: Telemetry updates must be spaced at least 3 seconds apart.'
            }));
            return;
          }
          deviceRateLimits.set(busId, nowMs);

          // 5. Duplicate & Replay Check
          const lastGpsTime = deviceLastGpsTimestamp.get(busId);
          if (lastGpsTime && lastGpsTime === gpsTimestamp) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              success: true,
              message: 'Duplicate packet skipped (identical GPS timestamp already stored)'
            }));
            return;
          }
          deviceLastGpsTimestamp.set(busId, gpsTimestamp);

          // Format IST timestamp for human-friendly logs
          const istString = new Intl.DateTimeFormat('en-IN', {
            timeZone: 'Asia/Kolkata',
            hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true
          }).format(new Date()) + ' IST';

          // 6. Write to In-Memory Cache
          liveTelemetryMemory.set(busId, {
            busId,
            routeId: resolvedRouteId,
            latitude: lat,
            longitude: lng,
            speed,
            heading,
            satellites,
            fixStatus,
            accuracy,
            gpsTimestamp,
            receivedAtMs: nowMs,
            lastSeenIST: istString
          });

          // 7. Write to Cloud Firestore (Admin SDK)
          let firestoreCommitted = false;
          let firestoreError = null;

          if (adminDb) {
            try {
              const batch = adminDb.batch();

              const telemetryDoc = {
                busId: busId,
                busPlate: busId,
                routeId: resolvedRouteId,
                latitude: lat,
                longitude: lng,
                speed: speed,
                speed_kmh: speed,
                heading: heading,
                satellites: satellites,
                fixStatus: fixStatus,
                accuracy: accuracy,
                gpsTimestamp: gpsTimestamp,
                status: 'online',
                source: 'esp32-a7670c-hardware',
                timestamp_ist: istString,
                updatedAt: FieldValue.serverTimestamp(),
                timestamp: FieldValue.serverTimestamp(),
                serverReceivedAt: FieldValue.serverTimestamp()
              };

              // Most recent position under busId
              const busDocRef = adminDb.collection('gps_locations').doc(busId);
              batch.set(busDocRef, telemetryDoc, { merge: true });

              // Alias under routeId for route queries
              if (resolvedRouteId && resolvedRouteId !== busId) {
                const routeDocRef = adminDb.collection('gps_locations').doc(resolvedRouteId);
                batch.set(routeDocRef, telemetryDoc, { merge: true });
              }

              // Append to history subcollection: gps_locations/{busId}/history
              const historyRef = adminDb.collection('gps_locations').doc(busId).collection('history').doc();
              batch.set(historyRef, {
                latitude: lat,
                longitude: lng,
                speed: speed,
                heading: heading,
                satellites: satellites,
                accuracy: accuracy,
                gpsTimestamp: gpsTimestamp,
                serverTimestamp: FieldValue.serverTimestamp(),
                timestamp_ist: istString
              });

              await batch.commit();
              firestoreCommitted = true;
            } catch (fsErr) {
              console.error('❌ Firestore write failure during telemetry ingestion:', fsErr.message);
              firestoreError = fsErr.message;
            }
          }

          console.log(`📡 [ESP32 Telemetry] Bus ${busId} (${resolvedRouteId}): ${lat.toFixed(5)}, ${lng.toFixed(5)} | ${speed} km/h | Sats: ${satellites} | Fix: ${fixStatus} | Firestore: ${firestoreCommitted ? '✅' : '⚠️ ' + (firestoreError || 'Admin offline')}`);

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: true,
            busId,
            routeId: resolvedRouteId,
            latitude: lat,
            longitude: lng,
            speed,
            satellites,
            fixStatus,
            firestoreCommitted,
            serverTimestamp: new Date().toISOString()
          }));
        } catch (parseErr) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Malformed JSON payload: ' + parseErr.message }));
        }
      });
      return;
    }
  }

  // Clean Route Rewrites
  if (pathname === '/' || pathname === '') {
    pathname = '/index.html';
  } else if (pathname === '/login') {
    pathname = '/login.html';
  } else if (pathname === '/signup' || pathname === '/register') {
    pathname = '/signup.html';
  }

  // Security: Block access to service account private keys, rules, .env, and hidden files
  const filename = path.basename(pathname).toLowerCase();
  if (
    filename.startsWith('.') ||
    filename.includes('routeiq-d2104-') ||
    filename.endsWith('.rules') ||
    filename === 'firebase.json' ||
    filename === '.firebaserc' ||
    filename === 'package.json' ||
    filename === 'package-lock.json' ||
    filename.includes('serviceaccount') ||
    filename.endsWith('.key') ||
    filename.endsWith('.pem') ||
    filename.endsWith('.ps1')
  ) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('403 Forbidden: Protected server resource');
    return;
  }

  // Sanitize path to prevent directory traversal
  const sanitizedPath = path.normalize(pathname).replace(/^(\.\.[\/\\])+/, '');

  // Resolve file: check __dirname first, then fallback to process.cwd() (standard for Vercel functions)
  let resolvedBase = __dirname;
  let filePath = path.join(__dirname, sanitizedPath);

  if (!fs.existsSync(filePath)) {
    const cwdCandidate = path.join(process.cwd(), sanitizedPath);
    if (fs.existsSync(cwdCandidate)) {
      filePath = cwdCandidate;
      resolvedBase = process.cwd();
    }
  }

  // Directory traversal check against the resolved base directory
  const relativeFromBase = path.relative(resolvedBase, filePath);
  if (relativeFromBase.startsWith('..') || path.isAbsolute(relativeFromBase)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('403 Forbidden');
    return;
  }

  // Handle directory requests
  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, 'index.html');
  }

  fs.readFile(filePath, (err, content) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <!DOCTYPE html>
          <html>
            <head><title>404 Not Found</title></head>
            <body style="font-family: sans-serif; background: #090d16; color: #fff; padding: 40px; text-align: center;">
              <h2>404 - File Not Found</h2>
              <p>The requested file <code>${pathname}</code> was not found.</p>
              <p><a href="/" style="color: #3b82f6;">Return to Home</a></p>
            </body>
          </html>
        `);
      } else {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(`500 Server Error: ${err.code}`);
      }
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    let contentType = MIME_TYPES[ext] || 'application/octet-stream';

    if (filename === 'manifest.json' || ext === '.webmanifest') {
      contentType = 'application/manifest+json; charset=utf-8';
    }

    if (filename === 'sw.js') {
      res.setHeader('Service-Worker-Allowed', '/');
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    }

    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content);
  });
};

export default handler;

// For local development only, create and listen on an HTTP server
if (!process.env.VERCEL) {
  const server = http.createServer(handler);
  server.listen(PORT, () => {
    console.log(`\n========================================`);
    console.log(`🚀 RouteIQ Dev Server is running!`);
    console.log(`📡 URL: http://localhost:${PORT}`);
    console.log(`📁 Serving directory: ${__dirname}`);
    console.log(`⚡ API: http://localhost:${PORT}/api/fleet-data`);
    console.log(`========================================\n`);
  });
}
