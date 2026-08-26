import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Admin-only gallery creation. Protected by a shared admin password stored
// as an edge function secret (ADMIN_PASSWORD), not by a user account —
// there is no photographer registration flow in this app by design.
//
// Deployed with verify_jwt = false (the admin has no session either);
// the password check below is the only gate.
const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);
const ADMIN_PASSWORD = Deno.env.get("ADMIN_PASSWORD");

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
    const { password, name, slug, pin } = await req.json();

    if (!ADMIN_PASSWORD || password !== ADMIN_PASSWORD) {
      return jsonResponse({ error: "Wrong admin password" }, 401);
    }
    if (!name || !slug || !pin) {
      return jsonResponse({ error: "name, slug and pin are required" }, 400);
    }
    // slugs are what clients type on a phone: lowercase, URL-friendly only
    if (!/^[a-z0-9][a-z0-9-]{1,29}$/.test(slug)) {
      return jsonResponse({
        error: "Slug must be 2-30 chars: lowercase letters, numbers, hyphens",
      }, 400);
    }
    if (!/^\S{4,20}$/.test(pin)) {
      return jsonResponse({ error: "PIN must be 4-20 characters, no spaces" }, 400);
    }

    const { data: gallery, error } = await admin
      .from("galleries")
      .insert({ name, slug, pin })
      .select("id, slug, name")
      .single();

    if (error) {
      if (error.code === "23505") {
        return jsonResponse({ error: "That slug is already taken" }, 409);
      }
      throw error;
    }

    return jsonResponse({ galleryId: gallery.id, slug: gallery.slug, name: gallery.name });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
    return jsonResponse({ error: errorMessage }, 500);
  }
});
