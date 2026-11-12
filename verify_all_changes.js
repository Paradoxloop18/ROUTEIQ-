import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const sa = JSON.parse(fs.readFileSync(path.join(__dirname, 'routeiq-d2104-8599cf6363fd.json'), 'utf8'));
const app = initializeApp({ credential: cert(sa) });
const db = getFirestore(app);

async function run() {
  console.log('🧪 VERIFYING ROUTEIQ DATABASE & UI CHANGES...\n');
  let allPassed = true;

  // 1. Verify Firestore Routes
  console.log('--- 1. Checking Firestore [routes] collection ---');
  const routesSnap = await db.collection('routes').get();
  const routeIds = routesSnap.docs.map(d => d.id).sort();
  console.log('Found routes:', routeIds);

  const expectedRoutes = ['Route 03', 'Route 13', 'Route 16', 'Route 19A', 'Route 25'];
  const hasAllRoutes = expectedRoutes.every(r => routeIds.includes(r));
  const hasNoMalformed = !routeIds.some(r => r.includes('-') || r !== r.trim());

  if (hasAllRoutes && hasNoMalformed) {
    console.log('✅ PASS: All 5 routes exist and no malformed route documents found.');
  } else {
    console.error('❌ FAIL: Routes mismatch.', { expectedRoutes, routeIds });
    allPassed = false;
  }

  // Check details of routes 16, 19A, 25
  for (const rId of ['Route 16', 'Route 19A', 'Route 25']) {
    const docData = routesSnap.docs.find(d => d.id === rId)?.data();
    if (docData && docData.busPlate && docData.stops && docData.stops.length > 0) {
      console.log(`  - ${rId}: Bus ${docData.busPlate}, Capacity: ${docData.capacity}, Current: ${docData.currentCount}, Stops: ${docData.stops.length}`);
    } else {
      console.error(`❌ FAIL: Incomplete route data for ${rId}`);
      allPassed = false;
    }
  }

  // 2. Verify Firestore Students
  console.log('\n--- 2. Checking Firestore [students] collection ---');
  const studentsSnap = await db.collection('students').get();
  const countsByRoute = {};
  studentsSnap.docs.forEach(d => {
    const r = d.data().routeId || d.data().route || 'unknown';
    countsByRoute[r] = (countsByRoute[r] || 0) + 1;
  });
  console.log('Total students in Firestore:', studentsSnap.size);
  console.log('Breakdown by route:', countsByRoute);

  if (
    countsByRoute['Route 16'] === 50 &&
    countsByRoute['Route 19A'] === 50 &&
    countsByRoute['Route 25'] === 50 &&
    countsByRoute['Route 03'] === 45 &&
    countsByRoute['Route 13'] === 41
  ) {
    console.log('✅ PASS: Student counts by route match configuration (total 236 students).');
  } else {
    console.error('❌ FAIL: Student counts mismatch.', countsByRoute);
    allPassed = false;
  }

  // 3. Verify CSV files
  console.log('\n--- 3. Checking CSV Exports ---');
  const csvFiles = [
    'RouteIQ_Route_16_Students.csv',
    'RouteIQ_Route_19A_Students.csv',
    'RouteIQ_Route_25_Students.csv'
  ];

  for (const f of csvFiles) {
    const p1 = path.join(__dirname, f);
    const p2 = path.join(__dirname, 'RouteIQ_Student_Bulk_Import', f);
    const exists1 = fs.existsSync(p1);
    const exists2 = fs.existsSync(p2);
    const lines1 = exists1 ? fs.readFileSync(p1, 'utf8').trim().split('\n').length : 0;
    const lines2 = exists2 ? fs.readFileSync(p2, 'utf8').trim().split('\n').length : 0;

    if (exists1 && exists2 && lines1 === 51 && lines2 === 51) {
      console.log(`✅ PASS: ${f} exists in root and bulk folder (50 records + 1 header).`);
    } else {
      console.error(`❌ FAIL: CSV file issue for ${f}: root(${lines1}), bulk(${lines2})`);
      allPassed = false;
    }
  }

  // 4. Verify index.html Table Columns
  console.log('\n--- 4. Checking index.html Table Columns ---');
  const indexHtml = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

  const hasAttendanceHeader = indexHtml.includes('<th>Attendance</th>');
  const hasEntryHeader = indexHtml.includes('<th>Entry</th>');
  const hasExitHeader = indexHtml.includes('<th>Exit</th>');
  const hasTravelTimeHeader = indexHtml.includes('<th>Travel Time</th>');

  const hasAttendanceCell = indexHtml.includes('${sAttendance}');
  const hasEntryCell = indexHtml.includes('${sEntryTime}');
  const hasExitCell = indexHtml.includes('${sExitTime}');
  const hasTravelTimeCell = indexHtml.includes('${sTravelTime}');

  if (!hasAttendanceHeader && !hasEntryHeader && !hasExitHeader && !hasTravelTimeHeader &&
      !hasAttendanceCell && !hasEntryCell && !hasExitCell && !hasTravelTimeCell) {
    console.log('✅ PASS: Attendance, Entry, Exit, and Travel Time columns completely removed from index.html.');
  } else {
    console.error('❌ FAIL: Some columns still present in index.html:', {
      hasAttendanceHeader, hasEntryHeader, hasExitHeader, hasTravelTimeHeader,
      hasAttendanceCell, hasEntryCell, hasExitCell, hasTravelTimeCell
    });
    allPassed = false;
  }

  // 5. Verify fleet_data.json
  console.log('\n--- 5. Checking fleet_data.json ---');
  const fleetData = JSON.parse(fs.readFileSync(path.join(__dirname, 'fleet_data.json'), 'utf8'));
  const fleetStudentRoutes = Object.keys(fleetData.studentsDatabase || {});
  console.log('Routes in fleet_data.json studentsDatabase:', fleetStudentRoutes);
  if (expectedRoutes.every(r => fleetStudentRoutes.includes(r))) {
    console.log('✅ PASS: All 5 routes are present in fleet_data.json studentsDatabase.');
  } else {
    console.error('❌ FAIL: Missing routes in fleet_data.json:', fleetStudentRoutes);
    allPassed = false;
  }

  console.log('\n=============================================');
  if (allPassed) {
    console.log('🏆 ALL 5 VERIFICATION CHECKS PASSED SUCCESSFULLY!');
  } else {
    console.error('❌ ONE OR MORE VERIFICATION CHECKS FAILED.');
    process.exit(1);
  }
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});

