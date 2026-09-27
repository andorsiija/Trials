import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js';
import { getAuth, onAuthStateChanged, setPersistence, browserSessionPersistence } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js';

const firebaseConfig = {
  apiKey: 'AIzaSyBmDA64k7MkU3zblU57AItCcnEebT5x0Sk',
  authDomain: 'vicom-capstone.firebaseapp.com',
  projectId: 'vicom-capstone',
  storageBucket: 'vicom-capstone.firebasestorage.app',
  messagingSenderId: '574424624710',
  appId: '1:574424624710:web:4af9352011e3b54d1fe447'
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