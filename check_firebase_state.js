import { initializeApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';

const sa = JSON.parse(readFileSync('./routeiq-d2104-8599cf6363fd.json', 'utf8'));

const app = initializeApp({
  credential: cert(sa)
});
const auth = getAuth(app);
const db = getFirestore(app);

async function check() {
  console.log('Checking Auth users...');
  const listUsersResult = await auth.listUsers(20);
  console.log('Total users found in Firebase Auth:', listUsersResult.users.length);
  listUsersResult.users.forEach(u => {
    console.log(` - ${u.email} (UID: ${u.uid}, verified: ${u.emailVerified})`);
  });
  
  console.log('\nChecking Firestore collections...');
  const collections = await db.listCollections();
  console.log('Collections in Firestore:', collections.map(c => c.id));
  for (const c of collections) {
    const snap = await db.collection(c.id).limit(5).get();
    console.log(`\n--- Collection [${c.id}] (${snap.size} sample docs) ---`);
    snap.docs.forEach(d => {
      console.log(`ID: ${d.id} =>`, JSON.stringify(d.data()).slice(0, 150));
    });
  }
}

check().catch(console.error);
