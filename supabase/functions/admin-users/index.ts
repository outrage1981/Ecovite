// Edge Function: admin-users
//
// Creates and deletes real Supabase Auth accounts on behalf of an in-app
// admin. This has to live here (server-side, inside Supabase) rather than
// in the regular app code, because both operations need the project's
// service-role secret key — a key that must never be shipped to a browser,
// since it bypasses every Row-Level-Security policy in the database.
//
// The function re-checks the caller itself: it reads their own auth token
// (passed automatically by supabase-js's `functions.invoke`), looks up
// their profile, and refuses to do anything unless that profile's role is
// 'admin'. The service-role key is only used after that check passes.
//
// Deploy with the Supabase CLI once a project exists:
//   supabase functions deploy admin-users
// It also needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY set as function
// secrets — Supabase provides both of these automatically as default
// environment variables for every Edge Function, so nothing extra to
// configure there.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

// Edge Functions don't add these automatically — without them, a browser
// calling this function directly (as the app does) blocks the request
// before it even reaches this code, since it never gets past the
// preflight check. Wide open on origin here because the real access
// control is the admin-role check below, not which website is asking.
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  // The browser sends this preflight check before the real request;
  // answering it (instead of falling through to the auth checks below,
  // which it would otherwise fail with no Authorization header) is what
  // lets the real request happen at all.
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Missing authorization.' }, 401);

    // A client scoped to the CALLER's own token — only used to verify who
    // they are, never to perform the privileged action itself.
    const callerClient = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: callerData, error: callerErr } = await callerClient.auth.getUser();
    if (callerErr || !callerData?.user) return json({ error: 'Not authenticated.' }, 401);

    const { data: callerProfile, error: profileErr } = await callerClient
      .from('profiles')
      .select('role')
      .eq('id', callerData.user.id)
      .single();
    if (profileErr || callerProfile?.role !== 'admin') {
      return json({ error: 'Only admins can manage users.' }, 403);
    }

    const body = await req.json();
    // Separate client using the service-role key — this is what actually
    // has permission to create/delete auth accounts.
    const admin = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!);

    if (body.action === 'create') {
      const { email, password, fullName, role } = body;
      if (!email || !password) return json({ error: 'Email and password are required.' }, 400);
      if (role !== 'admin' && role !== 'rep') return json({ error: "Role must be 'admin' or 'rep'." }, 400);

      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: fullName || '' },
      });
      if (createErr) return json({ error: createErr.message }, 400);

      // The handle_new_user() trigger already inserted a profiles row for
      // this new auth user (defaulting role to 'rep') — set the role that
      // was actually requested.
      const { error: roleErr } = await admin.from('profiles').update({ role }).eq('id', created.user.id);
      if (roleErr) return json({ error: roleErr.message }, 400);

      return json({ id: created.user.id, email: created.user.email, full_name: fullName || '', role });
    }

    if (body.action === 'delete') {
      const { userId } = body;
      if (!userId) return json({ error: 'userId is required.' }, 400);
      if (userId === callerData.user.id) return json({ error: "You can't remove your own account." }, 400);

      // profiles.id -> auth.users cascades, and mixes.owner_id -> profiles
      // cascades too, so this also removes everything that user saved.
      const { error: delErr } = await admin.auth.admin.deleteUser(userId);
      if (delErr) return json({ error: delErr.message }, 400);
      return json({ ok: true });
    }

    return json({ error: 'Unknown action.' }, 400);
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Unexpected error.' }, 500);
  }
});
