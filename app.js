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

// Firebase Configuration
const firebaseConfig = {
  apiKey: "AIzaSyAf22Bo9Zx5H79j-8cxe-des9SK2-A8BEk",
  authDomain: "indian-920df.firebaseapp.com",
  projectId: "indian-920df",
  storageBucket: "indian-920df.firebasestorage.app",
  messagingSenderId: "126002123087",
  appId: "1:126002123087:web:0cc243473aa1cbcffcf53a",
  measurementId: "G-QPBY7ZK8J2"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const provider = new GoogleAuthProvider();

// Enable offline persistence with error handling
enableIndexedDbPersistence(db).catch((err) => {
  if (err.code == 'failed-precondition') {
    console.log("Offline persistence already enabled in another tab");
  } else if (err.code == 'unimplemented') {
    console.log("Offline persistence not available");
  }
});

// DOM Elements
const authContainer = document.getElementById("auth-container");
const appContainer = document.getElementById("app-container");
const mealSelectionDiv = document.getElementById("meal-selection");

// Admin Panel
const adminPanel = document.getElementById("admin-panel");

// Global Variables
let currentUser = null;
let isAdmin = false;

// Initialize App
initApp();

async function initApp() {
  setupEventListeners();
  
  // Auth state listener
  onAuthStateChanged(auth, async (user) => {
    if (user) {
      currentUser = user;
      authContainer.style.display = "none";
      appContainer.style.display = "block";
      
      try {
        // Initialize user document if doesn't exist
        await handleUserDocument(user);
        
        // Load meal options with retry logic
        await loadMealOptionsWithRetry();
        
      } catch (error) {
        console.error("Initialization error:", error);
        showAlert("Failed to initialize application. Please refresh.", "error");
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

  // Show admin panel if user is admin
  if (isAdmin) {
    if (adminPanel) adminPanel.style.display = "block";
  }
}

async function loadMealOptionsWithRetry(retryCount = 0) {
  const maxRetries = 3;
  
  try {
    const today = new Date().toISOString().split('T')[0];
    const docRef = doc(db, "daily_meals", today);
    
    // First try to get from cache
    const docSnap = await getDoc(docRef);
    
    if (!docSnap.exists()) {
      // Create empty document if doesn't exist
      await setDoc(docRef, { date: today });
    }
    
    renderMealOptions(docSnap.exists() ? docSnap.data() : { date: today });
    
  } catch (error) {
    console.error("Error loading meal options (attempt " + (retryCount + 1) + "):", error);
    
    if (retryCount < maxRetries) {
      // Exponential backoff
      const delay = Math.pow(2, retryCount) * 1000;
      await new Promise(resolve => setTimeout(resolve, delay));
      return loadMealOptionsWithRetry(retryCount + 1);
    } else {
      showAlert("Failed to load meal options after multiple attempts. Please check your connection.", "error");
      throw error;
    }
  }
}

function renderMealOptions(data) {
  const meals = ["breakfast", "lunch", "dinner"];
  let html = '';
  
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
  
  // Add event listeners
  document.querySelectorAll(".meal-checkbox").forEach(checkbox => {
    checkbox.addEventListener("change", handleMealSelectionChange);
  });
  
  checkChangeWindow();
}

async function handleMealSelectionChange(e) {
  const checkbox = e.target;
  const originalState = checkbox.checked;
  const mealType = checkbox.id.split('-')[0];
  
  if (!canChangeSelection()) {
    checkbox.checked = !originalState;
    showAlert("Changes not allowed after 9 PM", "error");
    return;
  }
  
  try {
    checkbox.disabled = true;
    await updateMealSelection(mealType, checkbox.checked);
  } catch (error) {
    console.error("Update failed:", error);
    checkbox.checked = !originalState;
    showAlert("Failed to update selection. Please try again.", "error");
  } finally {
    checkbox.disabled = !canChangeSelection();
  }
}

async function updateMealSelection(mealType, isSelected) {
  const today = new Date().toISOString().split('T')[0];
  const docRef = doc(db, "daily_meals", today);
  
  showStatusMessage("Updating your selection...", "info");
  
  try {
    await runTransaction(db, async (transaction) => {
      const docSnap = await transaction.get(docRef);
      const data = docSnap.exists() ? docSnap.data() : { date: today };
      
      if (!data[mealType]) data[mealType] = { count: 0, students: [] };
      
      const userIndex = data[mealType].students.findIndex(s => s.userId === currentUser.uid);
      
      if (isSelected && userIndex === -1) {
        data[mealType].students.push({
          userId: currentUser.uid,
          name: currentUser.displayName,
          timestamp: serverTimestamp()
        });
        data[mealType].count++;
      } else if (!isSelected && userIndex !== -1) {
        data[mealType].students.splice(userIndex, 1);
        data[mealType].count--;
      }
      
      transaction.set(docRef, data);
    });
    
    showStatusMessage("Selection updated successfully!", "success");
  } catch (error) {
    console.error("Transaction error:", error);
    showStatusMessage(`Update failed: ${error.message}`, "error");
    throw error;
  }
}

// Helper Functions
function canChangeSelection() {
  const now = new Date();
  const cutoff = new Date();
  cutoff.setHours(21, 0, 0, 0); // 9 PM cutoff
  return now < cutoff;
}

function checkChangeWindow() {
  const canChange = canChangeSelection();
  document.getElementById("cutoff-time").textContent = canChange ?
    "Changes allowed until 9 PM" : "Changes locked for today";
  
  document.querySelectorAll(".meal-checkbox").forEach(cb => {
    cb.disabled = !canChange;
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
    const alert = statusDiv.querySelector('.alert');
    if (alert) {
      alert.classList.remove('show');
      setTimeout(() => statusDiv.innerHTML = '', 150);
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
  
  const container = document.querySelector(".container");
  container.prepend(alertDiv);
  
  setTimeout(() => {
    alertDiv.classList.remove("show");
    setTimeout(() => alertDiv.remove(), 150);
  }, 3000);
}

// Initialize event listeners
function setupEventListeners() {
  document.getElementById("googleLogin").addEventListener("click", handleGoogleLogin);
  document.getElementById("logoutBtn").addEventListener("click", handleLogout);
}

async function handleGoogleLogin() {
  try {
    provider.setCustomParameters({ prompt: 'select_account' });
    const result = await signInWithPopup(auth, provider);
    console.log("Login successful:", result.user.uid);
  } catch (error) {
    console.error("Login error:", error);
    showAlert(`Login failed: ${error.message}`, "error");
  }
}

async function handleLogout() {
  try {
    await signOut(auth);
  } catch (error) {
    console.error("Logout error:", error);
    showAlert("Logout failed. Please try again.", "error");
  }
        }
