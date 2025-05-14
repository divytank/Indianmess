import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { 
  getAuth, 
  GoogleAuthProvider, 
  signInWithPopup,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  collection,
  query,
  where,
  getDocs,
  runTransaction,
  serverTimestamp,
  enableIndexedDbPersistence
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// Firebase Config
const firebaseConfig = {
  apiKey: "AIzaSyAf22Bo9Zx5H79j-8cxe-des9SK2-A8BEk",
  authDomain: "indian-920df.firebaseapp.com",
  projectId: "indian-920df",
  storageBucket: "indian-920df.firebasestorage.app",
  messagingSenderId: "126002123087",
  appId: "1:126002123087:web:0cc243473aa1cbcffcf53a",
  measurementId: "G-QPBY7ZK8J2"
};

// Init Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const provider = new GoogleAuthProvider();

enableIndexedDbPersistence(db).catch((err) => {
  if (err.code === 'failed-precondition') {
    console.log("Persistence already enabled in another tab");
  } else if (err.code === 'unimplemented') {
    console.log("Offline persistence not supported");
  }
});

// DOM Elements
const authContainer = document.getElementById("auth-container");
const appContainer = document.getElementById("app-container");
const mealSelectionDiv = document.getElementById("meal-selection");

let currentUser = null;
let isAdmin = false;

// App Initialization
initApp();

async function initApp() {
  setupEventListeners();
  onAuthStateChanged(auth, async (user) => {
    if (user) {
      currentUser = user;
      authContainer.style.display = "none";
      appContainer.style.display = "block";
      try {
        await handleUserDocument(user);
        await loadMealOptionsWithRetry();
      } catch (err) {
        showAlert("Failed to initialize. Refresh the page.", "error");
      }
    } else {
      currentUser = null;
      authContainer.style.display = "block";
      appContainer.style.display = "none";
    }
  });
}

async function handleUserDocument(user) {
  const userRef = doc(db, "users", user.uid);
  const docSnap = await getDoc(userRef);
  if (!docSnap.exists()) {
    await setDoc(userRef, {
      name: user.displayName,
      email: user.email,
      isAdmin: false,
      createdAt: serverTimestamp()
    });
  }
  isAdmin = docSnap.data()?.isAdmin || false;
}

async function loadMealOptionsWithRetry(retry = 0) {
  const maxRetry = 3;
  try {
    const today = new Date().toISOString().split("T")[0];
    const docRef = doc(db, "daily_meals", today);
    const docSnap = await getDoc(docRef);
    if (!docSnap.exists()) {
      await setDoc(docRef, { date: today });
    }
    renderMealOptions(docSnap.exists() ? docSnap.data() : { date: today });
  } catch (err) {
    if (retry < maxRetry) {
      await new Promise(r => setTimeout(r, Math.pow(2, retry) * 1000));
      return loadMealOptionsWithRetry(retry + 1);
    } else {
      showAlert("Failed to load meal options after retries.", "error");
      throw err;
    }
  }
}

function renderMealOptions(data) {
  const meals = ["breakfast", "lunch", "dinner"];
  let html = "";
  meals.forEach(meal => {
    const isChecked = data[meal]?.students?.some(s => s.userId === currentUser.uid) || false;
    html += `
      <div class="form-check form-switch mb-3">
        <input class="form-check-input meal-checkbox" type="checkbox" 
               id="${meal}-check" ${isChecked ? 'checked' : ''}>
        <label class="form-check-label" for="${meal}-check">
          ${meal.charAt(0).toUpperCase() + meal.slice(1)}
        </label>
      </div>
    `;
  });
  mealSelectionDiv.innerHTML = html;
  document.querySelectorAll(".meal-checkbox").forEach(cb => {
    cb.addEventListener("change", handleMealSelectionChange);
  });
  checkChangeWindow();
}

async function handleMealSelectionChange(e) {
  const cb = e.target;
  const mealType = cb.id.split("-")[0];
  const originalState = cb.checked;

  if (!canChangeSelection()) {
    cb.checked = !originalState;
    showAlert("Changes not allowed after 9 PM", "error");
    return;
  }

  try {
    cb.disabled = true;
    await updateMealSelection(mealType, cb.checked);
  } catch (err) {
    cb.checked = !originalState;
    showAlert("Failed to update selection", "error");
  } finally {
    cb.disabled = !canChangeSelection();
  }
}

async function updateMealSelection(mealType, isSelected) {
  const today = new Date().toISOString().split("T")[0];
  const docRef = doc(db, "daily_meals", today);
  showStatusMessage("Updating...", "info");

  await runTransaction(db, async (tx) => {
    const docSnap = await tx.get(docRef);
    const data = docSnap.exists() ? docSnap.data() : { date: today };
    if (!data[mealType]) data[mealType] = { count: 0, students: [] };

    const index = data[mealType].students.findIndex(s => s.userId === currentUser.uid);
    if (isSelected && index === -1) {
      data[mealType].students.push({
        userId: currentUser.uid,
        name: currentUser.displayName,
        timestamp: new Date().toISOString()  // <== FIXED HERE
      });
      data[mealType].count++;
    } else if (!isSelected && index !== -1) {
      data[mealType].students.splice(index, 1);
      data[mealType].count--;
    }

    tx.set(docRef, data);
  });

  showStatusMessage("Selection updated!", "success");
}

function canChangeSelection() {
  const now = new Date();
  const cutoff = new Date();
  cutoff.setHours(21, 0, 0, 0);
  return now < cutoff;
}

function checkChangeWindow() {
  const msg = canChangeSelection() ? "Changes allowed until 9 PM" : "Changes locked for today";
  document.getElementById("cutoff-time").textContent = msg;
  document.querySelectorAll(".meal-checkbox").forEach(cb => {
    cb.disabled = !canChangeSelection();
  });
}

function showStatusMessage(message, type) {
  const statusDiv = document.getElementById("update-status");
  statusDiv.innerHTML = `
    <div class="alert alert-${type} alert-dismissible fade show mb-0">
      ${message}
      <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
    </div>
  `;
  setTimeout(() => {
    const alert = statusDiv.querySelector(".alert");
    if (alert) {
      alert.classList.remove("show");
      setTimeout(() => statusDiv.innerHTML = "", 150);
    }
  }, 3000);
}

function showAlert(message, type) {
  const alertDiv = document.createElement("div");
  alertDiv.className = `alert alert-${type} alert-dismissible fade show`;
  alertDiv.innerHTML = `
    ${message}
    <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
  `;
  document.querySelector(".container").prepend(alertDiv);
  setTimeout(() => {
    alertDiv.classList.remove("show");
    setTimeout(() => alertDiv.remove(), 150);
  }, 3000);
}

function setupEventListeners() {
  document.getElementById("googleLogin").addEventListener("click", handleGoogleLogin);
  document.getElementById("logoutBtn").addEventListener("click", handleLogout);
}

async function handleGoogleLogin() {
  try {
    provider.setCustomParameters({ prompt: "select_account" });
    await signInWithPopup(auth, provider);
  } catch (err) {
    showAlert(`Login failed: ${err.message}`, "error");
  }
}

async function handleLogout() {
  try {
    await signOut(auth);
  } catch (err) {
    showAlert("Logout failed", "error");
  }
      }
