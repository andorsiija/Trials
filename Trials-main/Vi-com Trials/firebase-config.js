import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js';
import { getAuth, onAuthStateChanged, setPersistence, browserSessionPersistence } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js';

const firebaseConfig = {
    apiKey: "AIzaSyDSO3YJhWK_dL88n89PnAWpn8EbNyjiSGo",
    authDomain: "vicom-capstone-463f3.firebaseapp.com",
    projectId: "vicom-capstone-463f3",
    storageBucket: "vicom-capstone-463f3.firebasestorage.app",
    messagingSenderId: "612784080046",
    appId: "1:612784080046:web:5a23a366e218b747b6593f"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
export const authReady = setPersistence(auth, browserSessionPersistence);
export const authStateReady = authReady.then(() => new Promise((resolve) => {
  const unsubscribe = onAuthStateChanged(auth, () => {
    unsubscribe();
    resolve();
  }, () => {
    unsubscribe();
    resolve();
  });
}));