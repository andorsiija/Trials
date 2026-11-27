import { supabase } from '../supabase-config.js';

const ADMIN_EMAIL = '23100335@spcba.edu.ph';

export async function checkAdminAccess() {
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) return false;

  if (user.email === ADMIN_EMAIL) return true;

  const { data, error } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single();

  return !error && data?.role === 'admin';
}

export async function getAdminUser() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  if (user.email !== ADMIN_EMAIL) {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single();

    if (error || data?.role !== 'admin') throw new Error('Admin access required');
    return { user, profile: data };
  }

  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single();

  if (error) {
    await supabase.from('profiles').insert({
      id: user.id,
      name: user.email.split('@')[0],
      role: 'admin',
      specialty: '',
    });
    return {
      user,
      profile: {
        id: user.id,
        name: user.email.split('@')[0],
        role: 'admin',
        specialty: '',
        description: '',
        socialLink: '',
        profileViews: 0,
        isSuspended: false,
        suspensionReason: '',
        suspensionUntil: null
      }
    };
  }

  return { user, profile: data };
}

export { ADMIN_EMAIL };