import posthog from "posthog-js";

type Consent = "granted" | "denied" | "unknown";

const projectKey = import.meta.env.PUBLIC_POSTHOG_KEY;
const apiHost = import.meta.env.PUBLIC_POSTHOG_HOST;
const consentKey = "saas_analytics_consent";
let initialized = false;
let consent: Consent = "unknown";
let userId: string | null = null;

function initialize() {
  if (!projectKey || !apiHost || initialized) return Boolean(projectKey && apiHost);
  posthog.init(projectKey, { api_host: apiHost, defaults: "2026-05-30", autocapture: false, capture_pageview: false, disable_session_recording: true, opt_out_capturing_by_default: true, person_profiles: "identified_only" });
  initialized = true;
  return true;
}

function applyConsent(value: Exclude<Consent, "unknown">) {
  if (!initialize()) return;
  consent = value;
  window.localStorage.setItem(consentKey, value);
  if (value === "granted") {
    posthog.opt_in_capturing();
    if (userId) posthog.identify(userId);
    captureAnalyticsEvent("$pageview", { $current_url: window.location.href, $pathname: window.location.pathname });
  } else posthog.opt_out_capturing();
}

export function captureAnalyticsEvent(event: string, properties?: Record<string, string | number | boolean>) {
  if (consent === "granted" && initialize()) posthog.capture(event, properties);
}

export function identifyAnalyticsUser(id: string) {
  userId = id;
  if (consent === "granted" && initialize()) posthog.identify(id);
}

export function resetAnalyticsUser() {
  userId = null;
  if (initialized) posthog.reset();
}

function consentBanner() {
  const banner = document.createElement("aside");
  banner.className = "analytics-consent";
  banner.setAttribute("aria-label", "Preferencias de analítica");
  banner.innerHTML = "<p>Usamos analítica opcional y sin autocaptura para mejorar el producto.</p><div><button type=\"button\" data-analytics-consent=\"denied\">Rechazar</button><button type=\"button\" data-analytics-consent=\"granted\">Aceptar analítica</button></div>";
  banner.querySelectorAll<HTMLButtonElement>("[data-analytics-consent]").forEach((button) => button.addEventListener("click", () => {
    applyConsent(button.dataset.analyticsConsent as Exclude<Consent, "unknown">);
    banner.remove();
    consentButton();
  }));
  document.body.append(banner);
}

function consentButton() {
  const button = document.createElement("button");
  button.className = "analytics-consent-manage";
  button.type = "button";
  button.textContent = "Preferencias de analítica";
  button.addEventListener("click", () => {
    posthog.opt_out_capturing();
    consent = "unknown";
    window.localStorage.removeItem(consentKey);
    button.remove();
    consentBanner();
  });
  document.body.append(button);
}

export function initializePostHog() {
  if (!initialize()) return;
  const saved = window.localStorage.getItem(consentKey);
  if (saved === "granted" || saved === "denied") { applyConsent(saved); consentButton(); }
  else consentBanner();
}
