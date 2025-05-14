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
  enableIndexedDbPersistence,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-analytics.js";

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
const analytics = getAnalytics(app);
const auth = getAuth(app);
const db = getFirestore(app);
const provider = new GoogleAuthProvider();

// Global Variables
let currentUser = null;
let isAdmin = false;
let isOnline = navigator.onLine;

// Initialize App
initApp();

async function initApp() {
  // Enable offline persistence
  try {
    await enableIndexedDbPersistence(db);
    console.log("Offline persistence enabled");
  } catch (err) {
    if (err.code == 'failed-precondition') {
      console.warn("Offline persistence already enabled in another tab");
    } else if (err.code == 'unimplemented') {
      console.warn("Offline persistence not available");
    }
  }

  // Set up connection monitoring
  setupConnectionMonitoring();
  
  // Set up auth state listener
  onAuthStateChanged(auth, handleAuthStateChange);
  
  // Set up event listeners
  document.getElementById("googleLogin").addEventListener("click", handleGoogleLogin);
  document.getElementById("logoutBtn").addEventListener("click", handleLogout);
  document.getElementById("student-date-picker").addEventListener("change", loadStudentDailyData);
  
  // Set default date to today
  document.getElementById("student-date-picker").value = new Date().toISOString().split('T')[0];
}

function setupConnectionMonitoring() {
  // Browser connection events
  window.addEventListener('online', updateConnectionStatus);
  window.addEventListener('offline', updateConnectionStatus);
  
  // Firestore connection state
  const dbRef = doc(db, "connection", "status");
  
  onSnapshot(dbRef, () => {
    isOnline = true;
    updateConnectionStatus();
  }, (error) => {
    isOnline = false;
    updateConnectionStatus();
  });
}

function updateConnectionStatus() {
  const connectionStatus = document.getElementById("connection-status");
  const connectionMessage = document.getElementById("connection-message");
  const connectionBadge = document.getElementById("connection-badge");
  
  isOnline = navigator.onLine;
  
  if (!isOnline) {
    // Browser offline
    connectionMessage.innerHTML = `<i class="bi bi-wifi-off"></i> You're offline - working in limited mode`;
    connectionStatus.className = "alert alert-warning alert-dismissible fade show mb-3 disconnected";
    connectionStatus.style.display = "block";
    connectionBadge.textContent = "Offline";
    connectionBadge.className = "badge bg-danger disconnected";
  } else {
    // Browser online
    connectionStatus.className = "alert alert-warning alert-dismissible fade show mb-3 connected";
    connectionStatus.style.display = "none";
    connectionBadge.textContent = "Online";
    connectionBadge.className = "badge bg-success connected";
  }
}

async function handleAuthStateChange(user) {
  const authContainer = document.getElementById("auth-container");
  const appContainer = document.getElementById("app-container");
  
  if (user) {
    currentUser = user;
    document.getElementById("user-name").textContent = user.displayName || "User";
    authContainer.style.display = "none";
    appContainer.style.display = "block";
    
    // Check/create user document
    await handleUserDocument(user);
    
    // Initialize meal selection
    await initMealSelection();
    
  } else {
    currentUser = null;
    authContainer.style.display = "block";
    appContainer.style.display = "none";
  }
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
  
  // Check admin status
  isAdmin = (await getDoc(userRef)).data()?.isAdmin || false;
  document.getElementById("admin-section").style.display = isAdmin ? "block" : "none";
  
  if (isAdmin) {
    loadAdminDashboard();
    loadStudentDailyData();
  }
}

async function handleGoogleLogin() {
  const authStatus = document.getElementById("auth-status");
  authStatus.innerHTML = `<span class="loading-spinner"></span> Connecting...`;
  
  try {
    provider.setCustomParameters({ prompt: 'select_account' });
    const result = await signInWithPopup(auth, provider);
    authStatus.textContent = "";
  } catch (error) {
    console.error("Login error:", error);
    authStatus.innerHTML = `<div class="text-danger"><i class="bi bi-exclamation-triangle"></i> Login failed: ${error.message}</div>`;
  }
}

async function handleLogout() {
  try {
    await signOut(auth);
    showAlert("Logged out successfully", "success");
  } catch (error) {
    console.error("Logout error:", error);
    showAlert("Logout failed. Please try again.", "error");
  }
}

async function initMealSelection() {
  const today = new Date().toISOString().split('T')[0];
  const docRef = doc(db, "daily_meals", today);
  
  try {
    const docSnap = await getDoc(docRef);
    const data = docSnap.exists() ? docSnap.data() : { date: today };
    
    renderMealCheckboxes(data);
    checkChangeWindow();
  } catch (error) {
    console.error("Error loading meal data:", error);
    showStatusMessage("Failed to load meal options", "error");
  }
}

function renderMealCheckboxes(data) {
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
  
  document.getElementById("meal-selection").innerHTML = html;
  
  // Add event listeners
  document.querySelectorAll(".meal-checkbox").forEach(checkbox => {
    checkbox.addEventListener("change", handleMealSelectionChange);
  });
}

async function handleMealSelectionChange(e) {
  const checkbox = e.target;
  const originalState = checkbox.checked;
  const mealType = checkbox.id.split('-')[0];
  
  if (!canChangeSelection()) {
    checkbox.checked = !originalState;
    showStatusMessage("Changes not allowed after 9 PM", "error");
    return;
  }
  
  try {
    checkbox.disabled = true;
    await updateMealSelection(mealType, checkbox.checked);
  } catch (error) {
    console.error("Update failed:", error);
    checkbox.checked = !originalState;
    showStatusMessage("Failed to update selection. Please try again.", "error");
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

// Admin Functions
async function loadAdminDashboard() {
  try {
    await loadDailySummary();
    await loadWeeklyTrend();
  } catch (error) {
    console.error("Admin dashboard error:", error);
    showStatusMessage("Failed to load admin data", "error");
  }
}

async function loadDailySummary() {
  const today = new Date().toISOString().split('T')[0];
  const docSnap = await getDoc(doc(db, "daily_meals", today));
  
  if (docSnap.exists()) {
    const data = docSnap.data();
    document.querySelector("#today-summary tbody").innerHTML = `
      <tr><td>Breakfast</td><td>${data.breakfast?.count || 0}</td></tr>
      <tr><td>Lunch</td><td>${data.lunch?.count || 0}</td></tr>
      <tr><td>Dinner</td><td>${data.dinner?.count || 0}</td></tr>
    `;
  }
}

async function loadWeeklyTrend() {
  const weekDates = getWeekDates(new Date());
  const q = query(
    collection(db, "daily_meals"),
    where("date", "in", weekDates)
  );
  
  try {
    const querySnapshot = await getDocs(q);
    const weeklyData = {};
    
    querySnapshot.forEach(doc => {
      weeklyData[doc.id] = doc.data();
    });
    
    renderWeeklyChart(weekDates, weeklyData);
  } catch (error) {
    console.error("Error loading weekly data:", error);
    showStatusMessage("Failed to load weekly trends", "error");
  }
}

async function loadStudentDailyData() {
  const selectedDate = document.getElementById("student-date-picker").value;
  const container = document.getElementById("students-daily-data");
  container.innerHTML = "<div class='text-center py-3'><span class='loading-spinner'></span> Loading...</div>";
  
  try {
    const [usersSnapshot, mealDoc] = await Promise.all([
      getDocs(collection(db, "users")),
      getDoc(doc(db, "daily_meals", selectedDate))
    ]);
    
    const users = usersSnapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    const mealData = mealDoc.exists() ? mealDoc.data() : null;
    
    if (!mealData) {
      container.innerHTML = "<div class='text-center py-3 text-muted'>No data available for this date</div>";
      return;
    }
    
    renderStudentData(users, mealData, container);
  } catch (error) {
    console.error("Error loading student data:", error);
    container.innerHTML = "<div class='text-center py-3 text-danger'>Failed to load data</div>";
  }
}

// Helper Functions
function renderWeeklyChart(labels, data) {
  const ctx = document.getElementById("weeklyChart").getContext('2d');
  
  // Destroy previous chart if exists
  if (window.weeklyChart) {
    window.weeklyChart.destroy();
  }
  
  window.weeklyChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [
        { 
          label: 'Breakfast', 
          data: labels.map(d => data[d]?.breakfast?.count || 0), 
          backgroundColor: 'rgba(66, 133, 244, 0.7)',
          borderColor: 'rgba(66, 133, 244, 1)',
          borderWidth: 1
        },
        { 
          label: 'Lunch', 
          data: labels.map(d => data[d]?.lunch?.count || 0), 
          backgroundColor: 'rgba(52, 168, 83, 0.7)',
          borderColor: 'rgba(52, 168, 83, 1)',
          borderWidth: 1
        },
        { 
          label: 'Dinner', 
          data: labels.map(d => data[d]?.dinner?.count || 0), 
          backgroundColor: 'rgba(234, 67, 53, 0.7)',
          borderColor: 'rgba(234, 67, 53, 1)',
          borderWidth: 1
        }
      ]
    },
    options: {
      responsive: true,
      scales: {
        y: {
          beginAtZero: true,
          ticks: {
            precision: 0
          }
        }
      }
    }
  });
}

function renderStudentData(users, mealData, container) {
  let html = `
    <table class="table table-hover">
      <thead class="table-light">
        <tr>
          <th>Student</th>
          <th>Breakfast</th>
          <th>Lunch</th>
          <th>Dinner</th>
        </tr>
      </thead>
      <tbody>
  `;
  
  users.forEach(user => {
    const breakfastStatus = mealData.breakfast?.students?.some(s => s.userId === user.id) ? '✓' : '✗';
    const lunchStatus = mealData.lunch?.students?.some(s => s.userId === user.id) ? '✓' : '✗';
    const dinnerStatus = mealData.dinner?.students?.some(s => s.userId === user.id) ? '✓' : '✗';
    
    html += `
      <tr>
        <td>${user.name || user.email}</td>
        <td class="${breakfastStatus === '✓' ? 'text-success' : 'text-danger'}">${breakfastStatus}</td>
        <td class="${lunchStatus === '✓' ? 'text-success' : 'text-danger'}">${lunchStatus}</td>
        <td class="${dinnerStatus === '✓' ? 'text-success' : 'text-danger'}">${dinnerStatus}</td>
      </tr>
    `;
  });
  
  html += "</tbody></table>";
  container.innerHTML = html;
}

function getWeekDates(date) {
  const day = date.getDay();
  const startDate = new Date(date);
  startDate.setDate(date.getDate() - day);
  
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(startDate);
    d.setDate(startDate.getDate() + i);
    return d.toISOString().split('T')[0];
  });
}

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
