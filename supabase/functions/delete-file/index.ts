import { S3Client, DeleteObjectCommand } from "https://esm.sh/@aws-sdk/client-s3@3.1090.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const BUCKET_NAME = Deno.env.get("R2_BUCKET_NAME") ?? "picsnic-storage";

const r2 = new S3Client({
  region: "auto",
  endpoint: Deno.env.get("R2_ENDPOINT")!,
  credentials: {
    accessKeyId: Deno.env.get("R2_ACCESS_KEY_ID")!,
    secretAccessKey: Deno.env.get("R2_SECRET_ACCESS_KEY")!,
  },
});

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

  // --- Auth: only the uploader of a photo may delete it ---
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return jsonResponse({ error: "Missing Authorization header" }, 401);
  }
  const { data: { user }, error: authError } = await admin.auth.getUser(
    authHeader.replace("Bearer ", ""),
  );
  if (authError || !user) {
    return jsonResponse({ error: "Invalid or expired session" }, 401);
  }

  try {
    const { photoId } = await req.json();
    if (!photoId) {
      return jsonResponse({ error: "Missing photoId" }, 400);
    }

    const { data: photo, error: fetchError } = await admin
      .from("photos")
      .select("id, url, photographer_id")
      .eq("id", photoId)
      .maybeSingle();

    if (fetchError || !photo) {
      return jsonResponse({ error: "Photo not found" }, 404);
    }
    if (photo.photographer_id !== user.id) {
      return jsonResponse({ error: "You can only delete your own uploads" }, 403);
    }

    // Delete the object in R2 first, then the DB row. If the DB delete
    // failed we'd rather have a dangling row than an orphaned file.
    const key = photo.url.split("/").slice(3).join("/");
    await r2.send(new DeleteObjectCommand({ Bucket: BUCKET_NAME, Key: key }));

    const { error: deleteError } = await admin
      .from("photos")
      .delete()
      .eq("id", photoId);

    if (deleteError) {
      return jsonResponse({ error: deleteError.message }, 500);
    }

    return jsonResponse({ success: true });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
    return jsonResponse({ error: errorMessage }, 500);
  }
});
