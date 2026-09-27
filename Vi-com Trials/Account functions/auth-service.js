import { auth, authReady, db } from '../firebase-config.js';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  updateEmail,
  updatePassword,
  updateProfile
} from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js';
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js';

const profileRef = (uid) => doc(db, 'users', uid);

function toUser(uid, authUser, profile = {}) {
  return {
    id: uid,
    email: profile.email || authUser?.email || '',
    name: profile.name || authUser?.displayName || '',
    role: profile.role || 'customer',
    specialty: profile.specialty || '',
    description: profile.description || '',
    socialLink: profile.socialLink || ''
  };
}

async function getProfile(uid) {
  const snapshot = await getDoc(profileRef(uid));
  return snapshot.exists() ? snapshot.data() : null;
}

export async function registerUser({ email, password, name, role, specialty }) {
  await authReady;
  const credential = await createUserWithEmailAndPassword(auth, email, password);
  await updateProfile(credential.user, { displayName: name });
  const profile = {
    name,
    role: role === 'artist' ? 'artist' : 'customer',
    specialty: specialty || '',
    description: '',
    socialLink: '',
    profileViews: 0,
    createdAt: serverTimestamp()
  };
  await setDoc(profileRef(credential.user.uid), profile);
  return toUser(credential.user.uid, credential.user, profile);
}

export async function loginUser({ email, password }) {
  await authReady;
  const credential = await signInWithEmailAndPassword(auth, email, password);
  const profile = await getProfile(credential.user.uid);
  if (!profile) throw new Error('Your account profile is missing. Please contact support.');
  return toUser(credential.user.uid, credential.user, profile);
}

export async function logoutUser() {
  await authReady;
  return signOut(auth);
}

export async function saveProfileChanges(uid, fields) {
  await authReady;
  const currentUser = auth.currentUser;
  if (!currentUser || currentUser.uid !== uid) throw new Error('You need to be signed in to update your profile.');

  if (fields.email && fields.email !== currentUser.email) await updateEmail(currentUser, fields.email);
  if (fields.password) await updatePassword(currentUser, fields.password);
  if (fields.name && fields.name !== currentUser.displayName) await updateProfile(currentUser, { displayName: fields.name });

  const updates = {
    name: fields.name,
    specialty: fields.specialty || '',
    updatedAt: serverTimestamp()
  };
  if (Object.hasOwn(fields, 'description')) updates.description = fields.description || '';
  if (Object.hasOwn(fields, 'socialLink')) updates.socialLink = fields.socialLink || '';
  await updateDoc(profileRef(uid), updates);
  return toUser(uid, currentUser, { ...updates, email: currentUser.email });
}

export function friendlyAuthError(error) {
  const messages = {
    'auth/email-already-in-use': 'An account with that email already exists.',
    'auth/invalid-email': 'Enter a valid email address.',
    'auth/weak-password': 'Use a password with at least 6 characters.',
    'auth/user-not-found': 'That email and password do not match.',
    'auth/wrong-password': 'That email and password do not match.',
    'auth/invalid-credential': 'That email and password do not match.',
    'auth/too-many-requests': 'Too many attempts. Wait a moment and try again.',
    'auth/network-request-failed': 'Could not connect to Firebase. Check your internet connection.',
    'auth/requires-recent-login': 'Please log out and back in, then try changing your email or password again.',
    'permission-denied': 'Firebase denied this request. Check that the Firestore rules are published.'
  };
  return messages[error?.code] || error?.message || 'Something went wrong. Please try again.';
}