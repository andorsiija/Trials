import { apiFetch } from '../supabase-api.js';
import { supabase } from '../supabase-config.js';
const sessionKey = 'vicom-session';
const apiUrl = 'supabase-data';
const modes = {
  signin: { eyebrow: 'Welcome back', title: 'Login to ViCom', description: 'Continue exploring artists and managing your commissions.', submit: 'Login', switch: 'New to ViCom?', switchAction: 'Create an account', switchMode: 'signup' },
  signup: { eyebrow: 'Start creating', title: 'Create your account', description: 'Save artists and turn your next idea into a commission.', submit: 'Create account', switch: 'Already have an account?', switchAction: 'Login', switchMode: 'signin' },
  artist: { eyebrow: 'For independent creatives', title: 'Join as an artist', description: 'Create your artist profile and start receiving commission requests.', submit: 'Create artist profile', switch: 'Already have an account?', switchAction: 'Login', switchMode: 'signin' }
};

let currentMode = new URLSearchParams(window.location.search).get('mode') || 'signin';
if (!modes[currentMode]) currentMode = 'signin';
const form = document.querySelector('#auth-form');
const error = document.querySelector('#form-error');
const toast = document.querySelector('#toast');
const submitButton = document.querySelector('#submit-button');
const forgotButton = document.querySelector('#forgot-password');
const emailInput = document.querySelector('#email');
const passwordInput = document.querySelector('#password');
const confirmPasswordField = document.querySelector('.confirm-password-field');
const confirmPasswordInput = document.querySelector('#confirm-password');
const passwordToggle = document.querySelector('#toggle-password');
const termsField = document.querySelector('#terms-field');
const termsCheckbox = document.querySelector('#terms-agree');
const legalModal = document.querySelector('#legal-modal');
const legalTitle = document.querySelector('#legal-title');
const legalBody = document.querySelector('#legal-body');
const legalClose = document.querySelector('#legal-close');
const legalAccept = document.querySelector('#legal-accept');
let isSubmitting = false;

const legalContent = {
  terms: {
    title: 'Terms and Conditions',
    body: `
      <p>Welcome to ViCom. By creating an account you agree to these terms.</p>
      <h3>1. Your account</h3>
      <p>Provide accurate information, keep your login details secure, and remember that you are responsible for activity on your account.</p>
      <h3>2. Commissions</h3>
      <p>ViCom connects customers with independent artists. The agreement for any commission, including pricing, deadlines, and deliverables, is between you and the artist. ViCom is not a party to that agreement.</p>
      <h3>3. Content</h3>
      <p>You keep ownership of the content you upload. Do not post work that infringes someone else's rights or violates the law. You grant ViCom permission to display your content as part of the service.</p>
      <h3>4. Acceptable use</h3>
      <p>Do not harass others, attempt to bypass security, or misuse the platform. We may suspend or remove accounts that break these rules.</p>
      <h3>5. Changes</h3>
      <p>We may update these terms from time to time. Continued use of ViCom after an update means you accept the revised terms.</p>
    `,
  },
  privacy: {
    title: 'Privacy Policy',
    body: `
      <p>This policy explains what information ViCom collects and how we use it.</p>
      <h3>Information we collect</h3>
      <p>Your name, email address, password (stored securely by our authentication provider), profile details, and the content you create or upload.</p>
      <h3>How we use it</h3>
      <p>To create and secure your account, connect customers with artists, operate commissions and messaging, and improve the service.</p>
      <h3>Sharing</h3>
      <p>We do not sell your personal information. We share data only with service providers that help us run ViCom and where required by law.</p>
      <h3>Your choices</h3>
      <p>You can update your profile details and request deletion of your account at any time.</p>
      <h3>Contact</h3>
      <p>Questions about your data? Reach out through the support options in ViCom.</p>
    `,
  },
};

function openLegal(kind) {
  const content = legalContent[kind];
  if (!content) return;
  legalTitle.textContent = content.title;
  legalBody.innerHTML = content.body;
  legalModal.hidden = false;
  legalAccept.focus();
}

function closeLegal() {
  legalModal.hidden = true;
}

document.addEventListener('click', (event) => {
  const termsTrigger = event.target.closest('[data-terms-open]');
  const privacyTrigger = event.target.closest('[data-privacy-open]');
  if (!termsTrigger && !privacyTrigger) return;
  event.preventDefault();
  openLegal(termsTrigger ? 'terms' : 'privacy');
});

termsCheckbox.addEventListener('change', () => {
  if (termsCheckbox.checked) termsField.classList.remove('invalid');
});

legalClose.addEventListener('click', closeLegal);
legalAccept.addEventListener('click', closeLegal);
legalModal.addEventListener('click', (event) => {
  if (event.target === legalModal) closeLegal();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !legalModal.hidden) closeLegal();
});

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2500);
}

function setMode(mode) {
  currentMode = mode;
  const copy = modes[mode];
  document.querySelectorAll('.mode-tab').forEach((tab) => tab.classList.toggle('active', tab.dataset.mode === mode));
  document.querySelector('#form-eyebrow').innerHTML = `<span></span> ${copy.eyebrow}`;
  document.querySelector('#form-title').textContent = copy.title;
  document.querySelector('#form-description').textContent = copy.description;
  document.querySelector('#submit-button').innerHTML = `${copy.submit} <span>↗</span>`;
  document.querySelector('#switch-copy').innerHTML = `${copy.switch} <button type="button" data-mode="${copy.switchMode}">${copy.switchAction}</button>`;
  document.querySelectorAll('.artist-only').forEach((field) => { field.hidden = mode !== 'artist'; });
  document.querySelector('.name-field').hidden = mode === 'signin';
  if (confirmPasswordField) {
    confirmPasswordField.hidden = mode === 'signin';
    if (mode === 'signin') confirmPasswordInput.value = '';
    confirmPasswordInput.autocomplete = 'new-password';
  }
  document.querySelector('#password').autocomplete = mode === 'signin' ? 'current-password' : 'new-password';
  passwordInput.type = 'password';
  passwordToggle.textContent = 'Show';
  passwordToggle.setAttribute('aria-label', 'Show password');
  passwordToggle.setAttribute('aria-pressed', 'false');
  if (forgotButton) forgotButton.hidden = mode !== 'signin';
  if (termsField) termsField.hidden = mode === 'signin';
  if (termsField) termsField.classList.remove('invalid');
  error.textContent = '';
  const url = new URL(window.location.href);
  url.searchParams.set('mode', mode);
  window.history.replaceState({}, '', url);
}

function redirectFor(role) {
  if (role === 'admin') {
    window.location.href = '../Admin%20side/index.html';
    return;
  }
  window.location.href = role === 'artist' ? '../Artist%20side/index.html' : '../User%20Side/index.html';
}

passwordToggle.addEventListener('click', () => {
  const show = passwordInput.type === 'password';
  passwordInput.type = show ? 'text' : 'password';
  passwordToggle.textContent = show ? 'Hide' : 'Show';
  passwordToggle.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
  passwordToggle.setAttribute('aria-pressed', String(show));
});

document.addEventListener('click', (event) => {
  const trigger = event.target.closest('[data-mode]');
  if (trigger) setMode(trigger.dataset.mode);
});

if (forgotButton) {
  forgotButton.addEventListener('click', async () => {
    const email = emailInput.value.trim().toLowerCase();
    error.textContent = '';

    if (!email) {
      error.textContent = 'Enter your email address above, then choose Forgot password.';
      emailInput.focus();
      return;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      error.textContent = 'Enter a valid email address.';
      emailInput.focus();
      return;
    }

    const originalLabel = forgotButton.textContent;
    forgotButton.disabled = true;
    forgotButton.textContent = 'Sending reset link...';

    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: new URL('reset-password.html', window.location.href).href,
      });
      if (resetError) throw resetError;
      error.textContent = `If an account exists for ${email}, a password reset link is on its way.`;
      showToast('Check your inbox for the reset link.');
    } catch (resetFailure) {
      error.textContent = resetFailure?.message || 'Could not send the reset email. Please try again.';
    } finally {
      forgotButton.disabled = false;
      forgotButton.textContent = originalLabel;
    }
  });
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();

  if (isSubmitting) return;
  isSubmitting = true;
  if (submitButton) {
    submitButton.disabled = true;
    submitButton.textContent = currentMode === 'signin' ? 'Signing in...' : 'Creating account...';
  }

  error.textContent = '';
  const data = new FormData(form);
  const email = data.get('email').trim().toLowerCase();
  const password = data.get('password');

  try {
    if (!email || !password) {
      error.textContent = 'Enter your email and password to continue.';
      return;
    }

    if (currentMode === 'signin') {
      await submitAccount('login', { email, password });
      return;
    }

    const isArtist = currentMode === 'artist';
    const name = (isArtist ? data.get('artistName') : data.get('name')).trim();
    if (!name) {
      error.textContent = isArtist ? 'Add your artist or studio name.' : 'Add your name to create an account.';
      return;
    }
    if (password.length < 6) {
      error.textContent = 'Use a password with at least 6 characters.';
      return;
    }
    const confirmPassword = data.get('confirmPassword') || '';
    if (password !== confirmPassword) {
      error.textContent = 'Passwords do not match. Please re-enter them.';
      confirmPasswordInput.focus();
      return;
    }
    if (!termsCheckbox.checked) {
      error.textContent = 'Please agree to the Terms and Conditions and Privacy Policy to create an account.';
      termsField.classList.add('invalid');
      termsCheckbox.focus();
      return;
    }
    termsField.classList.remove('invalid');

    await submitAccount('register', {
      email,
      password,
      name,
      role: isArtist ? 'artist' : 'customer',
      specialty: isArtist ? data.get('specialty').trim() : '',
    });
  } finally {
    isSubmitting = false;
    if (submitButton) {
      submitButton.disabled = false;
      submitButton.innerHTML = `${modes[currentMode].submit} <span>↗</span>`;
    }
  }
});

async function submitAccount(action, payload) {
  try {
    const response = await apiFetch(`${apiUrl}?action=${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const text = await response.text();
    let result;
    try {
      result = JSON.parse(text);
    } catch {
      throw new Error('Could not connect to Supabase. Check your internet connection and project configuration.');
    }
    if (!response.ok) throw new Error(result.error || 'Account request failed.');
    const user = result.user;
    if (user.emailVerificationSent) {
      showToast('Account created. Check your email to verify it, then log in.');
      return;
    }
    localStorage.setItem(sessionKey, JSON.stringify({
      userId: user.id,
      email: user.email,
      name: user.name,
      specialty: user.specialty || '',
      role: user.role,
      isSuspended: !!user.isSuspended,
      suspensionUntil: user.suspensionUntil || null,
    }));
    const successMessage = action === 'login' ? 'Signed in successfully' : 'Account created';
    showToast(successMessage);
    setTimeout(() => redirectFor(user.role), 350);
  } catch (requestError) {
    const message = String(requestError?.message || 'Account request failed.');
    const lower = message.toLowerCase();
    const duplicateAccountMessage = 'This email is already taken. Please sign in or use a different email.';

    if (
      lower.includes('user_already_exists') ||
      lower.includes('duplicate email') ||
      lower.includes('email is already') ||
      lower.includes('email already') ||
      lower.includes('already taken') ||
      lower.includes('already registered') ||
      lower.includes('already exists') ||
      lower.includes('in use') ||
      lower.includes('already in use') ||
      lower.includes('account with that email already exists') ||
      lower.includes('that email is already being used')
    ) {
      error.textContent = duplicateAccountMessage;
      showToast(duplicateAccountMessage);
      window.alert(duplicateAccountMessage);
      return;
    }

    error.textContent = message;
  }
}

setMode(currentMode);
