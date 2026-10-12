// auth-service.js
// Firebase Authentication Service for RouteIQ (Project: routeiq-d2104)

import { auth } from "./firebase-config.js";
import {
  signInWithEmailAndPassword,
  signOut,
  createUserWithEmailAndPassword,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

/**
 * Sign in user with email and password
 */
export async function loginWithEmail(email, password) {
  try {
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    return { success: true, user: userCredential.user };
  } catch (error) {
    console.error("Firebase Login Error:", error);
    return { success: false, error: error.message, code: error.code };
  }
}

/**
 * Sign out current authenticated user
 */
export async function logoutUser() {
  try {
    await signOut(auth);
    return { success: true };
  } catch (error) {
    console.error("Firebase Logout Error:", error);
    return { success: false, error: error.message };
  }
}

/**
 * Register new user with email and password
 */
export async function registerWithEmail(email, password) {
  try {
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    return { success: true, user: userCredential.user };
  } catch (error) {
    console.error("Firebase Registration Error:", error);
    return { success: false, error: error.message, code: error.code };
  }
}

/**
 * Get currently authenticated user
 */
export function getCurrentUser() {
  return auth.currentUser;
}

/**
 * Listen for authentication state changes
 */
export function subscribeToAuthChanges(callback) {
  return onAuthStateChanged(auth, callback);
}
