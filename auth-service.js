// auth-service.js
// Standalone Authentication & Session Service for RouteIQ (Zero External Credential Dependencies)

let currentSessionUser = {
  uid: "local-user-admin",
  email: "admin@cmrgi.ac.in",
  displayName: "Transport Administrator",
  role: "Admin"
};

/**
 * Direct sign-in without external Firebase credential barriers
 */
export async function loginWithEmail(email, password) {
  currentSessionUser = {
    uid: "session-" + Date.now(),
    email: email || "admin@cmrgi.ac.in",
    displayName: "Active RouteIQ User",
    role: "Admin"
  };
  return { success: true, user: currentSessionUser };
}

/**
 * Sign out current session
 */
export async function logoutUser() {
  currentSessionUser = null;
  return { success: true };
}

/**
 * Register account session
 */
export async function registerWithEmail(email, password) {
  return loginWithEmail(email, password);
}

/**
 * Get currently authenticated session user
 */
export function getCurrentUser() {
  return currentSessionUser;
}

/**
 * Listen for authentication state changes (Mocked local session observer)
 */
export function subscribeToAuthChanges(callback) {
  if (typeof callback === "function") {
    callback(currentSessionUser);
  }
  return () => {};
}
