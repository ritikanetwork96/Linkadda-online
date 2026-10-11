import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.17.1/firebase-app.js';
import {
  getAuth,
  setPersistence,
  browserLocalPersistence,
  browserSessionPersistence,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut,
} from 'https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js';
import {
  getDatabase,
  ref,
  onValue,
  get,
  set,
  update,
  remove,
  push,
  child,
  query,
  orderByChild,
  limitToLast,
} from 'https://www.gstatic.com/firebasejs/12.17.1/firebase-database.js';
import { FIREBASE_CONFIG } from './config.js';

if (typeof window !== 'undefined' && window.location.pathname.endsWith('.js')) {
  window.location.replace('/admin');
}

const app = initializeApp(FIREBASE_CONFIG);
const auth = getAuth(app);
const db = getDatabase(app);

// Use persistent local storage so login never drops on reload/navigation
void setPersistence(auth, browserLocalPersistence).catch(() => {
  void setPersistence(auth, browserSessionPersistence).catch(() => {});
});

export {
  app,
  auth,
  db,
  ref,
  onValue,
  get,
  set,
  update,
  remove,
  push,
  child,
  query,
  orderByChild,
  limitToLast,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut,
};
