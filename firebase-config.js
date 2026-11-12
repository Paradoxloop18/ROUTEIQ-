// firebase-config.js
// Firebase Modular SDK Initialization for RouteIQ (Project: routeiq-d2104)

import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

export const firebaseConfig = {
  apiKey: "AIzaSyCS_IGQ5Pfv8EAqP2DdiF-3QCNiNxfASSA",
  authDomain: "routeiq-d2104.firebaseapp.com",
  projectId: "routeiq-d2104",
  storageBucket: "routeiq-d2104.firebasestorage.app",
  messagingSenderId: "1022489934137",
  appId: "1:1022489934137:web:9a748879b565b17c7b90e8",
  measurementId: "G-Y6C6L02L71"
};

// Singleton initialization: initialize the existing Firebase app and Auth instance exactly once
let appInstance = null;
let authInstance = null;
let dbInstance = null;
let firebaseInitError = null;

try {
  const existingApps = getApps();
  if (existingApps && existingApps.length > 0) {
    appInstance = getApp();
  } else {
    appInstance = initializeApp(firebaseConfig);
  }
  authInstance = getAuth(appInstance);
  dbInstance = getFirestore(appInstance);
} catch (err) {
  console.error("Firebase initialization error (Project: routeiq-d2104):", err);
  firebaseInitError = err;
}

export const app = appInstance;
export const auth = authInstance;
export const db = dbInstance;
export { firebaseInitError };

