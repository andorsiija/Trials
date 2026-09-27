import { apiFetch } from '../firebase-api.js';
const tabs = document.querySelectorAll('.tab');
const grid = document.querySelector('#art-grid');
const empty = document.querySelector('#uploads-empty');
const toast = document.querySelector('#toast');
const filterButton = document.querySelector('#filter-button');
const priceFilterPanel = document.querySelector('#price-filter-panel');
const minPriceInput = document.querySelector('#min-price');
const maxPriceInput = document.querySelector('#max-price');
const clearPriceFilter = document.querySelector('#clear-price-filter');
let toastTimer;
let cards = [];
let allUploads = [];
let minimumPrice = null;
let maximumPrice = null;
let artistRateMapPromise;
const artistRateMap = new Map();

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2200);
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

async function filterCards() {
  if (minimumPrice !== null || maximumPrice !== null) await loadArtistRateMap();
  const category = document.querySelector('.tab.active').dataset.category;
  let visibleCount = 0;
  cards.forEach((card) => {
    const rate = artistRateMap.get(card.dataset.artistId);
    const matchesCategory = category === 'all' || card.dataset.category.toLowerCase() === category;
    const matchesBudget = (minimumPrice === null && maximumPrice === null)
      || (rate !== null && rate !== undefined && (minimumPrice === null || rate >= minimumPrice) && (maximumPrice === null || rate <= maximumPrice));
    const visible = matchesCategory && matchesBudget;
    card.classList.toggle('hidden', !visible);
    if (visible) visibleCount += 1;
  });
  empty.hidden = visibleCount > 0;
}

function renderUploads(uploads) {
  grid.innerHTML = uploads.slice(0, 3).map((upload) => `
    <article class="art-card" data-category="${upload.category}" data-artist-id="${upload.artistId || ''}">
      <div class="card-image published-upload" style="background-image:url('${upload.image}')">
        <a class="art-link" href="../Account%20functions/artist.html?id=${encodeURIComponent(upload.artistId)}" aria-label="View ${upload.artist} profile"></a>
        <button class="heart" type="button" aria-label="Save ${upload.title}">♡</button>
      </div>
      <div class="card-meta">
        <div>
          <h3>${upload.title}</h3>
          <p>by ${upload.artist}</p>
        </div>
      </div>
    </article>
  `).join('');
  cards = [...grid.querySelectorAll('.art-card')];
  grid.querySelectorAll('.heart').forEach((button) => button.addEventListener('click', (event) => {
    event.stopPropagation();
    button.classList.toggle('saved');
    button.textContent = button.classList.contains('saved') ? '♥' : '♡';
    showToast(button.classList.contains('saved') ? 'Saved to your collection' : 'Removed from your collection');
  }));
  filterCards();
}

async function loadUploads() {
  try {
    const response = await apiFetch('../firebase-data?action=artworks');
    if (!response.ok) throw new Error('Artwork API unavailable');
    const result = await response.json();
    allUploads = result.artworks || [];
    renderUploads(allUploads);
  } catch (error) {
    renderUploads([]);
  }
}

tabs.forEach((tab) => tab.addEventListener('click', () => {
  tabs.forEach((item) => item.classList.remove('active'));
  tab.classList.add('active');
  filterCards();
}));

document.querySelector('#hero-search').addEventListener('click', () => {
  document.querySelector('#discover').scrollIntoView({ behavior: 'smooth' });
  showToast('Explore the ViCom edit below');
});

filterButton.addEventListener('click', () => {
  const isOpen = !priceFilterPanel.hidden;
  priceFilterPanel.hidden = isOpen;
  filterButton.setAttribute('aria-expanded', String(!isOpen));
});

function updatePriceFilter() {
  minimumPrice = minPriceInput.value === '' ? null : Number(minPriceInput.value);
  maximumPrice = maxPriceInput.value === '' ? null : Number(maxPriceInput.value);
  filterCards();
}

minPriceInput.addEventListener('input', updatePriceFilter);
maxPriceInput.addEventListener('input', updatePriceFilter);
clearPriceFilter.addEventListener('click', () => {
  minPriceInput.value = '';
  maxPriceInput.value = '';
  minimumPrice = null;
  maximumPrice = null;
  filterCards();
});

document.querySelector('.menu-button').addEventListener('click', (event) => {
  const button = event.currentTarget;
  button.setAttribute('aria-expanded', button.getAttribute('aria-expanded') !== 'true');
  showToast(button.getAttribute('aria-expanded') === 'true' ? 'Menu opened' : 'Menu closed');
});

loadUploads();
