// firestore-service.js
// Cloud Firestore Data Layer for RouteIQ (Project: routeiq-d2104)

import { db } from "./firebase-config.js";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  where,
  orderBy,
  writeBatch,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// Collection References
export const routesCol = collection(db, "routes");
export const studentsCol = collection(db, "students");
export const gpsCol = collection(db, "gps_locations");
export const alertsCol = collection(db, "alerts");
export const inchargesCol = collection(db, "incharges");
export const usersCol = collection(db, "users");

// Callback storage for active subscriptions
let unsubscribers = [];

/**
 * Clean up all active Firestore snapshot listeners
 */
export function unsubscribeAll() {
  unsubscribers.forEach(unsub => {
    if (typeof unsub === "function") unsub();
  });
  unsubscribers = [];
}

/**
 * Validate Fuel Level (Must be a number between 0 and 100)
 */
export function validateFuelLevel(level) {
  const num = Number(level);
  if (isNaN(num) || num < 0 || num > 100) {
    return { valid: false, message: "Fuel level must be a valid number between 0 and 100." };
  }
  return { valid: true, value: Math.round(num) };
}

/* =========================================================
   1. REAL-TIME SUBSCRIPTIONS (onSnapshot)
   ========================================================= */

/**
 * Subscribe to routes collection in real-time
 */
export function subscribeToRoutes(onUpdate, onError) {
  const unsub = onSnapshot(routesCol, (snapshot) => {
    const routesMap = {};
    snapshot.forEach(docSnap => {
      const data = docSnap.data();
      const rId = data.routeId || docSnap.id;
      routesMap[rId] = {
        ...data,
        routeId: rId,
        fuelLevel: typeof data.fuelLevel === "number" ? data.fuelLevel : 0
      };
    });
    if (onUpdate) onUpdate(routesMap, snapshot.metadata.fromCache);
  }, (error) => {
    console.error("Firestore onSnapshot error (routes):", error);
    if (onError) onError(error);
  });
  unsubscribers.push(unsub);
  return unsub;
}

/**
 * Subscribe to students collection in real-time with field normalization & ordering
 */
export function subscribeToStudents(onUpdate, onError) {
  const unsub = onSnapshot(studentsCol, (snapshot) => {
    const studentsByRoute = {};
    snapshot.forEach(docSnap => {
      const s = docSnap.data();
      const rId = s.routeId || s.route || "Route 03";
      if (!studentsByRoute[rId]) studentsByRoute[rId] = [];

      // Normalize fields between CSV-import schema and UI schema
      const roll = String(s.roll || docSnap.id).trim();
      const name = s.name || "Student";
      const year = s.year || "1st";
      const dept = s.dept || s.department || "General";
      const campus = s.campus || "CMRCET";
      const receipt = s.receipt || "-";
      const stop = s.stop || s.boardingPoint || "Main Gate";
      const fee = s.fee || s.feeStatus || (s.receipt && s.receipt !== '-' ? "Paid" : "Pending");
      const numId = s.id !== undefined && s.id !== null ? (parseInt(s.id, 10) || null) : null;

      studentsByRoute[rId].push({
        ...s,
        id: numId !== null ? numId : studentsByRoute[rId].length + 1,
        roll,
        name,
        year,
        dept,
        department: dept,
        campus,
        receipt,
        stop,
        boardingPoint: stop,
        fee,
        feeStatus: fee,
        routeId: rId,
        docId: docSnap.id
      });
    });

    // Sort students within each route sequentially by id or roll
    Object.keys(studentsByRoute).forEach(rId => {
      studentsByRoute[rId].sort((a, b) => {
        const idA = typeof a.id === 'number' ? a.id : parseInt(a.id, 10) || 999;
        const idB = typeof b.id === 'number' ? b.id : parseInt(b.id, 10) || 999;
        return idA - idB;
      });
    });

    if (onUpdate) onUpdate(studentsByRoute, snapshot.metadata.fromCache);
  }, (error) => {
    console.error("Firestore onSnapshot error (students):", error);
    if (onError) onError(error);
  });
  unsubscribers.push(unsub);
  return unsub;
}

/**
 * Subscribe to alerts collection in real-time
 */
export function subscribeToAlerts(onUpdate, onError) {
  const unsub = onSnapshot(alertsCol, (snapshot) => {
    const alertsList = [];
    snapshot.forEach(docSnap => {
      alertsList.push({
        ...docSnap.data(),
        id: docSnap.id
      });
    });
    if (onUpdate) onUpdate(alertsList, snapshot.metadata.fromCache);
  }, (error) => {
    console.error("Firestore onSnapshot error (alerts):", error);
    if (onError) onError(error);
  });
  unsubscribers.push(unsub);
  return unsub;
}

/**
 * Subscribe to incharges collection in real-time
 */
export function subscribeToIncharges(onUpdate, onError) {
  const unsub = onSnapshot(inchargesCol, (snapshot) => {
    const inchargesMap = {};
    snapshot.forEach(docSnap => {
      inchargesMap[docSnap.id] = docSnap.data();
    });
    if (onUpdate) onUpdate(inchargesMap, snapshot.metadata.fromCache);
  }, (error) => {
    console.error("Firestore onSnapshot error (incharges):", error);
    if (onError) onError(error);
  });
  unsubscribers.push(unsub);
  return unsub;
}

/**
 * Subscribe to live GPS locations stream in real-time
 * Indexed by both docId, routeId, and busPlate for seamless mapping
 */
export function subscribeToGpsLocations(onUpdate, onError) {
  const unsub = onSnapshot(gpsCol, (snapshot) => {
    const locationsMap = {};
    snapshot.forEach(docSnap => {
      const data = docSnap.data();
      locationsMap[docSnap.id] = data;
      if (data.routeId) locationsMap[data.routeId] = data;
      if (data.busPlate) locationsMap[data.busPlate] = data;
      if (data.busId) locationsMap[data.busId] = data;
      if (data.bus_id) locationsMap[data.bus_id] = data;
    });
    if (onUpdate) onUpdate(locationsMap, snapshot.metadata.fromCache);
  }, (error) => {
    console.error("Firestore onSnapshot error (gps_locations):", error);
    if (onError) onError(error);
  });
  unsubscribers.push(unsub);
  return unsub;
}

/* =========================================================
   2. ROUTES & STOPS CRUD OPERATIONS
   ========================================================= */

/**
 * Add or Update a bus route
 */
export async function saveRoute(routeData) {
  try {
    const rId = routeData.routeId.trim();
    if (!rId) throw new Error("Route ID is required");

    // Validate fuel level
    const fuelValidation = validateFuelLevel(routeData.fuelLevel !== undefined ? routeData.fuelLevel : 0);
    if (!fuelValidation.valid) throw new Error(fuelValidation.message);

    const docRef = doc(db, "routes", rId);
    const payload = {
      ...routeData,
      routeId: rId,
      fuelLevel: fuelValidation.value,
      updatedAt: serverTimestamp()
    };

    await setDoc(docRef, payload, { merge: true });
    return { success: true, routeId: rId };
  } catch (err) {
    console.error("Error saving route to Firestore:", err);
    return { success: false, error: err.message };
  }
}

/**
 * Update fuelLevel for a specific route
 */
export async function updateFuelLevel(routeId, fuelLevel, userRole) {
  try {
    if (userRole !== "Admin" && userRole !== "Incharge") {
      throw new Error("Permission Denied: Only Admin and Incharge can modify fuel levels.");
    }

    const validation = validateFuelLevel(fuelLevel);
    if (!validation.valid) {
      throw new Error(validation.message);
    }

    const docRef = doc(db, "routes", routeId);
    await updateDoc(docRef, {
      fuelLevel: validation.value,
      updatedAt: serverTimestamp()
    });

    return { success: true, fuelLevel: validation.value };
  } catch (err) {
    console.error("Error updating fuel level:", err);
    return { success: false, error: err.message };
  }
}

/**
 * Delete a route from Firestore
 */
export async function deleteRoute(routeId) {
  try {
    const docRef = doc(db, "routes", routeId);
    await deleteDoc(docRef);
    return { success: true };
  } catch (err) {
    console.error("Error deleting route from Firestore:", err);
    return { success: false, error: err.message };
  }
}

/**
 * Add or Edit a stop in a route
 */
export async function saveStop(routeId, stopData, isEdit = false, stopIdx = -1) {
  try {
    const docRef = doc(db, "routes", routeId);
    const snap = await getDoc(docRef);
    if (!snap.exists()) throw new Error(`Route ${routeId} not found in Firestore`);

    const route = snap.data();
    let stops = Array.isArray(route.stops) ? [...route.stops] : [];

    if (isEdit && stopIdx >= 0 && stopIdx < stops.length) {
      stops[stopIdx] = { ...stops[stopIdx], ...stopData };
    } else {
      stops.push(stopData);
    }

    await updateDoc(docRef, {
      stops,
      updatedAt: serverTimestamp()
    });

    return { success: true, stops };
  } catch (err) {
    console.error("Error saving stop to Firestore:", err);
    return { success: false, error: err.message };
  }
}

/**
 * Delete a stop from a route
 */
export async function deleteStop(routeId, stopIdx) {
  try {
    const docRef = doc(db, "routes", routeId);
    const snap = await getDoc(docRef);
    if (!snap.exists()) throw new Error(`Route ${routeId} not found`);

    const route = snap.data();
    let stops = Array.isArray(route.stops) ? [...route.stops] : [];
    if (stopIdx < 0 || stopIdx >= stops.length) throw new Error("Invalid stop index");

    stops.splice(stopIdx, 1);
    await updateDoc(docRef, {
      stops,
      updatedAt: serverTimestamp()
    });

    return { success: true, stops };
  } catch (err) {
    console.error("Error deleting stop from Firestore:", err);
    return { success: false, error: err.message };
  }
}

/* =========================================================
   3. STUDENTS CRUD & SAFE ATOMIC DELETION / RENUMBERING
   ========================================================= */

/**
 * Add or update student
 */
export async function saveStudent(studentData) {
  try {
    const docId = String(studentData.roll || studentData.id || "STU-" + Date.now()).trim();
    const docRef = doc(db, "students", docId);
    await setDoc(docRef, {
      ...studentData,
      roll: docId,
      updatedAt: serverTimestamp()
    }, { merge: true });
    return { success: true, studentId: docId };
  } catch (err) {
    console.error("Error saving student to Firestore:", err);
    return { success: false, error: err.message };
  }
}

/**
 * Safely delete a student from Firestore without renumbering or altering other students' real IDs.
 * Uses stable student document IDs (roll number) and updates the route capacity count.
 */
export async function deleteStudentSafely(routeId, rollNumber) {
  try {
    if (!rollNumber) throw new Error("Student roll number is required.");

    const cleanRoll = String(rollNumber).trim();
    let targetDocRef = null;

    // Check direct doc existence by rollNumber
    const directRef = doc(db, "students", cleanRoll);
    const directSnap = await getDoc(directRef);
    if (directSnap.exists()) {
      targetDocRef = directRef;
    } else {
      // Find matching document by roll or id field
      const q = query(studentsCol, where("roll", "==", cleanRoll));
      const qSnap = await getDocs(q);
      if (!qSnap.empty) {
        targetDocRef = qSnap.docs[0].ref;
      }
    }

    if (!targetDocRef) {
      throw new Error(`Student ${cleanRoll} not found in database.`);
    }

    // Atomically delete student document and update route count if applicable
    const batch = writeBatch(db);
    batch.delete(targetDocRef);

    if (routeId) {
      try {
        const routeRef = doc(db, "routes", routeId);
        const rSnap = await getDoc(routeRef);
        if (rSnap.exists()) {
          const cur = rSnap.data().currentCount || 0;
          batch.update(routeRef, {
            currentCount: Math.max(0, cur - 1),
            updatedAt: serverTimestamp()
          });
        }
      } catch (e) {
        console.warn("Route count decrement note:", e);
      }
    }

    await batch.commit();
    console.log(`✅ Safely deleted student ${cleanRoll} from database without altering other students' real IDs.`);

    return {
      success: true,
      deletedRoll: cleanRoll
    };
  } catch (err) {
    console.error("Error in deleteStudentSafely:", err);
    return { success: false, error: err.message };
  }
}

/**
 * Standard delete student wrapper
 */
export async function deleteStudent(studentId, routeId) {
  return deleteStudentSafely(routeId, studentId);
}

/* =========================================================
   4. ALERTS CRUD OPERATIONS
   ========================================================= */

/**
 * Create a new fleet incident alert
 */
export async function createAlert(alertData) {
  try {
    const alertId = alertData.id || `ALT-${Math.floor(100 + Math.random() * 900)}`;
    const docRef = doc(db, "alerts", alertId);
    const payload = {
      ...alertData,
      id: alertId,
      status: alertData.status || "Active",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    };
    await setDoc(docRef, payload);
    return { success: true, alertId };
  } catch (err) {
    console.error("Error creating alert in Firestore:", err);
    return { success: false, error: err.message };
  }
}

/**
 * Acknowledge an alert
 */
export async function acknowledgeAlert(alertId, acknowledgedBy) {
  try {
    const docRef = doc(db, "alerts", alertId);
    await updateDoc(docRef, {
      status: "Acknowledged",
      acknowledgedBy: acknowledgedBy || "Transport Coordinator",
      updatedTime: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + " IST",
      updatedAt: serverTimestamp()
    });
    return { success: true };
  } catch (err) {
    console.error("Error acknowledging alert:", err);
    return { success: false, error: err.message };
  }
}

/**
 * Resolve an alert
 */
export async function resolveAlert(alertId) {
  try {
    const docRef = doc(db, "alerts", alertId);
    await updateDoc(docRef, {
      status: "Resolved",
      updatedTime: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + " IST",
      updatedAt: serverTimestamp()
    });
    return { success: true };
  } catch (err) {
    console.error("Error resolving alert:", err);
    return { success: false, error: err.message };
  }
}

/**
 * Delete an alert
 */
export async function deleteAlert(alertId) {
  try {
    const docRef = doc(db, "alerts", alertId);
    await deleteDoc(docRef);
    return { success: true };
  } catch (err) {
    console.error("Error deleting alert:", err);
    return { success: false, error: err.message };
  }
}

/* =========================================================
   5. LIVE GPS LOCATIONS (Real Telemetry Stream)
   ========================================================= */

/**
 * Store live real GPS telemetry packet in Cloud Firestore
 */
export async function saveGpsLocation(routeId, gpsPacket) {
  try {
    if (!routeId) throw new Error("Route ID is required for GPS packet");

    const payload = {
      ...gpsPacket,
      routeId,
      latitude: Number(gpsPacket.latitude),
      longitude: Number(gpsPacket.longitude),
      speed: Number(gpsPacket.speed || gpsPacket.speed_kmh || 0),
      speed_kmh: Number(gpsPacket.speed_kmh || gpsPacket.speed || 0),
      accuracy: Number(gpsPacket.accuracy || 0),
      source: gpsPacket.source || "driver-phone-gps",
      updatedAt: serverTimestamp(),
      timestamp: serverTimestamp()
    };

    // Save under routeId document
    const routeDocRef = doc(db, "gps_locations", routeId);
    await setDoc(routeDocRef, payload, { merge: true });

    // Also write under busPlate document if available for multi-key lookups
    const busId = gpsPacket.busPlate || gpsPacket.busId || gpsPacket.bus_id;
    if (busId && busId !== routeId) {
      const busDocRef = doc(db, "gps_locations", busId);
      await setDoc(busDocRef, payload, { merge: true });
    }

    console.log(`📡 Real GPS Telemetry pushed to Firestore for ${routeId}: (${payload.latitude}, ${payload.longitude})`);
    return { success: true };
  } catch (err) {
    console.warn("Could not write GPS location to Firestore:", err);
    return { success: false, error: err.message };
  }
}

/* =========================================================
   6. SEED / INITIALIZATION HELPER (PREVENTS DUPLICATES)
   ========================================================= */

/**
 * Sync initial fleet data into Firestore if documents do not yet exist
 */
export async function syncInitialFleetData(fleetData) {
  try {
    if (!fleetData || !fleetData.routesData) return;

    // Check existing routes in Firestore
    const existingSnap = await getDocs(routesCol);
    const existingRouteIds = new Set();
    existingSnap.forEach(d => existingRouteIds.add(d.id));

    // Upload only missing routes without overwriting existing ones
    for (const [rId, rData] of Object.entries(fleetData.routesData)) {
      if (!existingRouteIds.has(rId)) {
        console.log(`Seeding route ${rId} to Firestore...`);
        await setDoc(doc(db, "routes", rId), {
          ...rData,
          fuelLevel: rData.fuelLevel !== undefined ? rData.fuelLevel : 0,
          createdAt: serverTimestamp()
        });
      }
    }

    // Seed students if collection is empty
    const studentsSnap = await getDocs(studentsCol);
    if (studentsSnap.empty && fleetData.studentsDatabase) {
      for (const [rId, sList] of Object.entries(fleetData.studentsDatabase)) {
        for (const s of sList) {
          const sId = String(s.roll || s.id);
          await setDoc(doc(db, "students", sId), {
            ...s,
            routeId: rId,
            createdAt: serverTimestamp()
          });
        }
      }
      console.log("Seeded initial students database to Firestore.");
    }
  } catch (err) {
    console.warn("Note during Firestore initial data sync:", err.message);
  }
}
