import { apiFetch } from '../firebase-api.js';
const uploads = [
];

const grid = document.querySelector('#upload-grid');
const toast = document.querySelector('#toast');
const empty = document.querySelector('#uploads-empty');
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
let artistRateMapPromise;
const artistRateMap = new Map();

async function getPublishedUploads() {
  try {
    const response = await apiFetch('../firebase-data?action=artworks');
    if (!response.ok) throw new Error('Artwork API unavailable');
    const result = await response.json();
    const portfolio = result.artworks || [];
    return portfolio.map((work) => ({ ...work, style: 'published-upload' }));
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
    const matchesCategory = activeCategory === 'all' || String(upload.category || '').toLowerCase() === activeCategory;
    const rate = artistRateMap.get(String(upload.artistId || ''));
    const matchesBudget = (minimumPrice === null && maximumPrice === null)
      || (rate !== null && rate !== undefined && (minimumPrice === null || rate >= minimumPrice) && (maximumPrice === null || rate <= maximumPrice));
    return matchesCategory && matchesBudget;
  });
  grid.innerHTML = visibleUploads.map((upload) => `
    <article class="upload-card">
      <div class="upload-image ${upload.style}"${upload.image ? ` style="background-image:url('${upload.image}')"` : ''}>${upload.artistId ? `<a class="artist-photo-link" href="../Account%20functions/artist.html?id=${encodeURIComponent(upload.artistId)}" aria-label="View ${upload.artist} profile"></a>` : ''}<span class="category">${upload.category}</span><button class="heart" type="button" aria-label="Save ${upload.title}" data-title="${upload.title}">♡</button></div>
      <div class="upload-meta"><div><h3>${upload.title}</h3><p>by ${upload.artistId ? `<a class="artist-link" href="../Account%20functions/artist.html?id=${encodeURIComponent(upload.artistId)}">${upload.artist}</a>` : upload.artist} · ${upload.detail}</p></div></div>
    </article>
  `).join('');
  empty.hidden = visibleUploads.length > 0;
  grid.querySelectorAll('.heart').forEach((heart) => heart.addEventListener('click', () => {
    heart.classList.toggle('saved');
    heart.textContent = heart.classList.contains('saved') ? '♥' : '♡';
    showToast(heart.classList.contains('saved') ? `Saved ${heart.dataset.title}` : 'Removed from your collection');
  }));
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

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2200);
}

document.querySelector('#shuffle-button').addEventListener('click', async () => {
  await renderUploads();
  showToast('Fresh uploads shuffled');
});
document.querySelectorAll('[data-toast]').forEach((button) => button.addEventListener('click', () => showToast(button.dataset.toast)));
getPublishedUploads().then((publishedUploads) => {
  allUploads = [...uploads, ...publishedUploads];
  renderUploads();
});
