import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { S3Client, PutObjectCommand } from "https://esm.sh/@aws-sdk/client-s3@3.1090.0";
import { getSignedUrl } from "https://esm.sh/@aws-sdk/s3-request-presigner@3.1090.0";

const r2 = new S3Client({
  region: "auto",
  endpoint: "https://f03b0048a5c79649e8a48c09355a3283.r2.cloudflarestorage.com",
  credentials: {
    accessKeyId: Deno.env.get("R2_ACCESS_KEY_ID")!,
    secretAccessKey: Deno.env.get("R2_SECRET_ACCESS_KEY")!,
  },
});

const BUCKET_NAME = "principal";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*", 
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { 
      status: 405, 
      headers: corsHeaders 
    });
  }

  try {
    const { fileName } = await req.json();
    
    if (!fileName) {
      return new Response("Missing fileName", { 
        status: 400, 
        headers: corsHeaders 
      });
    }

    const putCommand = new PutObjectCommand({ Bucket: BUCKET_NAME, Key: fileName });
    const signedUrl = await getSignedUrl(r2, putCommand, { expiresIn: 60 });

    return new Response(JSON.stringify({ signedUrl }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
    
    return new Response(JSON.stringify({ error: errorMessage }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});