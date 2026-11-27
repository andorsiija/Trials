import { apiFetch } from '../supabase-api.js';
import { artworkImageAttrs, hydrateArtworkImages } from '../artwork-images.js';
import { logoutUser } from '../Account functions/auth-service.js';

const sessionKey = 'vicom-session';
const grid = document.querySelector('#upload-grid');
const empty = document.querySelector('#uploads-empty');
const toast = document.querySelector('#toast');
const search = document.querySelector('#search-input');
const savedCount = document.querySelector('#saved-count');
let toastTimer;
let activeSearch = '';
let allArtworks = [];

function hasSession() {
  try {
    const session = JSON.parse(localStorage.getItem(sessionKey));
    return Boolean(session?.userId || session?.email);
  } catch (error) {
    return false;
  }
}

if (!hasSession()) {
  window.location.href = '../Account%20functions/auth.html?mode=signin';
}

function loadArtistProfile() {
  try {
    const session = JSON.parse(localStorage.getItem(sessionKey) || 'null');
    const name = String(session?.name || '').trim();
    const profilePicture = session?.profilePicture || '';
    const initials = document.querySelector('#artist-initials');
    const nameElement = document.querySelector('#artist-name');
    
    if (nameElement && name) nameElement.textContent = name;
    
    if (!initials || !name) return;

    if (profilePicture) {
      initials.style.backgroundImage = `url('${profilePicture}')`;
      initials.style.backgroundSize = 'cover';
      initials.style.backgroundPosition = 'center';
      initials.textContent = '';
    } else {
      initials.textContent = name.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase();
    }
  } catch (error) {
    console.error('Error loading artist profile:', error);
  }
}

loadArtistProfile();

async function getSavedArtworks() {
  try {
    const response = await apiFetch('../supabase-data?action=saved_artworks');
    if (!response.ok) throw new Error('Saved artworks API unavailable');
    const result = await response.json();
    return result.artworks || [];
  } catch (error) {
    console.error('Error fetching saved artworks:', error);
    return [];
  }
}

async function unsaveArtwork(artworkId) {
  try {
    const response = await apiFetch('../supabase-data?action=unsave_artwork', {
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

function showToast(message) {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.add('show');
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2800);
}

async function renderArtworks() {
  const visibleArtworks = allArtworks.filter((artwork) => {
    const searchableText = [artwork.title, artwork.artist, artwork.category, artwork.detail]
      .map((value) => String(value || '').toLowerCase())
      .join(' ');
    return searchableText.includes(activeSearch);
  });

  grid.innerHTML = visibleArtworks.map((artwork) => `
    <article class="upload-card">
      <div class="upload-image"${artworkImageAttrs(artwork)}>${artwork.artistId ? `<a class="artist-photo-link" href="../User Side/artist.html?id=${encodeURIComponent(artwork.artistId)}" aria-label="View ${artwork.artist} profile"></a>` : ''}<span class="category">${artwork.category}</span><button class="heart saved" type="button" aria-label="Unsave ${artwork.title}" data-id="${artwork.id}" data-title="${artwork.title}">♥</button></div>
      <div class="upload-meta"><div><h3>${artwork.title}</h3><p>by ${artwork.artistId ? `<a class="artist-link" href="../User Side/artist.html?id=${encodeURIComponent(artwork.artistId)}">${artwork.artist}</a>` : artwork.artist} · ${artwork.detail}</p></div><strong>from ${artwork.price}</strong></div>
    </article>
  `).join('');

  hydrateArtworkImages(grid);
  empty.hidden = visibleArtworks.length > 0;
  savedCount.textContent = `${allArtworks.length} SAVED`;

  grid.querySelectorAll('.heart').forEach((heart) => {
    heart.addEventListener('click', async (event) => {
      event.preventDefault();
      const artworkId = heart.dataset.id;
      const title = heart.dataset.title;
      
      const result = await unsaveArtwork(artworkId);
      if (result.ok) {
        allArtworks = allArtworks.filter((artwork) => artwork.id !== artworkId);
        await renderArtworks();
        showToast(`Removed ${title}`);
      } else {
        showToast(result.error);
      }
    });
  });
}

search.addEventListener('input', () => {
  activeSearch = search.value.toLowerCase().trim();
  renderArtworks();
});

(async () => {
  allArtworks = await getSavedArtworks();
  await renderArtworks();
})();

document.querySelector('#logout')?.addEventListener('click', logoutUser);

const mobileNav = document.querySelector('.mobile-nav');
const sidebar = document.querySelector('.sidebar');

function ensureMobileOverlay() {
  if (document.querySelector('.mobile-overlay')) return;
  const overlay = document.createElement('button');
  overlay.type = 'button';
  overlay.className = 'mobile-overlay';
  overlay.setAttribute('aria-label', 'Close navigation');
  overlay.addEventListener('click', () => toggleSidebar(false));
  document.body.appendChild(overlay);
}

function toggleSidebar(forceOpen) {
  if (!sidebar) return;
  const shouldOpen = typeof forceOpen === 'boolean' ? forceOpen : !sidebar.classList.contains('open');
  sidebar.classList.toggle('open', shouldOpen);
  document.body.classList.toggle('menu-open', shouldOpen);
  document.querySelector('.mobile-overlay')?.classList.toggle('show', shouldOpen);
  mobileNav?.setAttribute('aria-expanded', String(shouldOpen));
}

async function loadSidebarBadges() {
  try {
    const session = JSON.parse(localStorage.getItem(sessionKey) || 'null');
    if (!session?.userId) return;
    const response = await apiFetch(`../supabase-data?action=dashboard_counts&userId=${encodeURIComponent(session.userId)}&role=artist`);
    if (!response.ok) return;
    const data = await response.json();
    const total = (data.active || 0) + (data.pending || 0);
    const link = document.querySelector('.sidebar nav a[href="commissions.html"]');
    if (!link) return;
    let badge = link.querySelector('b');
    if (!badge) { badge = document.createElement('b'); link.appendChild(badge); }
    badge.textContent = total > 99 ? '99+' : String(total);
    badge.style.display = total > 0 ? 'inline' : 'none';
  } catch (error) {
    console.error('Could not load sidebar badges:', error);
  }
}

ensureMobileOverlay();
mobileNav?.addEventListener('click', () => toggleSidebar());
document.querySelectorAll('.sidebar a').forEach((link) => {
  link.addEventListener('click', () => toggleSidebar(false));
});
window.addEventListener('resize', () => {
  if (window.innerWidth > 700) toggleSidebar(false);
});

loadSidebarBadges();
