import { supabase } from '../supabase-config.js';

const sessionKey = 'vicom-session';
const form = document.querySelector('#reset-form');
const newPassword = document.querySelector('#new-password');
const confirmPassword = document.querySelector('#confirm-password');
const error = document.querySelector('#reset-error');
const toast = document.querySelector('#reset-toast');
const submitButton = document.querySelector('#reset-submit');
const statusCopy = document.querySelector('#reset-status');
let hasRecoverySession = false;
let isSubmitting = false;

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2600);
}

function setStatus(message, isError = false) {
  statusCopy.textContent = message;
  statusCopy.style.color = isError ? '#b84242' : '';
}

function enableForm() {
  if (hasRecoverySession) return;
  hasRecoverySession = true;
  submitButton.disabled = false;
  setStatus('Enter a new password for your ViCom account.');
}

function showExpiredLink() {
  if (hasRecoverySession) return;
  submitButton.disabled = true;
  setStatus('This reset link is invalid or has expired. Request a new link from the login page.', true);
}

async function waitForRecoverySession(timeout = 3000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const { data } = await supabase.auth.getSession();
    if (data.session) return data.session;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  return null;
}

submitButton.disabled = true;

supabase.auth.onAuthStateChange((event, session) => {
  if (event === 'PASSWORD_RECOVERY' || (session && ['SIGNED_IN', 'TOKEN_REFRESHED', 'INITIAL_SESSION'].includes(event))) {
    enableForm();
  }
});

async function init() {
  try {
    const session = await waitForRecoverySession();
    if (session) {
      enableForm();
    } else {
      showExpiredLink();
    }
  } catch {
    showExpiredLink();
  }
}

init();

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (isSubmitting) return;

  error.textContent = '';

  if (!hasRecoverySession) {
    setStatus('This reset link is invalid or has expired. Request a new link from the login page.', true);
    return;
  }

  const password = newPassword.value;
  const confirmation = confirmPassword.value;

  if (password.length < 6) {
    error.textContent = 'Use a password with at least 6 characters.';
    newPassword.focus();
    return;
  }

  if (password !== confirmation) {
    error.textContent = 'The two passwords do not match.';
    confirmPassword.focus();
    return;
  }

  isSubmitting = true;
  submitButton.disabled = true;
  submitButton.textContent = 'Updating password...';

  try {
    const { error: updateError } = await supabase.auth.updateUser({ password });
    if (updateError) throw updateError;

    setStatus('Password updated. Redirecting you to login...');
    showToast('Password updated successfully.');
    localStorage.removeItem(sessionKey);
    await supabase.auth.signOut().catch(() => {});
    setTimeout(() => {
      window.location.href = 'auth.html?mode=signin';
    }, 1200);
  } catch (updateFailure) {
    error.textContent = updateFailure?.message || 'Could not update your password. Request a new reset link and try again.';
    submitButton.disabled = false;
    submitButton.innerHTML = 'Update password <span>↗</span>';
    isSubmitting = false;
  }
});
