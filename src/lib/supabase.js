import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://fquisivajgslrcvdfrrv.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_Z82GMfIx2TsiCqRPZAWIUw_5SsvzL6y";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
