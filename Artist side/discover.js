import { apiFetch } from '../supabase-api.js';
import { artworkImageAttrs, hydrateArtworkImages } from '../artwork-images.js';
import { logoutUser } from '../Account functions/auth-service.js';
const uploads = [
];
const sessionKey = 'vicom-session';
const grid = document.querySelector('#upload-grid');
const empty = document.querySelector('#uploads-empty');
const toast = document.querySelector('#toast');
const filters = document.querySelectorAll('.upload-filter');
const filterButton = document.querySelector('#filter-button');
const priceFilterPanel = document.querySelector('#price-filter-panel');
const minPriceInput = document.querySelector('#min-price');
const maxPriceInput = document.querySelector('#max-price');
const clearPriceFilter = document.querySelector('#clear-price-filter');
let toastTimer;
let activeCategory = 'all';
let minimumPrice = null;
let maximumPrice = null;
let allUploads = [];
let savedArtworkIds = new Set();

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

async function getPublishedUploads() {
  try {
    const response = await apiFetch('../supabase-data?action=artworks');
    if (!response.ok) throw new Error('Artwork API unavailable');
    const result = await response.json();
    return result.artworks || [];
  } catch (error) { return []; }
}

async function getSavedArtworkIds() {
  try {
    const artworkIds = allUploads.map((upload) => upload.id).filter(Boolean);
    if (!artworkIds.length) return [];
    const response = await apiFetch('../supabase-data?action=check_saved_artworks', {
      method: 'POST',
      body: JSON.stringify({ artworkIds }),
    });
    if (!response.ok) return [];
    const result = await response.json();
    return result.saved || [];
  } catch (error) {
    return [];
  }
}

async function saveArtwork(artworkId) {
  try {
    const response = await apiFetch('../supabase-data?action=save_artwork', {
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

function shuffled(items) {
  return [...items].sort(() => Math.random() - 0.5);
}

function parsePrice(value) {
  const parsed = Number(String(value || '').replace(/[^\d.-]/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

async function renderUploads() {
  const visibleUploads = shuffled(allUploads).filter((upload) => {
    const matchesCategory = activeCategory === 'all' || String(upload.category).toLowerCase() === activeCategory;
    const price = parsePrice(upload.price);
    const matchesMinimum = minimumPrice === null || (price !== null && price >= minimumPrice);
    const matchesMaximum = maximumPrice === null || (price !== null && price <= maximumPrice);
    return matchesCategory && matchesMinimum && matchesMaximum;
  });
  grid.innerHTML = visibleUploads.map((upload) => {
    const isSaved = savedArtworkIds.has(upload.id);
    return `
    <article class="upload-card">
      <div class="upload-image"${artworkImageAttrs(upload)}>${upload.artistId ? `<a class="artist-photo-link" href="../User Side/artist.html?id=${encodeURIComponent(upload.artistId)}" aria-label="View ${upload.artist} profile"></a>` : ''}<span class="category">${upload.category}</span><button class="heart${isSaved ? ' saved' : ''}" type="button" aria-label="${isSaved ? 'Unsave' : 'Save'} ${upload.title}" data-id="${upload.id}" data-title="${upload.title}">${isSaved ? '♥' : '♡'}</button></div>
      <div class="upload-meta"><div><h3>${upload.title}</h3><p>by ${upload.artistId ? `<a class="artist-link" href="../User Side/artist.html?id=${encodeURIComponent(upload.artistId)}">${upload.artist}</a>` : upload.artist} · ${upload.detail}</p></div><strong>from ${upload.price}</strong></div>
    </article>
  `;
  }).join('');
  hydrateArtworkImages(grid);
  empty.hidden = visibleUploads.length > 0;
  grid.querySelectorAll('.heart').forEach((heart) => heart.addEventListener('click', async () => {
    const artworkId = heart.dataset.id;
    const artworkTitle = heart.dataset.title;
    const wasSaved = heart.classList.contains('saved');

    const session = JSON.parse(localStorage.getItem(sessionKey) || 'null');
    if (!session || !session.userId) {
      showToast('Please sign in to save artwork');
      return;
    }

    const result = wasSaved ? await unsaveArtwork(artworkId) : await saveArtwork(artworkId);

    if (result.ok) {
      heart.classList.toggle('saved');
      heart.textContent = heart.classList.contains('saved') ? '♥' : '♡';
      heart.setAttribute('aria-label', `${heart.classList.contains('saved') ? 'Unsave' : 'Save'} ${artworkTitle}`);

      if (heart.classList.contains('saved')) {
        savedArtworkIds.add(artworkId);
      } else {
        savedArtworkIds.delete(artworkId);
      }

      showToast(heart.classList.contains('saved') ? `Saved ${artworkTitle}` : 'Removed from your collection');
    } else {
      showToast(result.error);
    }
  }));
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2200);
}

filters.forEach((filter) => filter.addEventListener('click', async () => {
  filters.forEach((item) => item.classList.remove('active'));
  filter.classList.add('active');
  activeCategory = filter.dataset.category;
  await renderUploads();
}));

filterButton.addEventListener('click', () => {
  const isOpen = !priceFilterPanel.hidden;
  priceFilterPanel.hidden = isOpen;
  filterButton.setAttribute('aria-expanded', String(!isOpen));
});

function updatePriceFilter() {
  minimumPrice = minPriceInput.value === '' ? null : Number(minPriceInput.value);
  maximumPrice = maxPriceInput.value === '' ? null : Number(maxPriceInput.value);
  renderUploads();
}

minPriceInput.addEventListener('input', updatePriceFilter);
maxPriceInput.addEventListener('input', updatePriceFilter);
clearPriceFilter.addEventListener('click', () => {
  minPriceInput.value = '';
  maxPriceInput.value = '';
  minimumPrice = null;
  maximumPrice = null;
  renderUploads();
});

document.querySelector('#shuffle-button').addEventListener('click', async () => {
  await renderUploads();
  showToast('Fresh uploads shuffled');
});
document.querySelector('#logout').addEventListener('click', async () => {
  await logoutUser();
  localStorage.removeItem(sessionKey);
  window.location.href = '../LandingPage/index.html';
});

getPublishedUploads().then(async (publishedUploads) => {
  allUploads = [...uploads, ...publishedUploads];
  const savedIds = await getSavedArtworkIds();
  savedArtworkIds = new Set(savedIds);
  renderUploads();
});
