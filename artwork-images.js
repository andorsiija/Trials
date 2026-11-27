import { apiFetch } from './supabase-api.js';

const API = new URL('supabase-data', import.meta.url).href;
const cache = new Map();
const resolved = new Map();

function escapeAttribute(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]);
}

export function artworkImageAttrs(work) {
  if (!work) return '';
  if (work.legacyImage) return ` data-artwork-image="${escapeAttribute(work.id)}"`;
  if (!work.image) return '';
  return ` style="background-image:url('${String(work.image).replace(/'/g, '%27')}')"`;
}

export function hydrateArtworkImages(root = document) {
  const elements = [...root.querySelectorAll('[data-artwork-image]')]
    .filter((element) => element.dataset.artworkImage && !element.dataset.hydrated);

  if (!('IntersectionObserver' in window)) {
    elements.forEach(loadElement);
    return;
  }

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      observer.unobserve(entry.target);
      loadElement(entry.target);
    });
  }, { rootMargin: '200px' });
  elements.forEach((element) => {
    element.dataset.hydrated = 'pending';
    observer.observe(element);
  });
}

function loadElement(element) {
  if (element.dataset.hydrated === '1') return;
  element.dataset.hydrated = '1';
  loadImage(element.dataset.artworkImage).then((image) => {
    resolved.set(element.dataset.artworkImage, image);
    element.style.backgroundImage = image ? `url("${String(image).replace(/"/g, '%22')}")` : '';
    if (!image) element.classList.add('no-artwork-image');
  });
}

export function getArtworkImage(element) {
  const id = element?.dataset?.artworkImage;
  if (id && !resolved.has(id)) {
    return loadImage(id).then((image) => {
      resolved.set(id, image);
      return image;
    });
  }
  return Promise.resolve((id && resolved.get(id)) || element?.dataset?.image || '');
}

function loadImage(id) {
  if (cache.has(id)) return cache.get(id);
  const request = apiFetch(`${API}?action=artwork_image&id=${encodeURIComponent(id)}`)
    .then((response) => (response.ok ? response.json() : {}))
    .then((data) => data.image || '')
    .catch(() => '');
  cache.set(id, request);
  return request;
}
