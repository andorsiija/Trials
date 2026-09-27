const uploads = [
];
import { apiFetch } from '../firebase-api.js';
import { logoutUser } from '../Account functions/auth-service.js';
const sessionKey = 'vicom-session';
const grid = document.querySelector('#upload-grid');
const empty = document.querySelector('#uploads-empty');
const toast = document.querySelector('#toast');
const filters = document.querySelectorAll('.upload-filter');
const search = document.querySelector('#search-input');
const filterButton = document.querySelector('#filter-button');
const priceFilterPanel = document.querySelector('#price-filter-panel');
const minPriceInput = document.querySelector('#min-price');
const maxPriceInput = document.querySelector('#max-price');
const clearPriceFilter = document.querySelector('#clear-price-filter');
let toastTimer;
let activeCategory = 'all';
let activeSearch = '';
let allUploads = [];
let minimumPrice = null;
let maximumPrice = null;
let artistRateMapPromise;
const artistRateMap = new Map();

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
    const profile = document.querySelector('#profile-initials');
    if (!profile || !name) return;
    profile.textContent = name.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase();
  } catch (error) {
    
  }
}

loadProfileInitials();

async function getPublishedUploads() {
  try {
    const response = await apiFetch('../firebase-data?action=artworks');
    if (!response.ok) throw new Error('Artwork API unavailable');
    const result = await response.json();
    return result.artworks || [];
  } catch (error) { return []; }
}

function shuffled(items) {
  return [...items].sort(() => Math.random() - 0.5);
}

async function loadArtistRateMap() {
  if (artistRateMapPromise) return artistRateMapPromise;
  const artistIds = [...new Set(allUploads.map((upload) => upload.artistId).filter(Boolean).map(String))];
  artistRateMapPromise = Promise.all(artistIds.map(async (artistId) => {
    try {
      const response = await apiFetch(`../firebase-data?action=artist&id=${encodeURIComponent(artistId)}&countView=false`);
      if (!response.ok) throw new Error('Artist rates unavailable');
      const profile = await response.json();
      const prices = (profile.rates || []).map((rate) => Number(rate.price)).filter((price) => Number.isFinite(price) && price > 0);
      artistRateMap.set(artistId, prices.length ? Math.min(...prices) : null);
    } catch (error) {
      artistRateMap.set(artistId, null);
    }
  }));
  return artistRateMapPromise;
}

async function renderUploads() {
  if (minimumPrice !== null || maximumPrice !== null) await loadArtistRateMap();
  const visibleUploads = shuffled(allUploads).filter((upload) => {
    const matchesCategory = activeCategory === 'all' || String(upload.category).toLowerCase() === activeCategory;
    const searchableText = [upload.title, upload.artist, upload.category, upload.detail]
      .map((value) => String(value || '').toLowerCase())
      .join(' ');
    const rate = artistRateMap.get(String(upload.artistId || ''));
    const matchesBudget = (minimumPrice === null && maximumPrice === null)
      || (rate !== null && rate !== undefined && (minimumPrice === null || rate >= minimumPrice) && (maximumPrice === null || rate <= maximumPrice));
    return matchesCategory && searchableText.includes(activeSearch) && matchesBudget;
  });
  grid.innerHTML = visibleUploads.map((upload) => `
    <article class="upload-card">
      <div class="upload-image" style="background-image:url('${upload.image}')">${upload.artistId ? `<a class="artist-photo-link" href="../User Side/artist.html?id=${encodeURIComponent(upload.artistId)}" aria-label="View ${upload.artist} profile"></a>` : ''}<span class="category">${upload.category}</span><button class="heart" type="button" aria-label="Save ${upload.title}" data-title="${upload.title}">♡</button></div>
      <div class="upload-meta"><div><h3>${upload.title}</h3><p>by ${upload.artistId ? `<a class="artist-link" href="../User Side/artist.html?id=${encodeURIComponent(upload.artistId)}">${upload.artist}</a>` : upload.artist} · ${upload.detail}</p></div></div>
    </article>
  `).join('');
  empty.hidden = visibleUploads.length > 0;
  grid.querySelectorAll('.heart').forEach((heart) => heart.addEventListener('click', () => {
    heart.classList.toggle('saved');
    heart.textContent = heart.classList.contains('saved') ? '♥' : '♡';
    showToast(heart.classList.contains('saved') ? `Saved ${heart.dataset.title}` : 'Removed from your collection');
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

search.addEventListener('input', () => {
  activeSearch = search.value.trim().toLowerCase();
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

getPublishedUploads().then((publishedUploads) => {
  allUploads = [...uploads, ...publishedUploads];
  renderUploads();
});

