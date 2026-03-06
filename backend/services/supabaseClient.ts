/**
 * Supabase Client — Server-side with service role key.
 * Bypasses RLS for backend admin operations.
 */
import { createClient, SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || "";

let _client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient | null {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
        return null;
    }
    if (!_client) {
        _client = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
            auth: { persistSession: false, autoRefreshToken: false },
        });
        console.log("[Supabase] Client initialized →", SUPABASE_URL);
    }
    return _client;
}

export function isSupabaseReady(): boolean {
    return !!SUPABASE_URL && !!SUPABASE_SERVICE_KEY;
}
