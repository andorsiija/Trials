import { apiFetch } from '../supabase-api.js';

const sessionKey = 'vicom-session';
const toast = document.querySelector('#toast');
let currentUser = null;
let myReports = [];
let myAppeals = [];
let pendingAppeal = null;
const appealModal = document.querySelector('#appeal-modal-overlay');
const appealMessage = document.querySelector('#appeal-message');
const appealSubmit = document.querySelector('#appeal-submit');
const appealCancel = document.querySelector('#appeal-cancel');

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

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[char]));
}

function activeSuspension(user) {
  if (!user?.isSuspended) return null;
  if (!user.suspensionUntil) return { hasEnd: false };
  const expiry = new Date(user.suspensionUntil);
  if (Number.isNaN(expiry.getTime())) return { hasEnd: false };
  if (expiry.getTime() <= Date.now()) return null;
  return { hasEnd: true, until: expiry };
}

function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });
}

function renderAppealStatus(user) {
  const container = document.querySelector('#appeal-suspension');
  if (!container) return;
  const suspension = activeSuspension(user);
  if (!suspension) {
    container.innerHTML = '<p class="appeal-note">Your account is not currently suspended.</p>';
    return;
  }
  const pending = myAppeals.some((appeal) => appeal.type === 'suspension' && appeal.status === 'pending');
  const details = [];
  if (user.suspensionReason) details.push(`Reason: ${escapeHtml(user.suspensionReason)}`);
  details.push(suspension.hasEnd
    ? `Ends ${suspension.until.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}`
    : 'This suspension has no set end date.');
  container.innerHTML = `
    <div class="appeal-suspension">
      <strong>Account suspended</strong>
      <p>${details.join(' · ')}</p>
    </div>
    ${pending
      ? '<span class="appeal-status pending">Appeal pending</span>'
      : '<button class="appeal-action" type="button" id="appeal-suspension-btn">Appeal suspension</button>'}
  `;
  container.querySelector('#appeal-suspension-btn')?.addEventListener('click', () => {
    openAppealModal({ type: 'suspension' });
  });
}

function renderReportsMade() {
  const container = document.querySelector('#appeal-reports');
  if (!container) return;
  if (!myReports.length) {
    container.innerHTML = '<p class="appeal-note">You have not made any reports yet.</p>';
    return;
  }
  container.innerHTML = myReports.map((report) => {
    const label = report.type ? `${escapeHtml(report.type)} report` : 'Report';
    return `
      <div class="appeal-item">
        <div class="appeal-item-copy">
          <strong>${label}</strong>
          <p>${escapeHtml(report.reason || 'No reason provided.')}</p>
          ${report.createdAt ? `<small>Filed ${formatDate(report.createdAt)}</small>` : ''}
        </div>
        <span class="appeal-status ${report.status || 'pending'}">${escapeHtml(report.status || 'pending')}</span>
      </div>
    `;
  }).join('');
}

function renderAppealHistory() {
  const container = document.querySelector('#appeal-history');
  if (!container) return;
  if (!myAppeals.length) {
    container.innerHTML = '<p class="appeal-note">You have not submitted any appeals yet.</p>';
    return;
  }
  container.innerHTML = myAppeals.map((appeal) => `
    <div class="appeal-item">
      <div class="appeal-item-copy">
        <strong>${appeal.type === 'suspension' ? 'Suspension appeal' : 'Report appeal'}</strong>
        <p>${escapeHtml(appeal.message)}</p>
        ${appeal.adminNote ? `<small>Admin note: ${escapeHtml(appeal.adminNote)}</small>` : ''}
        ${appeal.createdAt ? `<small>Submitted ${formatDate(appeal.createdAt)}</small>` : ''}
      </div>
      <span class="appeal-status ${appeal.status}">${escapeHtml(appeal.status)}</span>
    </div>
  `).join('');
}

async function loadAppeals() {
  const session = getSession();
  if (!session?.userId) return;
  try {
    const [reportsResponse, appealsResponse] = await Promise.all([
      apiFetch('supabase-data?action=my_reports'),
      apiFetch('supabase-data?action=my_appeals'),
    ]);
    const reportsResult = await reportsResponse.json().catch(() => ({}));
    const appealsResult = await appealsResponse.json().catch(() => ({}));
    myReports = reportsResponse.ok ? reportsResult.reports || [] : [];
    myAppeals = appealsResponse.ok ? appealsResult.appeals || [] : [];
  } catch {
    myReports = [];
    myAppeals = [];
  }
  renderAppealStatus(currentUser || session);
  renderReportsMade();
  renderAppealHistory();
}

function openAppealModal({ type, reportId = null }) {
  pendingAppeal = { type, reportId };
  document.querySelector('#appeal-modal-title').textContent = type === 'suspension' ? 'Appeal your suspension' : 'Appeal a report';
  document.querySelector('#appeal-modal-context').textContent = type === 'suspension'
    ? 'Explain why your suspension should be reconsidered. An admin will review your message.'
    : 'Explain why this report should be reconsidered. An admin will review your message.';
  appealMessage.value = '';
  appealModal.classList.add('open');
  setTimeout(() => appealMessage.focus(), 0);
}

function closeAppealModal() {
  appealModal.classList.remove('open');
  pendingAppeal = null;
}

async function submitAppeal() {
  if (!pendingAppeal) return;
  const message = appealMessage.value.trim();
  if (message.length < 10) {
    showToast('Describe your appeal in at least 10 characters.');
    appealMessage.focus();
    return;
  }
  appealSubmit.disabled = true;
  appealSubmit.textContent = 'Submitting...';
  try {
    const response = await apiFetch('supabase-data?action=create_appeal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: pendingAppeal.type, reportId: pendingAppeal.reportId, message }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'Could not submit your appeal.');
    closeAppealModal();
    showToast('Appeal submitted. An admin will review it soon.');
    await loadAppeals();
  } catch (requestError) {
    showToast(requestError.message || 'Could not submit your appeal.');
  } finally {
    appealSubmit.disabled = false;
    appealSubmit.textContent = 'Submit appeal';
  }
}

async function loadProfile(session) {
  const response = await apiFetch(`supabase-data?action=profile&id=${encodeURIComponent(session.userId)}`);
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || 'Could not load your profile.');
  currentUser = result.user;
  return result.user;
}

// Initialize
const session = getSession();
if (!session?.userId) {
  window.location.href = 'auth.html?mode=signin';
} else {
  loadProfile(session).then(() => {
    loadAppeals();
  }).catch(() => {
    currentUser = session;
    loadAppeals();
  });
}

appealSubmit?.addEventListener('click', submitAppeal);
appealCancel?.addEventListener('click', closeAppealModal);
appealModal?.addEventListener('click', (event) => {
  if (event.target === appealModal) closeAppealModal();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && appealModal?.classList.contains('open')) closeAppealModal();
});
