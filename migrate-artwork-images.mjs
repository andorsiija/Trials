const SUPABASE_URL = process.env.SUPABASE_URL || 'https://iupypaqynuttqlvdpend.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const BUCKET = 'vicom-uploads';

const MIME_EXTENSIONS = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
  'image/svg+xml': 'svg',
};

if (!SERVICE_KEY) {
  console.error('Set SUPABASE_SERVICE_ROLE_KEY before running this migration.');
  process.exit(1);
}

const headers = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
};

async function awaitText(response) {
  try {
    return (await response.text()).slice(0, 300);
  } catch {
    return '';
  }
}

async function getLegacyIds() {
  const url = new URL('/rest/v1/artworks', SUPABASE_URL);
  url.searchParams.set('select', 'id');
  url.searchParams.set('image', 'like.data:image/*');
  url.searchParams.set('limit', '1000');
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(`Reading artwork ids failed (${response.status}): ${await awaitText(response)}`);
  return response.json();
}

async function getArtwork(id) {
  const url = new URL('/rest/v1/artworks', SUPABASE_URL);
  url.searchParams.set('select', 'id,image');
  url.searchParams.set('id', `eq.${id}`);
  url.searchParams.set('limit', '1');
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(`Reading ${id} failed (${response.status}): ${await awaitText(response)}`);
  const rows = await response.json();
  return rows[0] || null;
}

function parseDataUrl(value) {
  const match = /^data:([^;]+);base64,([\s\S]*)$/.exec(value || '');
  if (!match) throw new Error('Artwork image is not a base64 data URL.');
  const mime = match[1];
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length) throw new Error('Artwork image is empty.');
  return { mime, bytes, extension: MIME_EXTENSIONS[mime] || 'bin' };
}

async function uploadImage(path, bytes, mime) {
  const url = new URL(`/storage/v1/object/${BUCKET}/${path}`, SUPABASE_URL);
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      ...headers,
      'Content-Type': mime,
      'x-upsert': 'true',
      'cache-control': '3600',
    },
    body: bytes,
  });
  if (!response.ok) throw new Error(`Uploading ${path} failed (${response.status}): ${await awaitText(response)}`);
}

async function updateArtwork(id, imageUrl) {
  const url = new URL('/rest/v1/artworks', SUPABASE_URL);
  url.searchParams.set('id', `eq.${id}`);
  const response = await fetch(url, {
    method: 'PATCH',
    headers: {
      ...headers,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({ image: imageUrl }),
  });
  if (!response.ok) throw new Error(`Updating ${id} failed (${response.status}): ${await awaitText(response)}`);
}

const ids = await getLegacyIds();
console.log(`Found ${ids.length} artwork(s) with embedded images.`);

let migrated = 0;
for (const { id } of ids) {
  try {
    const artwork = await getArtwork(id);
    if (!artwork?.image?.startsWith('data:image/')) continue;

    const { mime, bytes, extension } = parseDataUrl(artwork.image);
    const path = `artworks/${id}.${extension}`;
    await uploadImage(path, bytes, mime);
    await updateArtwork(id, `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`);
    migrated += 1;
    console.log(`Migrated ${id} (${(bytes.length / 1024 / 1024).toFixed(2)} MB)`);
  } catch (error) {
    console.error(`Skipped ${id}: ${error.message}`);
  }
}

console.log(`Done. Migrated ${migrated} of ${ids.length} artwork(s).`);
