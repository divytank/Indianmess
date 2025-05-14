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
import { getAnalytics } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-analytics.js";

// Your Firebase Config
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

// Enable offline persistence
enableIndexedDbPersistence(db).catch((err) => {
  if (err.code == 'failed-precondition') {
    console.warn("Offline persistence already enabled in another tab");
  } else if (err.code == 'unimplemented') {
    console.warn("Offline persistence not available");
  }
});

// DOM Elements
const authContainer = document.getElementById("auth-container");
const appContainer = document.getElementById("app-container");
const adminSection = document.getElementById("admin-section");
const googleLoginBtn = document.getElementById("googleLogin");
const logoutBtn = document.getElementById("logoutBtn");
const userNameSpan = document.getElementById("user-name");

// Initialize App
initApp();

function initApp() {
  // Auth state listener
  onAuthStateChanged(auth, async (user) => {
    if (user) {
      currentUser = user;
      userNameSpan.textContent = user.displayName || "User";
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
  });

  // Event listeners
  googleLoginBtn.addEventListener("click", handleGoogleLogin);
  logoutBtn.addEventListener("click", handleLogout);
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
  adminSection.style.display = isAdmin ? "block" : "none";
  
  if (isAdmin) {
    loadAdminDashboard();
  }
}

async function handleGoogleLogin() {
  try {
    const result = await signInWithPopup(auth, provider);
    console.log("User logged in:", result.user.uid);
  } catch (error) {
    console.error("Login error:", error);
    document.getElementById("auth-status").textContent = `Login failed: ${error.message}`;
  }
}

async function handleLogout() {
  try {
    await signOut(auth);
  } catch (error) {
    console.error("Logout error:", error);
  }
}

// ... (Include all the other functions from previous implementation) ...

// Example meal selection function
async function initMealSelection() {
  const today = new Date().toISOString().split('T')[0];
  const docRef = doc(db, "daily_meals", today);
  const docSnap = await getDoc(docRef);
  
  const meals = ["Breakfast", "Lunch", "Dinner"];
  let html = '';
  
  meals.forEach(meal => {
    const isChecked = docSnap.exists() && 
      docSnap.data()[meal.toLowerCase()]?.students?.some(s => s.userId === currentUser.uid);
    
    html += `
      <div class="form-check form-switch mb-3">
        <input class="form-check-input meal-checkbox" type="checkbox" 
               id="${meal.toLowerCase()}-check" ${isChecked ? 'checked' : ''}>
        <label class="form-check-label" for="${meal.toLowerCase()}-check">
          ${meal}
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

// Include all other necessary functions (updateMealSelection, loadAdminDashboard, etc.)
