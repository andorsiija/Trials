import { apiFetch } from '../supabase-api.js';
import { artworkImageAttrs, hydrateArtworkImages } from '../artwork-images.js';
const tabs = document.querySelectorAll('.tab');
const grid = document.querySelector('#art-grid');
const empty = document.querySelector('#uploads-empty');
const toast = document.querySelector('#toast');
let toastTimer;
let allUploads = [];
let minimumPrice = null;
let maximumPrice = null;

function parsePrice(value) {
  const cleaned = String(value || '').replace(/[^\d.-]/g, '');
  if (!cleaned) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2200);
}

function normalizeCategory(value) {
  return String(value || '').trim().toLowerCase().replace(/s$/, '');
}

function renderCards(uploads) {
  grid.innerHTML = uploads.map((upload) => `
    <article class="art-card" data-category="${upload.category || ''}">
      <div class="card-image published-upload"${artworkImageAttrs(upload)}>
        <a class="art-link" href="../User%20Side/artist.html?id=${encodeURIComponent(upload.artistId)}" aria-label="View ${upload.artist} profile"></a>
        <button class="heart" type="button" aria-label="Save ${upload.title}">♡</button>
      </div>
      <div class="card-meta">
        <div>
          <h3>${upload.title}</h3>
          <p>by ${upload.artist}</p>
        </div>
        <strong>from ${upload.price}</strong>
      </div>
    </article>
  `).join('');
  hydrateArtworkImages(grid);
  grid.querySelectorAll('.heart').forEach((button) => button.addEventListener('click', (event) => {
    event.stopPropagation();
    const session = JSON.parse(localStorage.getItem('vicom-session') || 'null');
    if (!session || !session.userId) {
      showToast('Please log in first to save');
      return;
    }
    button.classList.toggle('saved');
    button.textContent = button.classList.contains('saved') ? '♥' : '♡';
    showToast(button.classList.contains('saved') ? 'Saved to your collection' : 'Removed from your collection');
  }));
}

function filterCards() {
  const activeTab = document.querySelector('.tab.active');
  const category = normalizeCategory(activeTab?.dataset.category || 'all');
  const matching = allUploads.filter((upload) => {
    const matchesCategory = category === 'all' || normalizeCategory(upload.category) === category;
    const price = parsePrice(upload.price);
    const matchesMinimum = minimumPrice === null || (price !== null && price >= minimumPrice);
    const matchesMaximum = maximumPrice === null || (price !== null && price <= maximumPrice);
    return matchesCategory && matchesMinimum && matchesMaximum;
  });
  renderCards(matching.slice(0, 3));
  empty.hidden = matching.length > 0;
}

function renderUploads(uploads) {
  allUploads = Array.isArray(uploads) ? uploads : [];
  filterCards();
}

async function loadUploads() {
  try {
    const response = await apiFetch('../supabase-data?action=artworks');
    if (!response.ok) throw new Error('Artwork API unavailable');
    const result = await response.json();
    renderUploads(result.artworks || []);
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

const filterButton = document.querySelector('#filter-button');
const priceFilterPanel = document.querySelector('#price-filter-panel');
const minPriceInput = document.querySelector('#min-price');
const maxPriceInput = document.querySelector('#max-price');
const clearPriceFilter = document.querySelector('#clear-price-filter');

filterButton?.addEventListener('click', () => {
  const isOpen = !priceFilterPanel.hidden;
  priceFilterPanel.hidden = isOpen;
  filterButton.setAttribute('aria-expanded', String(!isOpen));
});

function updatePriceFilter() {
  minimumPrice = minPriceInput.value === '' ? null : Number(minPriceInput.value);
  maximumPrice = maxPriceInput.value === '' ? null : Number(maxPriceInput.value);
  filterCards();
}

minPriceInput?.addEventListener('input', updatePriceFilter);
maxPriceInput?.addEventListener('input', updatePriceFilter);
clearPriceFilter?.addEventListener('click', () => {
  minPriceInput.value = '';
  maxPriceInput.value = '';
  minimumPrice = null;
  maximumPrice = null;
  filterCards();
});

const menuButton = document.querySelector('.menu-button');
const mobileMenu = document.querySelector('#mobile-menu');
const mobileMenuOverlay = document.querySelector('#mobile-menu-overlay');
const mobileClose = document.querySelector('.mobile-close');

function toggleMobileMenu(forceOpen) {
  if (!mobileMenu || !menuButton) return;
  const shouldOpen = typeof forceOpen === 'boolean' ? forceOpen : !mobileMenu.classList.contains('open');
  mobileMenu.classList.toggle('open', shouldOpen);
  mobileMenuOverlay?.classList.toggle('show', shouldOpen);
  mobileMenu.setAttribute('aria-hidden', shouldOpen ? 'false' : 'true');
  menuButton.setAttribute('aria-expanded', String(shouldOpen));
  document.body.style.overflow = shouldOpen ? 'hidden' : '';
}

menuButton?.addEventListener('click', () => toggleMobileMenu());
mobileClose?.addEventListener('click', () => toggleMobileMenu(false));
mobileMenuOverlay?.addEventListener('click', () => toggleMobileMenu(false));
mobileMenu?.querySelectorAll('a').forEach((link) => {
  link.addEventListener('click', () => toggleMobileMenu(false));
});

loadUploads();
