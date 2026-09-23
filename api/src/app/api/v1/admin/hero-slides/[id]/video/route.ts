import { withRoute, json } from "@/lib/http";
import { RateLimitRules } from "@/lib/security/rateLimiter";
import { ValidationError } from "@/lib/errors";
import { removeHeroVideo, storeHeroVideo } from "@/lib/services/hero.service";

/**
 * POST   .../video   Upload or replace this slide's background video (MP4/WebM only — see security/video.ts).
 * DELETE .../video   Remove it. The slide's image remains as the poster/fallback either way — video is always optional.
 */
export const POST = withRoute({ permission: "content.manage", rateLimit: RateLimitRules.uploads }, async ({ req, user, params }) => {
  const formData = await req.formData().catch(() => null);
  const file = formData?.get("file");
  if (!formData || !(file instanceof File)) {
    throw new ValidationError("Provide a 'file' multipart field containing the video.");
  }
  const data = Buffer.from(await file.arrayBuffer());
  const slide = await storeHeroVideo(user!, params.id!, { data, filename: file.name || null });
  return json({ slide }, { status: 200 });
});

export const DELETE = withRoute({ permission: "content.manage", rateLimit: RateLimitRules.uploads }, async ({ user, params }) => {
  const slide = await removeHeroVideo(user!, params.id!);
  return json({ slide });
});
