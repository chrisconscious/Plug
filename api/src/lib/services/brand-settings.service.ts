import * as brandSettingsRepo from "../db/repos/brand-settings.repo";
import { ValidationError } from "../errors";
import { recordAuditEvent } from "../audit";
import type { BrandSectionSpeed } from "../db/types";
import type { Role } from "../rbac";

const SPEEDS: readonly BrandSectionSpeed[] = ["slow", "medium", "fast"];

export const DEFAULT_BRAND_SECTION_SPEED: BrandSectionSpeed = "medium";

export function assertBrandLogoSpeed(v: unknown): BrandSectionSpeed {
  if (typeof v === "string" && (SPEEDS as readonly string[]).includes(v)) {
    return v as BrandSectionSpeed;
  }
  throw new ValidationError("Validation failed.", { speed: "speed must be one of slow, medium, fast." });
}

/** Public storefront read — never throws on a missing row; falls back to MEDIUM. */
export async function getBrandSectionSettings(): Promise<{ speed: BrandSectionSpeed }> {
  const current = await brandSettingsRepo.getBrandSectionSettings();
  return { speed: current?.speed ?? DEFAULT_BRAND_SECTION_SPEED };
}

export async function updateBrandSectionSettings(
  actor: { id: string; role: Role },
  rawSpeed: unknown
): Promise<{ speed: BrandSectionSpeed }> {
  const speed = assertBrandLogoSpeed(rawSpeed);
  await brandSettingsRepo.updateBrandLogoSpeed(speed, actor.id);
  await recordAuditEvent({
    actorId: actor.id,
    actorRole: actor.role,
    action: "brandSettings.updated",
    targetType: "brandSettings",
    targetId: "1",
    metadata: { speed },
  });
  return { speed };
}