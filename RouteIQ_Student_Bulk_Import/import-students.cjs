/**
 * RouteIQ Firestore student bulk importer
 *
 * Imports the two provided CSV files into the existing lowercase `students`
 * collection. Document ID is the student's RollNumber. Existing documents
 * are SKIPPED (not overwritten) by default.
 *
 * IMPORTANT:
 * - Run locally; do NOT commit student CSV/JSON or service-account keys to GitHub.
 * - Use a trusted Firebase Admin credential with access to project routeiq-d2104.
 * - Never share the service-account JSON key.
 *
 * Setup:
 *   npm init -y
 *   npm install firebase-admin csv-parse
 *   # place this script and the two CSV files in one folder
 *   # set GOOGLE_APPLICATION_CREDENTIALS to your locally stored service-account key
 *   # Windows PowerShell:
 *   $env:GOOGLE_APPLICATION_CREDENTIALS="C:\secure-path\routeiq-admin-key.json"
 *   node import-students.js
 */
const fs = require("node:fs");
const { parse } = require("csv-parse/sync");
const admin = require("firebase-admin");

const { initializeApp, applicationDefault,getApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

const PROJECT_ID = "routeiq-d2104";
const COLLECTION = "students";
const INPUTS = [
  { file: "RouteIQ_Route_03_Students.csv", routeId: "Route 03" },
  { file: "RouteIQ_Route_13_Students.csv", routeId: "Route 13" },
  { file: "RouteIQ_Route_16_Students.csv", routeId: "Route 16" },
  { file: "RouteIQ_Route_19A_Students.csv", routeId: "Route 19A" },
  { file: "RouteIQ_Route_25_Students.csv", routeId: "Route 25" },
];

if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  console.error("Missing GOOGLE_APPLICATION_CREDENTIALS. Set it to a LOCAL service-account key file; do not upload/share that key.");
  process.exit(1);
}
initializeApp({
  credential: applicationDefault(),
  projectId: PROJECT_ID
});

const db = getFirestore();

function readRecords(file, routeId) {
  if (!fs.existsSync(file)) throw new Error(`Missing input file: ${file}`);
  const rows = parse(fs.readFileSync(file, "utf8"), { columns: true, skip_empty_lines: true, bom: true, trim: true });
  return rows.map((r, i) => {
    const roll = String(r.RollNumber || "").trim();
    if (!roll) throw new Error(`${file}, row ${i + 2}: missing RollNumber`);
    const receipt = String(r.Receipt || "").trim();
    return {
      docId: roll,
      data: {
        id: String(r.ID || "").trim(),
        name: String(r.Name || "").trim(),
        roll,
        year: String(r.Year || "").trim(),
        department: String(r.Department || "").trim(),
        campus: String(r.Campus || "").trim(),
        receipt: (!receipt || receipt === "—" || receipt === "-") ? null : receipt,
        boardingPoint: String(r.BoardingPoint || "").trim(),
        feeStatus: String(r.FeeStatus || "").trim(),
        routeId,
        source: "RouteIQ student CSV import",
        importedAt: FieldValue.serverTimestamp(),
      }
    };
  });
}

(async () => {
  try {
    const all = INPUTS.flatMap(x => readRecords(x.file, x.routeId));
    const ids = new Set();
    for (const r of all) {
      if (ids.has(r.docId)) throw new Error(`Duplicate RollNumber across CSV files: ${r.docId}`);
      ids.add(r.docId);
    }

    let added = 0, skipped = 0;
    // sequential chunks with an existence check; never overwrites existing docs
    for (let i = 0; i < all.length; i += 400) {
      const chunk = all.slice(i, i + 400);
      const refs = chunk.map(r => db.collection(COLLECTION).doc(r.docId));
      const snaps = await db.getAll(...refs);
      const batch = db.batch();
      let writes = 0;
      for (let j = 0; j < chunk.length; j++) {
        if (snaps[j].exists) {
          skipped++;
          continue;
        }
        batch.create(refs[j], chunk[j].data);
        added++;
        writes++;
      }
      if (writes) await batch.commit();
    }
    console.log(`Import complete. Added ${added}; skipped existing ${skipped}; source rows ${all.length}.`);
    console.log(`Project: ${PROJECT_ID}; collection: ${COLLECTION}`);
  } catch (err) {
    console.error("Import failed:", err.message);
    process.exitCode = 1;
  } finally {
    await getApp().delete();
  }
})();
