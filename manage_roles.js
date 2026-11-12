// manage_roles.js
// Authoritative Admin CLI Tool for RouteIQ User Role Management & Approvals
// Usage:
//   node manage_roles.js list
//   node manage_roles.js approve <email_or_uid> <Role>

import { initializeApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';

const sa = JSON.parse(readFileSync('./routeiq-d2104-8599cf6363fd.json', 'utf8'));
const app = initializeApp({ credential: cert(sa) });
const auth = getAuth(app);
const db = getFirestore(app);

const VALID_ROLES = ["Admin", "Incharge", "Driver", "Emergency", "Student", "pending"];

async function listUsers() {
  console.log("\n=======================================================");
  console.log("👥 RouteIQ Registered Users & Approval Status");
  console.log("=======================================================");

  const authUsers = await auth.listUsers(100);
  const usersSnap = await db.collection('users').get();
  const firestoreMap = {};
  usersSnap.forEach(d => { firestoreMap[d.id] = d.data(); });

  console.log(`Found ${authUsers.users.length} Auth accounts:\n`);
  for (const u of authUsers.users) {
    const fDoc = firestoreMap[u.uid] || {};
    const role = fDoc.role || u.customClaims?.role || "pending";
    const status = fDoc.status || (role.toLowerCase() === "pending" ? "pending" : "active");
    const verified = u.emailVerified ? "✅ Verified" : "⚠️ Unverified";
    const statusBadge = status === "pending" ? "🟡 PENDING" : "🟢 ACTIVE";

    console.log(` • [${statusBadge}] ${u.email} (UID: ${u.uid})`);
    console.log(`   Name: ${fDoc.displayName || u.displayName || 'N/A'} | Role: ${role} | Email: ${verified}\n`);
  }
}

async function approveUser(identifier, newRole) {
  if (!identifier || !newRole) {
    console.error("Usage: node manage_roles.js approve <email_or_uid> <Role>");
    console.error(`Valid roles: ${VALID_ROLES.join(", ")}`);
    process.exit(1);
  }

  const roleFormatted = newRole.charAt(0).toUpperCase() + newRole.slice(1).toLowerCase();
  if (!VALID_ROLES.map(r => r.toLowerCase()).includes(newRole.toLowerCase())) {
    console.error(`❌ Invalid role: "${newRole}". Valid options: ${VALID_ROLES.join(", ")}`);
    process.exit(1);
  }

  let userRecord;
  try {
    if (identifier.includes("@")) {
      userRecord = await auth.getUserByEmail(identifier);
    } else {
      userRecord = await auth.getUser(identifier);
    }
  } catch (e) {
    console.error(`❌ User not found for identifier "${identifier}":`, e.message);
    process.exit(1);
  }

  const isPending = roleFormatted.toLowerCase() === "pending";
  const newStatus = isPending ? "pending" : "active";

  // 1. Set Custom User Claims on Firebase Auth
  await auth.setCustomUserClaims(userRecord.uid, {
    role: roleFormatted.toLowerCase()
  });

  // 2. Update Firestore users collection
  await db.collection('users').doc(userRecord.uid).set({
    uid: userRecord.uid,
    email: userRecord.email,
    displayName: userRecord.displayName || userRecord.email.split('@')[0],
    role: roleFormatted,
    roleLower: roleFormatted.toLowerCase(),
    status: newStatus,
    approvedBy: "Administrator CLI",
    approvedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }, { merge: true });

  console.log(`\n✅ Successfully updated user ${userRecord.email}:`);
  console.log(`   - UID: ${userRecord.uid}`);
  console.log(`   - New Role: ${roleFormatted}`);
  console.log(`   - Status: ${newStatus}`);
  console.log(`   - Firebase Auth Claims & Firestore synchronized.`);
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || "list";

  if (command === "list") {
    await listUsers();
  } else if (command === "approve" || command === "set-role") {
    await approveUser(args[1], args[2]);
  } else {
    console.log("Usage:");
    console.log("  node manage_roles.js list");
    console.log("  node manage_roles.js approve <email_or_uid> <Role>");
  }
}

main().catch(console.error);
