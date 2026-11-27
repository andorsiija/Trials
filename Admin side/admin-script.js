import { apiFetch } from '../supabase-api.js';
import { checkAdminAccess, getAdminUser } from '../Account functions/admin-auth.js';
import { logoutUser } from '../Account functions/auth-service.js';

const toast = document.querySelector('#toast');
let timer;
let adminUser = null;
let selectedReport = null;
let selectedAppeal = null;
let suspendTargetId = null;
let suspendTargetType = null;

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[char]));
}

function notify(message) {
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(timer);
  timer = setTimeout(() => toast.classList.remove('show'), 2200);
}

async function validateAdmin() {
  const hasAccess = await checkAdminAccess();
  if (!hasAccess) {
    notify('Admin access required');
    setTimeout(() => {
      window.location.href = '../LandingPage/index.html';
    }, 1500);
    return false;
  }
  return true;
}

async function loadAdmin() {
  try {
    const { profile } = await getAdminUser();
    adminUser = profile;
    const displayName = profile.name || 'Admin';
    document.querySelector('#admin-name').textContent = displayName;
    document.querySelector('#admin-initials').textContent = displayName
      .split(/\s+/).map(p => p[0]).join('').slice(0, 2).toUpperCase();
  } catch (error) {
    await logoutUser();
    window.location.href = '../LandingPage/index.html';
  }
}

async function loadReports() {
  try {
    const res = await apiFetch('../supabase-data?action=admin_reports');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    return data.reports || [];
  } catch {
    return [];
  }
}

async function loadArtists() {
  try {
    const res = await apiFetch('../supabase-data?action=admin_artists');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    return data.artists || [];
  } catch {
    return [];
  }
}

async function loadUsers() {
  try {
    const res = await apiFetch('../supabase-data?action=admin_users');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    return data.users || [];
  } catch {
    return [];
  }
}

async function loadAppeals() {
  try {
    const res = await apiFetch('../supabase-data?action=admin_appeals');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    return data.appeals || [];
  } catch {
    return [];
  }
}

function openSuspendModal(targetId, targetType, name) {
  suspendTargetId = targetId;
  suspendTargetType = targetType;
  document.querySelector('#suspend-title').textContent = `Suspend ${name}?`;
  document.querySelector('#suspend-reason').value = '';
  document.querySelector('#suspend-days').value = '7';
  document.querySelector('#suspend-modal').classList.add('open');
}

function renderReports(reports) {
  const list = document.querySelector('#reports-list');
  const empty = document.querySelector('#reports-empty');
  const filter = document.querySelector('#report-filter').value;

  const filtered = filter ? reports.filter(r => r.status === filter) : reports;
  const pending = reports.filter(r => r.status === 'pending').length;

  document.querySelector('#pending-reports').textContent = pending;
  document.querySelector('#report-count').textContent = pending;

  if (!filtered.length) {
    list.innerHTML = '';
    empty.style.display = 'block';
    return;
  }

  empty.style.display = 'none';
  list.innerHTML = filtered.map(r => `
    <div class="report-item" data-id="${r.id}" data-reported="${r.reportedId}" data-type="${r.type}" data-reason="${r.reason.replace(/"/g, '&quot;')}" data-status="${r.status}" data-reporter-name="${(r.reporterName || 'Unknown').replace(/"/g, '&quot;')}" data-reported-name="${(r.reportedName || 'Unknown').replace(/"/g, '&quot;')}">
      <div class="report-info">
        <strong>${r.type.charAt(0).toUpperCase() + r.type.slice(1)} Report</strong>
        <small>${r.reason}</small>
        <small style="margin-top:4px;color:#8aa396;">Reported by ${r.reporterName || 'Unknown'} • Reported account: ${r.reportedName || 'Unknown'} • ${new Date(r.createdAt).toLocaleDateString()}</small>
      </div>
      <span class="report-badge ${r.status}">${r.status}</span>
    </div>
  `).join('');

  list.querySelectorAll('.report-item').forEach(item => {
    item.addEventListener('click', () => {
      selectedReport = {
        id: item.dataset.id,
        reportedId: item.dataset.reported,
        type: item.dataset.type,
        reason: item.dataset.reason,
        status: item.dataset.status,
        reporterName: item.dataset.reporterName,
        reportedName: item.dataset.reportedName
      };
      openReportModal();
    });
  });
}

function renderAppeals(appeals) {
  const list = document.querySelector('#appeals-list');
  const empty = document.querySelector('#appeals-empty');
  const filter = document.querySelector('#appeal-filter').value;

  const filtered = filter ? appeals.filter((appeal) => appeal.status === filter) : appeals;
  const pending = appeals.filter((appeal) => appeal.status === 'pending').length;
  document.querySelector('#appeal-count').textContent = pending;

  if (!filtered.length) {
    list.innerHTML = '';
    empty.style.display = 'block';
    return;
  }

  empty.style.display = 'none';
  list.innerHTML = filtered.map((appeal) => {
    const title = appeal.type === 'suspension' ? 'Suspension appeal' : 'Report appeal';
    const report = appeal.report
      ? `<small style="margin-top:4px;color:#8aa396;">Related report: ${escapeHtml(appeal.report.reason || appeal.report.type || '')}</small>`
      : '';
    return `
      <div class="report-item appeal-row" data-id="${appeal.id}">
        <div class="report-info">
          <strong>${title} · ${escapeHtml(appeal.userName || 'Unknown')}</strong>
          <small>${escapeHtml(appeal.message)}</small>
          ${report}
          <small style="margin-top:4px;color:#8aa396;">${escapeHtml(appeal.userRole || 'account')} • Submitted ${new Date(appeal.createdAt).toLocaleDateString()}${appeal.adminNote ? ` • Note: ${escapeHtml(appeal.adminNote)}` : ''}</small>
        </div>
        <span class="report-badge ${appeal.status}">${appeal.status}</span>
      </div>
    `;
  }).join('');

  list.querySelectorAll('.appeal-row').forEach((item) => {
    item.addEventListener('click', () => {
      selectedAppeal = appeals.find((appeal) => appeal.id === item.dataset.id);
      openAppealModal();
    });
  });
}

function openAppealModal() {
  if (!selectedAppeal) return;
  document.querySelector('#appeal-modal-title').textContent = selectedAppeal.type === 'suspension' ? 'Suspension appeal' : 'Report appeal';
  document.querySelector('#appeal-details').innerHTML = `
    <p><strong>Account:</strong> ${escapeHtml(selectedAppeal.userName || 'Unknown')} (${escapeHtml(selectedAppeal.userRole || 'account')})</p>
    ${selectedAppeal.report ? `<p><strong>Reported for:</strong> ${escapeHtml(selectedAppeal.report.reason || selectedAppeal.report.type || '')}</p>` : ''}
    <p><strong>Appeal message:</strong> ${escapeHtml(selectedAppeal.message)}</p>
    <p><strong>Status:</strong> ${escapeHtml(selectedAppeal.status)}</p>
    ${selectedAppeal.adminNote ? `<p><strong>Previous note:</strong> ${escapeHtml(selectedAppeal.adminNote)}</p>` : ''}
  `;
  document.querySelector('#appeal-admin-note').value = selectedAppeal.adminNote || '';
  document.querySelector('#appeal-modal').classList.add('open');
}

function closeAppealModal() {
  document.querySelector('#appeal-modal').classList.remove('open');
  selectedAppeal = null;
}

async function updateAppealStatus(appealId, status) {
  const adminNote = document.querySelector('#appeal-admin-note').value.trim();
  try {
    const res = await apiFetch('../supabase-data?action=update_appeal_status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appealId, status, adminNote }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    notify(status === 'accepted' ? 'Appeal accepted' : 'Appeal rejected');
    const appeals = await loadAppeals();
    renderAppeals(appeals);
    closeAppealModal();
  } catch (err) {
    notify(err.message);
  }
}

function renderArtists(artists) {
  const list = document.querySelector('#artists-list');
  const empty = document.querySelector('#artists-empty');

  if (!artists.length) {
    list.innerHTML = '';
    empty.style.display = 'block';
    return;
  }

  empty.style.display = 'none';
  const total = artists.length;
  const suspended = artists.filter(a => a.isSuspended).length;
  document.querySelector('#total-artists').textContent = total;
  document.querySelector('#suspended-count').textContent = suspended;

  list.innerHTML = artists.map(a => `
    <div class="artist-item" data-id="${a.id}" data-name="${a.name.replace(/"/g, '&quot;')}" data-suspended="${a.isSuspended}">
      <div class="artist-info">
        <span class="artist-avatar">${a.name.split(/\s+/).map(p => p[0]).join('').slice(0, 2).toUpperCase()}</span>
        <div class="artist-details">
          <strong>${a.name}</strong>
          <small>${a.specialty || 'Artist'}</small>
        </div>
      </div>
      <span class="artist-status ${a.isSuspended ? 'suspended' : 'active'}">${a.isSuspended ? 'SUSPENDED' : 'ACTIVE'}</span>
      <div class="artist-actions">
        ${a.isSuspended
          ? `<button class="action-button unsuspend-btn">Unsuspend</button>`
          : `<button class="action-button danger suspend-btn">Suspend</button>`
        }
      </div>
    </div>
  `).join('');

  list.querySelectorAll('.suspend-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const item = btn.closest('.artist-item');
      openSuspendModal(item.dataset.id, 'artist', item.dataset.name);
    });
  });

  list.querySelectorAll('.unsuspend-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const item = btn.closest('.artist-item');
      await unsuspendArtist(item.dataset.id);
    });
  });
}

function renderUsers(users) {
  const list = document.querySelector('#users-list');
  const empty = document.querySelector('#users-empty');
  const validUsers = (users || []).filter(Boolean);

  if (!validUsers.length) {
    list.innerHTML = '';
    empty.style.display = 'block';
    return;
  }

  empty.style.display = 'none';
  list.innerHTML = validUsers.map(u => {
    const name = u.name || 'User';
    const initials = name.split(/\s+/).filter(Boolean).map(p => p[0]).join('').slice(0, 2).toUpperCase() || 'U';
    const suspended = Boolean(u.isSuspended);
    return `
      <div class="user-item" data-id="${u.id}" data-name="${name.replace(/"/g, '&quot;')}" data-suspended="${suspended}">
        <div class="user-info">
          <span class="user-avatar">${initials}</span>
          <div class="user-details">
            <strong>${name}</strong>
            <small>Customer</small>
          </div>
        </div>
        <span class="user-status ${suspended ? 'suspended' : 'active'}">${suspended ? 'SUSPENDED' : 'ACTIVE'}</span>
        <div class="user-actions">
          ${suspended
            ? `<button class="action-button unsuspend-user-btn">Unsuspend</button>`
            : `<button class="action-button danger suspend-user-btn">Suspend</button>`
          }
        </div>
      </div>
    `;
  }).join('');

  list.querySelectorAll('.suspend-user-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const item = btn.closest('.user-item');
      openSuspendModal(item.dataset.id, 'user', item.dataset.name);
    });
  });

  list.querySelectorAll('.unsuspend-user-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const item = btn.closest('.user-item');
      await unsuspendUser(item.dataset.id);
    });
  });
}

function openReportModal() {
  if (!selectedReport) return;
  const details = document.querySelector('#report-details');
  document.querySelector('#report-modal-title').textContent = `${selectedReport.type.charAt(0).toUpperCase() + selectedReport.type.slice(1)} Report`;
  details.innerHTML = `
    <p><strong>Reported by:</strong> ${selectedReport.reporterName || 'Unknown'}</p>
    <p><strong>Reported account:</strong> ${selectedReport.reportedName || 'Unknown'}</p>
    <p><strong>Reason:</strong> ${selectedReport.reason}</p>
    <p><strong>Status:</strong> ${selectedReport.status}</p>
  `;
  document.querySelector('#report-modal').classList.add('open');
}

function closeReportModal() {
  document.querySelector('#report-modal').classList.remove('open');
  selectedReport = null;
}

function closeSuspendModal() {
  document.querySelector('#suspend-modal').classList.remove('open');
  document.querySelector('#suspend-days').value = '7';
  suspendTargetId = null;
  suspendTargetType = null;
}

async function updateReportStatus(reportId, status) {
  try {
    const res = await apiFetch('../supabase-data?action=update_report_status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reportId, status }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    notify('Report updated');
    const reports = await loadReports();
    renderReports(reports);
    closeReportModal();
  } catch (err) {
    notify(err.message);
  }
}

async function suspendArtist(artistId, reason, days) {
  try {
    const res = await apiFetch('../supabase-data?action=suspend_artist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ artistId, reason, days }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    notify(`Artist suspended for ${days || 0} day${Number(days) === 1 ? '' : 's'}`);
    const artists = await loadArtists();
    renderArtists(artists);
    closeSuspendModal();
  } catch (err) {
    notify(err.message);
  }
}

async function unsuspendArtist(artistId) {
  try {
    const res = await apiFetch('../supabase-data?action=unsuspend_artist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ artistId }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    notify('Artist unsuspended');
    const artists = await loadArtists();
    renderArtists(artists);
  } catch (err) {
    notify(err.message);
  }
}

async function suspendUser(userId, reason, days) {
  try {
    const res = await apiFetch('../supabase-data?action=suspend_user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, reason, days }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    notify(`User suspended for ${days || 0} day${Number(days) === 1 ? '' : 's'}`);
    const users = await loadUsers();
    renderUsers(users);
    closeSuspendModal();
  } catch (err) {
    notify(err.message);
  }
}

async function unsuspendUser(userId) {
  try {
    const res = await apiFetch('../supabase-data?action=unsuspend_user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    notify('User unsuspended');
    const users = await loadUsers();
    renderUsers(users);
  } catch (err) {
    notify(err.message);
  }
}

// Mobile sidebar
const sidebar = document.querySelector('.sidebar');
const sidebarOverlay = document.querySelector('#sidebar-overlay');
const mobileNav = document.querySelector('#mobile-nav');

function setSidebar(open) {
  if (!sidebar) return;
  sidebar.classList.toggle('open', open);
  sidebarOverlay?.classList.toggle('show', open);
  document.body.classList.toggle('menu-open', open);
  mobileNav?.setAttribute('aria-expanded', String(open));
}

mobileNav?.addEventListener('click', () => setSidebar(!sidebar.classList.contains('open')));
sidebarOverlay?.addEventListener('click', () => setSidebar(false));

// Navigation
document.querySelectorAll('nav a').forEach(link => {
  link.addEventListener('click', function(e) {
    e.preventDefault();
    const href = this.getAttribute('href');
    setSidebar(false);

    document.querySelectorAll('nav a').forEach(l => l.classList.remove('active'));
    this.classList.add('active');

    document.querySelector('#dashboard').style.display = 'none';
    document.querySelector('#reports-section').style.display = 'none';
    document.querySelector('#artists-section').style.display = 'none';
    document.querySelector('#users-section').style.display = 'none';
    document.querySelector('#appeals-section').style.display = 'none';

    if (href === '#dashboard') {
      document.querySelector('#dashboard').style.display = 'grid';
    } else if (href === '#reports') {
      document.querySelector('#reports-section').style.display = 'block';
    } else if (href === '#appeals') {
      document.querySelector('#appeals-section').style.display = 'block';
    } else if (href === '#artists') {
      document.querySelector('#artists-section').style.display = 'block';
    } else if (href === '#users') {
      document.querySelector('#users-section').style.display = 'block';
    }
  });
});

// Event listeners
document.querySelector('#close-report-modal').addEventListener('click', closeReportModal);
document.querySelector('#close-suspend-modal').addEventListener('click', closeSuspendModal);
document.querySelector('#close-appeal-modal').addEventListener('click', closeAppealModal);

document.querySelector('#accept-appeal').addEventListener('click', () => {
  if (selectedAppeal) updateAppealStatus(selectedAppeal.id, 'accepted');
});

document.querySelector('#reject-appeal').addEventListener('click', () => {
  if (selectedAppeal) updateAppealStatus(selectedAppeal.id, 'rejected');
});

document.querySelector('#approve-report').addEventListener('click', () => {
  if (selectedReport) updateReportStatus(selectedReport.id, 'reviewed');
});

document.querySelector('#dismiss-report').addEventListener('click', () => {
  if (selectedReport) updateReportStatus(selectedReport.id, 'dismissed');
});

document.querySelector('#confirm-suspend').addEventListener('click', async () => {
  const reason = document.querySelector('#suspend-reason').value.trim();
  const days = Number(document.querySelector('#suspend-days').value || 0);
  if (!reason) { notify('Please enter a reason'); return; }
  if (!suspendTargetId) { notify('No account selected'); return; }
  if (suspendTargetType === 'user') {
    await suspendUser(suspendTargetId, reason, days);
  } else {
    await suspendArtist(suspendTargetId, reason, days);
  }
});

document.querySelector('#cancel-suspend').addEventListener('click', closeSuspendModal);

document.querySelector('#report-filter').addEventListener('change', async () => {
  const reports = await loadReports();
  renderReports(reports);
});

document.querySelector('#appeal-filter').addEventListener('change', async () => {
  const appeals = await loadAppeals();
  renderAppeals(appeals);
});

document.querySelector('#artist-search').addEventListener('input', async (e) => {
  const term = e.target.value.toLowerCase();
  const artists = await loadArtists();
  renderArtists(artists.filter(a => a.name.toLowerCase().includes(term)));
});

document.querySelector('#user-search').addEventListener('input', async (e) => {
  const term = (e.target.value || '').toLowerCase();
  const users = await loadUsers();
  renderUsers(users.filter((u) => (u.name || '').toLowerCase().includes(term)));
});

document.querySelector('#logout').addEventListener('click', async () => {
  await logoutUser();
  localStorage.removeItem('vicom-session');
  window.location.href = '../LandingPage/index.html';
});

// Init
async function init() {
  const isAdmin = await validateAdmin();
  if (!isAdmin) return;
  await loadAdmin();
  const [reports, artists, users, appeals] = await Promise.all([loadReports(), loadArtists(), loadUsers(), loadAppeals()]);
  renderReports(reports);
  renderArtists(artists);
  renderUsers(users);
  renderAppeals(appeals);
}

init();