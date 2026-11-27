import { apiFetch } from '../supabase-api.js';
import { supabase } from '../supabase-config.js';
import { artworkImageAttrs, hydrateArtworkImages } from '../artwork-images.js';
import { logoutUser } from '../Account functions/auth-service.js';
/* Artist side – script.js
 * Pulls live counts and artwork from Supabase.
 * and shows real badges on Commissions & Messages nav links.
 */

const API = '../supabase-data';
const toast = document.querySelector('#toast');
let timer;
let loggedInArtist = null;
let currentNotifications = [];

function notify(message) {
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(timer);
  timer = setTimeout(() => toast.classList.remove('show'), 2200);
}

function toggleSidebar(forceOpen) {
  const sidebar = document.querySelector('.sidebar');
  const overlay = document.querySelector('.mobile-overlay');
  const menuButton = document.querySelector('.mobile-nav');
  if (!sidebar) return;

  const shouldOpen = typeof forceOpen === 'boolean' ? forceOpen : !sidebar.classList.contains('open');
  sidebar.classList.toggle('open', shouldOpen);
  document.body.classList.toggle('menu-open', shouldOpen);
  if (overlay) overlay.classList.toggle('show', shouldOpen);
  if (menuButton) menuButton.setAttribute('aria-expanded', String(shouldOpen));
}

function ensureMobileMenu() {
  if (document.querySelector('.mobile-overlay')) return;

  const overlay = document.createElement('button');
  overlay.type = 'button';
  overlay.className = 'mobile-overlay';
  overlay.setAttribute('aria-label', 'Close navigation');
  overlay.addEventListener('click', () => toggleSidebar(false));
  document.body.appendChild(overlay);
}

/* ── SESSION ──────────────────────────────────────── */
function getSession() {
  try { return JSON.parse(localStorage.getItem('vicom-session')); }
  catch { return null; }
}

function loadLoggedInArtist() {
  try {
    const session = getSession();
    if (!session) return;

    // Use session data directly (no more localStorage DB lookup)
    loggedInArtist = {
      id: session.userId,
      name: session.name || session.email,
      role: session.role || 'artist',
      isSuspended: !!session.isSuspended,
    };

    if (loggedInArtist.isSuspended) {
      // Suspended artist banners removed by request; the suspension is handled in the commission state and blocking logic.
    }

    if (loggedInArtist.name) {
      const displayName = loggedInArtist.name;
      const el_name     = document.querySelector('#artist-name');
      const el_greeting = document.querySelector('#artist-greeting');
      const el_initials = document.querySelector('#artist-initials');
      if (el_name)     el_name.textContent     = displayName;
      if (el_greeting) el_greeting.textContent = displayName;
      if (el_initials) el_initials.textContent = displayName
        .split(/\s+/).map(p => p[0]).join('').slice(0, 2).toUpperCase();
    }
  } catch (error) {
    loggedInArtist = null;
  }
}

async function loadProfilePicture() {
  const avatar = document.querySelector('#artist-initials');
  if (!avatar) return;

  let session = getSession();
  if (!session?.userId) return;

  const render = (url, name) => {
    const fallback = String(name || '')
      .split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase() || '--';
    if (url) {
      const probe = new Image();
      probe.onload = () => {
        avatar.style.backgroundImage = `url("${url}")`;
        avatar.style.backgroundSize = 'cover';
        avatar.style.backgroundPosition = 'center';
        avatar.style.backgroundRepeat = 'no-repeat';
        avatar.classList.add('has-photo');
        avatar.textContent = '';
      };
      probe.onerror = () => {
        avatar.style.backgroundImage = '';
        avatar.classList.remove('has-photo');
        avatar.textContent = fallback;
      };
      probe.src = url;
    } else {
      avatar.style.backgroundImage = '';
      avatar.classList.remove('has-photo');
      avatar.textContent = fallback;
    }
  };

  try {
    const res = await apiFetch(`${API}?action=profile&id=${encodeURIComponent(session.userId)}`);
    if (res.ok) {
      const data = await res.json();
      const profile = data.user || {};
      const url = profile.profilePicture || session.profilePicture || '';
      render(url, profile.name || session.name);

      if (url && (url !== session.profilePicture || profile.name !== session.name)) {
        session = { ...session, profilePicture: url, name: profile.name || session.name };
        localStorage.setItem('vicom-session', JSON.stringify(session));
      }
      return;
    }
  } catch (error) {
    console.warn('Could not load profile picture:', error.message);
  }

  render(session.profilePicture || '', session.name || session.email);
}

/* ── PORTFOLIO ────────────────────────────────────── */
async function fetchPortfolio() {
  if (!loggedInArtist) return [];
  try {
    const res  = await apiFetch(`${API}?action=artworks`);
    const json = await res.json();
    return (json.artworks || []).filter(a => a.artistId === loggedInArtist.id);
  } catch { return []; }
}

function renderPortfolio(portfolio) {
  const grid  = document.querySelector('#portfolio-grid');
  const empty = document.querySelector('#portfolio-empty');
  if (!grid || !empty) return;
  grid.innerHTML = portfolio
    .map(w => `<div class="work"${artworkImageAttrs(w)} title="${w.title}"></div>`)
    .join('');
  hydrateArtworkImages(grid);
  empty.hidden = portfolio.length > 0;
}

async function savePortfolio(work) {
  const response = await apiFetch(`${API}?action=create_artwork`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(work),
  });
  const text = await response.text();
  let result;
  try { result = JSON.parse(text); }
  catch { throw new Error('Supabase could not publish this artwork. Check your connection and database policies.'); }
  if (!response.ok) throw new Error(result.error || 'Artwork could not be published.');
}

/* ── DASHBOARD COUNTS (live from DB) ─────────────── */
async function loadDashboardCounts() {
  if (!loggedInArtist) return;

  try {
    const res  = await apiFetch(`${API}?action=dashboard_counts&userId=${encodeURIComponent(loggedInArtist.id)}&role=artist`);
    const data = await res.json();

    const active  = data.active  || 0;
    const pending = data.pending || 0;
    const unread  = data.unreadMessages || 0;
    const notifs  = data.notifications  || 0;

    const totalCommissions = active + pending;

    /* ── Stat card: Active commissions ── */
    const statEl = document.querySelector('.stat-card strong');
    if (statEl) {
      statEl.textContent = active;
      const smallEl = statEl.nextElementSibling;
      if (smallEl) smallEl.textContent = active === 0 ? 'No active commissions' : `${active} in progress`;
    }

    /* ── Nav badge: Commissions ── */
    updateNavBadge('commissions.html', totalCommissions);

    /* ── Nav badge: Messages ── */
    updateNavBadge('#messages', unread);

    /* ── Messages panel heading count ── */
    const msgCount = document.querySelector('.messages .count');
    if (msgCount) msgCount.textContent = unread;

    /* ── Notification bell ── */
    const notifBtn = document.querySelector('#notification');
    if (notifBtn) {
      notifBtn.style.position = 'relative';
      let badge = notifBtn.querySelector('.notif-badge');
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'notif-badge';
        notifBtn.appendChild(badge);
      }
      badge.textContent = notifs > 9 ? '9+' : notifs;
      badge.style.display = notifs > 0 ? 'flex' : 'none';
    }

    /* ── Active commissions panel ── */
    loadActiveCommissionsPanel(active + pending);

  } catch (err) {
    console.warn('Dashboard counts unavailable:', err.message);
  }
}

function updateNavBadge(href, count) {
  // Find the nav link that matches href or anchor
  const links = document.querySelectorAll('nav a');
  links.forEach(link => {
    if (link.getAttribute('href') === href) {
      let badge = link.querySelector('b');
      if (!badge) { badge = document.createElement('b'); link.appendChild(badge); }
      badge.textContent = count > 99 ? '99+' : String(count);
      badge.className   = count > 0 ? 'badge-active' : '';
      badge.style.display = count > 0 ? 'inline' : 'none';
    }
  });
}

function renderNotifications(items) {
  const menu = document.querySelector('#notifications-menu');
  if (!menu) return;

  const list = Array.isArray(items) ? items : [];
  currentNotifications = list;
  if (!list.length) {
    menu.innerHTML = '<div class="notification-header"><h3>Notifications</h3></div><p class="notification-empty">No new notifications.</p>';
    return;
  }

  menu.innerHTML = `
    <div class="notification-header">
      <h3>Notifications</h3>
      <button type="button" class="notification-clear">View all</button>
    </div>
    <div class="notification-list">
      ${list.map((item, index) => `
        <button class="notification-item" type="button" data-index="${index}">
          <span class="notification-icon ${item.tone || 'green'}">${item.icon || '✓'}</span>
          <span class="notification-copy">
            <strong>${item.title}</strong>
            <small>${item.detail}</small>
            <time>${item.time}</time>
          </span>
          <span class="notification-dot" aria-hidden="true"></span>
        </button>
      `).join('')}
    </div>
  `;
}

function toggleNotifications(forceOpen) {
  const bell = document.querySelector('#notification');
  const menu = document.querySelector('#notifications-menu');
  if (!bell || !menu) return;

  const shouldOpen = typeof forceOpen === 'boolean' ? forceOpen : !menu.classList.contains('open');
  menu.classList.toggle('open', shouldOpen);
  bell.classList.toggle('active', shouldOpen);
  bell.setAttribute('aria-expanded', String(shouldOpen));
}

/* ── ACTIVE COMMISSIONS PANEL ────────────────────── */
async function loadActiveCommissionsPanel(totalCount) {
  const listEl = document.querySelector('.commission-list');
  if (!listEl || !loggedInArtist) return;

  if (totalCount === 0) {
    listEl.innerHTML = '<p style="color:#8aa396;font-size:13px;padding:8px 0">No active commissions.</p>';
    return;
  }

  try {
    const res  = await apiFetch(`${API}?action=commissions&userId=${encodeURIComponent(loggedInArtist.id)}&role=artist`);
    const data = await res.json();
    const comms = (data.commissions || []).filter(c => c.status !== 'declined').slice(0, 4);

    listEl.innerHTML = comms.map(c => {
      const statusCls = c.status === 'pending' ? 'status-pending' : 'status-active';
      const statusTxt = c.status === 'pending' ? 'Pending' : `Stage ${(c.currentStage||0)+1}`;
      return `<a class="comm-preview-item" href="commissions.html">
        <span class="comm-avatar-sm">${initials(c.clientName)}</span>
        <div>
          <strong>${c.title}</strong>
          <small>from ${c.clientName}</small>
        </div>
        <span class="mini-badge ${statusCls}">${statusTxt}</span>
      </a>`;
    }).join('');
  } catch {
    listEl.innerHTML = '<p style="color:#8aa396;font-size:13px">Could not load commissions.</p>';
  }
}

function initials(name) {
  return (name || '?').split(/\s+/).map(p => p[0]).join('').slice(0, 2).toUpperCase();
}

/* ── PROFILE VIEWS ───────────────────────────────── */
async function loadProfileViews() {
  if (!loggedInArtist) return;
  const el = document.querySelector('#profile-views');
  try {
    const res  = await apiFetch(`${API}?action=artist_stats&id=${encodeURIComponent(loggedInArtist.id)}`);
    const data = await res.json();
    if (el) el.textContent = Number(data.profileViews || 0).toLocaleString();
  } catch { if (el) el.textContent = '0'; }
}

/* ── EARNINGS / TRANSACTION HISTORY ─────────────── */
function formatPeso(value) {
  return `₱${Number(value || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function escapeText(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

async function loadEarnings() {
  if (!loggedInArtist) return;
  const listEl = document.querySelector('#transaction-list');
  const emptyEl = document.querySelector('#transaction-empty');
  const totalEl = document.querySelector('#earnings-total');
  const monthlyEl = document.querySelector('#monthly-earnings');
  const monthlyNote = document.querySelector('#monthly-earnings-note');
  if (!listEl) return;

  try {
    const res = await apiFetch(`${API}?action=artist_payments`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not load earnings.');

    const payments = data.payments || [];
    const completed = payments.filter((payment) => payment.status === 'completed');
    const total = completed.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
    const now = new Date();
    const monthly = completed.filter((payment) => {
      const date = new Date(payment.createdAt);
      return date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();
    });
    const monthlyTotal = monthly.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);

    if (totalEl) totalEl.textContent = formatPeso(total);
    if (monthlyEl) monthlyEl.textContent = formatPeso(monthlyTotal);
    if (monthlyNote) {
      monthlyNote.textContent = monthly.length
        ? `${monthly.length} payment${monthly.length === 1 ? '' : 's'} this month`
        : 'No payments yet this month';
    }

    emptyEl.hidden = payments.length > 0;
    listEl.innerHTML = payments.map((payment) => {
      const date = payment.createdAt ? new Date(payment.createdAt) : null;
      const dateLabel = date && !Number.isNaN(date.getTime())
        ? date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
        : '—';
      const typeLabel = payment.paymentType === 'final_payment' ? 'Final payment' : '50% down payment';
      return `
        <div class="transaction-row">
          <div class="transaction-main">
            <strong>${escapeText(payment.commissionTitle)}</strong>
            <small>${dateLabel} · from ${escapeText(payment.clientName)}</small>
          </div>
          <div class="transaction-type">${typeLabel}<br><span>${escapeText(payment.status || 'completed')}</span></div>
          <div class="transaction-amount">
            <strong>${formatPeso(payment.amount)}</strong>
            <small>GCash</small>
          </div>
        </div>`;
    }).join('');
  } catch {
    if (emptyEl) {
      emptyEl.hidden = false;
      emptyEl.textContent = 'Could not load your transactions right now.';
    }
  }
}

/* ── MESSAGE PANEL ─────────────────────────────── */
async function loadMessagesPanel() {
  const panel = document.querySelector('#messages');
  if (!panel || !loggedInArtist) return;

  let list = panel.querySelector('.message-list');
  if (!list) {
    list = document.createElement('div');
    list.className = 'message-list';
    panel.appendChild(list);
  }

  try {
    const res  = await apiFetch(`${API}?action=commissions&userId=${encodeURIComponent(loggedInArtist.id)}&role=artist`);
    const data = await res.json();
    const comms = (data.commissions || []).filter(c => c.status !== 'declined').slice(0, 4);

    if (!comms.length) {
      list.innerHTML = '<p style="margin:12px 0 0;color:#8aa396;font-size:13px">No messages yet.</p>';
      return;
    }

    const items = [];
    for (const c of comms) {
      try {
        const msgRes  = await apiFetch(`${API}?action=messages&commissionId=${encodeURIComponent(c.id)}`);
        const msgData = await msgRes.json();
        const msgs = (msgData.messages || []).slice(-2);
        if (!msgs.length) continue;

        const last = msgs[msgs.length - 1];
        const from = last.senderRole === 'artist' ? 'You' : c.clientName;
        const preview = (last.message || '').replace(/\s+/g, ' ').trim();
        items.push(`
          <div class="message-item">
            <span class="msg-dot"></span>
            <div>
              <strong>${from}</strong>
              <p>${preview}</p>
              <small>${c.title}</small>
            </div>
          </div>`);
      } catch {}
    }

    list.innerHTML = items.length ? items.join('') : '<p style="margin:12px 0 0;color:#8aa396;font-size:13px">No messages yet.</p>';
  } catch {
    list.innerHTML = '<p style="margin:12px 0 0;color:#8aa396;font-size:13px">Could not load messages.</p>';
  }
}

/* ── NOTIFICATIONS PANEL ─────────────────────────── */
async function showNotifications() {
  const bell = document.querySelector('#notification');
  const menu = document.querySelector('#notifications-menu');
  if (!menu || !bell) return;

  try {
    if (!loggedInArtist) {
      renderNotifications([]);
      toggleNotifications(true);
      notify('Sign in to see notifications');
      return;
    }

    const res  = await apiFetch(`${API}?action=notifications&userId=${encodeURIComponent(loggedInArtist.id)}`);
    const data = await res.json();
    const list = (data.notifications || []).map(item => ({
      id: item.id || null,
      commissionId: item.commissionId || item.commission_id || null,
      icon: item.kind === 'commission' ? '✦' : item.kind === 'message' ? '✉' : item.kind === 'delivery' ? '↗' : '★',
      tone: item.kind === 'commission' ? 'green' : item.kind === 'message' ? 'blue' : item.kind === 'delivery' ? 'gold' : 'green',
      title: item.title || 'New update',
      detail: item.text || 'There is a fresh update for you.',
      time: item.created_at ? new Date(item.created_at).toLocaleDateString([], { month: 'short', day: 'numeric' }) : 'Today',
    }));

    renderNotifications(list);
    toggleNotifications();

    if (list.length) {
      apiFetch(`${API}?action=mark_notifications_read`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: loggedInArtist.id }),
      });
      loadDashboardCounts();
    }
  } catch {
    renderNotifications([]);
    toggleNotifications(true);
    notify('Could not load notifications');
  }
}

/* ── MODAL ───────────────────────────────────────── */
function openWorkModal() {
  const modal = document.querySelector('#work-modal');
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
}
function closeWorkModal() {
  const modal = document.querySelector('#work-modal');
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
  document.querySelector('#work-error').textContent = '';
}

/* ── INIT ────────────────────────────────────────── */
ensureMobileMenu();
loadLoggedInArtist();
loadProfilePicture();
renderNotifications([]);
loadDashboardCounts();
loadMessagesPanel();
loadProfileViews();
loadEarnings();
fetchPortfolio().then(renderPortfolio);

/* ── EVENTS ──────────────────────────────────────── */
document.querySelector('#notification')?.addEventListener('click', (event) => {
  event.stopPropagation();
  showNotifications();
});
document.querySelector('#notifications-menu')?.addEventListener('click', (event) => {
  const button = event.target.closest('.notification-item');
  if (!button) return;
  const item = currentNotifications[Number(button.dataset.index)];
  if (!item) return;
  const targetId = item.commissionId || item.id;
  const nextUrl = targetId ? `commissions.html?commissionId=${encodeURIComponent(targetId)}` : 'commissions.html';
  window.location.href = nextUrl;
});
document.addEventListener('click', (event) => {
  const bell = document.querySelector('#notification');
  const menu = document.querySelector('#notifications-menu');
  if (!bell || !menu) return;
  if (!bell.contains(event.target) && !menu.contains(event.target)) toggleNotifications(false);
});
document.querySelector('#help')?.addEventListener('click', () => notify('Help center is opening soon'));
document.querySelector('#view-profile')?.addEventListener('click', () => {
  if (loggedInArtist?.id) window.location.href = `profile.html?id=${encodeURIComponent(loggedInArtist.id)}`;
});
document.querySelector('#logout')?.addEventListener('click', async () => {
  await logoutUser();
  localStorage.removeItem('vicom-session');
  window.location.href = '../LandingPage/index.html';
});
document.querySelector('#all-commissions')?.addEventListener('click', () => { window.location.href = 'commissions.html'; });
document.querySelector('#open-messages')?.addEventListener('click', () => { window.location.href = 'commissions.html'; });
document.querySelector('#add-work')?.addEventListener('click', openWorkModal);
document.querySelector('#close-work')?.addEventListener('click', closeWorkModal);
document.querySelector('#work-modal')?.addEventListener('click', e => { if (e.target.id === 'work-modal') closeWorkModal(); });
document.querySelector('.mobile-nav')?.addEventListener('click', () => toggleSidebar());
document.querySelector('.mobile-overlay')?.addEventListener('click', () => toggleSidebar(false));
document.querySelectorAll('.sidebar a').forEach(link => {
  link.addEventListener('click', () => toggleSidebar(false));
});
window.addEventListener('resize', () => {
  if (window.innerWidth > 700) toggleSidebar(false);
});

let publishInProgress = false;

document.querySelector('#work-form')?.addEventListener('submit', async event => {
  event.preventDefault();
  if (publishInProgress) return;

  const form       = event.target;
  const submitBtn  = form.querySelector('.modal-submit');
  const imageFile  = document.querySelector('#work-image').files[0];
  const error      = document.querySelector('#work-error');
  const title      = document.querySelector('#work-title').value.trim();

  if (!loggedInArtist) { error.textContent = 'Sign in as an artist before publishing artwork.'; return; }
  if (!title)          { error.textContent = 'Add a title for your artwork.'; return; }
  if (!imageFile)      { error.textContent = 'Choose an artwork image to publish.'; return; }

  publishInProgress = true;
  error.textContent = '';
  const originalLabel = submitBtn ? submitBtn.innerHTML : '';
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = 'Publishing…';
  }

  const resetSubmit = () => {
    publishInProgress = false;
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = originalLabel;
    }
  };

  try {
    if (!imageFile.type.startsWith('image/')) throw new Error('Choose a valid image file.');
    if (imageFile.size > 10 * 1024 * 1024) throw new Error('Choose an image smaller than 10 MB.');

    const extension = (imageFile.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '') || 'png';
    const filePath = `artworks/${loggedInArtist.id}-${Date.now()}.${extension}`;
    const { error: uploadError } = await supabase.storage.from('vicom-uploads').upload(filePath, imageFile, {
      contentType: imageFile.type,
    });
    if (uploadError) throw uploadError;

    const { data: publicData } = supabase.storage.from('vicom-uploads').getPublicUrl(filePath);
    if (!publicData?.publicUrl) throw new Error('Could not create a public link for this image.');

    const work = {
      id: `work_${Date.now()}`,
      artistId: loggedInArtist.id,
      artist:   loggedInArtist.name,
      title,
      detail:   document.querySelector('#work-detail').value.trim() || 'Original artwork',
      price:    0,
      category: document.querySelector('#work-category').value,
      image:    publicData.publicUrl,
      createdAt: new Date().toISOString(),
    };
    await savePortfolio(work);
    const portfolio = await fetchPortfolio();
    renderPortfolio(portfolio);
    closeWorkModal();
    form.reset();
    notify('Artwork published to Discover');
  } catch (err) {
    error.textContent = err.message;
  } finally {
    resetSubmit();
  }
});

// Help/Support Button
const helpButtonFloat = document.querySelector('#help-button-float');
const helpMenu = document.querySelector('#help-menu');
const helpClose = document.querySelector('#help-close');

helpButtonFloat?.addEventListener('click', () => {
  helpMenu.hidden = !helpMenu.hidden;
});

helpClose?.addEventListener('click', () => {
  helpMenu.hidden = true;
});

// Close help menu when clicking outside
document.addEventListener('click', (e) => {
  if (!helpMenu.contains(e.target) && !helpButtonFloat.contains(e.target)) {
    helpMenu.hidden = true;
  }
});

// Close help menu on escape key
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !helpMenu.hidden) {
    helpMenu.hidden = true;
  }
});
