// Central config for the legal pages. Edit these before public launch.
// IMPORTANT: CONTACT_EMAIL must be a real, monitored inbox — data-subject (privacy) requests and
// legal notices go here. GOVERNING_LAW/COMPANY should match your actual entity once formed.
export const APP_NAME = "Snowfolio";

// The operator named in the Terms and Privacy Policy.
//
// Until an entity is formed this is a product name, not a legal person — which means the liability
// cap in the Terms rests on nothing incorporated. That is a real exposure and forming the entity is
// the only fix; see GitHub issue #2. What this env var buys is that the day the LLC exists, the
// name can be corrected in Vercel in a minute instead of waiting on a code change and a deploy.
export const COMPANY = process.env.NEXT_PUBLIC_LEGAL_COMPANY?.trim() || "Snowfolio";

/** True while COMPANY is still the placeholder product name rather than a formed entity. */
export const COMPANY_IS_PLACEHOLDER = !process.env.NEXT_PUBLIC_LEGAL_COMPANY?.trim();

export const CONTACT_EMAIL = process.env.NEXT_PUBLIC_LEGAL_CONTACT_EMAIL?.trim() || "support@snowfolio.app";
export const GOVERNING_LAW = "the State of California, United States";
export const MIN_AGE = 18;
export const LAST_UPDATED = "August 24, 2026";
