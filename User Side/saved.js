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

function loadProfileInitials() {
  try {
    const session = JSON.parse(localStorage.getItem(sessionKey) || 'null');
    const name = String(session?.name || '').trim();
    const profilePicture = session?.profilePicture || '';
    const profile = document.querySelector('#profile-initials');
    if (!profile || !name) return;

    if (profilePicture) {
      profile.style.backgroundImage = `url('${profilePicture}')`;
      profile.style.backgroundSize = 'cover';
      profile.style.backgroundPosition = 'center';
      profile.textContent = '';
    } else {
      profile.textContent = name.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase();
    }
  } catch (error) {

  }
}

loadProfileInitials();

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

  grid.querySelectorAll('.heart').forEach((heart) => heart.addEventListener('click', async () => {
    const artworkId = heart.dataset.id;
    const artworkTitle = heart.dataset.title;
    const result = await unsaveArtwork(artworkId);
    if (result.ok) {
      allArtworks = allArtworks.filter((artwork) => artwork.id !== artworkId);
      await renderArtworks();
      showToast(`Removed ${artworkTitle} from your collection`);
    } else {
      showToast(result.error);
    }
  }));
}

async function init() {
  allArtworks = await getSavedArtworks();
  await renderArtworks();
}

search.addEventListener('input', (event) => {
  activeSearch = String(event.target.value || '').toLowerCase().trim();
  renderArtworks();
});

document.querySelector('#logout')?.addEventListener('click', logoutUser);

init();
