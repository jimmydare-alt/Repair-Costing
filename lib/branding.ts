function hexToRgb(hex: string) {
  const clean = hex.replace("#", "");
  if (!/^[0-9a-f]{6}$/i.test(clean)) return null;
  return {
    r: parseInt(clean.slice(0, 2), 16),
    g: parseInt(clean.slice(2, 4), 16),
    b: parseInt(clean.slice(4, 6), 16)
  };
}

function channel(value: number) {
  const normal = value / 255;
  return normal <= 0.03928 ? normal / 12.92 : Math.pow((normal + 0.055) / 1.055, 2.4);
}

export function relativeLuminance(hex: string) {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0;
  return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b);
}

export function contrastRatio(a: string, b: string) {
  const l1 = relativeLuminance(a);
  const l2 = relativeLuminance(b);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return Math.round(((lighter + 0.05) / (darker + 0.05) + Number.EPSILON) * 100) / 100;
}

export function readableForeground(background: string) {
  return contrastRatio(background, "#ffffff") >= contrastRatio(background, "#07182f") ? "#ffffff" : "#07182f";
}

export function isWcagAaText(background: string, foreground: string) {
  return contrastRatio(background, foreground) >= 4.5;
}

export function approvedBrandVariables(branding: { primaryColour: string; accentColour: string; darkColour: string; softColour: string; onPrimaryColour?: string }) {
  const onPrimary = branding.onPrimaryColour && isWcagAaText(branding.primaryColour, branding.onPrimaryColour)
    ? branding.onPrimaryColour
    : readableForeground(branding.primaryColour);
  return {
    "--company-primary": branding.primaryColour,
    "--company-primary-hover": darkenHex(branding.primaryColour, 0.12),
    "--company-accent": branding.accentColour,
    "--company-dark": branding.darkColour,
    "--company-soft": branding.softColour,
    "--company-on-primary": onPrimary
  } as Record<string, string>;
}

export function darkenHex(hex: string, amount: number) {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  const scale = Math.max(0, Math.min(1, 1 - amount));
  const toHex = (value: number) => Math.round(value * scale).toString(16).padStart(2, "0");
  return `#${toHex(rgb.r)}${toHex(rgb.g)}${toHex(rgb.b)}`;
}

export const allowedLogoMimeTypes = ["image/png", "image/jpeg", "image/webp"] as const;
export const maxLogoBytes = 2 * 1024 * 1024;

export function validateLogoFile(file: { type: string; size: number; name: string }) {
  const extension = file.name.toLowerCase().split(".").pop();
  const extensionOk = extension === "png" || extension === "jpg" || extension === "jpeg" || extension === "webp";
  const mimeOk = (allowedLogoMimeTypes as readonly string[]).includes(file.type);
  if (!extensionOk || !mimeOk) return { ok: false, reason: "Use PNG, JPG/JPEG or WebP. SVG is blocked in version one." };
  if (file.size > maxLogoBytes) return { ok: false, reason: "Logo file is too large. Maximum size is 2 MB." };
  return { ok: true, reason: "" };
}

