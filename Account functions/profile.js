import { apiFetch } from '../supabase-api.js';
import { logoutUser } from './auth-service.js';
import { supabase } from '../supabase-config.js';
const sessionKey = 'vicom-session';
const form = document.querySelector('#profile-form');
const error = document.querySelector('#form-error');
const toast = document.querySelector('#toast');
const nameInput = document.querySelector('#name');
const emailInput = document.querySelector('#email');
const specialtyInput = document.querySelector('#specialty');
const gcashNumberInput = document.querySelector('#gcash-number');
const gcashNameInput = document.querySelector('#gcash-name');
const passwordInput = document.querySelector('#password');
const confirmPasswordInput = document.querySelector('#confirm-password');
const pictureInput = document.querySelector('#picture-input');
const picturePreview = document.querySelector('#picture-preview');
const pictureInitials = document.querySelector('#picture-initials');
const pictureImage = document.querySelector('#picture-image');
const removePictureBtn = document.querySelector('#remove-picture');
const confirmModal = document.querySelector('#confirm-modal-overlay');
const confirmYes = document.querySelector('#confirm-yes');
const confirmCancel = document.querySelector('#confirm-cancel');
const confirmMessage = document.querySelector('#confirm-modal-message');
let pendingFormData = null;
let selectedFile = null;
let currentProfilePicture = null;
let currentUser = null;

function getSession() {
  try {
    return JSON.parse(localStorage.getItem(sessionKey) || 'null');
  } catch {
    return null;
  }
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2400);
}

function fillProfile(user) {
  nameInput.value = user.name || '';
  emailInput.value = user.email || '';
  specialtyInput.value = user.specialty || '';
  gcashNumberInput.value = user.gcashNumber || '';
  gcashNameInput.value = user.gcashName || '';
  currentProfilePicture = user.profilePicture || null;
  updatePicturePreview(user.name, currentProfilePicture);
  document.querySelectorAll('.artist-only').forEach((field) => {
    field.hidden = user.role !== 'artist';
  });
}

function updatePicturePreview(name, pictureUrl) {
  const initials = name?.trim().charAt(0).toUpperCase() || 'U';
  pictureInitials.textContent = initials;

  if (pictureUrl) {
    pictureImage.src = pictureUrl;
    pictureImage.hidden = false;
    removePictureBtn.hidden = false;
  } else {
    pictureImage.src = '';
    pictureImage.hidden = true;
    removePictureBtn.hidden = !selectedFile;
  }
}

async function loadProfile(session) {
  const response = await apiFetch(`supabase-data?action=profile&id=${encodeURIComponent(session.userId)}`);
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || 'Could not load your profile.');
  fillProfile(result.user);
  currentUser = result.user;
  const stored = getSession();
  if (stored) {
    localStorage.setItem(sessionKey, JSON.stringify({
      ...stored,
      ...result.user,
      isSuspended: !!result.user.isSuspended,
      suspensionUntil: result.user.suspensionUntil || null,
      suspensionReason: result.user.suspensionReason || '',
    }));
  }
  return result.user;
}

const session = getSession();
if (!session?.userId) {
  window.location.href = 'auth.html?mode=signin';
} else {
  loadProfile(session).catch(() => {
    currentUser = session;
    if (session.name || session.email) fillProfile({ ...session, specialty: session.specialty || '' });
    else error.textContent = 'Could not load your profile. Check your Supabase connection and try again.';
  });
}

document.querySelector('#back-link').href = session?.role === 'artist'
  ? '../Artist%20side/index.html'
  : '../User%20Side/index.html';

document.querySelector('#logout').addEventListener('click', async () => {
  await logoutUser();
  localStorage.removeItem(sessionKey);
  window.location.href = '../LandingPage/index.html';
});

pictureInput.addEventListener('change', (event) => {
  const file = event.target.files?.[0];
  if (!file) return;

  if (!file.type.startsWith('image/')) {
    error.textContent = 'Please select a valid image file.';
    pictureInput.value = '';
    return;
  }

  if (file.size > 2 * 1024 * 1024) {
    error.textContent = 'Image must be smaller than 2 MB.';
    pictureInput.value = '';
    return;
  }

  selectedFile = file;
  error.textContent = '';

  const reader = new FileReader();
  reader.onload = (e) => {
    pictureImage.src = e.target.result;
    pictureImage.hidden = false;
    removePictureBtn.hidden = false;
  };
  reader.readAsDataURL(file);
});

removePictureBtn.addEventListener('click', () => {
  selectedFile = null;
  pictureInput.value = '';
  currentProfilePicture = null;
  updatePicturePreview(nameInput.value, null);
});

function showConfirmModal(message) {
  confirmMessage.textContent = message;
  confirmModal.classList.add('open');
  return new Promise((resolve) => {
    const handleYes = () => {
      confirmModal.classList.remove('open');
      confirmYes.removeEventListener('click', handleYes);
      confirmCancel.removeEventListener('click', handleNo);
      resolve(true);
    };
    const handleNo = () => {
      confirmModal.classList.remove('open');
      confirmYes.removeEventListener('click', handleYes);
      confirmCancel.removeEventListener('click', handleNo);
      resolve(false);
    };
    confirmYes.addEventListener('click', handleYes);
    confirmCancel.addEventListener('click', handleNo);
  });
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  error.textContent = '';

  const name = nameInput.value.trim();
  const email = emailInput.value.trim().toLowerCase();
  const specialty = specialtyInput.value.trim();
  const gcashNumber = gcashNumberInput.value.trim();
  const gcashName = gcashNameInput.value.trim();
  const password = passwordInput.value;
  const confirmPassword = confirmPasswordInput.value;
  const currentSession = getSession();
  const isArtist = currentSession?.role === 'artist';
  if (!name || !email) {
    error.textContent = 'Name and email are required.';
    return;
  }
  if (isArtist && gcashNumber && !/^09\d{9}$/.test(gcashNumber)) {
    error.textContent = 'GCash number must be 11 digits starting with 09.';
    return;
  }
  if (password && password.length < 6) {
    error.textContent = 'Use a password with at least 6 characters.';
    return;
  }
  if (password && password !== confirmPassword) {
    error.textContent = 'Passwords do not match. Please re-enter your new password.';
    confirmPasswordInput.focus();
    return;
  }

  // Determine what's being changed
  const changes = [];
  if (name !== currentSession.name) changes.push('name');
  if (email !== currentSession.email) changes.push('email');
  if (isArtist && gcashNumber !== (currentSession.gcashNumber || '')) changes.push('GCash number');
  if (isArtist && gcashName !== (currentSession.gcashName || '')) changes.push('GCash account name');
  if (password) changes.push('password');
  if (selectedFile) changes.push('profile picture');

  // Show confirmation modal
  let message = 'Are you sure you want to save these changes to your profile?';
  if (changes.length > 0) {
    message = `You are about to change your ${changes.join(', ')}. Do you want to continue?`;
  }

  const confirmed = await showConfirmModal(message);
  if (!confirmed) return;

  const submitButton = form.querySelector('.submit-button');
  submitButton.disabled = true;
  try {
    let profilePictureUrl = currentProfilePicture;

    // Upload new picture if selected
    if (selectedFile) {
      const fileExt = selectedFile.name.split('.').pop();
      const fileName = `${session.userId}-${Date.now()}.${fileExt}`;
      const filePath = `profile-pictures/${fileName}`;

      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('vicom-uploads')
        .upload(filePath, selectedFile, { upsert: true });

      if (uploadError) throw new Error('Could not upload profile picture.');

      const { data: urlData } = supabase.storage
        .from('vicom-uploads')
        .getPublicUrl(filePath);

      profilePictureUrl = urlData.publicUrl;
    }

    const response = await apiFetch('supabase-data?action=update_profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: session.userId,
        name,
        email,
        specialty,
        gcashNumber: isArtist ? gcashNumber : undefined,
        gcashName: isArtist ? gcashName : undefined,
        password,
        profilePicture: profilePictureUrl
      }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'Could not save your profile.');

    const user = { ...result.user, role: session.role };
    localStorage.setItem(sessionKey, JSON.stringify({
      ...session,
      email: user.email,
      name: user.name,
      specialty: user.specialty || '',
      gcashNumber: user.gcashNumber || '',
      gcashName: user.gcashName || '',
      profilePicture: user.profilePicture || '',
    }));
    passwordInput.value = '';
    confirmPasswordInput.value = '';
    selectedFile = null;
    pictureInput.value = '';
    fillProfile(user);
    showToast('Profile updated');
  } catch (requestError) {
    error.textContent = requestError.message;
  } finally {
    submitButton.disabled = false;
  }
});
