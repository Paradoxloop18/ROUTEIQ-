// test_telemetry_endpoint.js
// Automated verification suite for RouteIQ ESP32 Telemetry Endpoint & Validation

import http from 'http';
import { spawn } from 'child_process';

const PORT = 3000;
const VALID_TOKEN = 'routeiq_hw_sec_9a748879b565b17c';

function makeRequest(options, postData) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(body); } catch (_) {}
        resolve({ statusCode: res.statusCode, headers: res.headers, body, json });
      });
    });
    req.on('error', reject);
    if (postData) {
      req.write(typeof postData === 'string' ? postData : JSON.stringify(postData));
    }
    req.end();
  });
}

async function runTests() {
  console.log('🚀 Starting RouteIQ Local Server for Telemetry Test...');
  const serverProcess = spawn('node', ['server.js'], {
    cwd: process.cwd(),
    stdio: ['ignore', 'pipe', 'pipe']
  });

  serverProcess.stdout.on('data', d => process.stdout.write(`[SERVER] ${d}`));
  serverProcess.stderr.on('data', d => process.stderr.write(`[SERVER ERR] ${d}`));

  // Wait 1.5 seconds for server to bind
  await new Promise(r => setTimeout(r, 1500));

  let passed = 0;
  let failed = 0;

  function assert(desc, condition) {
    if (condition) {
      console.log(`✅ PASS: ${desc}`);
      passed++;
    } else {
      console.error(`❌ FAIL: ${desc}`);
      failed++;
    }
  }

  try {
    // Test 1: GET /api/telemetry
    console.log('\n--- Test 1: Health & Status (GET /api/telemetry) ---');
    const resGet = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/telemetry',
      method: 'GET'
    });
    assert('GET returns HTTP 200', resGet.statusCode === 200);
    assert('GET returns status active', resGet.json && resGet.json.status === 'active');
    assert('Firestore connection reported', resGet.json && typeof resGet.json.firestoreConnected === 'boolean');

    // Test 2: POST without Token -> 401
    console.log('\n--- Test 2: Auth Rejection (Missing Token) ---');
    const resNoToken = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/telemetry',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, {
      busId: 'TS-08-UB-4516',
      latitude: 17.5401,
      longitude: 78.4902
    });
    assert('Missing token rejected with 401', resNoToken.statusCode === 401);

    // Test 3: POST with Invalid Token -> 401
    console.log('\n--- Test 3: Auth Rejection (Invalid Token) ---');
    const resBadToken = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/telemetry',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Device-Token': 'wrong_token_12345'
      }
    }, {
      busId: 'TS-08-UB-4516',
      latitude: 17.5401,
      longitude: 78.4902
    });
    assert('Invalid token rejected with 401', resBadToken.statusCode === 401);

    // Test 4: POST with Out-of-Range Coordinates -> 400
    console.log('\n--- Test 4: Coordinate Validation (Out of Bounds) ---');
    const resBadCoords = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/telemetry',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Device-Token': VALID_TOKEN
      }
    }, {
      busId: 'TS-08-UB-4516',
      latitude: 95.1234, // Invalid latitude > 90
      longitude: 78.4902,
      gpsTimestamp: '2026-10-27T06:00:00Z'
    });
    assert('Latitude > 90 rejected with 400', resBadCoords.statusCode === 400);

    // Test 5: POST with Zero/No-Fix Coordinates -> 400
    console.log('\n--- Test 5: Coordinate Validation (Zero Coordinates) ---');
    const resZeroCoords = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/telemetry',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Device-Token': VALID_TOKEN
      }
    }, {
      busId: 'TS-08-UB-4516',
      latitude: 0,
      longitude: 0,
      gpsTimestamp: '2026-10-27T06:01:00Z'
    });
    assert('Coordinates (0,0) rejected with 400', resZeroCoords.statusCode === 400);

    // Test 6: POST Valid Telemetry -> 200
    console.log('\n--- Test 6: Valid Hardware Telemetry Packet Ingestion ---');
    const testTimestamp1 = new Date().toISOString();
    const resValid = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/telemetry',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Device-Token': VALID_TOKEN
      }
    }, {
      busId: 'TS-08-UB-4516',
      routeId: 'Route 16',
      latitude: 17.53852,
      longitude: 78.49210,
      speed: 34.5,
      heading: 142.0,
      satellites: 8,
      fixStatus: '3D Fix',
      gpsTimestamp: testTimestamp1
    });
    assert('Valid packet accepted with 200', resValid.statusCode === 200);
    assert('Success flag in JSON response', resValid.json && resValid.json.success === true);
    assert('Firestore commit reported', resValid.json && resValid.json.firestoreCommitted === true);

    // Test 7: Rapid Request -> 429 Rate Limit (fire two back-to-back requests for Bus TS-08-UA-1234)
    console.log('\n--- Test 7: Rate Limiting Enforcement (<3s Spacing) ---');
    const p1 = makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/telemetry',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Device-Token': VALID_TOKEN
      }
    }, {
      busId: 'TS-08-UA-1234',
      routeId: 'Route 03',
      latitude: 17.51234,
      longitude: 78.54321,
      speed: 28.0,
      satellites: 7,
      fixStatus: '3D Fix',
      gpsTimestamp: '2026-10-27T06:10:00Z'
    });

    // Send immediately after (< 100ms) without waiting for p1 to finish network commit
    await new Promise(r => setTimeout(r, 80));

    const p2 = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/telemetry',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Device-Token': VALID_TOKEN
      }
    }, {
      busId: 'TS-08-UA-1234',
      routeId: 'Route 03',
      latitude: 17.51240,
      longitude: 78.54330,
      speed: 29.0,
      satellites: 7,
      fixStatus: '3D Fix',
      gpsTimestamp: '2026-10-27T06:10:01Z'
    });

    await p1; // ensure p1 finishes
    assert('Immediate subsequent request rejected with 429', p2.statusCode === 429);
    assert('Rate limit error message returned', p2.json && p2.json.error && p2.json.error.includes('Rate limit'));

    // Test 8: Wait 3.2s and test duplicate GPS timestamp detection
    console.log('\n--- Test 8: Replay / Duplicate Packet Detection ---');
    await new Promise(r => setTimeout(r, 3200));

    const resDuplicate = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/telemetry',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Device-Token': VALID_TOKEN
      }
    }, {
      busId: 'TS-08-UB-4516',
      routeId: 'Route 16',
      latitude: 17.53852,
      longitude: 78.49210,
      speed: 34.5,
      heading: 142.0,
      satellites: 8,
      fixStatus: '3D Fix',
      gpsTimestamp: testTimestamp1 // Identical timestamp
    });
    assert('Duplicate timestamp handled gracefully (HTTP 200)', resDuplicate.statusCode === 200);
    assert('Skipped duplicate packet message', resDuplicate.json && resDuplicate.json.message && resDuplicate.json.message.includes('Duplicate packet skipped'));

  } catch (err) {
    console.error('Test execution error:', err);
    failed++;
  } finally {
    serverProcess.kill('SIGTERM');
    console.log(`\n========================================`);
    console.log(`TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
    console.log(`========================================\n`);
    process.exit(failed > 0 ? 1 : 0);
  }
}

runTests();
