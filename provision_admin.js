// provision_admin.js
// Authoritative Secure Administrator Provisioning Tool for CMR RouteIQ (Project: routeiq-d2104)
//
// Usage:
//   1. Authorize an existing registered Firebase user as Administrator:
//      node provision_admin.js authorize <email_or_uid>
//
//   2. Create a new real Administrator account in Firebase Auth & Firestore:
//      node provision_admin.js create <email> <password> ["Full Name"]
//
//   3. List all current users and administrative permissions:
//      node provision_admin.js list

import { initializeApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync, existsSync } from 'fs';

const SA_PATH = './routeiq-d2104-8599cf6363fd.json';

if (!existsSync(SA_PATH)) {
  console.error(`❌ Error: Service account key not found at ${SA_PATH}`);
  console.error('Please place your Firebase service account private key in the project root to run server-side provisioning.');
  process.exit(1);
}

const serviceAccount = JSON.parse(readFileSync(SA_PATH, 'utf8'));
const app = initializeApp({ credential: cert(serviceAccount) });
const auth = getAuth(app);
const db = getFirestore(app);

async function listUsers() {
  console.log('\n=============================================================');
  console.log('🛡️ CMR RouteIQ — Registered Accounts & Role Status');
  console.log('=============================================================');

  const authList = await auth.listUsers(100);
  const usersSnap = await db.collection('users').get();
  const firestoreMap = {};
  usersSnap.forEach(d => { firestoreMap[d.id] = d.data(); });

  console.log(`Total accounts found in Firebase Authentication: ${authList.users.length}\n`);

  for (const u of authList.users) {
    const fDoc = firestoreMap[u.uid] || {};
    const role = fDoc.role || u.customClaims?.role || 'Student';
    const status = fDoc.status || 'active';
    const verified = u.emailVerified ? '✅ Verified' : '⚠️ Unverified';
    const isAdmin = String(role).toLowerCase() === 'admin';
    const roleBadge = isAdmin ? '👑 [ADMINISTRATOR]' : `👤 [${role}]`;

    console.log(` • ${roleBadge} ${u.email} (UID: ${u.uid})`);
    console.log(`   Name: ${fDoc.displayName || u.displayName || 'N/A'} | Status: ${status} | Email: ${verified}\n`);
  }
}

async function authorizeAdmin(identifier) {
  if (!identifier) {
    console.error('Usage: node provision_admin.js authorize <email_or_uid>');
    process.exit(1);
  }

  let userRecord;
  try {
    if (identifier.includes('@')) {
      userRecord = await auth.getUserByEmail(identifier.trim());
    } else {
      userRecord = await auth.getUser(identifier.trim());
    }
  } catch (e) {
    console.error(`❌ User not found for identifier "${identifier}":`, e.message);
    process.exit(1);
  }

  // 1. Mark verified in Firebase Auth (Admin accounts must have verified email)
  await auth.updateUser(userRecord.uid, {
    emailVerified: true
  });

  // 2. Set Custom User Claims for role-based security rules
  await auth.setCustomUserClaims(userRecord.uid, {
    role: 'admin'
  });

  // 3. Update or create authoritative Firestore users collection document
  await db.collection('users').doc(userRecord.uid).set({
    uid: userRecord.uid,
    email: userRecord.email,
    displayName: userRecord.displayName || 'Transport Fleet Administrator',
    role: 'Admin',
    roleLower: 'admin',
    accountType: 'Staff',
    status: 'active',
    authorizedBy: 'Firebase Admin SDK Provisioner',
    authorizedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }, { merge: true });

  console.log('\n=============================================================');
  console.log(`🎉 SUCCESS: User ${userRecord.email} is now an Authoritative Administrator!`);
  console.log('=============================================================');
  console.log(` • UID: ${userRecord.uid}`);
  console.log(` • Firebase Auth Custom Claims: { role: 'admin' }`);
  console.log(` • Firestore Document (/users/${userRecord.uid}): role = "Admin", status = "active"`);
  console.log(` • Email Verified: true`);
  console.log('\nThe administrator can now sign in at http://localhost:3000/login.html with their credentials.');
}

async function createAdmin(email, password, displayName = 'Transport Fleet Administrator') {
  if (!email || !password) {
    console.error('Usage: node provision_admin.js create <email> <password> ["Full Name"]');
    process.exit(1);
  }

  if (password.length < 8) {
    console.error('❌ Password must be at least 8 characters long.');
    process.exit(1);
  }

  let userRecord;
  try {
    userRecord = await auth.getUserByEmail(email.trim());
    console.log(`Account with email ${email} already exists. Elevating permissions...`);
    await auth.updateUser(userRecord.uid, {
      password: password,
      displayName: displayName,
      emailVerified: true
    });
  } catch (err) {
    if (err.code === 'auth/user-not-found') {
      console.log(`Creating new Firebase Authentication user: ${email}...`);
      userRecord = await auth.createUser({
        email: email.trim(),
        password: password,
        displayName: displayName,
        emailVerified: true
      });
    } else {
      throw err;
    }
  }

  // Set Custom Claims & Firestore Profile
  await auth.setCustomUserClaims(userRecord.uid, {
    role: 'admin'
  });

  await db.collection('users').doc(userRecord.uid).set({
    uid: userRecord.uid,
    email: userRecord.email,
    displayName: displayName,
    role: 'Admin',
    roleLower: 'admin',
    accountType: 'Staff',
    status: 'active',
    authorizedBy: 'Firebase Admin SDK Provisioner',
    authorizedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }, { merge: true });

  console.log('\n=============================================================');
  console.log(`🎉 SUCCESS: New Administrator account created: ${userRecord.email}`);
  console.log('=============================================================');
  console.log(` • UID: ${userRecord.uid}`);
  console.log(` • Display Name: ${displayName}`);
  console.log(` • Role: Admin`);
  console.log(` • Custom Claims & Firestore synchronized.`);
  console.log('\nThe administrator can now sign in at http://localhost:3000/login.html');
}

async function main() {
  const args = process.argv.slice(2);
  const command = (args[0] || 'list').toLowerCase();

  switch (command) {
    case 'list':
      await listUsers();
      break;
    case 'authorize':
    case 'approve':
    case 'elevate':
      await authorizeAdmin(args[1]);
      break;
    case 'create':
      await createAdmin(args[1], args[2], args[3]);
      break;
    default:
      console.log('CMR RouteIQ Secure Admin Provisioning CLI');
      console.log('Usage:');
      console.log('  node provision_admin.js list');
      console.log('  node provision_admin.js authorize <email_or_uid>');
      console.log('  node provision_admin.js create <email> <password> ["Full Name"]');
  }
}

main().catch(err => {
  console.error('\n❌ Provisioning error:', err);
  process.exit(1);
});
