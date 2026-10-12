// firebase-config.js
// Firebase Modular SDK Initialization for RouteIQ (Project: routeiq-d2104)

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

export const firebaseConfig = {
  apiKey: "AIzaSyDovLKo3djdRbs963vqKdbj-geRWyzMTrg",
  authDomain: "routeiq-d2104.firebaseapp.com",
  projectId: "routeiq-d2104",
  storageBucket: "routeiq-d2104.firebasestorage.app",
  messagingSenderId: "703506618799",
  appId: "1:703506618799:web:b78d31c1ae570d3b5c375a"
};

// Initialize Firebase App
export const app = initializeApp(firebaseConfig);

// Initialize Firebase Authentication
export const auth = getAuth(app);

// Initialize Cloud Firestore Database
export const db = getFirestore(app);
