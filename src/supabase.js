import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !key) {
  document.getElementById("main").innerHTML =
    '<div class="empty">Missing settings. Copy <b>.env.example</b> to <b>.env</b> and add your Supabase URL and anon key, then restart.</div>';
  throw new Error("VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY not set");
}

export const supabase = createClient(url, key, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});
