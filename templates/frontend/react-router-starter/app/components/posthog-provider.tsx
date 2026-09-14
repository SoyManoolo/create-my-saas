import { useEffect, useState, type ReactNode } from "react";
import { useLocation } from "react-router";
import posthog from "posthog-js";

type Consent = "granted" | "denied" | "unknown";

const projectKey = import.meta.env.VITE_POSTHOG_KEY;
const apiHost = import.meta.env.VITE_POSTHOG_HOST;
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

export function PostHogProvider({ children }: { children: ReactNode }) {
  const location = useLocation();
  const [currentConsent, setCurrentConsent] = useState<Consent>("unknown");
  const configured = Boolean(projectKey && apiHost);

  useEffect(() => {
    if (!configured || !initialize()) return;
    const saved = window.localStorage.getItem(consentKey);
    if (saved === "granted" || saved === "denied") { applyConsent(saved); setCurrentConsent(saved); }
  }, [configured]);

  useEffect(() => {
    if (currentConsent === "granted") captureAnalyticsEvent("$pageview", { $current_url: window.location.href, $pathname: location.pathname });
  }, [currentConsent, location.pathname, location.search]);

  function choose(value: Exclude<Consent, "unknown">) { applyConsent(value); setCurrentConsent(value); }

  function changeConsent() {
    if (initialized) posthog.opt_out_capturing();
    consent = "unknown";
    window.localStorage.removeItem(consentKey);
    setCurrentConsent("unknown");
  }

  return <>{children}{configured && currentConsent !== "unknown" ? <button className="analytics-consent-manage" type="button" onClick={changeConsent}>Preferencias de analítica</button> : null}{configured && currentConsent === "unknown" ? <aside className="analytics-consent" aria-label="Preferencias de analítica"><p>Usamos analítica opcional y sin autocaptura para mejorar el producto.</p><div><button type="button" onClick={() => choose("denied")}>Rechazar</button><button type="button" onClick={() => choose("granted")}>Aceptar analítica</button></div></aside> : null}</>;
}
