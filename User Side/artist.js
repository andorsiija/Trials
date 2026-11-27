import { apiFetch } from '../supabase-api.js';
import { artworkImageAttrs, hydrateArtworkImages } from '../artwork-images.js';
const artistId = new URLSearchParams(window.location.search).get('id');
const apiBase = '../supabase-data';
const apiUrl = `${apiBase}?action=artist&id=`;
let profileSession = null;
try {
  profileSession = JSON.parse(localStorage.getItem('vicom-session') || 'null');
} catch {
  profileSession = null;
}
if (profileSession?.role === 'artist') {
  document.querySelector('#back-link')?.setAttribute('href', '../Artist side/discover.html');
  document.querySelector('#brand-link')?.setAttribute('href', '../Artist side/index.html');
}
const nameElement = document.querySelector('#artist-name');
const specialtyElement = document.querySelector('#artist-specialty');
const descriptionElement = document.querySelector('#artist-description');
const socialLinkElement = document.querySelector('#artist-social-link');
const avatarElement = document.querySelector('#artist-avatar');
const avatarImg = document.querySelector('#artist-avatar-img');

// Debug panel
const debugPanel = document.querySelector('#debug-panel');
const debugId = document.querySelector('#debug-id');
const debugStatus = document.querySelector('#debug-status');
const debugClose = document.querySelector('#debug-close');

if (debugPanel && debugId && debugStatus) {
  debugId.textContent = artistId || '(missing from URL)';
  debugClose?.addEventListener('click', () => {
    if (debugPanel) debugPanel.style.display = 'none';
  });
}

function updateDebugStatus(status, isError = false) {
  if (debugStatus) {
    debugStatus.textContent = status;
    debugStatus.style.color = isError ? '#f00' : '#060';
  }
  console.log('[DEBUG]', status);
}
const grid = document.querySelector('#portfolio-grid');
const empty = document.querySelector('#empty-state');
const count = document.querySelector('#work-count');
const ratesGrid = document.querySelector('#rates-grid');
const ratesEmpty = document.querySelector('#rates-empty');
const ratesNote = document.querySelector('#rates-note');
const toast = document.querySelector('#toast');
const imageLightbox = document.querySelector('#image-lightbox');
const imageLightboxPicture = document.querySelector('#image-lightbox-picture');
function closeImageLightbox() {
  imageLightbox.classList.remove('open');
  imageLightbox.setAttribute('aria-hidden', 'true');
  imageLightboxPicture.style.backgroundImage = '';
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2200);
}

const savedArtworkIds = new Set();

async function saveArtwork(artworkId) {
  try {
    const response = await apiFetch(`${apiBase}?action=save_artwork`, {
      method: 'POST',
      body: JSON.stringify({ artworkId }),
    });
    if (response.ok) return { ok: true };
    const data = await response.json().catch(() => ({}));
    return { ok: false, error: data.error || 'Could not save artwork.' };
  } catch (error) {
    return { ok: false, error: error.message || 'Could not save artwork.' };
  }
}

async function unsaveArtwork(artworkId) {
  try {
    const response = await apiFetch(`${apiBase}?action=unsave_artwork`, {
      method: 'POST',
      body: JSON.stringify({ artworkId }),
    });
    if (response.ok) return { ok: true };
    const data = await response.json().catch(() => ({}));
    return { ok: false, error: data.error || 'Could not remove artwork.' };
  } catch (error) {
    return { ok: false, error: error.message || 'Could not remove artwork.' };
  }
}

async function loadSavedArtworkIds(artworkIds) {
  const ids = (artworkIds || []).filter(Boolean);
  if (!ids.length || !getSession()) return;
  try {
    const response = await apiFetch(`${apiBase}?action=check_saved_artworks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ artworkIds: ids }),
    });
    if (!response.ok) return;
    const result = await response.json().catch(() => ({}));
    (result.saved || []).forEach((id) => savedArtworkIds.add(id));
    grid.querySelectorAll('.heart').forEach((heart) => {
      if (savedArtworkIds.has(heart.dataset.id)) {
        heart.classList.add('saved');
        heart.textContent = '♥';
        heart.setAttribute('aria-label', `Unsave ${heart.dataset.title}`);
      }
    });
  } catch (error) {}
}

function hasActiveSuspension(session) {
  if (!session?.isSuspended) return false;
  if (!session.suspensionUntil) return true;
  const expiry = new Date(session.suspensionUntil);
  return Number.isNaN(expiry.getTime()) || expiry.getTime() > Date.now();
}

function renderRates(rates = []) {
  ratesEmpty.hidden = rates.length > 0;
  ratesNote.textContent = rates.length ? `${rates.length} ${rates.length === 1 ? 'service' : 'services'}` : '';
  const buttonCount = document.querySelector('#rates-button-count');
  if (buttonCount) {
    buttonCount.textContent = String(rates.length);
    buttonCount.hidden = rates.length === 0;
  }
  ratesGrid.innerHTML = rates.map((rate) => `
    <article class="rate-card">
      <div class="rate-card-body">
        <p class="rate-card-type">${escapeHtml(rate.type || 'Commission')}</p>
        <p class="rate-card-desc">${escapeHtml(rate.description || '')}</p>
        <span class="rate-card-price">from ₱${Number(rate.price).toLocaleString()}</span>
      </div>
    </article>`).join('');
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

function renderAvatar(name, pictureUrl) {
  const initial = (name || '?').trim().charAt(0).toUpperCase() || '?';
  const textNode = Array.from(avatarElement.childNodes).find((node) => node.nodeType === Node.TEXT_NODE);
  if (textNode) {
    textNode.nodeValue = initial;
  } else {
    avatarElement.insertBefore(document.createTextNode(initial), avatarElement.firstChild);
  }

  if (pictureUrl) {
    avatarImg.alt = `${name} profile picture`;
    avatarImg.onerror = () => {
      avatarImg.hidden = true;
      avatarImg.removeAttribute('src');
    };
    avatarImg.src = pictureUrl;
    avatarImg.hidden = false;
  } else {
    avatarImg.onerror = null;
    avatarImg.removeAttribute('src');
    avatarImg.hidden = true;
  }
}

function renderProfile(profile) {
  const artist = profile?.artist;
  const artworks = profile?.artworks || [];
  
  if (!artist) {
    console.error('No artist object in profile data');
    throw new Error('Invalid artist data');
  }
  
  console.log('Rendering profile for:', artist.name);
  
  _currentArtistId   = artist.id   || artistId;
  _currentArtistName = artist.name || '';
  document.title = `ViCom | ${artist.name}`;
  nameElement.textContent = artist.name;
  specialtyElement.textContent = artist.specialty || 'Original commissions';
  descriptionElement.textContent = artist.description || 'Original work made with care, clarity, and a point of view.';
  if (artist.socialLink) {
    socialLinkElement.href = artist.socialLink;
    socialLinkElement.textContent = artist.socialLink;
    socialLinkElement.hidden = false;
  } else {
    socialLinkElement.removeAttribute('href');
    socialLinkElement.textContent = '';
    socialLinkElement.hidden = true;
  }
  renderAvatar(artist.name, artist.profilePicture);

  count.textContent = `${artworks.length} ${artworks.length === 1 ? 'piece' : 'pieces'}`;
  grid.innerHTML = artworks.map((work) => `<article class="work-card"><div class="work-image"${artworkImageAttrs(work)}><button class="heart" type="button" aria-label="Save ${escapeHtml(work.title)}" data-id="${work.id}" data-title="${escapeHtml(work.title)}">♡</button></div><div class="work-meta"><div><h3>${work.title}</h3><p>${work.detail || work.category}</p></div><strong>from ${work.price}</strong></div></article>`).join('');
  hydrateArtworkImages(grid);
  empty.hidden = artworks.length > 0;
  renderRates(profile.rates || []);
  loadSavedArtworkIds(artworks.map((work) => work.id).filter(Boolean));
  
  console.log('Profile rendered successfully');
}

async function loadProfile() {
  updateDebugStatus('Checking artist ID...', false);
  
  if (!artistId) {
    updateDebugStatus('ERROR: No artist ID in URL', true);
    nameElement.textContent = 'Artist not found';
    empty.hidden = false;
    empty.textContent = 'Choose an artist from Discover to view their profile.';
    return;
  }
  
  updateDebugStatus('Fetching artist data...', false);
  
  try {
    console.log('Loading artist profile for ID:', artistId);
    const response = await apiFetch(`${apiUrl}${encodeURIComponent(artistId)}`);
    console.log('API response status:', response.status);
    
    updateDebugStatus(`API response: ${response.status}`, false);
    
    const text = await response.text();
    console.log('API response text:', text);
    
    let data;
    try { 
      data = JSON.parse(text); 
    } catch (parseError) { 
      console.error('JSON parse error:', parseError);
      updateDebugStatus('ERROR: Invalid JSON from API', true);
      throw new Error('API returned invalid data'); 
    }
    
    if (!response.ok) {
      console.error('API error:', data.error || 'Unknown error');
      updateDebugStatus('ERROR: ' + (data.error || 'API error'), true);
      throw new Error(data.error || 'Profile unavailable');
    }
    
    if (!data.artist) {
      console.error('No artist data in response:', data);
      updateDebugStatus('ERROR: No artist data', true);
      throw new Error('Artist data not found');
    }
    
    console.log('Artist data loaded successfully:', data.artist.name);
    updateDebugStatus('✓ Loaded: ' + data.artist.name, false);
    
    _currentArtistId   = data.artist?.id   || artistId;
    _currentArtistName = data.artist?.name || '';
    renderProfile(data);
    
    // Hide debug panel after successful load
    setTimeout(() => {
      if (debugPanel) debugPanel.style.display = 'none';
    }, 3000);
    
  } catch (error) {
    console.error('Error loading profile:', error);
    updateDebugStatus('ERROR: ' + error.message, true);
    nameElement.textContent = 'Artist not found';
    empty.hidden = false;
    empty.textContent = error.message || 'This artist profile is not available right now.';
    showToast('Error: ' + error.message);
  }
}

/* ── COMMISSION REQUEST FLOW ── */
let _currentArtistId   = null;
let _currentArtistName = null;

function openCommissionModal(aId, aName) {
  _currentArtistId   = aId;
  _currentArtistName = aName;
  const nameEl = document.querySelector('#modal-artist-name');
  if (nameEl) nameEl.textContent = aName || 'the artist';
  document.querySelector('#commission-modal-overlay').classList.add('open');
  document.querySelector('#commission-title').value = '';
  document.querySelector('#commission-brief').value = '';
  const refInput = document.querySelector('#commission-reference');
  const preview = document.querySelector('#commission-reference-preview');
  if (refInput) refInput.value = '';
  if (preview) {
    preview.src = '';
    preview.hidden = true;
  }
}

function readReferenceImage(file) {
  if (!file) return Promise.resolve('');
  if (!file.type.startsWith('image/')) {
    throw new Error('Please choose an image file for your reference.');
  }
  if (file.size > 5 * 1024 * 1024) {
    throw new Error('Reference image must be under 5 MB.');
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Could not read the selected image.'));
    reader.readAsDataURL(file);
  });
}

const referenceInput = document.querySelector('#commission-reference');
const referencePreview = document.querySelector('#commission-reference-preview');
referenceInput?.addEventListener('change', () => {
  const file = referenceInput.files?.[0];
  if (!file) {
    if (referencePreview) {
      referencePreview.src = '';
      referencePreview.hidden = true;
    }
    return;
  }
  if (!file.type.startsWith('image/')) {
    showToast('Please choose an image file for your reference.');
    referenceInput.value = '';
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    if (referencePreview) {
      referencePreview.src = String(reader.result);
      referencePreview.hidden = false;
    }
  };
  reader.readAsDataURL(file);
});

function closeCommissionModal() {
  document.querySelector('#commission-modal-overlay').classList.remove('open');
}

document.querySelector('#commission-button').addEventListener('click', () => {
  // Check if logged in as customer
  try {
    const sess = JSON.parse(localStorage.getItem('vicom-session'));
    if (!sess) {
      window.location.href = '../Account%20functions/auth.html?mode=signin';
      return;
    }
    if (sess.role === 'artist') {
      showToast('Log in as a client to commission artists.');
      return;
    }
    if (hasActiveSuspension(sess)) {
      showToast('Your account is suspended and cannot request commissions until the suspension is lifted.');
      return;
    }
  } catch {
    window.location.href = '../Account%20functions/auth.html?mode=signin';
    return;
  }
  openCommissionModal(_currentArtistId || artistId, _currentArtistName || document.querySelector('#artist-name')?.textContent || 'Artist');
});

document.querySelector('#commission-modal-close')?.addEventListener('click', closeCommissionModal);
document.querySelector('#commission-modal-cancel')?.addEventListener('click', closeCommissionModal);
document.querySelector('#commission-modal-overlay')?.addEventListener('click', e => {
  if (e.target.id === 'commission-modal-overlay') closeCommissionModal();
});

document.querySelector('#commission-submit')?.addEventListener('click', async () => {
  const btn   = document.querySelector('#commission-submit');
  const title = document.querySelector('#commission-title').value.trim();
  const brief = document.querySelector('#commission-brief').value.trim();
  const file  = document.querySelector('#commission-reference')?.files?.[0] || null;
  if (!title) { showToast('Add a project title first.'); return; }

  const sess = JSON.parse(localStorage.getItem('vicom-session') || 'null');
  if (!sess) { window.location.href = '../Account%20functions/auth.html?mode=signin'; return; }
  if (sess.role === 'artist') { showToast('Log in as a client to commission artists.'); return; }
  if (hasActiveSuspension(sess)) {
    showToast('Your account is suspended and cannot request commissions until the suspension is lifted.');
    return;
  }

  const targetArtistId = _currentArtistId || artistId;
  if (!targetArtistId) { showToast('Could not identify this artist.'); return; }

  btn.disabled = true;

  try {
    const referenceImage = await readReferenceImage(file);
    // Prevent duplicate pending request to the same artist (checked against the DB)
    const existing = await apiFetch(
      `${apiBase}?action=commissions&userId=${encodeURIComponent(sess.userId)}&role=customer`
    ).then(r => r.json());

    const dup = (existing.commissions || []).some(c =>
      c.artistId === targetArtistId && c.status === 'pending'
    );
    if (dup) {
      showToast('You already have a pending request with this artist.');
      closeCommissionModal();
      return;
    }

    const res = await apiFetch(`${apiBase}?action=create_commission`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        artistId:       targetArtistId,
        clientId:       sess.userId,
        title:          title,
        description:    brief,
        referenceImage: referenceImage,
      }),
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || 'Request failed.');

    closeCommissionModal();
    showToast('\u2705 Commission request sent! Redirecting\u2026');
    setTimeout(() => { window.location.href = '../User%20Side/commissions.html'; }, 1400);
  } catch (err) {
    showToast('Could not send request: ' + err.message);
  } finally {
    btn.disabled = false;
  }
});

loadProfile();

function getSession() {
  try {
    const session = JSON.parse(localStorage.getItem('vicom-session') || 'null');
    return session && session.userId ? session : null;
  } catch {
    return null;
  }
}

async function submitReport({ reportedId, type, reason, commissionId = null, messageId = null }) {
  const session = getSession();
  if (!session) {
    showToast('Sign in to report');
    return false;
  }
  if (!reportedId) {
    showToast('Could not identify the user to report');
    return false;
  }

  try {
    const response = await apiFetch(`${apiBase}?action=create_report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reportedId,
        type,
        reason,
        commissionId,
        messageId,
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Could not submit report.');
    return true;
  } catch (error) {
    showToast(error.message || 'Could not submit report.');
    return false;
  }
}

// Report artist functionality
document.querySelector('#report-artist-button')?.addEventListener('click', () => {
  const session = getSession();
  if (!session) {
    showToast('Sign in to report artists');
    return;
  }

  const targetArtistId = _currentArtistId || artistId;
  if (!targetArtistId) {
    showToast('Could not identify this artist');
    return;
  }

  const modal = document.createElement('div');
  modal.className = 'report-modal-overlay open';
  modal.innerHTML = `
    <div class="report-modal">
      <button class="report-modal-close" type="button" aria-label="Close report form">×</button>
      <h3>Report Artist</h3>
      <p>Help us maintain a safe community</p>
      <select class="report-reason">
        <option value="">Select reason...</option>
        <option value="Inappropriate behavior">Inappropriate behavior</option>
        <option value="Scam or fraud">Scam or fraud</option>
        <option value="Hate speech">Hate speech</option>
        <option value="Harassment">Harassment</option>
        <option value="Other">Other</option>
      </select>
      <textarea class="report-details" placeholder="Describe the issue..."></textarea>
      <div class="report-actions">
        <button class="btn-primary report-submit" id="submit-report" type="button">Submit Report</button>
        <button class="btn-secondary report-cancel" id="cancel-report" type="button">Cancel</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  modal.querySelector('.report-modal-close').addEventListener('click', () => modal.remove());
  modal.querySelector('#cancel-report').addEventListener('click', () => modal.remove());
  modal.addEventListener('click', (event) => {
    if (event.target === modal) modal.remove();
  });

  modal.querySelector('#submit-report').addEventListener('click', async () => {
    const reason = modal.querySelector('.report-reason').value;
    const details = modal.querySelector('.report-details').value.trim();

    if (!reason) {
      showToast('Please select a reason');
      return;
    }
    if (!details) {
      showToast('Please provide details');
      return;
    }

    const submitted = await submitReport({
      reportedId: targetArtistId,
      type: 'artist',
      reason: `${reason}: ${details}`,
    });

    if (submitted) {
      modal.remove();
      showToast('Report submitted successfully');
    }
  });
});

grid.addEventListener('click', async (event) => {
  const heart = event.target.closest('.heart');
  if (heart) {
    event.stopPropagation();
    const session = getSession();
    if (!session) {
      showToast('Please log in first to save');
      return;
    }
    const artworkId = heart.dataset.id;
    if (!artworkId) return;
    const wasSaved = heart.classList.contains('saved');
    const result = wasSaved ? await unsaveArtwork(artworkId) : await saveArtwork(artworkId);
    if (!result.ok) {
      showToast(result.error);
      return;
    }
    heart.classList.toggle('saved');
    const nowSaved = heart.classList.contains('saved');
    heart.textContent = nowSaved ? '♥' : '♡';
    heart.setAttribute('aria-label', `${nowSaved ? 'Unsave' : 'Save'} ${heart.dataset.title}`);
    if (nowSaved) savedArtworkIds.add(artworkId); else savedArtworkIds.delete(artworkId);
    showToast(nowSaved ? `Saved ${heart.dataset.title}` : 'Removed from your collection');
    return;
  }
  const image = event.target.closest('.work-image');
  if (!image) return;
  imageLightboxPicture.style.backgroundImage = image.style.backgroundImage;
  imageLightbox.classList.add('open');
  imageLightbox.setAttribute('aria-hidden', 'false');
});

document.querySelector('#image-lightbox-close').addEventListener('click', closeImageLightbox);
imageLightbox.addEventListener('click', (event) => {
  if (event.target === imageLightbox) closeImageLightbox();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && imageLightbox.classList.contains('open')) closeImageLightbox();
});

/* ── RATES & SERVICES MODAL ── */
const ratesModalOverlay = document.querySelector('#rates-modal-overlay');
const ratesButton = document.querySelector('#rates-button');
const ratesModalClose = document.querySelector('#rates-modal-close');

function openRatesModal() {
  if (!ratesModalOverlay) return;
  ratesModalOverlay.classList.add('open');
  ratesModalOverlay.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
}

function closeRatesModal() {
  if (!ratesModalOverlay) return;
  ratesModalOverlay.classList.remove('open');
  ratesModalOverlay.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
}

ratesButton?.addEventListener('click', openRatesModal);
ratesModalClose?.addEventListener('click', closeRatesModal);
ratesModalOverlay?.addEventListener('click', (event) => {
  if (event.target === ratesModalOverlay) closeRatesModal();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && ratesModalOverlay?.classList.contains('open')) closeRatesModal();
});
