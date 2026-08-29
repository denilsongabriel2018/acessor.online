import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const email = process.env.INITIAL_USER_EMAIL;
const password = process.env.INITIAL_USER_PASSWORD;
const name = process.env.INITIAL_USER_NAME || "Rafael";
const timezone = process.env.APP_TIMEZONE || "America/Sao_Paulo";
const workspaceId = process.env.DEFAULT_WORKSPACE_ID || "00000000-0000-4000-8000-000000000001";

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
}

if (!email || !password) {
  throw new Error("Missing INITIAL_USER_EMAIL or INITIAL_USER_PASSWORD.");
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false
  }
});

async function findAuthUserByEmail(targetEmail) {
  let page = 1;
  const perPage = 100;

  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error) throw error;

    const found = data.users.find((user) => user.email?.toLowerCase() === targetEmail.toLowerCase());
    if (found) return found;
    if (data.users.length < perPage) return undefined;
    page += 1;
  }
}

let authUser = await findAuthUserByEmail(email);

if (!authUser) {
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { name }
  });

  if (error) throw error;
  authUser = data.user;
}

if (!authUser) {
  throw new Error("Could not create or find auth user.");
}

const { data: appUser, error: appUserError } = await supabase
  .from("app_users")
  .upsert(
    {
      auth_user_id: authUser.id,
      name,
      email,
      timezone
    },
    { onConflict: "auth_user_id" }
  )
  .select("*")
  .single();

if (appUserError) throw appUserError;

const { error: memberError } = await supabase.from("workspace_members").upsert(
  {
    workspace_id: workspaceId,
    user_id: appUser.id,
    role: "owner"
  },
  { onConflict: "workspace_id,user_id" }
);

if (memberError) throw memberError;

console.log("INITIAL_USER_CREATED=true");
console.log(`APP_USER_ID=${appUser.id}`);
console.log(`WORKSPACE_ID=${workspaceId}`);
