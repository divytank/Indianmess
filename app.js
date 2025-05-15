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
      // Initialize with all users marked as not selected
      const usersSnapshot = await getDocs(collection(db, "users"));
      const allUsers = usersSnapshot.docs.map(doc => ({
        userId: doc.id,
        name: doc.data().name,
        selected: false
      }));
      
      await setDoc(docRef, {
        date: today,
        breakfast: { count: 0, students: [] },
        lunch: { count: 0, students: [] },
        dinner: { count: 0, students: [] },
        allUsers: allUsers
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
  document.getElementById('weekly-tab').addEventListener('click', () => loadWeeklySummary());
  document.getElementById('students-tab').addEventListener('click', () => loadStudentsData());
  
  // Date picker change event
  studentDatePicker.addEventListener('change', () => loadStudentsData());
}

async function loadAdminData() {
  await loadTodaySummary();
  await loadWeeklySummary();
  await loadStudentsData();
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

async function loadWeeklySummary() {
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(endDate.getDate() - 6); // Last 7 days
  
  const dates = [];
  for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
    dates.push(new Date(d).toISOString().split('T')[0]);
  }
  
  const mealData = {
    breakfast: [],
    lunch: [],
    dinner: []
  };
  
  // Get data for each day
  for (const date of dates) {
    const docSnap = await getDoc(doc(db, "daily_meals", date));
    if (docSnap.exists()) {
      const data = docSnap.data();
      mealData.breakfast.push(data.breakfast?.count || 0);
      mealData.lunch.push(data.lunch?.count || 0);
      mealData.dinner.push(data.dinner?.count || 0);
    } else {
      mealData.breakfast.push(0);
      mealData.lunch.push(0);
      mealData.dinner.push(0);
    }
  }
  
  // Format dates for chart labels
  const labels = dates.map(date => {
    const d = new Date(date);
    return d.toLocaleDateString('en-US', { weekday: 'short' });
  });
  
  // Create or update chart
  const ctx = weeklyChartCanvas.getContext('2d');
  
  if (weeklyChart) {
    weeklyChart.data.labels = labels;
    weeklyChart.data.datasets[0].data = mealData.breakfast;
    weeklyChart.data.datasets[1].data = mealData.lunch;
    weeklyChart.data.datasets[2].data = mealData.dinner;
    weeklyChart.update();
  } else {
    weeklyChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [
          {
            label: 'Breakfast',
            data: mealData.breakfast,
            backgroundColor: 'rgba(255, 99, 132, 0.7)'
          },
          {
            label: 'Lunch',
            data: mealData.lunch,
            backgroundColor: 'rgba(54, 162, 235, 0.7)'
          },
          {
            label: 'Dinner',
            data: mealData.dinner,
            backgroundColor: 'rgba(255, 206, 86, 0.7)'
          }
        ]
      },
      options: {
        responsive: true,
        scales: {
          y: {
            beginAtZero: true,
            title: {
              display: true,
              text: 'Number of Students'
            }
          },
          x: {
            title: {
              display: true,
              text: 'Day of Week'
            }
          }
        }
      }
    });
  }
}

async function loadStudentsData() {
  const selectedDate = studentDatePicker.value;
  const docSnap = await getDoc(doc(db, "daily_meals", selectedDate));
  
  let html = `
    <table class="table table-striped">
      <thead>
        <tr>
          <th>Student Name</th>
          <th>Breakfast</th>
          <th>Lunch</th>
          <th>Dinner</th>
        </tr>
      </thead>
      <tbody>
  `;
  
  if (docSnap.exists()) {
    const data = docSnap.data();
    const allStudents = {};
    
    // Initialize with all users
    if (data.allUsers) {
      data.allUsers.forEach(user => {
        allStudents[user.userId] = {
          name: user.name,
          breakfast: false,
          lunch: false,
          dinner: false
        };
      });
    }
    
    // Update with actual selections
    ["breakfast", "lunch", "dinner"].forEach(meal => {
      if (data[meal]?.students) {
        data[meal].students.forEach(student => {
          if (allStudents[student.userId]) {
            allStudents[student.userId][meal] = true;
          }
        });
      }
    });
    
    // Generate table rows
    Object.values(allStudents).forEach(student => {
      html += `
        <tr>
          <td>${student.name}</td>
          <td>${student.breakfast ? '✓' : '✗'}</td>
          <td>${student.lunch ? '✓' : '✗'}</td>
          <td>${student.dinner ? '✓' : '✗'}</td>
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
  
  html += `</tbody></table>`;
  studentsDailyData.innerHTML = html;
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
