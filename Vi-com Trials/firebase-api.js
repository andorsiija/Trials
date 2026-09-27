import { auth, authStateReady, db } from './firebase-config.js';
import { friendlyAuthError, loginUser, registerUser, saveProfileChanges } from './Account functions/auth-service.js';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  increment,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch
} from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js';

const MAX_ARTWORK_IMAGE = 700000;
const MAX_COMMISSION_IMAGE = 150000;
const MAX_STAGE_DATA = 620000;
const MAX_ARTIST_RATE = 10000000;
const statusOrder = { pending: 0, active: 1, done: 2, declined: 3 };

function requireUser() {
  if (!auth.currentUser) throw new Error('Please sign in again to continue.');
  return auth.currentUser;
}

function iso(value) {
  return value?.toDate ? value.toDate().toISOString() : (value || null);
}

function formatArtwork(id, data) {
  return {
    id,
    artistId: data.artistId || '',
    artist: data.artist || 'Unknown artist',
    title: data.title || '',
    detail: data.detail || '',
    price: `₱${Number(data.price || 0).toFixed(2)}`,
    category: data.category || 'Original artwork',
    image: data.image || '',
    createdAt: iso(data.createdAt)
  };
}

function formatCommission(id, data) {
  return {
    ...data,
    id,
    createdAt: iso(data.createdAt),
    updatedAt: iso(data.updatedAt),
    currentStage: Number(data.currentStage || 0),
    stageStatus: data.stageStatus || [false, false, false, false, false],
    clientApproval: data.clientApproval || [false, false, false, false, false],
    stageData: data.stageData || Array.from({ length: 5 }, () => ({ uploads: [], note: null, comments: [] }))
  };
}

function response(data, status = 200) {
  const text = JSON.stringify(data);
  return { ok: status >= 200 && status < 300, status, json: async () => data, text: async () => text };
}

async function compressDataUrl(dataUrl, maxLength, maxDimension = 1600) {
  if (!dataUrl || dataUrl.length <= maxLength) return dataUrl;
  if (!/^data:image\//i.test(dataUrl)) throw new Error('Choose a valid image file.');

  const image = new Image();
  await new Promise((resolve, reject) => {
    image.onload = resolve;
    image.onerror = () => reject(new Error('Could not read that image file.'));
    image.src = dataUrl;
  });

  let scale = Math.min(1, maxDimension / Math.max(image.width, image.height));
  let quality = 0.82;
  for (let attempt = 0; attempt < 14; attempt += 1) {
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Image compression is unavailable in this browser.');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const result = canvas.toDataURL('image/jpeg', quality);
    if (result.length <= maxLength) return result;
    quality -= 0.08;
    if (quality < 0.42) {
      quality = 0.78;
      scale *= 0.78;
    }
  }
  throw new Error('This image is too large after compression. Try a smaller image.');
}

async function addNotification(userId, notification) {
  if (!userId) return;
  await addDoc(collection(db, 'users', userId, 'notifications'), {
    userId,
    type: notification.type || 'update',
    commissionId: notification.commissionId || '',
    text: notification.text || '',
    isRead: false,
    createdAt: serverTimestamp()
  });
}

async function getUser(id) {
  const snapshot = await getDoc(doc(db, 'users', id));
  if (!snapshot.exists()) return null;
  return { id, ...snapshot.data() };
}

async function getArtworks() {
  const snapshot = await getDocs(query(collection(db, 'artworks'), orderBy('createdAt', 'desc')));
  return snapshot.docs.map((item) => formatArtwork(item.id, item.data()));
}

async function getArtist(artistId, countView = true) {
  const ref = doc(db, 'users', artistId);
  if (countView && auth.currentUser?.uid !== artistId) {
    try { await updateDoc(ref, { profileViews: increment(1) }); } catch {}
  }
  const artist = await getUser(artistId);
  if (!artist || artist.role !== 'artist') throw new Error('Artist not found.');
  const snapshot = await getDocs(query(collection(db, 'artworks'), where('artistId', '==', artistId)));
  const artworks = snapshot.docs.map((item) => formatArtwork(item.id, item.data()));
  artworks.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  const ratesSnapshot = await getDocs(query(collection(db, 'artistRates'), where('artistId', '==', artistId)));
  const rates = ratesSnapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
  return {
    artist: {
      id: artistId,
      name: artist.name || '',
      role: artist.role,
      specialty: artist.specialty || '',
      description: artist.description || '',
      socialLink: artist.socialLink || '',
      profileViews: artist.profileViews || 0
    },
    artworks,
    rates
  };
}

async function saveArtistRate(data) {
  const currentUser = requireUser();
  const artist = await getUser(currentUser.uid);
  if (artist?.role !== 'artist') throw new Error('Only artist accounts can manage services.');

  const type = String(data.type || '').trim();
  const description = String(data.description || '').trim();
  const price = Number(data.price);
  if (!type || type.length > 60) throw new Error('Service type must be between 1 and 60 characters.');
  if (description.length > 400) throw new Error('Service details must be 400 characters or fewer.');
  if (!Number.isFinite(price) || price <= 0 || price > MAX_ARTIST_RATE) throw new Error('Enter a rate greater than 0 and no more than ₱10,000,000.');

  const fields = { type, description, price };
  if (data.id) {
    const rateRef = doc(db, 'artistRates', String(data.id));
    const existing = await getDoc(rateRef);
    if (!existing.exists() || existing.data().artistId !== currentUser.uid) throw new Error('Service not found.');
    await updateDoc(rateRef, fields);
    return { rate: { id: rateRef.id, artistId: currentUser.uid, ...fields } };
  }

  const created = await addDoc(collection(db, 'artistRates'), {
    artistId: currentUser.uid,
    ...fields,
    createdAt: serverTimestamp()
  });
  return { rate: { id: created.id, artistId: currentUser.uid, ...fields } };
}

async function deleteArtistRate(rateId) {
  const currentUser = requireUser();
  const rateRef = doc(db, 'artistRates', String(rateId || ''));
  const existing = await getDoc(rateRef);
  if (!existing.exists() || existing.data().artistId !== currentUser.uid) throw new Error('Service not found.');
  await deleteDoc(rateRef);
  return { status: 'deleted' };
}

async function getCommissions(userId, role) {
  const currentUser = requireUser();
  if (currentUser.uid !== userId) throw new Error('You can only view your own commissions.');
  const field = role === 'artist' ? 'artistId' : 'clientId';
  const snapshot = await getDocs(query(collection(db, 'commissions'), where(field, '==', userId)));
  return snapshot.docs.map((item) => formatCommission(item.id, item.data())).sort((a, b) => {
    const statusDifference = (statusOrder[a.status] ?? 4) - (statusOrder[b.status] ?? 4);
    return statusDifference || new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0);
  });
}

async function getCommission(id) {
  const snapshot = await getDoc(doc(db, 'commissions', id));
  if (!snapshot.exists()) throw new Error('Commission not found.');
  return formatCommission(snapshot.id, snapshot.data());
}

async function createCommission(data) {
  const currentUser = requireUser();
  if (currentUser.uid !== data.clientId) throw new Error('Sign in as the customer sending this request.');
  const artist = await getUser(data.artistId);
  const client = await getUser(data.clientId);
  if (!artist || artist.role !== 'artist') throw new Error('Artist not found.');
  if (!client || client.role !== 'customer') throw new Error('Customer account not found.');
  const referenceImage = await compressDataUrl(data.referenceImage || '', MAX_COMMISSION_IMAGE, 1000);
  const now = serverTimestamp();
  const initialStages = Array.from({ length: 5 }, () => ({ uploads: [], note: null, comments: [] }));
  const record = {
    artistId: data.artistId,
    clientId: data.clientId,
    artistName: artist.name || '',
    clientName: client.name || '',
    title: String(data.title || '').trim(),
    description: String(data.description || '').trim(),
    referenceImage,
    status: 'pending',
    currentStage: 0,
    stageStatus: [false, false, false, false, false],
    clientApproval: [false, false, false, false, false],
    stageData: initialStages,
    createdAt: now,
    updatedAt: now
  };
  if (!record.title) throw new Error('A commission title is required.');
  const created = await addDoc(collection(db, 'commissions'), record);
  await addNotification(data.artistId, {
    type: 'new_commission',
    commissionId: created.id,
    text: `${record.clientName} sent you a commission request: "${record.title}"`
  });
  return { id: created.id, status: 'pending' };
}

async function updateCommissionStatus({ id, status }) {
  const currentUser = requireUser();
  const commission = await getCommission(id);
  if (commission.artistId !== currentUser.uid || commission.status !== 'pending') throw new Error('This request can no longer be changed.');
  if (!['active', 'declined'].includes(status)) throw new Error('Invalid commission status.');
  await updateDoc(doc(db, 'commissions', id), { status, updatedAt: serverTimestamp() });
  const verb = status === 'active' ? 'accepted' : 'declined';
  await addNotification(commission.clientId, {
    type: status === 'active' ? 'commission_accepted' : 'commission_declined',
    commissionId: id,
    text: `${commission.artistName} ${verb} your commission request: "${commission.title}"`
  });
  return { status: 'updated' };
}

async function updateCommissionStage(data) {
  const currentUser = requireUser();
  const commission = await getCommission(data.id);
  const isArtist = commission.artistId === currentUser.uid;
  const isClient = commission.clientId === currentUser.uid;
  if (!isArtist && !isClient) throw new Error('You are not part of this commission.');

  const updates = { updatedAt: serverTimestamp() };
  if (data.stageData !== undefined) {
    if (!isArtist) throw new Error('Only the artist can update stage artwork and notes.');
    const stages = await Promise.all(data.stageData.map(async (stage) => ({
      ...stage,
      uploads: await Promise.all((stage.uploads || []).map(async (upload) => ({
        ...upload,
        src: await compressDataUrl(upload.src, MAX_COMMISSION_IMAGE, 1200)
      })))
    })));
    if (JSON.stringify(stages).length > MAX_STAGE_DATA) throw new Error('Too many images for one commission. Remove an image or use smaller files.');
    updates.stageData = stages;
  }
  if (data.stageStatus !== undefined) {
    const canUpdate = isArtist || (isClient && data.stageStatus.every((ready, index) => !ready || Boolean(commission.stageStatus[index])));
    if (!canUpdate) throw new Error('Only the artist can submit a stage for review.');
    updates.stageStatus = data.stageStatus;
  }
  if (data.clientApproval !== undefined || data.currentStage !== undefined || data.status === 'done') {
    if (!isClient) throw new Error('Only the customer can approve a stage.');
    if (data.clientApproval !== undefined) updates.clientApproval = data.clientApproval;
    if (data.currentStage !== undefined) updates.currentStage = data.currentStage;
    if (data.status === 'done') updates.status = 'done';
  }
  await updateDoc(doc(db, 'commissions', data.id), updates);
  if (data.notify) await addNotification(data.notify.userId, { ...data.notify, commissionId: data.id });
  return { status: 'updated' };
}

async function getMessages(commissionId) {
  await getCommission(commissionId);
  const snapshot = await getDocs(query(collection(db, 'commissions', commissionId, 'messages'), orderBy('createdAt', 'asc')));
  return snapshot.docs.map((item) => ({ id: item.id, ...item.data(), createdAt: iso(item.data().createdAt) }));
}

export async function listenForMessages(commissionId, onMessages, onError = () => {}) {
  await authStateReady;
  const currentUser = requireUser();
  const commission = await getCommission(commissionId);
  if (![commission.artistId, commission.clientId].includes(currentUser.uid)) {
    throw new Error('You are not part of this commission.');
  }

  const messagesQuery = query(
    collection(db, 'commissions', commissionId, 'messages'),
    orderBy('createdAt', 'asc')
  );
  return onSnapshot(messagesQuery, (snapshot) => {
    const messages = snapshot.docs.map((item) => ({
      id: item.id,
      ...item.data(),
      createdAt: iso(item.data().createdAt)
    }));
    onMessages(messages);

    const unread = snapshot.docs.filter((item) =>
      !item.data().isRead && item.data().senderId !== currentUser.uid
    );
    if (unread.length) {
      const batch = writeBatch(db);
      unread.forEach((item) => batch.update(item.ref, { isRead: true }));
      batch.commit().catch((error) => console.error('Could not mark incoming messages as read:', error));
    }
  }, onError);
}

async function sendMessage(data) {
  const currentUser = requireUser();
  const commission = await getCommission(data.commissionId);
  if (![commission.artistId, commission.clientId].includes(currentUser.uid)) throw new Error('You are not part of this commission.');
  const profile = await getUser(currentUser.uid);
  if (!data.message?.trim()) throw new Error('Message cannot be empty.');
  const created = await addDoc(collection(db, 'commissions', data.commissionId, 'messages'), {
    senderId: currentUser.uid,
    senderName: profile?.name || currentUser.displayName || currentUser.email,
    senderRole: profile?.role || 'customer',
    message: data.message.trim(),
    isRead: false,
    createdAt: serverTimestamp()
  });
  const recipientId = currentUser.uid === commission.artistId ? commission.clientId : commission.artistId;
  await addNotification(recipientId, {
    type: 'new_message',
    commissionId: data.commissionId,
    text: `${profile?.name || 'A participant'} sent a message on "${commission.title}"`
  });
  return { message: { id: created.id, status: 'sent' } };
}

async function markMessagesRead({ commissionId, userId }) {
  const currentUser = requireUser();
  if (currentUser.uid !== userId) throw new Error('You can only update your own messages.');
  const messages = await getMessages(commissionId);
  const batch = writeBatch(db);
  let changed = 0;
  messages.filter((message) => !message.isRead && message.senderId !== userId).forEach((message) => {
    batch.update(doc(db, 'commissions', commissionId, 'messages', message.id), { isRead: true });
    changed += 1;
  });
  if (changed) await batch.commit();
  return { status: 'marked' };
}

async function getNotifications(userId) {
  if (requireUser().uid !== userId) throw new Error('You can only view your notifications.');
  const snapshot = await getDocs(query(collection(db, 'users', userId, 'notifications'), orderBy('createdAt', 'desc'), limit(30)));
  return snapshot.docs.map((item) => ({ id: item.id, ...item.data(), createdAt: iso(item.data().createdAt) }));
}

async function markNotificationsRead(userId) {
  if (requireUser().uid !== userId) throw new Error('You can only update your notifications.');
  const snapshot = await getDocs(query(collection(db, 'users', userId, 'notifications'), where('isRead', '==', false)));
  const batch = writeBatch(db);
  snapshot.docs.forEach((item) => batch.update(item.ref, { isRead: true }));
  if (!snapshot.empty) await batch.commit();
  return { status: 'marked' };
}

async function dashboardCounts(userId, role) {
  const commissions = await getCommissions(userId, role);
  const notifications = await getNotifications(userId);
  let unreadMessages = 0;
  for (const commission of commissions) {
    const messages = await getMessages(commission.id);
    unreadMessages += messages.filter((message) => !message.isRead && message.senderId !== userId).length;
  }
  return {
    active: commissions.filter((item) => item.status === 'active').length,
    pending: commissions.filter((item) => item.status === 'pending').length,
    unreadMessages,
    notifications: notifications.filter((item) => !item.isRead).length
  };
}

async function dispatch(action, queryParams, body) {
  switch (action) {
    case 'register': return { user: await registerUser(body) };
    case 'login': return { user: await loginUser(body) };
    case 'profile': {
      const user = await getUser(queryParams.get('id'));
      if (!user) throw new Error('User not found.');
      if (auth.currentUser?.uid !== user.id && user.role !== 'artist') throw new Error('Profile not found.');
      if (auth.currentUser?.uid === user.id) user.email = auth.currentUser.email || '';
      return { user };
    }
    case 'update_profile': return { user: await saveProfileChanges(body.id, body) };
    case 'create_artwork': {
      const currentUser = requireUser();
      const profile = await getUser(currentUser.uid);
      if (profile?.role !== 'artist') throw new Error('Only artist accounts can publish artwork.');
      const image = await compressDataUrl(body.image, MAX_ARTWORK_IMAGE);
      const artwork = {
        artistId: currentUser.uid,
        artist: profile.name || '',
        title: String(body.title || '').trim(),
        detail: body.detail || '',
        price: Number(body.price) || 0,
        category: body.category || '',
        image,
        createdAt: serverTimestamp()
      };
      if (!artwork.title || !artwork.category || !artwork.image || artwork.price <= 0) throw new Error('Artwork title, category, image, and price are required.');
      const created = await addDoc(collection(db, 'artworks'), artwork);
      return { status: 'created', id: created.id };
    }
    case 'artworks': return { artworks: await getArtworks() };
    case 'artist': return getArtist(queryParams.get('id'));
    case 'save_artist_rate': return saveArtistRate(body);
    case 'delete_artist_rate': return deleteArtistRate(body.id);
    case 'artist_stats': {
      const artist = await getUser(queryParams.get('id'));
      if (!artist || artist.role !== 'artist') throw new Error('Artist not found.');
      return { profileViews: artist.profileViews || 0 };
    }
    case 'create_commission': return { commission: await createCommission(body) };
    case 'commissions': return { commissions: await getCommissions(queryParams.get('userId'), queryParams.get('role')) };
    case 'commission': return { commission: await getCommission(queryParams.get('id')) };
    case 'update_commission_status': return updateCommissionStatus(body);
    case 'update_commission_stage': return updateCommissionStage(body);
    case 'messages': return { messages: await getMessages(queryParams.get('commissionId')) };
    case 'send_message': return sendMessage(body);
    case 'mark_messages_read': return markMessagesRead(body);
    case 'dashboard_counts': return dashboardCounts(queryParams.get('userId'), queryParams.get('role'));
    case 'notifications': return { notifications: await getNotifications(queryParams.get('userId')) };
    case 'mark_notifications_read': return markNotificationsRead(body.userId);
    default: throw new Error('Unknown Firebase data action.');
  }
}

export async function apiFetch(input, options = {}) {
  const url = new URL(input, window.location.href);
  const action = url.searchParams.get('action') || '';
  let body = {};
  try { body = options.body ? JSON.parse(options.body) : {}; } catch {}
  try {
    await authStateReady;
    return response(await dispatch(action, url.searchParams, body));
  } catch (error) {
    console.error(`Firebase action ${action} failed:`, error);
    return response({ error: friendlyAuthError(error) }, 400);
  }
}

export function compressArtworkImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read that image file.'));
    reader.onload = async () => {
      try { resolve(await compressDataUrl(reader.result, MAX_ARTWORK_IMAGE)); }
      catch (error) { reject(error); }
    };
    reader.readAsDataURL(file);
  });
}