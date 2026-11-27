import { supabase } from './supabase-config.js';

const sessionKey = 'vicom-session';
const ADMIN_EMAIL = '23100335@spcba.edu.ph';

function response(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function fail(error, status = 400) {
  throw Object.assign(new Error(error?.message || String(error)), { status });
}

function unwrap(result) {
  if (result.error) fail(result.error);
  return result.data;
}

function readStoredSession() {
  try {
    return JSON.parse(localStorage.getItem(sessionKey) || 'null');
  } catch {
    return null;
  }
}

async function currentUser() {
  try {
    const { data, error } = await supabase.auth.getUser();
    if (!error && data?.user) return data.user;
  } catch {
    // Fall back to the saved session below when the auth request is unavailable.
  }

  const storedSession = readStoredSession();
  if (storedSession?.userId) {
    return {
      id: storedSession.userId,
      email: storedSession.email || '',
    };
  }

  fail('Sign in to continue.', 401);
}

async function currentProfile() {
  try {
    const user = await currentUser();
    const profile = await clearExpiredSuspension(unwrap(await supabase.from('profiles').select('*').eq('id', user.id).single()));
    return { user: { ...user, ...profile }, profile };
  } catch (error) {
    const storedSession = readStoredSession();
    if (!storedSession?.userId) throw error;

    const profile = await clearExpiredSuspension(unwrap(await supabase.from('profiles').select('*').eq('id', storedSession.userId).single()));
    return {
      user: {
        id: storedSession.userId,
        email: storedSession.email || profile.email || '',
        ...profile,
      },
      profile,
    };
  }
}

async function loadProfileNames(ids = []) {
  const uniqueIds = [...new Set(ids.filter(Boolean))];
  if (!uniqueIds.length) return {};
  const profiles = unwrap(await supabase.from('profiles').select('id,name').in('id', uniqueIds));
  return Object.fromEntries(profiles.map((profile) => [profile.id, profile.name || 'Unknown']));
}

async function loadAdminProfileNames(ids = []) {
  const uniqueIds = [...new Set(ids.filter(Boolean))];
  if (!uniqueIds.length) return {};
  const viaRpc = await supabase.rpc('admin_profile_names', { ids: uniqueIds });
  if (!viaRpc.error) {
    const rows = Array.isArray(viaRpc.data) ? viaRpc.data : [];
    return Object.fromEntries(rows.map((row) => [row.id, row.name || 'Unknown']));
  }
  return loadProfileNames(uniqueIds);
}

function hasActiveSuspension(profile) {
  if (!profile || !profile.isSuspended) return false;
  if (!profile.suspensionUntil) return true;
  const expiry = new Date(profile.suspensionUntil);
  if (Number.isNaN(expiry.getTime())) return true;
  return expiry.getTime() > Date.now();
}

async function clearExpiredSuspension(profile) {
  if (!profile || !profile.isSuspended || !profile.suspensionUntil) return profile;
  const expiry = new Date(profile.suspensionUntil);
  if (Number.isNaN(expiry.getTime()) || expiry.getTime() > Date.now()) return profile;

  try {
    const cleared = unwrap(await supabase.from('profiles').update({
      isSuspended: false,
      suspensionReason: '',
      suspensionUntil: null,
    }).eq('id', profile.id).select('*').single());
    return { ...profile, ...cleared, isSuspended: false, suspensionReason: '', suspensionUntil: null };
  } catch {
    // The RLS-restricted caller may not be able to persist the cleanup; the
    // suspension has already expired, so treat the artist as available.
    return { ...profile, isSuspended: false, suspensionReason: '', suspensionUntil: null };
  }
}

function ensureArtistAvailable(profile, context) {
  if (!profile || profile.role !== 'artist') return;
  if (hasActiveSuspension(profile)) {
    fail(`This artist account is suspended and cannot ${context} until the suspension is lifted.`, 403);
  }
}

const ARTWORK_LIST_FIELDS = 'id,artistId,artist,title,detail,price,category,createdAt';

function currency(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 1) return 'Price on request';
  return `₱${numeric.toFixed(2)}`;
}

async function loadArtworkImages(scope = {}) {
  let urlQuery = supabase.from('artworks').select('id,image').not('image', 'like', 'data:image/%');
  let legacyQuery = supabase.from('artworks').select('id').like('image', 'data:image/%');
  if (scope.ids) {
    urlQuery = urlQuery.in('id', scope.ids);
    legacyQuery = legacyQuery.in('id', scope.ids);
  }
  if (scope.artistId) {
    urlQuery = urlQuery.eq('artistId', scope.artistId);
    legacyQuery = legacyQuery.eq('artistId', scope.artistId);
  }
  const [urlResult, legacyResult] = await Promise.all([urlQuery, legacyQuery]);
  const urls = unwrap(urlResult);
  const legacy = unwrap(legacyResult);
  return {
    images: new Map(urls.map((row) => [row.id, row.image || ''])),
    legacy: new Set(legacy.map((row) => row.id)),
  };
}

function decorateArtwork(row, images, legacy) {
  return {
    ...row,
    image: images.get(row.id) || '',
    legacyImage: legacy.has(row.id),
    price: currency(row.price),
  };
}

async function loadArtworks() {
  const rows = unwrap(await supabase.from('artworks').select(ARTWORK_LIST_FIELDS).order('createdAt', { ascending: false }));
  const { images, legacy } = await loadArtworkImages();
  const artistIds = [...new Set(rows.map((row) => row.artistId))];
  const artists = artistIds.length
    ? unwrap(await supabase.from('profiles').select('id,name').in('id', artistIds))
    : [];
  const names = new Map(artists.map((artist) => [artist.id, artist.name]));
  return rows.map((row) => ({
    ...decorateArtwork(row, images, legacy),
    artist: row.artist || names.get(row.artistId) || 'Artist',
  }));
}

async function fetchArtistRecord(artistId) {
  const viaRpc = await supabase.rpc('get_artist_profile', { target_id: artistId });
  if (!viaRpc.error) {
    const row = Array.isArray(viaRpc.data) ? viaRpc.data[0] : viaRpc.data;
    if (row) return row;
  }
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', artistId)
    .eq('role', 'artist')
    .maybeSingle();
  if (error) fail(error);
  return data;
}

async function loadArtist(artistId) {
  let artist = await fetchArtistRecord(artistId);
  if (!artist) fail('Artist profile not found.', 404);
  const [artworks, rates] = await Promise.all([
    supabase.from('artworks').select(ARTWORK_LIST_FIELDS).eq('artistId', artistId).order('createdAt', { ascending: false }),
    supabase.from('artistRates').select('*').eq('artistId', artistId).order('createdAt', { ascending: true }),
  ]);
  const { images, legacy } = await loadArtworkImages({ artistId });
  return {
    artist,
    artworks: unwrap(artworks).map((work) => decorateArtwork(work, images, legacy)),
    rates: unwrap(rates),
  };
}

async function loadCommissions(role) {
  const { user, profile } = await currentProfile();
  const column = role === 'artist' ? 'artistId' : 'clientId';
  if (profile.role !== role && !(role === 'customer' && profile.role === 'customer')) fail('You cannot access these commissions.', 403);
  const rows = unwrap(await supabase.from('commissions').select('*').eq(column, user.id).order('updatedAt', { ascending: false }));
  const order = { pending: 0, active: 1, done: 2, declined: 3 };
  return rows.sort((left, right) => order[left.status] - order[right.status]);
}

async function createNotification(notification) {
  if (!notification?.userId || !notification?.type || !notification?.text) return;
  unwrap(await supabase.from('notifications').insert({
    userId: notification.userId,
    type: notification.type,
    commissionId: notification.commissionId || null,
    text: notification.text,
  }));
}

async function loadMyReportsAgainst(userId) {
  const viaRpc = await supabase.rpc('my_reports_against');
  if (!viaRpc.error) return Array.isArray(viaRpc.data) ? viaRpc.data : [];
  return unwrap(await supabase.from('reports').select('id,type,reason,status,"createdAt"').eq('reportedId', userId).order('createdAt', { ascending: false }));
}

async function loadMyReportsMade(userId) {
  const viaRpc = await supabase.rpc('my_reports_made');
  if (!viaRpc.error) return Array.isArray(viaRpc.data) ? viaRpc.data : [];
  return unwrap(await supabase.from('reports').select('id,type,reason,status,"createdAt"').eq('reporterId', userId).order('createdAt', { ascending: false }));
}

async function dispatch(action, params, body) {
  if (action === 'register') {
    const { email, password, name, role, specialty = '' } = body;
    const normalizedRole = role === 'artist' ? 'artist' : 'customer';
    const result = unwrap(await supabase.auth.signUp({
      email,
      password,
      options: { data: { name, role: normalizedRole, specialty } },
    }));

    return {
      user: {
        id: result.user.id,
        email,
        name,
        role: normalizedRole,
        specialty,
        emailVerificationSent: !result.session,
      },
    };
  }

  if (action === 'login') {
    const { email, password } = body;
    const result = unwrap(await supabase.auth.signInWithPassword({ email, password }));
    const profile = unwrap(await supabase.from('profiles').select('*').eq('id', result.user.id).single());
    return { user: { ...profile, email: result.user.email } };
  }

  if (action === 'artworks') return { artworks: await loadArtworks() };

  if (action === 'artwork_image') {
    const id = params.get('id');
    if (!id) fail('Artwork id is required.', 422);
    const row = unwrap(await supabase.from('artworks').select('id,image').eq('id', id).maybeSingle());
    if (!row) fail('Artwork not found.', 404);
    return { id: row.id, image: row.image || '' };
  }

  if (action === 'create_artwork') {
    const { user, profile } = await currentProfile();
    if (profile.role !== 'artist') fail('Only artist accounts can publish artwork.', 403);
    const liveProfile = await clearExpiredSuspension(unwrap(await supabase.from('profiles').select('*').eq('id', user.id).single()));
    ensureArtistAvailable(liveProfile, 'publish artwork');
    unwrap(await supabase.from('artworks').insert({ ...body, artistId: user.id }));
    return { status: 'created' };
  }

  if (action === 'delete_artwork') {
    const { user, profile } = await currentProfile();
    if (profile.role !== 'artist') fail('Only artist accounts can remove artwork.', 403);
    if (!body.id) fail('Artwork id is required.', 422);
    unwrap(await supabase.from('artworks').delete().eq('id', body.id).eq('artistId', user.id));
    return { status: 'deleted' };
  }

  if (action === 'artist') {
    const artistId = params.get('id');
    if (!artistId) fail('Artist id is required.', 422);
    unwrap(await supabase.rpc('increment_artist_views', { target_id: artistId }));
    return loadArtist(artistId);
  }

  if (action === 'artist_stats') {
    const artist = unwrap(await supabase.from('profiles').select('profileViews').eq('id', params.get('id')).eq('role', 'artist').single());
    return artist;
  }

  if (action === 'profile') {
    const { user } = await currentProfile();
    const id = params.get('id');
    if (id !== user.id) fail('You can only read your own profile here.', 403);
    return { user: { ...unwrap(await supabase.from('profiles').select('*').eq('id', id).single()), email: user.email } };
  }

  if (action === 'update_profile') {
    const { user } = await currentProfile();
    const updates = {};
    for (const key of ['name', 'specialty', 'description', 'socialLink', 'profilePicture', 'gcashNumber', 'gcashName']) {
      if (body[key] !== undefined) updates[key] = body[key];
    }
    const authUpdates = {};
    if (body.email && body.email !== user.email) authUpdates.email = body.email;
    if (body.password) authUpdates.password = body.password;
    let email = user.email;
    if (Object.keys(authUpdates).length) {
      const updatedAuth = unwrap(await supabase.auth.updateUser(authUpdates));
      email = updatedAuth.user.email;
    }
    const profile = Object.keys(updates).length
      ? unwrap(await supabase.from('profiles').update(updates).eq('id', user.id).select('*').single())
      : unwrap(await supabase.from('profiles').select('*').eq('id', user.id).single());
    return { user: { ...profile, email } };
  }

  if (action === 'artist_rates') {
    const result = unwrap(await supabase.from('artistRates').select('*').eq('artistId', params.get('id')).order('createdAt'));
    return { rates: result };
  }

  if (action === 'save_artist_rate') {
    const { user, profile } = await currentProfile();
    if (profile.role !== 'artist') fail('Only artists can manage rates.', 403);
    const values = { type: body.type, description: body.description || '', price: Number(body.price) };
    const result = body.id
      ? await supabase.from('artistRates').update(values).eq('id', body.id).eq('artistId', user.id).select('*').single()
      : await supabase.from('artistRates').insert({ ...values, artistId: user.id }).select('*').single();
    return { rate: unwrap(result) };
  }

  if (action === 'delete_artist_rate') {
    const { user } = await currentProfile();
    unwrap(await supabase.from('artistRates').delete().eq('id', body.id).eq('artistId', user.id));
    return { status: 'deleted' };
  }

  if (action === 'create_commission') {
    const { user, profile } = await currentProfile();
    if (profile.role !== 'customer') fail('Sign in as a customer to request a commission.', 403);
    if (hasActiveSuspension(profile)) fail('Your account is suspended and cannot request commissions until the suspension is lifted.', 403);
    const artist = await clearExpiredSuspension(await fetchArtistRecord(body.artistId));
    if (!artist) fail('Artist profile not found.', 404);
    if (hasActiveSuspension(artist)) fail('This artist is currently suspended and cannot accept new commissions until the suspension is lifted.', 403);
    const commission = unwrap(await supabase.from('commissions').insert({
      id: body.id || crypto.randomUUID(),
      artistId: artist.id,
      clientId: user.id,
      artistName: artist.name,
      clientName: profile.name,
      title: body.title,
      description: body.description || '',
      referenceImage: body.referenceImage || '',
    }).select('id,status').single());
    await createNotification({
      userId: artist.id,
      commissionId: commission.id,
      type: 'new_commission',
      text: `${profile.name} sent you a commission request: "${body.title}"`,
    });
    return { commission };
  }

  if (action === 'commissions') {
    return { commissions: await loadCommissions(params.get('role')) };
  }

  if (action === 'commission') {
    return { commission: unwrap(await supabase.from('commissions').select('*').eq('id', params.get('id')).single()) };
  }

  if (action === 'update_commission_status') {
    const { user, profile } = await currentProfile();
    if (profile.role !== 'artist') fail('Only artists can accept or decline commission requests.', 403);
    const liveProfile = await clearExpiredSuspension(unwrap(await supabase.from('profiles').select('*').eq('id', user.id).single()));
    ensureArtistAvailable(liveProfile, 'accept or decline commission requests');
    const commission = unwrap(await supabase.from('commissions').update({ status: body.status }).eq('id', body.id).eq('artistId', user.id).select('*').single());
    const accepted = body.status === 'active';
    await createNotification({
      userId: commission.clientId,
      commissionId: commission.id,
      type: accepted ? 'commission_accepted' : 'commission_declined',
      text: `${commission.artistName} ${accepted ? 'accepted' : 'declined'} your commission request: "${commission.title}"`,
    });
    return { status: 'updated' };
  }

  if (action === 'update_commission_stage') {
    const { user } = await currentProfile();
    const updates = {};
    for (const key of ['currentStage', 'stageStatus', 'clientApproval', 'stageData', 'status']) {
      if (body[key] !== undefined) updates[key] = body[key];
    }
    if (!Object.keys(updates).length) fail('Nothing to update.', 422);
    unwrap(await supabase.from('commissions').update(updates).eq('id', body.id).select('id').single());
    if (body.notify) await createNotification({ ...body.notify, commissionId: body.id });
    return { status: 'updated' };
  }

  if (action === 'messages') {
    const result = unwrap(await supabase.from('commission_messages').select('*').eq('commissionId', params.get('commissionId')).order('createdAt'));
    return { messages: result };
  }

  if (action === 'send_message') {
    const { user, profile } = await currentProfile();
    if (body.senderId !== user.id) fail('Message sender does not match your signed-in account.', 403);
    if (hasActiveSuspension(profile)) fail('Your account is suspended and cannot send messages until the suspension is lifted.', 403);
    const message = unwrap(await supabase.from('commission_messages').insert({
      commissionId: body.commissionId,
      senderId: user.id,
      senderName: profile.name,
      senderRole: profile.role,
      message: body.message,
    }).select('id').single());
    const commission = unwrap(await supabase.from('commissions').select('*').eq('id', body.commissionId).single());
    await createNotification({
      userId: profile.role === 'artist' ? commission.clientId : commission.artistId,
      commissionId: commission.id,
      type: 'new_message',
      text: `${profile.name} sent a message on "${commission.title}"`,
    });
    return { message: { ...message, status: 'sent' } };
  }

  if (action === 'mark_messages_read') {
    const { user } = await currentProfile();
    unwrap(await supabase.from('commission_messages').update({ isRead: true })
      .eq('commissionId', body.commissionId).neq('senderId', user.id).eq('isRead', false));
    return { status: 'marked' };
  }

  if (action === 'dashboard_counts') {
    const { user, profile } = await currentProfile();
    const column = profile.role === 'artist' ? 'artistId' : 'clientId';
    const commissions = unwrap(await supabase.from('commissions').select('id,status').eq(column, user.id));
    const commissionIds = commissions.map((item) => item.id);
    const [messagesResult, notificationsResult] = await Promise.all([
      commissionIds.length
        ? supabase.from('commission_messages').select('id', { count: 'exact', head: true }).in('commissionId', commissionIds).neq('senderId', user.id).eq('isRead', false)
        : Promise.resolve({ count: 0, error: null }),
      supabase.from('notifications').select('id', { count: 'exact', head: true }).eq('userId', user.id).eq('isRead', false),
    ]);
    if (messagesResult.error) fail(messagesResult.error);
    if (notificationsResult.error) fail(notificationsResult.error);
    return {
      active: commissions.filter((item) => item.status === 'active').length,
      pending: commissions.filter((item) => item.status === 'pending').length,
      unreadMessages: messagesResult.count || 0,
      notifications: notificationsResult.count || 0,
    };
  }

  if (action === 'notifications') {
    const { user } = await currentProfile();
    if (params.get('userId') !== user.id) fail('You can only read your own notifications.', 403);
    return { notifications: unwrap(await supabase.from('notifications').select('*').eq('userId', user.id).order('createdAt', { ascending: false }).limit(30)) };
  }

  if (action === 'mark_notifications_read') {
    const { user } = await currentProfile();
    if (body.userId !== user.id) fail('You can only update your own notifications.', 403);
    unwrap(await supabase.from('notifications').update({ isRead: true }).eq('userId', user.id).eq('isRead', false));
    return { status: 'marked' };
  }

  if (action === 'admin_reports') {
    const { user, profile } = await currentProfile();
    if (user.email !== ADMIN_EMAIL && profile.role !== 'admin') fail('Admin access required', 403);
    const reports = unwrap(await supabase.from('reports').select('*').order('createdAt', { ascending: false }));
    const reporterNames = await loadAdminProfileNames(reports.map((report) => report.reporterId));
    const reportedNames = await loadAdminProfileNames(reports.map((report) => report.reportedId));
    return {
      reports: reports.map((report) => ({
        ...report,
        reporterName: reporterNames[report.reporterId] || 'Unknown',
        reportedName: reportedNames[report.reportedId] || 'Unknown',
      })),
    };
  }

  if (action === 'admin_artists') {
    const { user, profile } = await currentProfile();
    if (user.email !== ADMIN_EMAIL && profile.role !== 'admin') fail('Admin access required', 403);
    const artists = unwrap(await supabase.from('profiles').select('*').eq('role', 'artist').order('createdAt', { ascending: false }));
    return { artists };
  }

  if (action === 'admin_users') {
    const { user, profile } = await currentProfile();
    if (user.email !== ADMIN_EMAIL && profile.role !== 'admin') fail('Admin access required', 403);

    const viaRpc = await supabase.rpc('admin_list_users');
    if (!viaRpc.error) {
      const rows = viaRpc.data || [];
      const ids = rows.map((row) => row.id).filter(Boolean);
      let profiles = [];
      if (ids.length) {
        try {
          profiles = unwrap(await supabase.from('profiles').select('*').in('id', ids));
        } catch {
          profiles = [];
        }
      }
      const profileMap = new Map(profiles.map((item) => [item.id, item]));
      return { users: rows.map((row) => ({ ...row, ...(profileMap.get(row.id) || {}) })) };
    }

    const allUsers = unwrap(await supabase.from('profiles').select('*').order('createdAt', { ascending: false }));
    const users = allUsers.filter((item) => {
      const role = String(item.role || '').toLowerCase();
      return role === 'customer' || role === 'user';
    });
    return { users };
  }

  if (action === 'update_report_status') {
    const { user, profile } = await currentProfile();
    if (user.email !== ADMIN_EMAIL && profile.role !== 'admin') fail('Admin access required', 403);
    const { reportId, status } = body;
    unwrap(await supabase.from('reports').update({ status, reviewedAt: new Date().toISOString(), reviewedBy: user.id }).eq('id', reportId));
    return { status: 'updated' };
  }

  if (action === 'suspend_artist') {
    const { user, profile } = await currentProfile();
    if (user.email !== ADMIN_EMAIL && profile.role !== 'admin') fail('Admin access requir ed', 403);
    const { artistId, reason, days } = body;
    const validDays = Number(days || 0);
    const suspensionDays = Number.isFinite(validDays) && validDays > 0 ? validDays : 0;
    const suspensionUntil = suspensionDays > 0 ? new Date(Date.now() + suspensionDays * 24 * 60 * 60 * 1000).toISOString() : null;
    const result = unwrap(await supabase.rpc('set_artist_suspension', {
      target_artist_id: artistId,
      suspend: true,
      reason: reason || '',
      suspension_until: suspensionUntil,
    }));
    return { status: 'suspended', suspensionDays, suspensionUntil, artist: result };
  }

  if (action === 'unsuspend_artist') {
    const { user, profile } = await currentProfile();
    if (user.email !== ADMIN_EMAIL && profile.role !== 'admin') fail('Admin access required', 403);
    const { artistId } = body;
    const result = unwrap(await supabase.rpc('set_artist_suspension', {
      target_artist_id: artistId,
      suspend: false,
      reason: '',
      suspension_until: null,
    }));
    return { status: 'unsuspended', artist: result };
  }

  if (action === 'suspend_user') {
    const { user, profile } = await currentProfile();
    if (user.email !== ADMIN_EMAIL && profile.role !== 'admin') fail('Admin access required', 403);
    const { userId, reason, days } = body;
    const validDays = Number(days || 0);
    const suspensionDays = Number.isFinite(validDays) && validDays > 0 ? validDays : 0;
    const suspensionUntil = suspensionDays > 0 ? new Date(Date.now() + suspensionDays * 24 * 60 * 60 * 1000).toISOString() : null;
    const result = unwrap(await supabase.rpc('set_user_suspension', {
      target_user_id: userId,
      suspend: true,
      reason: reason || '',
      suspension_until: suspensionUntil,
    }));
    return { status: 'suspended', suspensionDays, suspensionUntil, user: result };
  }

  if (action === 'unsuspend_user') {
    const { user, profile } = await currentProfile();
    if (user.email !== ADMIN_EMAIL && profile.role !== 'admin') fail('Admin access required', 403);
    const { userId } = body;
    const result = unwrap(await supabase.rpc('set_user_suspension', {
      target_user_id: userId,
      suspend: false,
      reason: '',
      suspension_until: null,
    }));
    return { status: 'unsuspended', user: result };
  }

  if (action === 'create_report') {
    const { user } = await currentProfile();
    const { reportedId, type, reason, commissionId, messageId } = body;
    if (user.id === reportedId) fail('Cannot report yourself', 422);
    unwrap(await supabase.from('reports').insert({
      reporterId: user.id,
      reportedId,
      type,
      reason,
      commissionId: commissionId || null,
      messageId: messageId || null,
    }));
    return { status: 'reported' };
  }

  if (action === 'my_reports') {
    const { user } = await currentProfile();
    const reports = await loadMyReportsMade(user.id);
    return {
      reports: reports.map((report) => ({
        id: report.id,
        type: report.type,
        reason: report.reason,
        status: report.status,
        createdAt: report.createdAt || report.created_at || null,
      })),
    };
  }

  if (action === 'create_appeal') {
    const { user, profile } = await currentProfile();
    const type = body.type === 'report' ? 'report' : body.type === 'suspension' ? 'suspension' : '';
    if (!type) fail('Choose what you are appealing.', 422);
    const message = String(body.message || '').trim();
    if (message.length < 10) fail('Describe your appeal in at least 10 characters.', 422);

    let reportId = null;
    if (type === 'report') {
      reportId = body.reportId || null;
      if (!reportId) fail('Choose the report you are appealing.', 422);
      const reports = await loadMyReportsAgainst(user.id);
      if (!reports.some((report) => report.id === reportId)) {
        fail('You can only appeal reports filed against your account.', 403);
      }
    } else if (!hasActiveSuspension(profile)) {
      fail('You can only appeal an active suspension.', 422);
    }

    let pending = supabase.from('appeals').select('id').eq('userId', user.id).eq('type', type).eq('status', 'pending');
    pending = reportId ? pending.eq('reportId', reportId) : pending.is('reportId', null);
    const existing = unwrap(await pending);
    if (existing?.length) {
      fail('You already have a pending appeal for this. Please wait for the admin to review it.', 409);
    }

    const appeal = unwrap(await supabase.from('appeals').insert({
      userId: user.id,
      userRole: profile.role || '',
      type,
      reportId,
      message,
      status: 'pending',
    }).select('*').single());
    return { appeal };
  }

  if (action === 'my_appeals') {
    const { user } = await currentProfile();
    const appeals = unwrap(await supabase.from('appeals').select('*').eq('userId', user.id).order('createdAt', { ascending: false }));
    return { appeals };
  }

  if (action === 'admin_appeals') {
    const { user, profile } = await currentProfile();
    if (user.email !== ADMIN_EMAIL && profile.role !== 'admin') fail('Admin access required', 403);
    const appeals = unwrap(await supabase.from('appeals').select('*').order('createdAt', { ascending: false }));
    const names = await loadAdminProfileNames(appeals.map((appeal) => appeal.userId));
    const reportIds = [...new Set(appeals.map((appeal) => appeal.reportId).filter(Boolean))];
    let reportMap = {};
    if (reportIds.length) {
      const reports = unwrap(await supabase.from('reports').select('id,type,reason,status').in('id', reportIds));
      reportMap = Object.fromEntries(reports.map((report) => [report.id, report]));
    }
    return {
      appeals: appeals.map((appeal) => ({
        ...appeal,
        userName: names[appeal.userId] || 'Unknown',
        report: appeal.reportId ? reportMap[appeal.reportId] || null : null,
      })),
    };
  }

  if (action === 'update_appeal_status') {
    const { user, profile } = await currentProfile();
    if (user.email !== ADMIN_EMAIL && profile.role !== 'admin') fail('Admin access required', 403);
    const { appealId, status, adminNote = '' } = body;
    if (!['pending', 'accepted', 'rejected'].includes(status)) fail('Invalid appeal status.', 422);

    const appeal = unwrap(await supabase.from('appeals').update({
      status,
      adminNote: String(adminNote || ''),
      resolvedAt: status === 'pending' ? null : new Date().toISOString(),
      resolvedBy: status === 'pending' ? null : user.id,
    }).eq('id', appealId).select('*').single());

    if (status === 'accepted' && appeal.type === 'suspension') {
      try {
        const target = unwrap(await supabase.from('profiles').select('role').eq('id', appeal.userId).single());
        if (target.role === 'artist') {
          await supabase.rpc('set_artist_suspension', {
            target_artist_id: appeal.userId,
            suspend: false,
            reason: '',
            suspension_until: null,
          });
        } else {
          await supabase.rpc('set_user_suspension', {
            target_user_id: appeal.userId,
            suspend: false,
            reason: '',
            suspension_until: null,
          });
        }
      } catch {
        // The appeal stays accepted even if the suspension was already lifted.
      }
    }

    return { appeal };
  }

  if (action === 'set_commission_price') {
    const { user, profile } = await currentProfile();
    const { commissionId, price } = body;
    if (!commissionId || !Number.isFinite(price) || price < 100) {
      fail('Valid commission ID and price (minimum ₱100) are required', 422);
    }

    const commission = unwrap(await supabase.from('commissions').select('*').eq('id', commissionId).single());
    if (profile.role !== 'artist' || commission.artistId !== user.id) {
      fail('Only the artist can set the commission price.', 403);
    }

    const updated = unwrap(await supabase.from('commissions').update({
      agreedPrice: price
    }).eq('id', commissionId).select('*').single());

    const notifyUserId = commission.artistId === user.id ? commission.clientId : commission.artistId;
    unwrap(await supabase.from('notifications').insert({
      userId: notifyUserId,
      type: 'price_set',
      commissionId: commissionId,
      text: `Commission price set to ₱${price.toLocaleString()} for "${commission.title}"`,
    }));

    return { commission: updated };
  }

  if (action === 'submit_payment') {
    const { user } = await currentProfile();
    const { commissionId, paymentType, amount, proofImage, gcashNumber, gcashName } = body;
    
    if (!commissionId || !paymentType || !amount || !proofImage) {
      fail('Missing required payment information', 422);
    }

    const commission = unwrap(await supabase.from('commissions').select('*').eq('id', commissionId).single());
    
    if (commission.clientId !== user.id) {
      fail('Only the client can submit payment', 403);
    }

    if (paymentType === 'half_payment' && commission.paymentStatus !== 'unpaid') {
      fail('Half payment already completed', 422);
    }

    if (paymentType === 'final_payment' && commission.paymentStatus !== 'half_paid') {
      fail('Half payment must be completed first', 422);
    }

    const payment = unwrap(await supabase.from('payments').insert({
      commissionId: commissionId,
      payerId: user.id,
      receiverId: commission.artistId,
      amount: amount,
      paymentType: paymentType,
      status: 'completed',
      gcashNumber: gcashNumber || '',
      gcashName: gcashName || '',
      proofImage: proofImage,
    }).select('*').single());

    const newPaymentStatus = paymentType === 'half_payment' ? 'half_paid' : 'fully_paid';
    unwrap(await supabase.from('commissions').update({
      paymentStatus: newPaymentStatus
    }).eq('id', commissionId));

    unwrap(await supabase.from('notifications').insert({
      userId: commission.artistId,
      type: 'payment_received',
      commissionId: commissionId,
      text: `Payment of ₱${amount.toLocaleString()} received for "${commission.title}"`,
    }));

    return { payment, status: 'success' };
  }

  if (action === 'get_payments') {
    const { user } = await currentProfile();
    const commissionId = params.get('commissionId');
    
    if (!commissionId) fail('Commission ID required', 422);

    const commission = unwrap(await supabase.from('commissions').select('*').eq('id', commissionId).single());
    
    if (commission.artistId !== user.id && commission.clientId !== user.id) {
      fail('Access denied', 403);
    }

    const payments = unwrap(await supabase.from('payments').select('*').eq('commissionId', commissionId).order('createdAt'));

    return { payments };
  }

  if (action === 'artist_payments') {
    const { user, profile } = await currentProfile();
    if (profile.role !== 'artist') fail('Only artists can view earnings.', 403);

    const payments = unwrap(await supabase.from('payments')
      .select('id,commissionId,payerId,receiverId,amount,paymentType,status,createdAt')
      .eq('receiverId', user.id)
      .order('createdAt', { ascending: false }));

    const commissionIds = [...new Set(payments.map((payment) => payment.commissionId).filter(Boolean))];
    const commissions = commissionIds.length
      ? unwrap(await supabase.from('commissions').select('id,title').in('id', commissionIds))
      : [];
    const titles = new Map(commissions.map((commission) => [commission.id, commission.title]));
    const names = await loadProfileNames(payments.map((payment) => payment.payerId));

    return {
      payments: payments.map((payment) => ({
        ...payment,
        commissionTitle: titles.get(payment.commissionId) || 'Commission',
        clientName: names[payment.payerId] || 'Client',
      })),
    };
  }

  // ===== SAVE ARTWORK FUNCTIONALITY =====
  if (action === 'save_artwork') {
    const { user } = await currentProfile();
    if (!body.artworkId) fail('Artwork ID required.', 422);

    const existing = await supabase
      .from('saved_artworks')
      .select('id')
      .eq('userId', user.id)
      .eq('artworkId', body.artworkId)
      .maybeSingle();

    if (!existing.error && existing.data) return { status: 'already_saved' };

    const result = await supabase
      .from('saved_artworks')
      .insert({ userId: user.id, artworkId: body.artworkId });

    if (result.error) fail('Failed to save: ' + result.error.message, 500);

    return { status: 'saved' };
  }

  if (action === 'unsave_artwork') {
    const { user } = await currentProfile();
    if (!body.artworkId) fail('Artwork ID required.', 422);
    unwrap(await supabase.from('saved_artworks').delete().eq('userId', user.id).eq('artworkId', body.artworkId));
    return { status: 'unsaved' };
  }

  if (action === 'saved_artworks') {
    const { user } = await currentProfile();
    const saved = unwrap(await supabase.from('saved_artworks').select('artworkId,savedAt').eq('userId', user.id).order('savedAt', { ascending: false }));
    const artworkIds = saved.map((item) => item.artworkId);
    if (!artworkIds.length) return { artworks: [] };
    const artworks = unwrap(await supabase.from('artworks').select(ARTWORK_LIST_FIELDS).in('id', artworkIds));
    const { images, legacy } = await loadArtworkImages({ ids: artworkIds });
    const artistIds = [...new Set(artworks.map((artwork) => artwork.artistId).filter(Boolean))];
    const names = await loadProfileNames(artistIds);
    const sortedArtworks = artworkIds.map((id) => artworks.find((artwork) => artwork.id === id)).filter(Boolean);
    return {
      artworks: sortedArtworks.map((artwork) => ({
        ...decorateArtwork(artwork, images, legacy),
        artist: names[artwork.artistId] || 'Unknown Artist',
      })),
    };
  }

  if (action === 'check_saved_artworks') {
    const { user } = await currentProfile();
    const artworkIds = body.artworkIds || [];
    if (!artworkIds.length) return { saved: [] };
    const saved = unwrap(await supabase.from('saved_artworks').select('artworkId').eq('userId', user.id).in('artworkId', artworkIds));
    return { saved: saved.map((item) => item.artworkId) };
  }

  fail(`Unsupported Supabase action: ${action}`, 404);
}

export async function apiFetch(input, init = {}) {
  const rawUrl = typeof input === 'string' ? input : input.url;
  const url = new URL(rawUrl, window.location.href);
  const params = url.searchParams;
  const action = params.get('action');
  let body = {};
  try {
    const rawBody = init.body ?? (input instanceof Request ? await input.clone().text() : null);
    if (rawBody) body = typeof rawBody === 'string' ? JSON.parse(rawBody) : rawBody;
    return response(await dispatch(action, params, body));
  } catch (error) {
    return response({ error: error.message || 'Supabase request failed.' }, error.status || 400);
  }
}

export async function listenForMessages(commissionId, onMessages, onError = console.error) {
  let refreshVersion = 0;
  const refresh = async () => {
    const version = ++refreshVersion;
    const { data, error } = await supabase.from('commission_messages')
      .select('*').eq('commissionId', commissionId).order('createdAt');
    if (error) onError(error);
    else if (version === refreshVersion) onMessages(data || []);
  };

  refresh();
  const channel = supabase.channel(`commission-messages-${commissionId}`)
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'commission_messages',
      filter: `commissionId=eq.${commissionId}`,
    }, refresh)
    .subscribe((status, error) => {
      if (status === 'SUBSCRIBED') refresh();
      if (status === 'CHANNEL_ERROR' && error) onError(error);
    });

  return () => { supabase.removeChannel(channel); };
}

export function listenForCommissionChanges(commissionId, onChange, onError = console.error) {
  const channel = supabase.channel(`commission-updates-${commissionId}`)
    .on('postgres_changes', {
      event: 'UPDATE',
      schema: 'public',
      table: 'commissions',
      filter: `id=eq.${commissionId}`,
    }, onChange)
    .subscribe((status, error) => {
      if (status === 'SUBSCRIBED') onChange();
      if (status === 'CHANNEL_ERROR' && error) onError(error);
    });

  return () => { supabase.removeChannel(channel); };
}