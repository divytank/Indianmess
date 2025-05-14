// app.js
import { auth, provider, db } from "./firebase-config.js";
import { signInWithPopup, signOut, onAuthStateChanged } from "firebase/auth";
import { doc, setDoc, getDoc, collection, query, where, getDocs } from "firebase/firestore";
import { Chart } from "chart.js";

const loginBtn = document.getElementById("googleLogin");
const logoutBtn = document.getElementById("logoutBtn");
const authContainer = document.getElementById("auth-container");
const appContainer = document.getElementById("app-container");
const userNameSpan = document.getElementById("user-name");
const mealSelection = document.getElementById("meal-selection");
const todaySummary = document.getElementById("today-summary");
const weeklyChartCanvas = document.getElementById("weeklyChart");

const meals = ["Breakfast", "Lunch", "Dinner"];

loginBtn.onclick = () => signInWithPopup(auth, provider);

logoutBtn.onclick = () => signOut(auth);

onAuthStateChanged(auth, async (user) => {
  if (user) {
    authContainer.style.display = "none";
    appContainer.style.display = "block";
    userNameSpan.textContent = user.displayName;

    const uid = user.uid;
    const today = new Date().toISOString().split('T')[0];
    const docRef = doc(db, "meals", `${uid}_${today}`);
    const docSnap = await getDoc(docRef);
    const existingData = docSnap.exists() ? docSnap.data() : {};

    meals.forEach(meal => {
      const id = `meal-${meal}`;
      const input = document.createElement("input");
      input.type = "checkbox";
      input.id = id;
      input.checked = existingData[meal] || false;

      input.onchange = async () => {
        const update = { ...existingData, [meal]: input.checked };
        await setDoc(docRef, update);
      };

      const label = document.createElement("label");
      label.htmlFor = id;
      label.innerText = meal;

      const wrapper = document.createElement("div");
      wrapper.className = "form-check mb-2";
      wrapper.appendChild(input);
      wrapper.appendChild(label);

      mealSelection.appendChild(wrapper);
    });

    // Admin Panel Logic
    await loadTodaySummary(uid);
    await loadWeeklyTrends(uid);
  } else {
    authContainer.style.display = "block";
    appContainer.style.display = "none";
  }
});

// Load today's meal summary for admin
async function loadTodaySummary(uid) {
  const today = new Date().toISOString().split('T')[0];
  const docRef = doc(db, "meals", `${uid}_${today}`);
  const docSnap = await getDoc(docRef);
  const data = docSnap.exists() ? docSnap.data() : {};

  todaySummary.innerHTML = `
    <table class="table">
      <thead><tr><th>Meal</th><th>Count</th></tr></thead>
      <tbody>
        ${meals.map(meal => `
          <tr>
            <td>${meal}</td>
            <td>${data[meal] ? "Selected" : "Not Selected"}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

// Load weekly trend chart for admin
async function loadWeeklyTrends(uid) {
  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - 7);
  const weekStartStr = weekStart.toISOString().split('T')[0];

  const q = query(collection(db, "meals"), where("uid", "==", uid), where("date", ">=", weekStartStr));
  const querySnapshot = await getDocs(q);
  const weeklyData = { Breakfast: [], Lunch: [], Dinner: [] };

  querySnapshot.forEach((doc) => {
    const data = doc.data();
    meals.forEach(meal => {
      weeklyData[meal].push(data[meal] ? 1 : 0);
    });
  });

  const chartData = {
    labels: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
    datasets: meals.map(meal => ({
      label: meal,
      data: weeklyData[meal],
      borderColor: getRandomColor(),
      fill: false
    }))
  };

  new Chart(weeklyChartCanvas, {
    type: 'line',
    data: chartData
  });
}

function getRandomColor() {
  const letters = '0123456789ABCDEF';
  let color = '#';
  for (let i = 0; i < 6; i++) {
    color += letters[Math.floor(Math.random() * 16)];
  }
  return color;
}
