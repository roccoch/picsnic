import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// NOTE: this function is deployed with verify_jwt = false (see supabase/config.toml)
// because clients verify the PIN *before* signing in anonymously.
// The `galleries` table has NO public SELECT policy, so PINs are only
// readable here, server-side, via the service role key.
const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status,
  });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method Not Allowed" }, 405);
  }

  try {
    const { galleryId, pin } = await req.json();

    if (!galleryId || !pin) {
      return jsonResponse({ error: "Missing galleryId or pin" }, 400);
    }

    const { data: gallery, error } = await admin
      .from("galleries")
      .select("id, name, pin")
      .eq("id", galleryId)
      .maybeSingle();

    // Generic error on purpose: don't reveal whether the gallery ID
    // exists or the PIN was wrong (prevents enumeration).
    if (error || !gallery || gallery.pin !== String(pin)) {
      return jsonResponse({ error: "Invalid gallery ID or PIN" }, 401);
    }

    return jsonResponse({ galleryId: gallery.id, name: gallery.name });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
    return jsonResponse({ error: errorMessage }, 500);
  }
});
