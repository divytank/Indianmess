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
  storageBucket: "indian-920df.appspot.com",
  messagingSenderId: "126002123087",
  appId: "1:126002123087:web:0cc243473aa1cbcffcf53a",
  measurementId: "G-QPBY7ZK8J2"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const provider = new GoogleAuthProvider();

// Enable offline persistence
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
const adminSection = document.getElementById("admin-section");
const userNameSpan = document.getElementById("user-name");
const todaySummaryTable = document.getElementById("today-summary").querySelector("tbody");
const weeklyChartCanvas = document.getElementById("weeklyChart");
const studentsDailyData = document.getElementById("students-daily-data");
const studentDatePicker = document.getElementById("student-date-picker");

// Global Variables
let currentUser = null;
let isAdmin = false;
let weeklyChart = null;
let allUsersCache = []; // Cache for all users data

// Meal cutoff times (24-hour format)
const MEAL_CUTOFF_TIMES = {
  breakfast: 11, // 11 AM
  lunch: 14,     // 2 PM
  dinner: 21     // 9 PM
};

// Initialize App
initApp();

async function initApp() {
  setupEventListeners();
  
  onAuthStateChanged(auth, async (user) => {
    if (user) {
      currentUser = user;
      authContainer.style.display = "none";
      appContainer.style.display = "block";
      userNameSpan.textContent = user.displayName;
      
      try {
        await handleUserDocument(user);
        // Load all users into cache
        const usersSnapshot = await getDocs(collection(db, "users"));
        allUsersCache = usersSnapshot.docs.map(doc => ({
          id: doc.id,
          name: doc.data().name
        }));
        
        await loadMealOptionsWithRetry();
        
        if (isAdmin) {
          adminSection.style.display = "block";
          initializeAdminPanel();
          loadAdminData();
        } else {
          adminSection.style.display = "none";
        }
        
      } catch (error) {
        console.error("Initialization error:", error);
        showAlert("Failed to initialize application. Please refresh.", "error");
      }
    } else {
      currentUser = null;
      isAdmin = false;
      authContainer.style.display = "block";
      appContainer.style.display = "none";
      adminSection.style.display = "none";
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

async function loadMealOptionsWithRetry(retryCount = 0) {
  const maxRetries = 3;
  
  try {
    const today = new Date().toISOString().split('T')[0];
    const docRef = doc(db, "daily_meals", today);
    const docSnap = await getDoc(docRef);
    
    if (!docSnap.exists()) {
      // Initialize with all users
      await setDoc(docRef, {
        date: today,
        breakfast: { count: 0, students: [] },
        lunch: { count: 0, students: [] },
        dinner: { count: 0, students: [] },
        allUsers: allUsersCache.map(user => ({
          userId: user.id,
          name: user.name,
          selected: false
        }))
      });
    }
    
    renderMealOptions(docSnap.exists() ? docSnap.data() : { date: today });
    
  } catch (error) {
    console.error("Error loading meal options:", error);
    if (retryCount < maxRetries) {
      await new Promise(resolve => setTimeout(resolve, 1000 * (retryCount + 1)));
      return loadMealOptionsWithRetry(retryCount + 1);
    }
    showAlert("Failed to load meal options. Please check connection.", "error");
  }
}

function renderMealOptions(data) {
  const meals = ["breakfast", "lunch", "dinner"];
  let html = '';
  
  meals.forEach(meal => {
    const isChecked = data[meal]?.students?.some(s => s.userId === currentUser.uid) || false;
    const isDisabled = !isAdmin && !canChangeSelection(meal);
    
    html += `
      <div class="form-check form-switch mb-3">
        <input class="form-check-input meal-checkbox" type="checkbox" 
               id="${meal}-check" ${isChecked ? 'checked' : ''} ${isDisabled ? 'disabled' : ''}>
        <label class="form-check-label" for="${meal}-check">
          ${meal.charAt(0).toUpperCase() + meal.slice(1)}
          ${isDisabled ? '<span class="badge bg-secondary ms-2">Closed</span>' : ''}
        </label>
      </div>
    `;
  });
  
  mealSelectionDiv.innerHTML = html;
  
  document.querySelectorAll(".meal-checkbox").forEach(checkbox => {
    checkbox.addEventListener("change", handleMealSelectionChange);
  });
  
  updateCutoffTimeDisplay();
}

async function handleMealSelectionChange(e) {
  const checkbox = e.target;
  const originalState = checkbox.checked;
  const mealType = checkbox.id.split('-')[0];
  
  if (!isAdmin && !canChangeSelection(mealType)) {
    checkbox.checked = !originalState;
    showAlert(`Changes not allowed after ${MEAL_CUTOFF_TIMES[mealType] > 12 ? 
              MEAL_CUTOFF_TIMES[mealType]-12 + ' PM' : 
              MEAL_CUTOFF_TIMES[mealType] + ' AM'}`, "error");
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
    checkbox.disabled = !isAdmin && !canChangeSelection(mealType);
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
          name: currentUser.displayName
        });
        data[mealType].count++;
      } else if (!isSelected && userIndex !== -1) {
        data[mealType].students.splice(userIndex, 1);
        data[mealType].count--;
      }
      
      data.lastUpdated = serverTimestamp();
      transaction.set(docRef, data);
    });
    
    showStatusMessage("Selection updated successfully!", "success");
    
    // Refresh admin data if admin is viewing
    if (isAdmin) {
      loadAdminData();
    }
  } catch (error) {
    console.error("Transaction error:", error);
    showStatusMessage(`Update failed: ${error.message}`, "error");
    throw error;
  }
}

// Admin Panel Functions
function initializeAdminPanel() {
  // Set default date for student date picker
  studentDatePicker.value = new Date().toISOString().split('T')[0];
  
  // Add event listeners for admin tabs
  document.getElementById('today-tab').addEventListener('click', () => loadTodaySummary());
  document.getElementById('weekly-tab').addEventListener('click', () => loadWeeklyStudentReport());
  document.getElementById('students-tab').addEventListener('click', () => loadMonthlyStudentReport());
  
  // Date picker change event
  studentDatePicker.addEventListener('change', () => loadDailyStudentReport());
}

async function loadAdminData() {
  await loadTodaySummary();
  await loadWeeklyStudentReport();
}

async function loadTodaySummary() {
  const today = new Date().toISOString().split('T')[0];
  const docSnap = await getDoc(doc(db, "daily_meals", today));
  
  todaySummaryTable.innerHTML = '';
  
  if (docSnap.exists()) {
    const data = docSnap.data();
    const meals = ["breakfast", "lunch", "dinner"];
    
    meals.forEach(meal => {
      const row = document.createElement('tr');
      row.innerHTML = `
        <td>${meal.charAt(0).toUpperCase() + meal.slice(1)}</td>
        <td>${data[meal]?.count || 0}</td>
      `;
      todaySummaryTable.appendChild(row);
    });
  }
}

async function loadWeeklyStudentReport() {
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(endDate.getDate() - 6); // Last 7 days
  
  const dates = [];
  for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
    dates.push(new Date(d).toISOString().split('T')[0]);
  }

  // Get meal data for each day
  const studentMeals = {};
  
  // Initialize with all users
  allUsersCache.forEach(user => {
    studentMeals[user.id] = {
      name: user.name,
      days: {}
    };
    
    dates.forEach(date => {
      studentMeals[user.id].days[date] = {
        breakfast: false,
        lunch: false,
        dinner: false
      };
    });
  });

  // Populate with actual data
  for (const date of dates) {
    const docSnap = await getDoc(doc(db, "daily_meals", date));
    if (docSnap.exists()) {
      const data = docSnap.data();
      
      ["breakfast", "lunch", "dinner"].forEach(meal => {
        if (data[meal]?.students) {
          data[meal].students.forEach(student => {
            if (studentMeals[student.userId]) {
              studentMeals[student.userId].days[date][meal] = true;
            }
          });
        }
      });
    }
  }

  // Generate HTML table
  let html = `
    <div class="table-responsive">
      <table class="table table-striped table-bordered">
        <thead class="table-dark">
          <tr>
            <th>Student Name</th>
  `;

  // Add date headers
  dates.forEach(date => {
    const d = new Date(date);
    html += `<th>${d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</th>`;
  });

  html += `</tr></thead><tbody>`;

  // Add student rows
  allUsersCache.forEach(user => {
    if (!studentMeals[user.id]) return;
    
    html += `<tr><td>${user.name}</td>`;
    
    dates.forEach(date => {
      const day = studentMeals[user.id].days[date];
      const meals = [];
      if (day.breakfast) meals.push('B');
      if (day.lunch) meals.push('L');
      if (day.dinner) meals.push('D');
      
      html += `<td class="text-center">${meals.join('/') || '-'}</td>`;
    });
    
    html += `</tr>`;
  });

  html += `</tbody></table></div>`;
  weeklyChartCanvas.parentElement.innerHTML = `
    <h4 class="mb-3">Weekly Student Meal Participation</h4>
    ${html}
  `;
}

async function loadMonthlyStudentReport() {
  const endDate = new Date();
  const startDate = new Date();
  startDate.setMonth(endDate.getMonth() - 1); // Last 30 days
  
  const dates = [];
  for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
    dates.push(new Date(d).toISOString().split('T')[0]);
  }

  // Get meal data for each student
  const studentMeals = {};
  
  // Initialize with all users
  allUsersCache.forEach(user => {
    studentMeals[user.id] = {
      name: user.name,
      breakfast: 0,
      lunch: 0,
      dinner: 0,
      total: 0
    };
  });

  // Populate with actual data
  for (const date of dates) {
    const docSnap = await getDoc(doc(db, "daily_meals", date));
    if (docSnap.exists()) {
      const data = docSnap.data();
      
      ["breakfast", "lunch", "dinner"].forEach(meal => {
        if (data[meal]?.students) {
          data[meal].students.forEach(student => {
            if (studentMeals[student.userId]) {
              studentMeals[student.userId][meal]++;
              studentMeals[student.userId].total++;
            }
          });
        }
      });
    }
  }

  // Generate HTML table
  let html = `
    <div class="table-responsive">
      <table class="table table-striped table-bordered">
        <thead class="table-dark">
          <tr>
            <th>Student Name</th>
            <th class="text-center">Breakfast</th>
            <th class="text-center">Lunch</th>
            <th class="text-center">Dinner</th>
            <th class="text-center">Total</th>
          </tr>
        </thead>
        <tbody>
  `;

  // Add student rows
  allUsersCache.forEach(user => {
    if (!studentMeals[user.id]) return;
    
    const meals = studentMeals[user.id];
    html += `
      <tr>
        <td>${user.name}</td>
        <td class="text-center">${meals.breakfast}</td>
        <td class="text-center">${meals.lunch}</td>
        <td class="text-center">${meals.dinner}</td>
        <td class="text-center">${meals.total}</td>
      </tr>
    `;
  });

  html += `</tbody></table></div>`;
  studentsDailyData.innerHTML = `
    <h4 class="mb-3">Monthly Student Meal Participation</h4>
    ${html}
  `;
}

async function loadDailyStudentReport() {
  const selectedDate = studentDatePicker.value;
  const docSnap = await getDoc(doc(db, "daily_meals", selectedDate));
  
  let html = `
    <div class="table-responsive">
      <table class="table table-striped table-bordered">
        <thead class="table-dark">
          <tr>
            <th>Student Name</th>
            <th class="text-center">Breakfast</th>
            <th class="text-center">Lunch</th>
            <th class="text-center">Dinner</th>
          </tr>
        </thead>
        <tbody>
  `;
  
  if (docSnap.exists()) {
    const data = docSnap.data();
    const studentStatus = {};
    
    // Initialize with all users as not selected
    allUsersCache.forEach(user => {
      studentStatus[user.id] = {
        name: user.name,
        breakfast: false,
        lunch: false,
        dinner: false
      };
    });
    
    // Update with actual selections
    ["breakfast", "lunch", "dinner"].forEach(meal => {
      if (data[meal]?.students) {
        data[meal].students.forEach(student => {
          if (studentStatus[student.userId]) {
            studentStatus[student.userId][meal] = true;
          }
        });
      }
    });
    
    // Generate table rows
    allUsersCache.forEach(user => {
      if (!studentStatus[user.id]) return;
      
      const status = studentStatus[user.id];
      html += `
        <tr>
          <td>${user.name}</td>
          <td class="text-center">${status.breakfast ? '✓' : '✗'}</td>
          <td class="text-center">${status.lunch ? '✓' : '✗'}</td>
          <td class="text-center">${status.dinner ? '✓' : '✗'}</td>
        </tr>
      `;
    });
  } else {
    html += `
      <tr>
        <td colspan="4" class="text-center">No data available for this date</td>
      </tr>
    `;
  }
  
  html += `</tbody></table></div>`;
  studentsDailyData.innerHTML = `
    <h4 class="mb-3">Daily Student Meal Participation - ${new Date(selectedDate).toLocaleDateString()}</h4>
    ${html}
  `;
}

// Helper Functions
function canChangeSelection(mealType) {
  if (isAdmin) return true;
  
  const now = new Date();
  const cutoffHour = MEAL_CUTOFF_TIMES[mealType];
  const cutoff = new Date();
  cutoff.setHours(cutoffHour, 0, 0, 0);
  return now < cutoff;
}

function updateCutoffTimeDisplay() {
  const now = new Date();
  let nextCutoff = null;
  let nextMeal = null;
  
  // Find the next cutoff time
  for (const [meal, hour] of Object.entries(MEAL_CUTOFF_TIMES)) {
    const cutoff = new Date();
    cutoff.setHours(hour, 0, 0, 0);
    
    if (cutoff > now && (!nextCutoff || cutoff < nextCutoff)) {
      nextCutoff = cutoff;
      nextMeal = meal;
    }
  }
  
  if (nextCutoff) {
    const timeString = nextCutoff.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    document.getElementById("cutoff-time").textContent = 
      isAdmin ? "Admin mode - changes always allowed" :
      `Changes allowed until ${timeString} for ${nextMeal}`;
  } else {
    document.getElementById("cutoff-time").textContent = 
      isAdmin ? "Admin mode - changes always allowed" :
      "Changes locked for today";
  }
  
  // Update checkbox disabled states
  document.querySelectorAll(".meal-checkbox").forEach(checkbox => {
    const mealType = checkbox.id.split('-')[0];
    checkbox.disabled = !isAdmin && !canChangeSelection(mealType);
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
