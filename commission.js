import { apiFetch, listenForCommissionChanges, listenForMessages } from './supabase-api.js';
/**
 * commission.js — shared commission tracker backed by Supabase.
 * Works for both client (role='customer') and artist (role='artist').
 * Reads role from vicom-session in localStorage.
 *
 * Commission data, messages, and notifications are stored in Supabase.
 * localStorage is only used for the session (login token).
 */

'use strict';

/* ── CONSTANTS ──────────────────────────────────────── */
const SESSION_KEY = 'vicom-session';
const API_BASE    = '../supabase-data';

const STAGES = [
  { id: 'rough',  label: 'Rough Sketch',           icon: '✏️',  color: '#b8d4c8' },
  { id: 'clean',  label: 'Clean Sketch',            icon: '🖊️',  color: '#8abcaa' },
  { id: 'line',   label: 'Lineart',                 icon: '🖋️',  color: '#5da08a' },
  { id: 'color',  label: 'Coloring & Rendering',    icon: '🎨',  color: '#3f8061' },
  { id: 'final',  label: 'Final Review & Delivery', icon: '✔',  color: '#1d3027' },
];

/* ── SESSION ────────────────────────────────────────── */
function getSession() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY)); }
  catch { return null; }
}

function hasActiveSuspension(session) {
  if (!session?.isSuspended) return false;
  if (!session.suspensionUntil) return true;
  const expiry = new Date(session.suspensionUntil);
  return Number.isNaN(expiry.getTime()) || expiry.getTime() > Date.now();
}

/* ── API HELPER ─────────────────────────────────────── */
async function api(action, method = 'GET', body = null, query = {}) {
  const params = new URLSearchParams({ action, ...query });
  const opts   = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const res  = await apiFetch(`${API_BASE}?${params}`, opts);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || 'API error');
  return json;
}

/* ── HELPERS ────────────────────────────────────────── */
function initials(name) {
  return (name || '?').split(/\s+/).map(p => p[0]).join('').slice(0, 2).toUpperCase();
}
function fmt(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return isNaN(d) ? ts : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
let _toastTimer;
function showToast(msg) {
  const t = document.querySelector('#toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

/* ── COMMISSION REQUEST (from artist profile page) ─── */
async function startCommissionRequest(artistId, artistName) {
  const session = getSession();
  if (!session || session.role !== 'customer') {
    window.location.href = `auth.html?mode=signin&redirect=artist.html?id=${encodeURIComponent(artistId)}`;
    return;
  }
  if (hasActiveSuspension(session)) {
    showToast('Your account is suspended and cannot request commissions until the suspension is lifted.');
    return;
  }
  const title = prompt(`Commission "${artistName}" — describe your request (title):`, 'My Commission');
  if (!title) return;
  const description = prompt('Add more detail (optional):') || '';

  try {
    await api('create_commission', 'POST', {
      artistId,
      clientId: session.userId,
      title: title.trim(),
      description: description.trim(),
    });
    showToast('✔ Commission request sent!');
    setTimeout(() => { window.location.href = 'commissions.html'; }, 1200);
  } catch (err) {
    alert('Could not send request: ' + err.message);
  }
}

/* ══════════════════════════════════════════════════════
   CommissionTracker class
══════════════════════════════════════════════════════ */
export class CommissionTracker {
  constructor({ role }) {
    this.role         = role;
    this.session      = getSession();
    this.commissions  = [];
    this.active       = 0;
    this._feedbackIdx = 0;
    this._messageUnsubscribe = null;
    this._messageGeneration = 0;
    this._commissionUnsubscribe = null;
    this._commissionSubscriptionId = null;
    this._stateSyncing = false;
    this._refreshPending = false;
  }

  /* ── PUBLIC: mount ───────────────────────────────── */
  async mount() {
    if (!this.session) { window.location.href = '../LandingPage/index.html'; return; }

    try {
      const profileRes = await api('profile', 'GET', null, { id: this.session.userId });
      const profile = profileRes.user || {};
      const nextSession = {
        ...this.session,
        isSuspended: !!profile.isSuspended,
        suspensionUntil: profile.suspensionUntil || null,
        role: profile.role || this.session.role,
      };
      localStorage.setItem(SESSION_KEY, JSON.stringify(nextSession));
      this.session = nextSession;
    } catch (err) {
      console.warn('Could not refresh artist suspension state:', err.message);
    }

    await this._load();
    const targetId = new URLSearchParams(window.location.search).get('commissionId');
    if (targetId) {
      const matchIndex = this.commissions.findIndex((commission) => commission.id === targetId);
      if (matchIndex >= 0) this.active = matchIndex;
    }
    this._renderSidebar();
    if (this.commissions.length) this._renderMain();
    this._bindFeedbackModal();
    document.querySelector('#comm-main')?.addEventListener('focusout', () => {
      if (this._refreshPending) queueMicrotask(() => this._refreshState());
    });
  }

  /* ── LOAD commissions from DB ─────────────────────── */
  async _load() {
    try {
      const res = await api('commissions', 'GET', null, {
        userId: this.session.userId,
        role:   this.role,
      });
      this.commissions = res.commissions || [];
    } catch (err) {
      console.error('Failed to load commissions:', err);
      return false;
    }
    return true;
  }

  _hasActiveSuspension() {
    const session = this.session;
    if (!session?.isSuspended) return false;
    if (!session.suspensionUntil) return true;
    const expiry = new Date(session.suspensionUntil);
    return Number.isNaN(expiry.getTime()) || expiry.getTime() > Date.now();
  }

  _isEditing() {
    const activeElement = document.activeElement;
    const main = document.querySelector('#comm-main');
    return activeElement instanceof HTMLElement
      && main?.contains(activeElement)
      && activeElement.matches('input, textarea, select, [contenteditable="true"]');
  }

  async _refreshState() {
    if (this._stateSyncing || this._isEditing()) {
      this._refreshPending = true;
      return;
    }
    this._refreshPending = false;
    this._stateSyncing = true;
    const activeId = this.commissions[this.active]?.id;
    const previousCommissions = this.commissions;
    const previousState = JSON.stringify(this.commissions);
    try {
      if (!await this._load()) return;
      if (JSON.stringify(this.commissions) === previousState) return;
      if (this._isEditing()) {
        this.commissions = previousCommissions;
        return;
      }

      const nextActive = this.commissions.findIndex((commission) => commission.id === activeId);
      this.active = nextActive >= 0 ? nextActive : 0;
      this._renderSidebar();
      if (this.commissions.length) this._renderMain();
      else document.querySelector('#comm-main').innerHTML = '';
    } finally {
      this._stateSyncing = false;
      if (this._refreshPending && !this._isEditing()) {
        this._refreshPending = false;
        queueMicrotask(() => this._refreshState());
      }
    }
  }

  /* ── RENDER SIDEBAR ──────────────────────────────── */
  _renderSidebar() {
    const el = document.querySelector('#comm-sidebar');
    if (!el) return;

    const activeId = this.commissions[this.active]?.id;
    const matchingIndex = this.commissions.findIndex((commission) => commission.id === activeId);
    if (matchingIndex >= 0) this.active = matchingIndex;

    const pending = this.commissions.filter(c => c.status === 'pending');
    const active  = this.commissions.filter(c => c.status === 'active');
    const done    = this.commissions.filter(c => c.status === 'done');

    let html = '';

    if (pending.length) {
      html += `<p class="comm-section-label">PENDING</p>`;
      pending.forEach((c, i) => {
        const idx = this.commissions.indexOf(c);
        html += this._sidebarItem(c, idx);
      });
    }
    if (active.length) {
      html += `<p class="comm-section-label">ACTIVE</p>`;
      active.forEach(c => {
        html += this._sidebarItem(c, this.commissions.indexOf(c));
      });
    }
    if (done.length) {
      html += `<p class="comm-section-label">COMPLETED</p>`;
      done.forEach(c => {
        html += this._sidebarItem(c, this.commissions.indexOf(c));
      });
    }
    if (!html) {
      html = `<p class="comm-empty">No commissions yet.</p>`;
    }

    el.innerHTML = html;
    el.querySelectorAll('.comm-item').forEach(item => {
      item.addEventListener('click', () => {
        this.active = parseInt(item.dataset.idx);
        el.querySelectorAll('.comm-item').forEach(x => x.classList.remove('selected'));
        item.classList.add('selected');
        this._renderMain();
      });
    });

    // Select the current commission, or the first one on initial load.
    const selected = el.querySelector('.comm-item.selected') || el.querySelector('.comm-item');
    if (selected) {
      selected.classList.add('selected');
      this.active = parseInt(selected.dataset.idx);
    }
  }

  _sidebarItem(c, idx) {
    const name  = this.role === 'artist' ? c.clientName : c.artistName;
    const dot   = c.status === 'pending' ? ' dot-pending' : (c.status === 'active' ? ' dot-active' : '');
    return `<div class="comm-item${idx === this.active ? ' selected' : ''}" data-idx="${idx}">
      <span class="comm-avatar">${initials(name)}</span>
      <div class="comm-item-info">
        <strong>${c.title}</strong>
        <small>from ${name}</small>
      </div>
      ${c.status === 'pending' ? `<span class="status-badge pending">PENDING</span>` : `<span class="comm-dot${dot}"></span>`}
    </div>`;
  }

  /* ── RENDER MAIN PANEL ───────────────────────────── */
  _renderMain() {
    this._stopMessageSubscription();
    const el = document.querySelector('#comm-main');
    if (!el || !this.commissions.length) {
      this._stopCommissionSubscription();
      if (el) el.innerHTML = '';
      return;
    }

    const c = this.commissions[this.active];
    if (!c) return;
    this._startCommissionSubscription(c.id);

    const partner = this.role === 'artist' ? c.clientName : c.artistName;
    el.innerHTML = '';

    /* header */
    const header = document.createElement('div');
    header.className = 'comm-header';
    header.innerHTML = `
      <div class="comm-header-copy">
        <h2>${c.title}</h2>
        <p>With ${partner} · ${c.description || 'No description added'}</p>
        ${c.referenceImage ? `
          <div style="margin-top:12px;border:1px solid #dfe7e1;border-radius:12px;padding:10px;background:#f8faf7;">
            <strong style="display:block;margin-bottom:8px;color:#1f4138;">Reference image</strong>
            <img src="${c.referenceImage}" alt="Commission reference" style="max-width:100%;max-height:220px;object-fit:cover;border-radius:10px;border:1px solid #dfe7e1;display:block;">
          </div>` : ''}
      </div>
      <span class="status-pill status-${c.status}">
        <span class="status-dot" style="background:${c.status === 'active' ? '#3f8061' : c.status === 'pending' ? '#d8b86a' : '#8aa396'}"></span>
        ${this._statusLabel(c)}
      </span>`;
    el.appendChild(header);

    /* ── PENDING: accept/decline card ── */
    if (c.status === 'pending' && this.role === 'artist') {
      const card = document.createElement('div');
      card.className = 'new-request-card';

      if (this.session?.isSuspended) {
        card.classList.add('suspended-card');
        card.innerHTML = `
          <div class="request-icon">🚫</div>
          <h3>Account suspended</h3>
          <p>This artist account is suspended and cannot accept or decline commissions until the suspension is lifted.</p>`;
      } else {
        card.innerHTML = `
          <div class="request-icon">✉</div>
          <h3>New commission request</h3>
          <p>${c.clientName} has sent you a commission request.</p>
          ${c.description ? `<blockquote>${c.description}</blockquote>` : ''}
          ${c.referenceImage ? `
            <div style="margin-top:12px;border:1px solid #dfe7e1;border-radius:12px;padding:10px;background:#f8faf7;">
              <strong style="display:block;margin-bottom:8px;color:#1f4138;">Reference image</strong>
              <img src="${c.referenceImage}" alt="Commission reference" style="max-width:100%;max-height:240px;object-fit:cover;border-radius:10px;border:1px solid #dfe7e1;display:block;">
            </div>` : ''}
          <div class="request-actions">
            <button class="btn-approve accept-btn">Accept commission</button>
            <button class="btn-revise decline-btn">Decline</button>
          </div>`;
        card.querySelector('.accept-btn').addEventListener('click', () => this._acceptCommission(c));
        card.querySelector('.decline-btn').addEventListener('click', () => this._declineCommission(c));
      }

      el.appendChild(card);
      this._renderConversation(c);
      return;
    }

    if (c.status === 'pending' && this.role === 'customer') {
      const card = document.createElement('div');
      card.className = 'new-request-card';
      card.innerHTML = `<div class="request-icon">⏳</div>
        <h3>Waiting for artist</h3>
        <p>${c.artistName} has not yet accepted your request.</p>`;
      el.appendChild(card);
      this._renderConversation(c);
      return;
    }

    if (c.status === 'declined') {
      const card = document.createElement('div');
      card.className = 'new-request-card';
      card.innerHTML = `<div class="request-icon">✉️</div>
        <h3>Request declined</h3>
        <p>${c.artistName} was unable to take this commission.</p>`;
      el.appendChild(card);
      this._renderConversation(c);
      return;
    }

    /* ── ACTIVE: stage tracker ── */
    const stageData     = c.stageData || Array(5).fill({ uploads: [], note: null, comments: [] });
    const stageStatus   = c.stageStatus   || [false,false,false,false,false];
    const clientApproval= c.clientApproval|| [false,false,false,false,false];
    const currentStage  = c.currentStage  || 0;

    const completedStages = clientApproval.filter(Boolean).length;
    const progress = document.createElement('div');
    progress.className = 'commission-progress';
    progress.setAttribute('aria-label', `${completedStages} of ${STAGES.length} stages complete`);
    progress.innerHTML = `
      <div class="commission-progress-copy">
        <strong>${c.status === 'done' ? 'Commission complete' : `Step ${Math.min(currentStage + 1, STAGES.length)} of ${STAGES.length}`}</strong>
        <span>${c.status === 'done' ? 'All stages approved' : STAGES[currentStage]?.label || 'In progress'}</span>
      </div>
      <div class="commission-progress-track" role="progressbar" aria-valuemin="0" aria-valuemax="${STAGES.length}" aria-valuenow="${completedStages}">
        <span style="width:${Math.round((completedStages / STAGES.length) * 100)}%"></span>
      </div>`;
    el.appendChild(progress);

    /* stage list */
    const list = document.createElement('div');
    list.className = 'stage-list';

    STAGES.forEach((stage, i) => {
      const isCurrent  = i === currentStage && c.status === 'active';
      const isCompleted= clientApproval[i];
      const isFuture   = !isCurrent && !isCompleted;
      const stageD     = stageData[i] || { uploads: [], note: null, comments: [] };
      const markedReady= stageStatus[i];
      const approved   = clientApproval[i];
      const hasUploads = (stageD.uploads || []).length > 0;

      const card = document.createElement('details');
      card.className = `stage-card${isCurrent ? ' current' : isCompleted ? ' completed' : ' future'}`;
      card.open = isCurrent || (this.role === 'customer' && markedReady);
      const hdr = document.createElement('summary');
      hdr.className = 'stage-header';
      hdr.innerHTML = `<span class="stage-icon">${stage.icon}</span>
        <strong>${stage.label}</strong>
        ${approved ? '<span class="stage-badge approved">✓ Approved</span>' :
          markedReady ? '<span class="stage-badge ready">Ready for review</span>' :
          isCurrent ? '<span class="stage-badge in-progress">In Progress</span>' :
          isFuture ? '<span class="stage-badge future">Upcoming</span>' : ''}`;
      card.appendChild(hdr);

      if (isFuture && !hasUploads) { list.appendChild(card); return; }

      const body = document.createElement('div');
      body.className = 'stage-body';

      /* uploads */
      const canEditUploads = this.role === 'artist' && isCurrent && !approved;
      if (hasUploads) {
        const gallery = document.createElement('div');
        gallery.className = 'upload-gallery';
        (stageD.uploads || []).forEach((u, uIdx) => {
          const thumb = document.createElement('div');
          thumb.className = 'upload-thumb';
          const image = document.createElement('img');
          image.src = u.src;
          image.alt = u.name || 'Artwork';
          image.loading = 'lazy';
          const meta = document.createElement('small');
          meta.textContent = `${u.name} · ${fmt(u.uploaded)}`;
          thumb.append(image, meta);
          if (canEditUploads) {
            const remove = document.createElement('button');
            remove.type = 'button';
            remove.className = 'upload-remove';
            remove.title = 'Remove this file';
            remove.textContent = '✕';
            remove.addEventListener('click', () =>
              this._removeUpload(c, i, uIdx, stageData, stageD));
            thumb.appendChild(remove);
          }
          if (this.role === 'customer' && i === STAGES.length - 1) {
            const download = document.createElement('a');
            download.className = 'upload-download';
            download.href = u.src;
            download.download = u.name || 'artwork';
            download.textContent = '⬇ Download HD';
            thumb.appendChild(download);
          }
          gallery.appendChild(thumb);
        });
        body.appendChild(gallery);
      }
      if (approved && hasUploads) {
        const lockNote = document.createElement('p');
        lockNote.className = 'upload-locked-note';
        lockNote.innerHTML = '🔒 The client approved this stage — the submitted file(s) are now locked and can\'t be changed.';
        body.appendChild(lockNote);
      }

      /* artist note */
      if (stageD.note) {
        const noteEl = document.createElement('div');
        noteEl.className = 'artist-note';
        noteEl.innerHTML = `<strong>Artist note</strong><p>${stageD.note}</p>`;
        body.appendChild(noteEl);
      }

      /* ARTIST actions — only while this stage hasn't been client-approved yet */
      if (this.role === 'artist' && isCurrent && !approved) {
        const actionRow = document.createElement('div');
        actionRow.className = 'action-row';

        const uploadLabel = document.createElement('label');
        uploadLabel.className = 'btn-primary';
        uploadLabel.innerHTML = `📎 ${hasUploads ? 'Replace / add file' : 'Upload artwork'}`;
        const fileInput = document.createElement('input');
        fileInput.type = 'file'; fileInput.accept = 'image/*'; fileInput.style.display = 'none';
        fileInput.addEventListener('change', e => this._handleUpload(e, c, i, stageD, stageData, stageStatus, clientApproval));
        uploadLabel.appendChild(fileInput);
        actionRow.appendChild(uploadLabel);

        const noteBtn = document.createElement('button');
        noteBtn.className = 'btn-secondary';
        noteBtn.textContent = stageD.note ? 'Edit note' : '+ Add note';
        noteBtn.addEventListener('click', () =>
          this._toggleNoteForm(body, i, c, stageD.note || '', stageData, stageStatus, clientApproval));
        actionRow.appendChild(noteBtn);

        if (hasUploads && !markedReady) {
          const readyBtn = document.createElement('button');
          readyBtn.className = 'btn-approve';
          readyBtn.innerHTML = 'Submit for review ↗';
          readyBtn.addEventListener('click', () =>
            this._markStageReady(c, i, stageData, stageStatus, clientApproval));
          actionRow.appendChild(readyBtn);
        } else if (markedReady) {
          const wait = document.createElement('span');
          wait.className = 'waiting-label';
          wait.textContent = '⏳ Waiting for client approval… you can still swap the file until they confirm.';
          actionRow.appendChild(wait);
        }
        body.appendChild(actionRow);
      } else if (this.role === 'artist' && isCompleted) {
        const locked = document.createElement('p');
        locked.className = 'stage-locked-msg';
        locked.textContent = '🔒 Approved and locked.';
        body.appendChild(locked);
      }

      card.appendChild(body);

      /* CLIENT review bar */
      if (this.role === 'customer' && hasUploads) {
        const bar = document.createElement('div');
        bar.className = 'review-bar';
        if (approved) {
          bar.innerHTML = '<p class="approved">✓ You approved this stage.</p>';
        } else if (markedReady) {
          bar.innerHTML = `<p>The artist marked this stage ready for your review.</p>
            <button class="btn-revise">Request revision</button>
            <button class="btn-approve">Approve →</button>`;
          bar.querySelector('.btn-approve').addEventListener('click', () =>
            this._approveStage(c, i, stageData, stageStatus, clientApproval, currentStage));
          bar.querySelector('.btn-revise').addEventListener('click', () => {
            this._feedbackIdx = i;
            this._feedbackCommission = c;
            this._feedbackStageData  = stageData;
            this._feedbackStageStatus= stageStatus;
            this._feedbackClientApproval = clientApproval;
            const feedbackOverlay = document.querySelector('#feedback-overlay');
            const feedbackText = document.querySelector('#feedback-text');
            if (feedbackText) feedbackText.value = '';
            feedbackOverlay?.classList.add('open');
            feedbackOverlay?.setAttribute('aria-hidden', 'false');
          });
        } else {
          bar.innerHTML = `<p>Work in progress — you'll be able to approve once the artist submits.</p>`;
        }
        card.appendChild(bar);
      }

      list.appendChild(card);
    });

    el.appendChild(list);
    this._renderConversation(c);
  }

  _renderConversation(c) {
    const el = document.querySelector('#comm-main');
    if (!el) return;

    const panel = document.createElement('section');
    panel.className = 'commission-chat';
    panel.setAttribute('aria-label', 'Commission conversation');

    const suspended = this._hasActiveSuspension();

    // Payment section HTML based on status
    const paymentSection = this._renderPaymentSection(c);

    const chatForm = suspended
      ? `<p class="chat-suspended-note">Your account is suspended. You can still view this conversation, but you cannot send messages until the suspension is lifted.</p>`
      : `<form class="commission-chat-form">
        <textarea class="stage-msg-input" aria-label="Write a message" placeholder="Write a message…" rows="2" required></textarea>
        <button class="btn-primary send-msg" type="submit">Send</button>
      </form>`;

    panel.innerHTML = `
      <div class="commission-chat-heading">
        <div>
          <h3>Messages</h3>
          <p class="chat-partner"></p>
        </div>
      </div>
      ${paymentSection}
      <div class="chat-feed" aria-live="polite">
        <p class="no-msgs">Loading messages…</p>
      </div>
      ${chatForm}
      <button class="report-chat-btn" id="report-commission-btn">⚑ Report conversation</button>
    `;

    panel.querySelector('.chat-partner').textContent =
      `Chat with ${this.role === 'artist' ? c.clientName : c.artistName} about this commission.`;
    const form = panel.querySelector('.commission-chat-form');
    form?.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (this._hasActiveSuspension()) {
        showToast('Your account is suspended and cannot send messages.');
        return;
      }
      const input = form.querySelector('textarea');
      const message = input.value.trim();
      const sendButton = form.querySelector('.send-msg');
      if (!message) {
        input.focus();
        showToast('Write a message first');
        return;
      }

      sendButton.disabled = true;
      try {
        await api('send_message', 'POST', {
          commissionId: c.id,
          senderId:     this.session.userId,
          senderName:   this.session.name || this.session.email,
          senderRole:   this.role,
          message,
        });
        input.value = '';
        showToast('Message sent');
      } catch (err) {
        showToast('Error: ' + err.message);
      } finally {
        sendButton.disabled = false;
      }
    });

    el.appendChild(panel);
    
    // Bind payment section events
    this._bindPaymentEvents(c, panel);
    this._renderPaymentProofs(c, panel);
    
    this._startMessageSubscription(c.id);

    // Report conversation button
    panel.querySelector('#report-commission-btn').addEventListener('click', () => {
      this._showReportConversationModal(c);
    });
  }

  _showReportConversationModal(c) {
    const modal = document.createElement('div');
    modal.className = 'report-modal-overlay open';
    modal.innerHTML = `
      <div class="report-modal">
        <button class="report-modal-close">×</button>
        <h3>Report Conversation</h3>
        <p>Report inappropriate behavior in this conversation</p>
        <select class="report-reason">
          <option value="">Select reason…</option>
          <option value="Harassment">Harassment</option>
          <option value="Threats">Threats</option>
          <option value="Spam">Spam</option>
          <option value="Scam">Scam</option>
          <option value="Inappropriate content">Inappropriate content</option>
          <option value="Other">Other</option>
        </select>
        <textarea class="report-details" placeholder="Describe the issue…"></textarea>
        <div class="report-actions">
          <button class="btn-primary report-submit">Submit Report</button>
          <button class="btn-secondary report-cancel">Cancel</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    modal.querySelector('.report-modal-close').addEventListener('click', () => modal.remove());
    modal.querySelector('.report-cancel').addEventListener('click', () => modal.remove());
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });

    modal.querySelector('.report-submit').addEventListener('click', async () => {
      const reason = modal.querySelector('.report-reason').value;
      const details = modal.querySelector('.report-details').value.trim();
      if (!reason) { showToast('Please select a reason'); return; }
      if (!details) { showToast('Please provide details'); return; }

      const partnerId = this.role === 'artist' ? c.clientId : c.artistId;
      try {
        const res = await api('create_report', 'POST', {
          reportedId: partnerId,
          type: 'message',
          reason: `${reason}: ${details}`,
          commissionId: c.id,
        });
        showToast('Report submitted successfully');
        modal.remove();
      } catch (err) { showToast('Error: ' + err.message); }
    });
  }

  /* ── PAYMENT SECTION ─────────────────────────────── */
  _renderPaymentSection(c) {
    if (c.status === 'pending' || c.status === 'declined') return '';
    
    const agreedPrice = c.agreedPrice || 0;
    const paymentStatus = c.paymentStatus || 'unpaid';
    const halfPayment = agreedPrice / 2;
    
    // For active commissions
    if (c.status === 'active') {
      // Client view
      if (this.role === 'customer') {
        if (paymentStatus === 'unpaid') {
          return `
            <div class="payment-card pending">
              <div class="payment-header">
                <span class="payment-icon">💰</span>
                <h4>Payment Required</h4>
              </div>
              <p>Half payment (₱${halfPayment.toLocaleString()}) is required to start the commission.</p>
              ${agreedPrice > 0 ? `
                <div class="payment-details">
                  <p><strong>Total Commission Price:</strong> ₱${agreedPrice.toLocaleString()}</p>
                  <p><strong>Half Payment (Now):</strong> ₱${halfPayment.toLocaleString()}</p>
                  <p><strong>Remaining Payment:</strong> ₱${halfPayment.toLocaleString()}</p>
                </div>
                <button class="btn-primary" id="pay-half-btn">Pay Half (₱${halfPayment.toLocaleString()})</button>
              ` : `
                <p class="payment-note">Waiting for the artist to set the commission price.</p>
              `}
            </div>`;
        } else if (paymentStatus === 'half_paid') {
          return `
            <div class="payment-card success">
              <div class="payment-header">
                <span class="payment-icon">✔</span>
                <h4>Half Payment Completed</h4>
              </div>
              <p>You have paid ₱${halfPayment.toLocaleString()}. The remaining ₱${halfPayment.toLocaleString()} will be due upon completion.</p>
            </div>`;
        }
      } 
      // Artist view
      else {
        if (paymentStatus === 'unpaid') {
          return `
            <div class="payment-card waiting">
              <div class="payment-header">
                <span class="payment-icon">⏳</span>
                <h4>Awaiting Payment</h4>
              </div>
              <p>Waiting for client to pay half payment (₱${halfPayment.toLocaleString()}).</p>
              ${agreedPrice === 0 ? `
                <p class="payment-note">Set a commission price to enable payment.</p>
                <div style="display:flex;gap:8px;align-items:center;margin-top:8px;">
                  <input type="number" id="price-input" placeholder="Enter price (₱)" min="100" style="flex:1;padding:8px;border:1px solid #dfe7e1;border-radius:8px;">
                  <button class="btn-primary" id="set-price-btn">Set Price</button>
                </div>
              ` : ''}
            </div>`;
        } else if (paymentStatus === 'half_paid') {
          return `
            <div class="payment-card success">
              <div class="payment-header">
                <span class="payment-icon">✔</span>
                <h4>Half Payment Received</h4>
              </div>
              <p>Client has paid ₱${halfPayment.toLocaleString()}. Remaining ₱${halfPayment.toLocaleString()} due upon completion.</p>
            </div>`;
        }
      }
    }
    
    // For completed commissions
    if (c.status === 'done') {
      // Client view
      if (this.role === 'customer') {
        if (paymentStatus === 'half_paid') {
          return `
            <div class="payment-card pending">
              <div class="payment-header">
                <span class="payment-icon"></span>
                <h4>Final Payment Required</h4>
              </div>
              <p>The commission is complete. Please pay the remaining ₱${halfPayment.toLocaleString()} to finalize.</p>
              <button class="btn-primary" id="pay-final-btn">Pay Final Amount (₱${halfPayment.toLocaleString()})</button>
            </div>`;
        } else if (paymentStatus === 'fully_paid') {
          return `
            <div class="payment-card success">
              <div class="payment-header">
                <span class="payment-icon">✓</span>
                <h4>Payment Complete</h4>
              </div>
              <p>All payments completed. Total paid: ₱${agreedPrice.toLocaleString()}</p>
              ${this._renderDownloadSection(c)}
            </div>`;
        }
      }
      // Artist view
      else {
        if (paymentStatus === 'half_paid') {
          return `
            <div class="payment-card waiting">
              <div class="payment-header">
                <span class="payment-icon"></span>
                <h4>Awaiting Final Payment</h4>
              </div>
              <p>Waiting for client to pay the remaining ₱${halfPayment.toLocaleString()}.</p>
            </div>`;
        } else if (paymentStatus === 'fully_paid') {
          return `
            <div class="payment-card success">
              <div class="payment-header">
                <span class="payment-icon"></span>
                <h4>Payment Complete</h4>
              </div>
              <p>All payments received. Total earned: ₱${agreedPrice.toLocaleString()}</p>
            </div>`;
        }
      }
    }
    
    return '';
  }

  _renderDownloadSection(c) {
    const uploads = c.stageData?.[STAGES.length - 1]?.uploads || [];
    if (!uploads.length) return '';

    const escape = (value) => String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
    const links = uploads.map((u) => {
      const name = escape(u.name || 'artwork');
      return `<a class="btn-primary download-button" href="${u.src}" download="${name}">⬇ Download ${name} (HD)</a>`;
    }).join('');

    return `
      <div class="download-section">
        <h4>Your final artwork</h4>
        <p>Your commission is paid in full. Download your artwork in HD.</p>
        <div class="download-links">${links}</div>
      </div>`;
  }

  async _renderPaymentProofs(c, panel) {
    const card = panel.querySelector('.payment-card');
    if (!card) return;
    try {
      const res = await api('get_payments', 'GET', null, { commissionId: c.id });
      const payments = res.payments || [];
      if (!payments.length) return;

      const wrap = document.createElement('div');
      wrap.className = 'payment-proofs';
      wrap.innerHTML = `<h4>Payment proof</h4>` + payments.map((p) => `
        <figure class="payment-proof-item">
          ${p.proofImage
            ? `<img src="${p.proofImage}" alt="Proof of payment" loading="lazy">`
            : '<p class="payment-note">No proof image uploaded.</p>'}
          <figcaption>
            ₱${Number(p.amount || 0).toLocaleString()} ·
            ${p.paymentType === 'half_payment' ? 'Half payment' : 'Final payment'}
            ${p.createdAt ? `· ${fmt(p.createdAt)}` : ''}
          </figcaption>
        </figure>`).join('');
      card.appendChild(wrap);
    } catch (err) {
      console.warn('Could not load payment proofs:', err.message);
    }
  }

  _bindPaymentEvents(c, panel) {
    // Set price button
    const setPriceBtn = panel.querySelector('#set-price-btn');
    if (setPriceBtn) {
      setPriceBtn.addEventListener('click', async () => {
        const priceInput = panel.querySelector('#price-input');
        const price = Number(priceInput.value);
        
        if (!Number.isFinite(price) || price < 100) {
          showToast('Please enter a valid price (minimum ₱100)');
          return;
        }
        
        const confirmed = confirm(`Set commission price to ₱${price.toLocaleString()}?`);
        if (!confirmed) return;
        
        setPriceBtn.disabled = true;
        try {
          await api('set_commission_price', 'POST', {
            commissionId: c.id,
            price: price
          });
          showToast('✓ Price set successfully');
          await this._load();
          this._renderMain();
        } catch (err) {
          showToast('Error: ' + err.message);
          setPriceBtn.disabled = false;
        }
      });
    }

    // Pay half button
    const payHalfBtn = panel.querySelector('#pay-half-btn');
    if (payHalfBtn) {
      payHalfBtn.addEventListener('click', () => {
        this._showPaymentModal(c, 'half');
      });
    }

    // Pay final button
    const payFinalBtn = panel.querySelector('#pay-final-btn');
    if (payFinalBtn) {
      payFinalBtn.addEventListener('click', () => {
        this._showPaymentModal(c, 'final');
      });
    }
  }

  async _showPaymentModal(c, paymentType) {
    const halfPayment = (c.agreedPrice || 0) / 2;
    const amount = halfPayment;
    const paymentLabel = paymentType === 'half' ? 'Half Payment' : 'Final Payment';
    
    // Get artist GCash details
    try {
      const artistData = await api('artist', 'GET', null, { id: c.artistId });
      const artist = artistData.artist;
      
      const modal = document.createElement('div');
      modal.className = 'payment-modal-overlay open';
      modal.innerHTML = `
        <div class="payment-modal">
          <button class="payment-modal-close">×</button>
          <h3> ${paymentLabel}</h3>
          <div class="payment-amount">
            <p>Amount to Pay</p>
            <h2>₱${amount.toLocaleString()}</h2>
          </div>
          
          <div class="gcash-details">
            <h4>Send payment to:</h4>
            ${artist.gcashNumber ? `
              <p><strong>GCash Number:</strong> ${artist.gcashNumber}</p>
              <p><strong>Account Name:</strong> ${artist.gcashName || 'Not provided'}</p>
            ` : `
              <p class="payment-note">Artist has not set up GCash details yet. Please coordinate with them directly.</p>
            `}
          </div>
          
          <div class="payment-proof">
            <label for="proof-upload">Upload proof of payment (screenshot)</label>
            <input type="file" id="proof-upload" accept="image/*" style="margin-top:8px;">
            <img id="proof-preview" alt="Proof preview" hidden style="max-width:100%;max-height:200px;object-fit:contain;border-radius:10px;border:1px solid #dfe7e1;margin-top:8px;display:block;">
            <small style="display:block;margin-top:4px;color:#666;">Required: Upload a screenshot of your GCash transaction</small>
          </div>
          
          <div class="payment-actions">
            <button class="btn-primary payment-submit" disabled>Submit Payment</button>
            <button class="btn-secondary payment-cancel">Cancel</button>
          </div>
          <p class="payment-error" style="color:#c84a3f;margin-top:8px;display:none;"></p>
        </div>
      `;
      document.body.appendChild(modal);

      const proofInput = modal.querySelector('#proof-upload');
      const proofPreview = modal.querySelector('#proof-preview');
      const submitBtn = modal.querySelector('.payment-submit');
      let proofImageData = null;

      proofInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) {
          submitBtn.disabled = true;
          if (proofPreview) { proofPreview.src = ''; proofPreview.hidden = true; }
          return;
        }
        
        if (!file.type.startsWith('image/')) {
          showToast('Please upload an image file');
          proofInput.value = '';
          submitBtn.disabled = true;
          return;
        }
        
        if (file.size > 5 * 1024 * 1024) {
          showToast('Image must be smaller than 5 MB');
          proofInput.value = '';
          submitBtn.disabled = true;
          return;
        }

        const reader = new FileReader();
        reader.onload = () => {
          proofImageData = reader.result;
          submitBtn.disabled = false;
          if (proofPreview) {
            proofPreview.src = String(reader.result);
            proofPreview.hidden = false;
          }
        };
        reader.readAsDataURL(file);
      });

      modal.querySelector('.payment-modal-close').addEventListener('click', () => modal.remove());
      modal.querySelector('.payment-cancel').addEventListener('click', () => modal.remove());
      modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });

      submitBtn.addEventListener('click', async () => {
        if (!proofImageData) {
          showToast('Please upload proof of payment');
          return;
        }

        submitBtn.disabled = true;
        const errorEl = modal.querySelector('.payment-error');
        errorEl.style.display = 'none';

        try {
          await api('submit_payment', 'POST', {
            commissionId: c.id,
            paymentType: paymentType === 'half' ? 'half_payment' : 'final_payment',
            amount: amount,
            proofImage: proofImageData,
            gcashNumber: artist.gcashNumber || '',
            gcashName: artist.gcashName || ''
          });
          
          showToast('✔ Payment submitted successfully');
          modal.remove();
          await this._load();
          this._renderMain();
        } catch (err) {
          errorEl.textContent = err.message;
          errorEl.style.display = 'block';
          submitBtn.disabled = false;
        }
      });
    } catch (err) {
      showToast('Error loading payment details: ' + err.message);
    }
  }

  /* ── LIVE MESSAGES ───────────────────────────────── */
  _stopCommissionSubscription() {
    this._commissionUnsubscribe?.();
    this._commissionUnsubscribe = null;
    this._commissionSubscriptionId = null;
  }

  _startCommissionSubscription(commissionId) {
    if (this._commissionSubscriptionId === commissionId) return;
    this._stopCommissionSubscription();
    this._commissionSubscriptionId = commissionId;
    this._commissionUnsubscribe = listenForCommissionChanges(commissionId, () => this._refreshState(), (error) => {
      console.error('Could not listen for commission updates:', error);
    });
  }

  _stopMessageSubscription() {
    this._messageGeneration += 1;
    this._messageUnsubscribe?.();
    this._messageUnsubscribe = null;
  }

  _startMessageSubscription(commissionId) {
    const generation = this._messageGeneration;
    listenForMessages(commissionId, (messages) => {
      if (generation !== this._messageGeneration) return;
      const feed = document.querySelector('#comm-main .chat-feed');
      if (!feed) return;
      feed.replaceChildren();

      if (!messages.length) {
        const empty = document.createElement('p');
        empty.className = 'no-msgs';
        empty.textContent = 'No messages yet. Send a note to get started.';
        feed.appendChild(empty);
        return;
      }

      messages.forEach((message) => {
        const item = document.createElement('article');
        item.className = `chat-msg ${message.senderId === this.session.userId ? 'mine' : 'theirs'}`;
        const sender = document.createElement('strong');
        sender.textContent = message.senderName || (message.senderRole === 'artist' ? 'Artist' : 'Client');
        const text = document.createElement('p');
        text.textContent = message.message;
        const timestamp = document.createElement('small');
        timestamp.textContent = fmt(message.createdAt);
        item.append(sender, text, timestamp);
        feed.appendChild(item);
      });
      feed.scrollTop = feed.scrollHeight;
    }, (error) => {
      console.error('Could not listen for commission messages:', error);
      this._showMessageError(generation);
    })
      .then((unsubscribe) => {
        if (generation !== this._messageGeneration) unsubscribe();
        else this._messageUnsubscribe = unsubscribe;
      })
      .catch((error) => {
        console.error('Could not start commission message listener:', error);
        this._showMessageError(generation);
      });
  }

  _showMessageError(generation) {
    if (generation !== this._messageGeneration) return;
    const feed = document.querySelector('#comm-main .chat-feed');
    if (!feed) return;
    const errorMessage = document.createElement('p');
    errorMessage.className = 'no-msgs';
    errorMessage.textContent = 'Could not load messages. Please refresh and try again.';
    feed.replaceChildren(errorMessage);
  }

  /* ── ACCEPT / DECLINE ────────────────────────────── */
  async _acceptCommission(c) {
    if (this.session?.isSuspended) {
      showToast('This account is suspended and cannot accept commissions.');
      return;
    }
    try {
      await api('update_commission_status', 'POST', { id: c.id, status: 'active' });
      showToast('✔ Commission accepted!');
      await this._load();
      this._renderSidebar();
      this._renderMain();
    } catch (err) { showToast('Error: ' + err.message); }
  }

  async _declineCommission(c) {
    if (this.session?.isSuspended) {
      showToast('This account is suspended and cannot decline commissions.');
      return;
    }
    if (!confirm('Decline this commission request?')) return;
    try {
      await api('update_commission_status', 'POST', { id: c.id, status: 'declined' });
      showToast('Commission declined.');
      await this._load();
      this.active = 0;
      this._renderSidebar();
      this._renderMain();
    } catch (err) { showToast('Error: ' + err.message); }
  }

  /* ── UPLOAD ──────────────────────────────────────── */
  _handleUpload(event, c, stageIdx, stageD, stageData, stageStatus, clientApproval) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const uploads = [...(stageD.uploads || []), {
        name: file.name.replace(/\.[^.]+$/, ''),
        src: reader.result,
        uploaded: new Date().toISOString().slice(0, 10),
      }];
      const newStageData = [...stageData];
      newStageData[stageIdx] = { ...stageD, uploads };
      try {
        await api('update_commission_stage', 'POST', { id: c.id, stageData: newStageData });
        showToast('📎 File uploaded');
        await this._load();
        this._renderSidebar();
        this._renderMain();
      } catch (err) { showToast('Upload failed: ' + err.message); }
    };
    reader.readAsDataURL(file);
  }

  /* ── REMOVE UPLOAD (only allowed before client approval) ─── */
  async _removeUpload(c, stageIdx, uploadIdx, stageData, stageD) {
    if (!confirm('Remove this file? The client will no longer see it.')) return;
    const uploads = (stageD.uploads || []).filter((_, i) => i !== uploadIdx);
    const newStageData = [...stageData];
    newStageData[stageIdx] = { ...stageD, uploads };
    try {
      await api('update_commission_stage', 'POST', { id: c.id, stageData: newStageData });
      showToast('🗑️ File removed');
      await this._load();
      this._renderSidebar();
      this._renderMain();
    } catch (err) { showToast('Error: ' + err.message); }
  }

  /* ── NOTE FORM ───────────────────────────────────── */
  _toggleNoteForm(body, stageIdx, c, existing, stageData, stageStatus, clientApproval) {
    const existingForm = body.querySelector('.note-form');
    if (existingForm) { existingForm.remove(); return; }
    const form = document.createElement('div');
    form.className = 'note-form';
    form.innerHTML = `<textarea placeholder="Write a note for your client…">${existing}</textarea>
      <div style="display:flex;gap:8px">
        <button class="btn-primary save-note">Save note</button>
        <button class="btn-secondary cancel-note">Cancel</button>
      </div>`;
    form.querySelector('.cancel-note').addEventListener('click', () => form.remove());
    form.querySelector('.save-note').addEventListener('click', async () => {
      const txt = form.querySelector('textarea').value.trim();
      if (!txt) { showToast('Write something first'); return; }
      const newStageData = [...stageData];
      newStageData[stageIdx] = { ...stageData[stageIdx], note: txt };
      try {
        await api('update_commission_stage', 'POST', { id: c.id, stageData: newStageData });
        showToast('📝 Note saved');
        await this._load();
        this._renderMain();
      } catch (err) { showToast('Error: ' + err.message); }
    });
    const actionRow = body.querySelector('.action-row');
    actionRow ? body.insertBefore(form, actionRow) : body.appendChild(form);
  }

  /* ── MARK STAGE READY ────────────────────────────── */
  async _markStageReady(c, stageIdx, stageData, stageStatus, clientApproval) {
    const newStatus = [...stageStatus];
    newStatus[stageIdx] = true;
    try {
      await api('update_commission_stage', 'POST', {
        id: c.id,
        stageStatus: newStatus,
        notify: {
          userId: c.clientId,
          type: 'stage_submitted',
          text: `${c.artistName} submitted stage "${STAGES[stageIdx].label}" for your review on "${c.title}"`
        }
      });
      showToast('✔ Stage submitted — waiting for client approval');
      await this._load();
      this._renderSidebar();
      this._renderMain();
    } catch (err) { showToast('Error: ' + err.message); }
  }

  /* ── APPROVE STAGE ───────────────────────────────── */
  async _approveStage(c, stageIdx, stageData, stageStatus, clientApproval, currentStage) {
    const newApproval = [...clientApproval];
    newApproval[stageIdx] = true;
    let newStage = currentStage;
    if (stageIdx >= currentStage && currentStage < STAGES.length - 1) newStage = stageIdx + 1;
    const allDone = newApproval.every(Boolean);
    try {
      await api('update_commission_stage', 'POST', {
        id: c.id,
        clientApproval: newApproval,
        currentStage:   newStage,
        status:         allDone ? 'done' : undefined,
        notify: {
          userId: c.artistId,
          type: 'stage_approved',
          text: `${c.clientName} approved stage "${STAGES[stageIdx].label}" on "${c.title}"`
        }
      });
      showToast('✔ Stage approved! Moving to next step.');
      await this._load();
      this._renderSidebar();
      this._renderMain();
    } catch (err) { showToast('Error: ' + err.message); }
  }

  /* ── FEEDBACK MODAL ──────────────────────────────── */
  _bindFeedbackModal() {
    const overlay = document.querySelector('#feedback-overlay');
    if (!overlay) return;
    const close = () => {
      overlay.classList.remove('open');
      overlay.setAttribute('aria-hidden', 'true');
      const text = overlay.querySelector('#feedback-text');
      if (text) text.value = '';
    };
    overlay.querySelector('#feedback-close')?.addEventListener('click', close);
    overlay.querySelector('#feedback-cancel')?.addEventListener('click', close);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
    overlay.querySelector('#feedback-send')?.addEventListener('click', async () => {
      if (this._hasActiveSuspension()) {
        showToast('Your account is suspended and cannot send messages.');
        return;
      }
      const text = overlay.querySelector('#feedback-text')?.value.trim();
      if (!text) { showToast('Please write your feedback first'); return; }
      const c   = this._feedbackCommission;
      const idx = this._feedbackIdx;
      const sd  = this._feedbackStageData;
      const ss  = this._feedbackStageStatus;

      // Send as a message
      try {
        await api('send_message', 'POST', {
          commissionId: c.id,
          senderId:     this.session.userId,
          senderName:   this.session.name || this.session.email,
          senderRole:   this.role,
          message:      `[Revision request for ${STAGES[idx].label}]: ${text}`,
        });
        // un-mark ready
        const newSS = [...(ss || [false,false,false,false,false])];
        newSS[idx] = false;
        await api('update_commission_stage', 'POST', {
          id: c.id,
          stageStatus: newSS,
          notify: {
            userId: c.artistId,
            type: 'revision_requested',
            text: `${c.clientName} requested a revision on "${STAGES[idx].label}" for "${c.title}"`
          }
        });
        close();
        showToast('💬 Revision request sent to artist');
        await this._load();
        this._renderSidebar();
        this._renderMain();
      } catch (err) { showToast('Error: ' + err.message); }
    });
  }

  /* ── STATUS LABEL ────────────────────────────────── */
  _statusLabel(c) {
    if (c.status === 'pending')  return 'Pending artist acceptance';
    if (c.status === 'declined') return 'Declined';
    if (c.status === 'done')     return '✓ Completed';
    const stageName = STAGES[c.currentStage]?.label || '';
    return `In progress · ${stageName}`;
  }
}

window.CommissionTracker = CommissionTracker;
window.startCommissionRequest = startCommissionRequest;
