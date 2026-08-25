import { S3Client, PutObjectCommand } from "https://esm.sh/@aws-sdk/client-s3@3.1090.0";
import { getSignedUrl } from "https://esm.sh/@aws-sdk/s3-request-presigner@3.1090.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const BUCKET_NAME = Deno.env.get("R2_BUCKET_NAME") ?? "picsnic-storage";
const PUBLIC_URL = Deno.env.get("R2_PUBLIC_URL"); // e.g. https://pub-xxx.r2.dev

const r2 = new S3Client({
  region: "auto",
  endpoint: Deno.env.get("R2_ENDPOINT")!, // https://<account_id>.r2.cloudflarestorage.com
  credentials: {
    accessKeyId: Deno.env.get("R2_ACCESS_KEY_ID")!,
    secretAccessKey: Deno.env.get("R2_SECRET_ACCESS_KEY")!,
  },
});

// 500 MB per file — generous for university use, protects the free tier from abuse
const MAX_FILE_SIZE = 500 * 1024 * 1024;
const SIGNED_URL_TTL = 300; // 5 minutes

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

  // --- Auth: require a valid Supabase session (anonymous sessions count) ---
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return jsonResponse({ error: "Missing Authorization header" }, 401);
  }

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { data: { user }, error: authError } = await admin.auth.getUser(
    authHeader.replace("Bearer ", ""),
  );
  if (authError || !user) {
    return jsonResponse({ error: "Invalid or expired session" }, 401);
  }

  try {
    const { fileName, contentType, fileSize } = await req.json();

    // --- Validation ---
    if (!fileName || !/^photos\/[a-z0-9-]+\.[a-z0-9]+$/i.test(fileName)) {
      return jsonResponse({ error: "Invalid fileName" }, 400);
    }
    if (!contentType || !/^(image|video)\//.test(contentType)) {
      return jsonResponse({ error: "Only image and video files are allowed" }, 400);
    }
    if (typeof fileSize === "number" && fileSize > MAX_FILE_SIZE) {
      return jsonResponse({ error: "File exceeds the 500 MB limit" }, 413);
    }

    // ContentType is part of the signature: the client MUST send the same
    // Content-Type header on the PUT, or R2 rejects the upload.
    const putCommand = new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: fileName,
      ContentType: contentType,
    });
    const signedUrl = await getSignedUrl(r2, putCommand, { expiresIn: SIGNED_URL_TTL });

    return jsonResponse({
      signedUrl,
      publicUrl: PUBLIC_URL ? `${PUBLIC_URL}/${fileName}` : null,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
    return jsonResponse({ error: errorMessage }, 500);
  }
});
