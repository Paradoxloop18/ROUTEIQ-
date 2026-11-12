# RouteIQ student bulk import (local-only)

The supplied CSVs contain 93 records: 50 for Route 03 and 43 for Route 13.
This bundle does not upload data automatically. Run the script from your own computer with authorized Firebase Admin credentials.

## Files
- `RouteIQ_Route_03_Students.csv` — source data
- `RouteIQ_Route_13_Students.csv` — source data
- `import-students.js` — inserts into lowercase Firestore collection `students`
- `routeiq_students_import.json` — normalized preview data (do not publish; contains student names/roll numbers)

## Run
1. Install Node.js.
2. Put the two CSV files and `import-students.js` in the same folder.
3. In that folder, run:
   `npm init -y`
   `npm install firebase-admin csv-parse`
4. In Firebase Console, select project `routeiq-d2104` → Project settings → Service accounts. Only an authorized project owner/admin should provision credentials. Keep the downloaded key private and outside GitHub.
5. Set `GOOGLE_APPLICATION_CREDENTIALS` to the full local path of that key. On Windows PowerShell:
   `$env:GOOGLE_APPLICATION_CREDENTIALS="C:\secure-path\routeiq-admin-key.json"`
6. Run:
   `node import-students.js`
7. In Firestore → Data, open the lowercase `students` collection and verify documents by RollNumber.

## Safety / behavior
- Existing document IDs are skipped, never overwritten.
- New document IDs are `RollNumber` values.
- No data is written to the uppercase `Students` collection.
- The import includes only fields present in the CSVs. Missing receipt values become null.
- Never commit or send the service-account key or these student files to a public repository.
