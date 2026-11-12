// auth-service.js
// Production Firebase Authentication & Role Management Service for RouteIQ (Project: routeiq-d2104)

import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut as firebaseSignOut,
  sendPasswordResetEmail,
  onAuthStateChanged,
  reload,
  updateProfile
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  collection,
  getDocs,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

import { auth, db, firebaseConfig, firebaseInitError } from "./firebase-config.js";

let currentSessionUser = null;

export const isInitialized = Boolean(auth);
export const authInitError = firebaseInitError;

/**
 * Wait for Firebase Auth instance to be initialized
 */
export async function waitForAuthInit(timeoutMs = 8000) {
  if (auth) return { success: true, auth, db };
  if (firebaseInitError) {
    throw new Error(`Firebase initialization error: ${firebaseInitError.message || firebaseInitError}`);
  }
  const startTime = Date.now();
  while (!auth && (Date.now() - startTime < timeoutMs)) {
    await new Promise(r => setTimeout(r, 100));
    if (firebaseInitError) throw firebaseInitError;
  }
  if (!auth) {
    throw new Error(`Authentication service initialization timed out (${timeoutMs}ms). Check network connection to Firebase.`);
  }
  return { success: true, auth, db };
}

export const VALID_ROLES = ["Admin", "Incharge", "Driver", "Emergency", "Student", "Staff", "pending"];

/**
 * Friendly error message parser for Firebase Auth error codes
 */
export function formatAuthError(err) {
  if (!err) return "An unknown authentication error occurred.";
  const rawCode = err.code || (typeof err === "string" ? err : err.message || "");
  const code = String(rawCode).toLowerCase().trim();

  if (code.includes("invalid-credential")) {
    return "Invalid institutional credentials. Please check your email and password, or use 'Forgot Password?' to reset.";
  }
  if (code.includes("wrong-password")) {
    return "Incorrect password entered. Please verify your credentials or use 'Forgot Password?'.";
  }
  if (code.includes("user-not-found")) {
    return "No account registered with this institutional email address. Please create an account first.";
  }
  if (code.includes("invalid-email")) {
    return "Please enter a valid institutional email format (e.g. rollnumber@cmrcet.ac.in).";
  }
  if (code.includes("too-many-requests")) {
    return "Access temporarily blocked due to repeated failed login attempts. Please wait a few minutes or reset your password.";
  }
  if (code.includes("network-request-failed")) {
    return "Network connection issue. Please verify your internet connection and retry.";
  }
  if (code.includes("operation-not-allowed")) {
    return "Email & password sign-in is not enabled in Firebase Console for this project. Please contact the administrator.";
  }
  if (code.includes("unauthorized-domain")) {
    return "This domain is not authorized for Firebase Authentication. Please check authorized domains in Firebase Console.";
  }
  if (code.includes("invalid-api-key")) {
    return "Invalid Firebase API key configured. Please verify project configuration.";
  }
  if (code.includes("user-disabled")) {
    return "This institutional account has been disabled by the system administrator.";
  }
  if (code.includes("email-already-in-use")) {
    return "An account with this institutional email already exists. Please sign in or reset your password.";
  }
  if (code.includes("weak-password")) {
    return "Password is too weak. Please choose a password with at least 8 characters.";
  }

  return err.message || "Authentication failed. Please verify credentials and try again.";
}

/**
 * Fetch and resolve user profile & authorized role from Firestore users collection
 * Security: NEVER auto-assign Admin or privileged roles.
 */
export async function resolveUserProfile(firebaseUser) {
  if (!firebaseUser) return null;
  let role = "Student";
  let status = "active";
  let accountType = "Student";
  let displayName = firebaseUser.displayName || (firebaseUser.email ? firebaseUser.email.split('@')[0] : "RouteIQ User");

  try {
    if (db) {
      const uRef = doc(db, "users", firebaseUser.uid);
      const uSnap = await getDoc(uRef);
      if (uSnap.exists()) {
        const data = uSnap.data();
        if (data.role) {
          const r = String(data.role).trim();
          role = r.charAt(0).toUpperCase() + r.slice(1).toLowerCase();
        } else if (data.accountType) {
          const r = String(data.accountType).trim();
          role = r.charAt(0).toUpperCase() + r.slice(1).toLowerCase();
        }
        if (data.status) status = data.status;
        if (data.displayName) displayName = data.displayName;
        if (data.accountType) accountType = data.accountType;
        else accountType = role;
      } else {
        // Inspect custom claims if Firestore doc is missing
        let tokenRole = null;
        try {
          const tokenRes = await firebaseUser.getIdTokenResult();
          if (tokenRes && tokenRes.claims && tokenRes.claims.role) {
            tokenRole = String(tokenRes.claims.role).trim();
          }
        } catch (tokErr) {
          console.warn("Could not inspect custom claims:", tokErr.message);
        }

        if (tokenRole) {
          role = tokenRole.charAt(0).toUpperCase() + tokenRole.slice(1).toLowerCase();
          accountType = role;
          // Auto-repair missing Firestore doc using authoritative tokenRole
          try {
            await setDoc(uRef, {
              uid: firebaseUser.uid,
              email: firebaseUser.email,
              displayName: displayName,
              role: role,
              roleLower: role.toLowerCase(),
              status: "active",
              accountType: accountType,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp()
            });
            console.log(`🛡️ Missing Firestore profile securely repaired from token claims for ${firebaseUser.email} (Role: ${role})`);
          } catch (repairErr) {
            console.warn("Could not write repaired profile:", repairErr.message);
          }
        } else {
          // Document missing and no custom claims: do not silently default to Student!
          console.warn(`Profile document missing for ${firebaseUser.email} (UID: ${firebaseUser.uid})`);
          return {
            uid: firebaseUser.uid,
            email: firebaseUser.email,
            displayName: displayName,
            role: "Pending",
            roleLower: "pending",
            status: "incomplete_profile",
            accountType: "Student",
            emailVerified: true,
            isApproved: false,
            isAdmin: false,
            isDriver: false,
            isIncharge: false,
            isEmergency: false,
            isStudent: false,
            isStaff: false,
            profileMissing: true
          };
        }
      }
    }
  } catch (err) {
    console.warn("Could not read user doc from Firestore:", err.message);
    return {
      uid: firebaseUser.uid,
      email: firebaseUser.email,
      displayName: displayName,
      role: "Pending",
      roleLower: "pending",
      status: "read_error",
      accountType: "Student",
      emailVerified: true,
      isApproved: false,
      profileMissing: true
    };
  }

  const roleLower = role.toLowerCase();
  const isApproved = roleLower !== "pending" && roleLower !== "";

  return {
    uid: firebaseUser.uid,
    email: firebaseUser.email,
    displayName: displayName,
    role: role,
    roleLower: roleLower,
    status: status,
    accountType: accountType,
    emailVerified: true,
    isApproved: isApproved,
    isAdmin: roleLower === "admin" || roleLower === "administrator",
    isIncharge: roleLower === "incharge" || roleLower === "admin" || roleLower === "administrator",
    isDriver: roleLower === "driver" || roleLower === "admin" || roleLower === "administrator",
    isEmergency: roleLower === "emergency" || roleLower === "admin" || roleLower === "administrator",
    isStudent: roleLower === "student",
    isStaff: roleLower === "staff"
  };
}

/**
 * Real Firebase Authentication: Login with Email & Password
 * Verifies credentials, retrieves authoritative role, and validates expectedRole if provided.
 */
export async function loginWithEmail(email, password, expectedRole = null) {
  if (!email || !password) {
    return { success: false, error: "Please enter both institutional email and password." };
  }

  const cleanEmail = String(email).trim();

  try {
    if (!auth) {
      await waitForAuthInit(4000).catch(() => {});
    }
    if (!auth) throw new Error("Firebase Authentication is not initialized. Please verify your connection.");

    const cred = await signInWithEmailAndPassword(auth, cleanEmail, password);

    currentSessionUser = await resolveUserProfile(cred.user);
    if (!currentSessionUser || currentSessionUser.profileMissing) {
      return {
        success: false,
        error: "Account setup error: Your user profile document was not found in the database. Please contact Transport Administration."
      };
    }

    console.log(`✅ Firebase Auth login: ${currentSessionUser.email} [Role: ${currentSessionUser.role}]`);

    // Role check if expectedRole was specified
    if (expectedRole) {
      const exp = String(expectedRole).trim().toLowerCase();
      const actual = String(currentSessionUser.role).trim().toLowerCase();
      const expNorm = (exp === 'administrator' || exp === 'admin') ? 'admin' : exp;
      const actNorm = (actual === 'administrator' || actual === 'admin') ? 'admin' : actual;

      if (expNorm !== actNorm) {
        return {
          success: false,
          roleMismatch: true,
          actualRole: currentSessionUser.role,
          expectedRole: expectedRole,
          error: `Role Authorization Mismatch: This account is authorized as ${currentSessionUser.role}, not ${expectedRole}. Please select ${currentSessionUser.role} to proceed.`
        };
      }
    }

    return {
      success: true,
      user: currentSessionUser,
      isPending: currentSessionUser.roleLower === "pending"
    };
  } catch (err) {
    console.warn("Firebase Auth sign-in failed:", err.code, err.message);
    currentSessionUser = null;
    return { success: false, error: formatAuthError(err), code: err.code || "auth/unknown" };
  }
}

/**
 * Real Firebase Authentication: Direct User Registration
 * Public registration is strictly restricted to Student or Staff roles.
 * Privileged roles (Admin, Driver, Incharge, Emergency) CANNOT be registered publicly.
 * Directly activates the account without mandatory email verification.
 */
export async function registerWithEmail(email, password, fullName, accountType = "Student") {
  const cleanEmail = String(email || "").trim();
  const cleanName = String(fullName || "").trim();
  const rawType = String(accountType || "").trim().toLowerCase();

  // Strict restriction: Public registration is restricted to Student or Staff
  if (rawType === "admin" || rawType === "administrator" || rawType === "driver" || rawType === "incharge" || rawType === "emergency") {
    return {
      success: false,
      error: "Restricted Account Type: Administrator and Driver privileges cannot be self-registered. Please contact the Transport Fleet Coordinator to be officially provisioned."
    };
  }

  const safeAccountType = (rawType === "staff") ? "Staff" : "Student";

  if (!cleanName || cleanName.length < 2) {
    return { success: false, error: "Please provide your full legal name." };
  }
  if (!cleanEmail || !cleanEmail.includes("@")) {
    return { success: false, error: "Institutional email address is required (e.g. name@cmrcet.ac.in)." };
  }
  if (!password || password.length < 8) {
    return { success: false, error: "Password must be at least 8 characters long." };
  }

  try {
    if (!auth) {
      await waitForAuthInit(4000).catch(() => {});
    }
    if (!auth) throw new Error("Firebase Auth is not initialized. Please check network connectivity.");

    const cred = await createUserWithEmailAndPassword(auth, cleanEmail, password);

    // Set display name on Firebase Auth profile
    try {
      await updateProfile(cred.user, { displayName: cleanName });
    } catch (e) {
      console.warn("Could not set displayName on Auth user:", e);
    }

    // Save profile in Firestore users collection
    if (db) {
      try {
        const uRef = doc(db, "users", cred.user.uid);
        await setDoc(uRef, {
          uid: cred.user.uid,
          email: cleanEmail,
          displayName: cleanName,
          role: safeAccountType,
          roleLower: safeAccountType.toLowerCase(),
          accountType: safeAccountType,
          status: "active",
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });
        console.log(`📄 Firestore user profile created for ${cleanEmail} (UID: ${cred.user.uid}, Role: ${safeAccountType})`);
      } catch (dbErr) {
        console.error("❌ Failed to create Firestore user profile doc:", dbErr.message);
        return {
          success: false,
          error: "Registration failed: Unable to save user profile in database. " + dbErr.message
        };
      }
    }

    currentSessionUser = {
      uid: cred.user.uid,
      email: cleanEmail,
      displayName: cleanName,
      role: safeAccountType,
      roleLower: safeAccountType.toLowerCase(),
      accountType: safeAccountType,
      status: "active",
      emailVerified: true,
      isApproved: true,
      isAdmin: false,
      isDriver: false,
      isIncharge: false,
      isEmergency: false,
      isStudent: safeAccountType === "Student",
      isStaff: safeAccountType === "Staff"
    };

    return {
      success: true,
      user: currentSessionUser,
      message: `Account created successfully for ${cleanEmail}! Welcome to RouteIQ.`
    };
  } catch (err) {
    console.error("Firebase Auth registration failed:", err);
    return { success: false, error: formatAuthError(err), code: err.code };
  }
}

/**
 * Resend verification email stub (verification no longer required in RouteIQ)
 */
export async function resendVerificationEmail() {
  return {
    success: true,
    message: "Email verification is no longer required for RouteIQ institutional access."
  };
}

/**
 * Check role approval status
 */
export async function checkVerificationAndApproval() {
  if (!auth) {
    await waitForAuthInit(4000).catch(() => {});
  }
  if (!auth || !auth.currentUser) {
    return { isAuthenticated: false };
  }
  try {
    currentSessionUser = await resolveUserProfile(auth.currentUser);
    return {
      isAuthenticated: true,
      emailVerified: true,
      isPending: currentSessionUser.roleLower === "pending",
      role: currentSessionUser.role,
      user: currentSessionUser
    };
  } catch (err) {
    console.warn("Error refreshing user status:", err);
    return { isAuthenticated: true, error: err.message };
  }
}

/**
 * Real Firebase Password Reset Email
 */
export async function resetPassword(email) {
  if (!email || !String(email).trim()) {
    return { success: false, error: "Please enter your registered institutional email address." };
  }
  try {
    if (!auth) throw new Error("Firebase Auth is not initialized.");
    await sendPasswordResetEmail(auth, String(email).trim());
    return {
      success: true,
      message: `If an account is associated with ${email.trim()}, password reset instructions have been sent to that address.`
    };
  } catch (err) {
    console.warn("Password reset error:", err.code, err.message);
    if (err.code === "auth/user-not-found" || err.code === "auth/invalid-email") {
      return {
        success: true,
        message: `If an account is associated with ${email.trim()}, password reset instructions have been sent to that address.`
      };
    }
    return { success: false, error: formatAuthError(err) };
  }
}

/**
 * Sign out current session and clean state
 */
export async function logoutUser(authInstance) {
  try {
    const targetAuth = authInstance || auth;
    if (targetAuth) {
      await firebaseSignOut(targetAuth);
    }
  } catch (err) {
    console.warn("SignOut notice:", err);
  }
  currentSessionUser = null;
  return { success: true };
}

export async function logout(authInstance) {
  return logoutUser(authInstance);
}

export const signOutUser = logoutUser;
export const signOut = logoutUser;
export { firebaseSignOut };

/**
 * Administrator Workflow: Update and Assign Role to a User
 * Can only be executed by an authenticated Administrator
 */
export async function updateUserRole(targetUid, newRole) {
  if (!currentSessionUser || !currentSessionUser.isAdmin) {
    return { success: false, error: "Permission Denied: Only Transport Fleet Administrators can assign roles." };
  }
  if (!targetUid || !newRole) {
    return { success: false, error: "Target User ID and New Role are required." };
  }

  const formattedRole = newRole.charAt(0).toUpperCase() + newRole.slice(1).toLowerCase();

  if (!VALID_ROLES.map(r => r.toLowerCase()).includes(newRole.toLowerCase())) {
    return { success: false, error: `Invalid role selected. Allowed: ${VALID_ROLES.join(", ")}` };
  }

  try {
    if (!db) throw new Error("Firestore is not initialized.");
    const uRef = doc(db, "users", targetUid);
    const newStatus = formattedRole.toLowerCase() === "pending" ? "pending" : "active";

    await updateDoc(uRef, {
      role: formattedRole,
      roleLower: formattedRole.toLowerCase(),
      status: newStatus,
      approvedBy: currentSessionUser.email,
      approvedAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    console.log(`🛡️ User ${targetUid} role updated to ${formattedRole} by Admin ${currentSessionUser.email}`);
    return { success: true, role: formattedRole, status: newStatus };
  } catch (err) {
    console.error("Error updating user role in Firestore:", err);
    return { success: false, error: err.message };
  }
}

/**
 * Fetch all registered users for Administrator Role Management
 */
export async function fetchAllUsers() {
  if (!currentSessionUser || !currentSessionUser.isAdmin) {
    return { success: false, error: "Permission Denied: Administrator access required." };
  }
  try {
    if (!db) throw new Error("Firestore is not initialized.");
    const snap = await getDocs(collection(db, "users"));
    const usersList = [];
    snap.forEach(d => {
      usersList.push({ id: d.id, ...d.data() });
    });
    return { success: true, users: usersList, data: usersList };
  } catch (err) {
    console.error("Error fetching users list:", err);
    return { success: false, error: err.message };
  }
}

/**
 * Get profile for a specific user ID
 */
export async function getUserProfile(uid) {
  if (!uid || !db) return { success: false, error: "Invalid user ID" };
  try {
    const snap = await getDoc(doc(db, "users", uid));
    if (snap.exists()) {
      return { success: true, data: snap.data() };
    }
    return { success: false, error: "User doc not found" };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Reload currently authenticated user
 */
export async function reloadCurrentUser() {
  if (!auth || !auth.currentUser) {
    return { success: false, error: "No active user session" };
  }
  try {
    await reload(auth.currentUser);
    currentSessionUser = await resolveUserProfile(auth.currentUser);
    return { success: true, user: currentSessionUser };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Get currently authenticated session user
 */
export function getCurrentUser() {
  return currentSessionUser;
}

/**
 * Listen for authentication state changes in real time
 */
export function subscribeToAuthChanges(callback) {
  if (auth && typeof onAuthStateChanged === 'function') {
    return onAuthStateChanged(auth, async (user) => {
      if (user) {
        try {
          await reload(user);
        } catch (e) {}
        currentSessionUser = await resolveUserProfile(user);
      } else {
        currentSessionUser = null;
      }
      if (typeof callback === "function") {
        callback(currentSessionUser);
      }
    });
  }
  if (typeof callback === "function") {
    callback(currentSessionUser);
  }
  return () => {};
}

export { auth, db, firebaseConfig, firebaseInitError };