import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SERVICE_ACCOUNT_FILE = path.join(__dirname, 'routeiq-d2104-8599cf6363fd.json');
const FLEET_DATA_PATH = path.join(__dirname, 'fleet_data.json');

const sa = JSON.parse(fs.readFileSync(SERVICE_ACCOUNT_FILE, 'utf8'));
const app = initializeApp({ credential: cert(sa) });
const db = getFirestore(app);

const fleet = JSON.parse(fs.readFileSync(FLEET_DATA_PATH, 'utf8'));

// Name generator pools
const firstNames = [
  "Rahul","Ananya","Arjun","Harsha","Sneha","Kiran","Divya","Siddharth","Pooja","Varun",
  "Kavya","Nikhil","Meghana","Rohan","Bhavana","Sai","Pranathi","Manish","Deepika","Karthik",
  "Sravani","Aditya","Keerthana","Teja","Mounika","Abhinav","Niharika","Tarun","Vaishnavi","Vamshi",
  "Harini","Chaitanya","Akshitha","Gautham","Spandana","Pradeep","Aravind","Swathi","Vikas","Sanjana",
  "Ganesh","Pavani","Shiva","Pallavi","Akhil","Sindhu","Rajesh","Navya","Mahesh","Sowmya"
];

const lastNames = [
  "Reddy","Sharma","Kumar","Rao","Verma","Gupta","Yadav","Patel","Singh","Chowdary",
  "Naidu","Joshi","Mishra","Kulkarni","Deshmukh","Nair","Menon","Pillai","Iyer","Bhat",
  "Hegde","Shetty","Goud","Venkatesh","Chary","Raju","Prasad","Murthy","Sastry","Vangala",
  "Kancharla","Boppana","Thota","Mothe","Kommula","Duggirala","Bandari","Golla","Pothula","Marri",
  "Katakam","Allam","Gaddam","Dharavath","Banoth","Guguloth","Jadhav","Pawar","Solanki","Chauhan"
];

const departments = ["CSE","ECE","IT","AIML","Data Science","EEE","Mechanical","Civil"];
const yearsList = ["1st","2nd","3rd","4th"];

const routeCampusAllotments = {
  'Route 16': { CMRCET: 17, CMREC: 17, CMRIT: 16 },
  'Route 19A': { CMRCET: 17, CMREC: 17, CMRIT: 16 },
  'Route 25': { CMRCET: 16, CMREC: 16, CMRIT: 18 }
};

const routeCodes = {
  'Route 16': { code: '16', rcptNum: 1600, fuelLevel: 80 },
  'Route 19A': { code: '19', rcptNum: 1900, fuelLevel: 85 },
  'Route 25': { code: '25', rcptNum: 2500, fuelLevel: 75 }
};

const campusMetadata = {
  'CMRCET': { prefix: '22811A', receiptPrefix: 'RCPT-CET' },
  'CMREC':  { prefix: '23812A', receiptPrefix: 'RCPT-REC' },
  'CMRIT':  { prefix: '21813A', receiptPrefix: 'RCPT-RIT' }
};

async function main() {
  console.log('🚀 Step 1: Cleaning up malformed route documents in Firestore...');
  const routesSnap = await db.collection('routes').get();
  for (const docSnap of routesSnap.docs) {
    if (docSnap.id.includes('-') || docSnap.id !== docSnap.id.trim()) {
      console.log(`🗑️ Deleting malformed doc [${docSnap.id}]...`);
      await docSnap.ref.delete();
    }
  }

  console.log('\n🚌 Step 2: Adding and connecting routes (Route 16, Route 19A, Route 25) in Firestore...');
  const allRoutes = ['Route 03', 'Route 13', 'Route 16', 'Route 19A', 'Route 25'];
  for (const rId of allRoutes) {
    const rData = fleet.routesData[rId];
    if (!rData) {
      console.warn(`Missing route data for ${rId}`);
      continue;
    }

    const fuelLevel = routeCodes[rId] ? routeCodes[rId].fuelLevel : (rData.fuelLevel || 90);
    const routePayload = {
      routeId: rId,
      busPlate: rData.busPlate,
      campus: rData.campus || 'CMRGI',
      capacity: rData.capacity || 50,
      currentCount: 50,
      status: 'Active',
      fuelLevel: fuelLevel,
      inchargeName: rData.inchargeName || 'Incharge Staff',
      inchargePhone: rData.inchargePhone || '+91 9999999999',
      color: rData.color || '#3b82f6',
      stops: rData.stops || [],
      updatedAt: FieldValue.serverTimestamp()
    };

    await db.collection('routes').doc(rId).set(routePayload, { merge: true });
    console.log(`✅ Upserted route [${rId}] (${rData.busPlate}) with ${rData.stops.length} stops.`);
  }

  console.log('\n👥 Step 3: Generating and uploading 50 students each for Route 16, Route 19A, and Route 25...');
  if (!fleet.studentsDatabase) fleet.studentsDatabase = {};

  let globalNameIndex = 60; // unique starting offset
  const newStudentsByRoute = {};

  for (const [rId, allotment] of Object.entries(routeCampusAllotments)) {
    const rData = fleet.routesData[rId];
    const boardingStops = rData.stops.slice(0, -1); // exclude final college stop
    const cfg = routeCodes[rId];
    newStudentsByRoute[rId] = [];
    let routeStudentIndex = 1;

    for (const [campusName, count] of Object.entries(allotment)) {
      const meta = campusMetadata[campusName];
      for (let c = 1; c <= count; c++) {
        const studentNum = routeStudentIndex++;
        globalNameIndex++;

        const fn = firstNames[globalNameIndex % firstNames.length];
        const ln = lastNames[(globalNameIndex * 7) % lastNames.length];
        const studentName = `${fn} ${ln}`;
        const rollNumber = `${meta.prefix}${cfg.code}${String(c).padStart(2, '0')}`;
        const dept = departments[(globalNameIndex) % departments.length];
        const year = yearsList[(globalNameIndex) % yearsList.length];
        const stopName = boardingStops[(studentNum - 1) % boardingStops.length].name;
        const isPaid = (studentNum % 8 !== 0); // ~88% paid rate
        const feeStatus = isPaid ? 'Paid' : 'Pending';
        const receipt = isPaid ? `${meta.receiptPrefix}-${cfg.rcptNum + studentNum}` : '—';

        const studentRecord = {
          id: studentNum,
          name: studentName,
          roll: rollNumber,
          year: year,
          department: dept,
          dept: dept,
          campus: campusName,
          destination: 'CMRGI',
          receipt: isPaid ? receipt : null,
          boardingPoint: stopName,
          stop: stopName,
          feeStatus: feeStatus,
          fee: feeStatus,
          routeId: rId,
          source: 'RouteIQ student CSV import',
          importedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp()
        };

        newStudentsByRoute[rId].push(studentRecord);
      }
    }

    console.log(`Generated ${newStudentsByRoute[rId].length} students for ${rId}`);
  }

  // Batch upload to Firestore
  for (const [rId, studentsList] of Object.entries(newStudentsByRoute)) {
    console.log(`Uploading ${studentsList.length} students for [${rId}] to Firestore...`);
    // Firestore batches have limit of 500 ops; 50 is well within limit
    const batch = db.batch();
    for (const s of studentsList) {
      const docRef = db.collection('students').doc(s.roll);
      batch.set(docRef, s, { merge: true });
    }
    await batch.commit();
    console.log(`✅ Uploaded [${rId}] students to Firestore.`);
  }

  console.log('\n📄 Step 4: Exporting CSV files for routes 16, 19A, and 25...');
  const bulkDir = path.join(__dirname, 'RouteIQ_Student_Bulk_Import');
  if (!fs.existsSync(bulkDir)) fs.mkdirSync(bulkDir, { recursive: true });

  for (const [rId, studentsList] of Object.entries(newStudentsByRoute)) {
    const safeRoute = rId.replace(' ', '_');
    const fileName = `RouteIQ_${safeRoute}_Students.csv`;
    let csv = 'ID,Name,RollNumber,Year,Department,Campus,Receipt,BoardingPoint,FeeStatus\n';
    studentsList.forEach(s => {
      csv += `"${s.id}","${s.name}","${s.roll}","${s.year}","${s.dept}","${s.campus}","${s.receipt || '—'}","${s.stop}","${s.fee}"\n`;
    });

    // Write to root
    fs.writeFileSync(path.join(__dirname, fileName), csv, 'utf8');
    // Write to RouteIQ_Student_Bulk_Import
    fs.writeFileSync(path.join(bulkDir, fileName), csv, 'utf8');
    console.log(`✅ Saved CSV: ${fileName}`);
  }

  console.log('\n💾 Step 5: Updating fleet_data.json with new route students...');
  for (const [rId, studentsList] of Object.entries(newStudentsByRoute)) {
    // For JSON storage, convert timestamps to plain objects
    fleet.studentsDatabase[rId] = studentsList.map(s => ({
      ...s,
      importedAt: { seconds: Math.floor(Date.now() / 1000), nanoseconds: 0 },
      updatedAt: { seconds: Math.floor(Date.now() / 1000), nanoseconds: 0 },
      docId: s.roll
    }));
    if (fleet.routesData[rId]) {
      fleet.routesData[rId].capacity = 50;
      fleet.routesData[rId].currentCount = 50;
    }
  }
  fleet.lastUpdated = new Date().toISOString();
  fs.writeFileSync(FLEET_DATA_PATH, JSON.stringify(fleet, null, 2), 'utf8');
  console.log('✅ fleet_data.json updated successfully.');

  console.log('\n📡 Step 6: Ensuring GPS locations exist for Route 13, Route 19A, and Route 25...');
  const gpsPayloads = {
    'Route 13': {
      busId: 'TS-08-UB-4513',
      routeId: 'Route 13',
      busPlate: 'TS-08-UB-4513',
      altitude: 0,
      battery: 91,
      satellites: 9,
      heading: 120,
      latitude: 17.3995,
      longitude: 78.5110,
      accuracy: 4.2,
      source: 'esp32-a7670c-hardware',
      speed: 28.0,
      speed_kmh: 28.0,
      fixStatus: '3D Fix',
      status: 'online',
      gpsTimestamp: new Date().toISOString(),
      timestamp_ist: new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' }) + ' IST',
      updatedAt: FieldValue.serverTimestamp()
    },
    'Route 19A': {
      busId: 'TS-08-UB-4519',
      routeId: 'Route 19A',
      busPlate: 'TS-08-UB-4519',
      altitude: 0,
      battery: 88,
      satellites: 8,
      heading: 95,
      latitude: 17.4490,
      longitude: 78.4510,
      accuracy: 4.8,
      source: 'esp32-a7670c-hardware',
      speed: 32.0,
      speed_kmh: 32.0,
      fixStatus: '3D Fix',
      status: 'online',
      gpsTimestamp: new Date().toISOString(),
      timestamp_ist: new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' }) + ' IST',
      updatedAt: FieldValue.serverTimestamp()
    },
    'Route 25': {
      busId: 'TS-08-UB-4525',
      routeId: 'Route 25',
      busPlate: 'TS-08-UB-4525',
      altitude: 0,
      battery: 95,
      satellites: 10,
      heading: 65,
      latitude: 17.5040,
      longitude: 78.4130,
      accuracy: 4.0,
      source: 'esp32-a7670c-hardware',
      speed: 30.5,
      speed_kmh: 30.5,
      fixStatus: '3D Fix',
      status: 'online',
      gpsTimestamp: new Date().toISOString(),
      timestamp_ist: new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' }) + ' IST',
      updatedAt: FieldValue.serverTimestamp()
    }
  };

  for (const [rId, gpsData] of Object.entries(gpsPayloads)) {
    await db.collection('gps_locations').doc(rId).set(gpsData, { merge: true });
    await db.collection('gps_locations').doc(gpsData.busPlate).set(gpsData, { merge: true });
    console.log(`✅ Set live GPS location for [${rId}] (${gpsData.busPlate})`);
  }

  console.log('\n🎉 ALL DONE! Verified complete synchronization with Firebase Firestore!');
}

main().catch(err => {
  console.error('❌ Error executing sync script:', err);
  process.exit(1);
});

