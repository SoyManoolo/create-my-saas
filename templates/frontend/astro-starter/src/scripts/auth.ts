type User = { id: string; name: string; email: string; emailVerified: boolean };
type Session = { accessToken: string; user: User };
import { captureAnalyticsEvent, identifyAnalyticsUser, resetAnalyticsUser } from "./posthog";

const baseUrl = (import.meta.env?.PUBLIC_API_BASE_URL ?? "").replace(/\/$/, "");
const csrfCookieName = import.meta.env?.PUBLIC_CSRF_COOKIE_NAME ?? "csrf_token";
let accessToken: string | null = null;

class ApiError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

export const API_ERROR_MESSAGES: Record<string, string> = {
  EMAIL_ALREADY_EXISTS: "Ya existe una cuenta con este correo electrónico.",
  INVALID_CREDENTIALS: "El correo o la contraseña no son correctos.",
  USER_INACTIVE: "Esta cuenta está desactivada.",
  MISSING_TOKEN: "Tu sesión no es válida o ha caducado. Inicia sesión de nuevo.",
  INVALID_ACCESS_TOKEN: "Tu sesión no es válida o ha caducado. Inicia sesión de nuevo.",
  EXPIRED_TOKEN: "Tu sesión no es válida o ha caducado. Inicia sesión de nuevo.",
  INVALID_REFRESH_TOKEN: "Tu sesión no es válida o ha caducado. Inicia sesión de nuevo.",
  REFRESH_TOKEN_REUSED: "Por seguridad, hemos cerrado tus sesiones. Inicia sesión de nuevo.",
  INVALID_CSRF_TOKEN: "No se ha podido verificar la solicitud. Recarga la página e inténtalo de nuevo.",
  INVALID_RESET_TOKEN: "El enlace de restablecimiento no es válido o ha caducado.",
  INVALID_VERIFICATION_TOKEN: "El enlace de verificación no es válido o ha caducado.",
  INVALID_TOKEN: "El enlace no es válido, ha caducado o ya se ha utilizado.",
  EMAIL_DELIVERY_UNAVAILABLE: "No hemos podido enviar el correo. Inténtalo de nuevo más tarde.",
  OAUTH_PROVIDER_UNAVAILABLE: "Este proveedor de inicio de sesión no está disponible.",
  OAUTH_CALLBACK_INVALID: "La respuesta del proveedor de inicio de sesión no es válida.",
  OAUTH_STATE_INVALID: "El intento de inicio de sesión ha caducado. Vuelve a intentarlo.",
  OAUTH_EMAIL_UNVERIFIED: "El proveedor no ha confirmado tu correo electrónico.",
  OAUTH_PROVIDER_ERROR: "No se ha podido completar el inicio de sesión con este proveedor.",
  VALIDATION_ERROR: "Revisa los datos introducidos e inténtalo de nuevo.",
  HTTP_400: "Revisa los datos introducidos e inténtalo de nuevo.",
  HTTP_422: "Revisa los datos introducidos e inténtalo de nuevo.",
  RATE_LIMITED: "Has realizado demasiadas solicitudes. Espera un momento e inténtalo de nuevo.",
  RATE_LIMIT_UNAVAILABLE: "El servicio no está disponible temporalmente. Inténtalo de nuevo más tarde.",
  SERVICE_NOT_READY: "El servicio no está disponible temporalmente. Inténtalo de nuevo más tarde.",
  INTERNAL_ERROR: "Ha ocurrido un error inesperado. Inténtalo de nuevo más tarde.",
  INTERNAL_SERVER_ERROR: "Ha ocurrido un error inesperado. Inténtalo de nuevo más tarde.",
  MEMBERSHIP_REQUIRED: "Necesitas pertenecer a esta organización para continuar.",
  ORGANIZATION_ACCESS_DENIED: "No tienes permiso para realizar esta acción en la organización.",
  INSUFFICIENT_ROLE: "No tienes permiso para realizar esta acción en la organización.",
  ORGANIZATION_NOT_FOUND: "No se ha encontrado la organización.",
  MEMBERSHIP_NOT_FOUND: "No se ha encontrado al miembro de la organización.",
  INVALID_ORGANIZATION_SLUG: "El identificador de la organización debe contener letras o números.",
  SLUG_ALREADY_EXISTS: "Ese identificador de organización ya está en uso.",
  ORGANIZATION_SLUG_ALREADY_EXISTS: "Ese identificador de organización ya está en uso.",
  INVALID_INVITATION_EMAIL: "Introduce un correo electrónico válido para la invitación.",
  INVALID_INVITATION: "La invitación no es válida o ha caducado.",
  OWNER_ROLE_PROTECTED: "Transfiere la propiedad antes de cambiar o eliminar al propietario.",
  OWNER_REQUIRED: "Transfiere la propiedad antes de eliminar al propietario.",
  OWNERSHIP_TARGET_NOT_ELIGIBLE: "La propiedad solo puede transferirse a otro miembro activo.",
  LAST_ACTIVE_OWNER: "Transfiere la propiedad antes de desactivar esta cuenta.",
  BILLING_NOT_CONFIGURED: "La facturación todavía no está configurada.",
  BILLING_PRICE_NOT_AVAILABLE: "El plan seleccionado ya no está disponible.",
  BILLING_CUSTOMER_NOT_FOUND: "Contrata primero un plan para acceder al portal de facturación.",
  BILLING_PROVIDER_ERROR: "No se ha podido conectar con el proveedor de pagos. Inténtalo de nuevo más tarde.",
  ENTITLEMENT_REQUIRED: "Tu plan no incluye esta función.",
  ENTITLEMENT_LIMIT_REACHED: "Has alcanzado el límite de uso de tu plan.",
  INVALID_USAGE_RECORD: "Los datos de uso no son válidos.",
  INVALID_ENTITLEMENT_QUANTITY: "La cantidad solicitada no es válida.",
  INVALID_WEBHOOK_SIGNATURE: "No se ha podido verificar la notificación de pago.",
  INVALID_BILLING_WEBHOOK: "La notificación de pago no es válida.",
  BILLING_ORGANIZATION_MISMATCH: "Los datos de facturación no corresponden a esta organización.",
  BILLING_SUBSCRIPTION_MISMATCH: "La organización ya tiene otra suscripción asociada.",
  BILLING_CUSTOMER_MISMATCH: "La organización ya tiene otro cliente de facturación asociado.",
  INVALID_BILLING_CONFIGURATION: "La facturación no está disponible temporalmente.",
};

export function apiErrorMessage(code: string | undefined, status: number): string {
  if (code && API_ERROR_MESSAGES[code]) return API_ERROR_MESSAGES[code];
  if (status === 400 || status === 422) return "Revisa los datos introducidos e inténtalo de nuevo.";
  if (status === 401) return "Tu sesión no es válida o ha caducado. Inicia sesión de nuevo.";
  if (status === 403) return "No tienes permiso para realizar esta acción.";
  if (status === 404) return "No hemos encontrado el recurso solicitado.";
  if (status === 409) return "No se ha podido completar la operación porque los datos han cambiado.";
  if (status === 429) return API_ERROR_MESSAGES.RATE_LIMITED;
  if (status >= 500) return "El servicio no está disponible temporalmente. Inténtalo de nuevo más tarde.";
  return "La operación no se ha podido completar.";
}

function cookie(name: string) {
  return document.cookie.split(";").map((value) => value.trim().split("=", 2)).find(([key]) => key === name)?.[1];
}

function user(value: Record<string, unknown>): User {
  return { id: String(value.id), name: String(value.name), email: String(value.email), emailVerified: Boolean(value.emailVerified ?? value.email_verified) };
}

async function request<T>(path: string, init: Omit<RequestInit, "body"> & { body?: unknown; token?: string | null } = {}) {
  const { body, token, headers, ...options } = init;
  const requestHeaders = new Headers(headers);
  if (body !== undefined) requestHeaders.set("content-type", "application/json");
  if (token) requestHeaders.set("authorization", `Bearer ${token}`);
  const csrf = cookie(csrfCookieName);
  if (csrf && !["GET", "HEAD", "OPTIONS"].includes(options.method ?? "GET")) requestHeaders.set("x-csrf-token", csrf);
  let response: Response;
  try { response = await fetch(`${baseUrl}${path}`, { ...options, headers: requestHeaders, body: body === undefined ? undefined : JSON.stringify(body), credentials: "include" }); }
  catch { throw new ApiError("No se ha podido conectar con el servicio. Comprueba tu conexión e inténtalo de nuevo.", 0, "NETWORK_ERROR"); }
  if (response.status === 204) return undefined as T;
  const result = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    const error = result.error as Record<string, unknown> | undefined;
    const code = typeof error?.code === "string" ? error.code : undefined;
    throw new ApiError(apiErrorMessage(code, response.status), response.status, code);
  }
  return result as T;
}

async function restoreSession() {
  const result = await request<Record<string, unknown>>("/auth/refresh", { method: "POST" });
  accessToken = String(result.accessToken ?? result.access_token);
  const session = { accessToken, user: user(result.user as Record<string, unknown>) } satisfies Session;
  identifyAnalyticsUser(session.user.id);
  return session;
}

function setStatus(target: Element | null, message: string, error = false) {
  if (!target) return;
  target.textContent = message;
  target.classList.toggle("error", error);
  target.classList.toggle("success", !error);
}

async function startOAuth(provider: "google" | "github") {
  try {
    const providers = await request<Array<{ provider: string; configured: boolean }>>("/auth/oauth/providers");
    if (!providers.some((item) => item.provider === provider && item.configured)) throw new ApiError("Este proveedor OAuth no está configurado.", 400);
    const result = await request<Record<string, unknown>>(`/auth/oauth/${provider}`);
    if (typeof result.authorizationUrl !== "string") throw new ApiError("El proveedor OAuth no devolvió una URL de autorización.", 502);
    window.location.assign(result.authorizationUrl);
  } catch (cause) {
    if (cause instanceof ApiError && cause.status === 404) window.location.assign(`${baseUrl}/auth/oauth/${provider}/start`);
    else throw cause;
  }
}

function bindForms() {
  document.querySelectorAll<HTMLFormElement>("[data-auth-form]").forEach((form) => form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const kind = form.dataset.authForm;
    const values = new FormData(form);
    const status = form.querySelector("[data-form-status]");
    const button = form.querySelector<HTMLButtonElement>("button[type=submit]");
    if (kind === "reset" && !new URLSearchParams(location.search).get("token")) return setStatus(status, "El enlace de restablecimiento no es válido.", true);
    button?.setAttribute("disabled", "true");
    try {
      if (kind === "login") {
        const result = await request<Record<string, unknown>>("/auth/login", { method: "POST", body: { email: values.get("email"), password: values.get("password") } });
        accessToken = String(result.accessToken ?? result.access_token);
        window.location.assign("/app/"); return;
      }
      if (kind === "register") { await request("/auth/register", { method: "POST", body: { name: values.get("name"), email: values.get("email"), password: values.get("password") } }); captureAnalyticsEvent("signup_requested"); setStatus(status, "Revisa tu correo para verificar la cuenta antes de iniciar sesión."); }
      if (kind === "forgot") { await request("/auth/password/reset/request", { method: "POST", body: { email: values.get("email") } }); setStatus(status, "Si existe una cuenta con ese correo, recibirás un enlace de restablecimiento."); }
      if (kind === "reset") { await request("/auth/password/reset/confirm", { method: "POST", body: { token: new URLSearchParams(location.search).get("token"), newPassword: values.get("password") } }); setStatus(status, "Contraseña actualizada. Ya puedes iniciar sesión."); }
    } catch (cause) { setStatus(status, cause instanceof Error ? cause.message : "La operación no se ha podido completar.", true); }
    finally { button?.removeAttribute("disabled"); }
  }));
}

function bindOAuth() {
  document.querySelectorAll<HTMLButtonElement>("[data-oauth-provider]").forEach((button) => button.addEventListener("click", async () => {
    const status = document.querySelector("[data-oauth-status]");
    button.disabled = true;
    try { await startOAuth(button.dataset.oauthProvider as "google" | "github"); }
    catch (cause) { setStatus(status, cause instanceof Error ? cause.message : "No se ha podido iniciar sesión con este proveedor.", true); button.disabled = false; }
  }));
}

async function bindProtectedPage() {
  if (!("protected" in document.body.dataset)) return;
  try {
    const session = await restoreSession();
    document.querySelectorAll<HTMLElement>("[data-user-name]").forEach((node) => { node.textContent = session.user.name; });
    document.querySelectorAll<HTMLElement>("[data-user-email]").forEach((node) => { node.textContent = session.user.email; });
    document.querySelectorAll<HTMLElement>("[data-verification]").forEach((node) => { node.textContent = session.user.emailVerified ? "Correo verificado" : "Correo pendiente de verificación"; });
    document.querySelector<HTMLElement>("[data-protected-content]")?.removeAttribute("hidden");
  } catch { window.location.replace(`/login/?next=${encodeURIComponent(location.pathname)}`); }
}

if (typeof document !== "undefined") document.addEventListener("DOMContentLoaded", () => {
  bindForms(); bindOAuth(); void bindProtectedPage();
  document.querySelectorAll<HTMLElement>("[data-mobile-menu-button]").forEach((button) => button.addEventListener("click", () => document.querySelector("[data-mobile-menu]")?.classList.toggle("open")));
  document.querySelectorAll<HTMLButtonElement>("[data-logout]").forEach((button) => button.addEventListener("click", async () => { try { await request("/auth/logout", { method: "POST" }); } finally { accessToken = null; resetAnalyticsUser(); window.location.assign("/login/"); } }));
  document.querySelectorAll<HTMLButtonElement>("[data-resend-verification]").forEach((button) => button.addEventListener("click", async () => { const status = document.querySelector("[data-account-status]"); try { if (!accessToken) throw new Error("La sesión ha caducado. Inicia sesión de nuevo."); await request("/auth/email/resend", { method: "POST", token: accessToken }); setStatus(status, "Hemos enviado un nuevo enlace de verificación."); } catch (cause) { setStatus(status, cause instanceof Error ? cause.message : "No se ha podido reenviar el enlace.", true); } }));
  if (document.querySelector("[data-oauth-callback]")) void restoreSession().then(() => window.location.replace("/app/")).catch(() => setStatus(document.querySelector("[data-oauth-status]"), "No se ha podido completar el inicio de sesión.", true));
  if (document.querySelector("[data-verify-email]")) { const token = new URLSearchParams(location.search).get("token"); const status = document.querySelector("[data-verify-status]"); if (!token) setStatus(status, "El enlace de verificación no es válido.", true); else void request("/auth/email/verify", { method: "POST", body: { token } }).then(() => setStatus(status, "Tu correo se ha verificado correctamente.")).catch((cause) => setStatus(status, cause instanceof Error ? cause.message : "No se ha podido verificar el correo.", true)); }
});
