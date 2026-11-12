// migrate_users.js
// Safe Authorized User Migration Tool for CMR RouteIQ (Project: routeiq-d2104)

import { initializeApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';

const sa = JSON.parse(readFileSync('./routeiq-d2104-8599cf6363fd.json', 'utf8'));
const app = initializeApp({ credential: cert(sa) });
const auth = getAuth(app);
const db = getFirestore(app);

async function migrate() {
  console.log('===============================================================');
  console.log('🔄 CMR RouteIQ: Authoritative User Profile Migration');
  console.log('===============================================================\n');

  const authList = await auth.listUsers(100);
  console.log(`Found ${authList.users.length} accounts in Firebase Authentication.\n`);

  for (const u of authList.users) {
    const userRef = db.collection('users').doc(u.uid);
    const snap = await userRef.get();
    let data = snap.exists ? snap.data() : {};

    let role = data.role || u.customClaims?.role || null;
    let displayName = data.displayName || u.displayName || (u.email ? u.email.split('@')[0] : 'User');
    let status = data.status || 'active';

    // Authoritative role assignment based on account identity:
    if (u.email === 'admin@cmrcet.ac.in') {
      role = 'Admin';
      displayName = 'Transport Fleet SuperAdmin';
      await auth.setCustomUserClaims(u.uid, { role: 'admin' });
    } else if (u.email === 'driver.route16@cmrgi.ac.in') {
      role = 'Driver';
      displayName = 'M. Naresh Kumar (Driver)';
      await auth.setCustomUserClaims(u.uid, { role: 'driver' });
    } else if (u.email === 'incharge.cmrec@cmrgi.ac.in') {
      role = 'Incharge';
      displayName = 'P. Mahesh Babu (Incharge)';
      await auth.setCustomUserClaims(u.uid, { role: 'incharge' });
    } else if (u.email === 'emergency.desk@cmrgi.ac.in') {
      role = 'Emergency';
      displayName = 'Emergency Dispatch Desk';
      await auth.setCustomUserClaims(u.uid, { role: 'emergency' });
    } else if (u.email === 'kiranram134@cmrgi.ac.in') {
      // Staff account registered by faculty
      role = 'Staff';
      displayName = 'Kiran (Staff)';
      await auth.setCustomUserClaims(u.uid, { role: 'staff' });
    } else if (u.email === 'student.cse@cmrcet.ac.in') {
      role = 'Student';
      displayName = 'Rahul Reddy (Student)';
      await auth.setCustomUserClaims(u.uid, { role: 'student' });
    } else if (!role) {
      // Default roll number patterns (e.g. 25h51...) to Student, faculty/staff to Staff
      if (u.email.toLowerCase().includes('staff') || u.email.endsWith('@cmrgi.ac.in') && !u.email.startsWith('25h')) {
        role = 'Staff';
      } else {
        role = 'Student';
      }
      await auth.setCustomUserClaims(u.uid, { role: role.toLowerCase() });
    }

    const roleLower = role.toLowerCase();
    const accountType = (roleLower === 'staff') ? 'Staff' : (roleLower === 'admin' ? 'Admin' : (roleLower === 'driver' ? 'Driver' : (roleLower === 'incharge' ? 'Incharge' : (roleLower === 'emergency' ? 'Emergency' : 'Student'))));

    const updatedProfile = {
      uid: u.uid,
      email: u.email,
      displayName: displayName,
      role: role,
      roleLower: roleLower,
      accountType: accountType,
      status: status,
      updatedAt: FieldValue.serverTimestamp()
    };

    if (!snap.exists) {
      updatedProfile.createdAt = FieldValue.serverTimestamp();
      console.log(`➕ Creating missing profile for ${u.email} -> Role: [${role}]`);
    } else {
      console.log(`✓ Synchronizing profile for ${u.email} -> Role: [${role}]`);
    }

    await userRef.set(updatedProfile, { merge: true });
  }

  console.log('\n===============================================================');
  console.log('✅ User Profile Migration Completed Successfully');
  console.log('===============================================================\n');
}

migrate();
