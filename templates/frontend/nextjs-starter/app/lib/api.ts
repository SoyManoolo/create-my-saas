export type User = {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  isActive: boolean;
  avatarUrl?: string | null;
};

type ApiErrorBody = { error?: { code?: string } };

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

export class ApiError extends Error {
  public readonly status: number;
  public readonly code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

type RequestOptions = Omit<RequestInit, "body"> & { body?: unknown; accessToken?: string | null };

const apiBaseUrl = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "").replace(/\/$/, "");
const csrfCookieName = process.env.NEXT_PUBLIC_CSRF_COOKIE_NAME ?? "csrf_token";

function getCookie(name: string): string | undefined {
  if (typeof document === "undefined") return undefined;
  return document.cookie
    .split(";")
    .map((part) => part.trim().split("=", 2))
    .find(([key]) => key === name)?.[1];
}

function normaliseUser(input: Record<string, unknown>): User {
  return {
    id: String(input.id),
    name: String(input.name),
    email: String(input.email),
    emailVerified: Boolean(input.emailVerified ?? input.email_verified),
    isActive: Boolean(input.isActive ?? input.is_active),
    avatarUrl: typeof (input.avatarUrl ?? input.avatar_url) === "string" ? String(input.avatarUrl ?? input.avatar_url) : null,
  };
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, accessToken, headers, ...init } = options;
  const requestHeaders = new Headers(headers);
  if (body !== undefined) requestHeaders.set("content-type", "application/json");
  if (accessToken) requestHeaders.set("authorization", `Bearer ${accessToken}`);

  const csrfToken = getCookie(csrfCookieName);
  if (csrfToken && !["GET", "HEAD", "OPTIONS"].includes(init.method ?? "GET")) {
    requestHeaders.set("x-csrf-token", csrfToken);
  }

  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl}${path}`, {
      ...init,
      headers: requestHeaders,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: "include",
    });
  } catch {
    throw new ApiError("No se ha podido conectar con el servicio. Comprueba tu conexión e inténtalo de nuevo.", 0, "NETWORK_ERROR");
  }

  if (response.status === 204) return undefined as T;
  const responseBody = (await response.json().catch(() => ({}))) as T & ApiErrorBody;
  if (!response.ok) {
    const code = responseBody.error?.code;
    throw new ApiError(apiErrorMessage(code, response.status), response.status, code);
  }
  return responseBody;
}

export type Authentication = { accessToken: string; user: User };
export type OAuthProvider = "google" | "github";
export type Organization = { id: string; name: string; slug: string };
export type BillingPlan = { priceId: string; name: string; entitlements: Record<string, number | null> };
export type BillingConfiguration = { configured: boolean; provider: "stripe"; usageMeterConfigured: boolean; plans: BillingPlan[] };
export type BillingSubscription = {
  organizationId: string; provider: string; plan: string; status: string; seats: number;
  currentPeriodStart: string | null; currentPeriodEnd: string | null; cancelAtPeriodEnd: boolean;
  entitlements: Array<{ key: string; limit: number | null; enabled: boolean; source: string; expiresAt: string | null }>;
  usage: Array<{ metric: string; quantity: number }>;
};
export type BillingRedirect = { configured: boolean; url: string | null; reason?: string; sessionId?: string | null };

function authentication(input: Record<string, unknown>): Authentication {
  return { accessToken: String(input.accessToken ?? input.access_token), user: normaliseUser(input.user as Record<string, unknown>) };
}

async function billingRequest<T>(organizationId: string, suffix: "subscription" | "configuration" | "checkout" | "portal", accessToken: string, body?: unknown): Promise<T> {
  const options: RequestOptions = { method: suffix === "subscription" || suffix === "configuration" ? "GET" : "POST", accessToken, ...(body === undefined ? {} : { body }) };
  try {
    return await request<T>(`/organizations/${organizationId}/billing/${suffix}`, options);
  } catch (cause) {
    if (!(cause instanceof ApiError) || cause.status !== 404) throw cause;
    const fastApiSuffix = suffix === "subscription" ? "" : `/${suffix}`;
    return request<T>(`/billing/organizations/${organizationId}${fastApiSuffix}`, options);
  }
}

export const api = {
  register: (payload: { name: string; email: string; password: string }) => request<User>("/auth/register", { method: "POST", body: payload }),
  login: async (payload: { email: string; password: string }) => authentication(await request<Record<string, unknown>>("/auth/login", { method: "POST", body: payload })),
  refresh: async () => authentication(await request<Record<string, unknown>>("/auth/refresh", { method: "POST" })),
  logout: () => request<void>("/auth/logout", { method: "POST" }),
  currentUser: async (accessToken: string) => normaliseUser(await request<Record<string, unknown>>("/users/me", { accessToken })),
  requestPasswordReset: (email: string) => request<void>("/auth/password/reset/request", { method: "POST", body: { email } }),
  resetPassword: (token: string, newPassword: string) => request<void>("/auth/password/reset/confirm", { method: "POST", body: { token, newPassword } }),
  verifyEmail: (token: string) => request<void>("/auth/email/verify", { method: "POST", body: { token } }),
  resendEmailVerification: (accessToken: string) => request<void>("/auth/email/resend", { method: "POST", accessToken }),
  organizations: (accessToken: string) => request<Organization[]>("/organizations", { accessToken }),
  billingConfiguration: (organizationId: string, accessToken: string) => billingRequest<BillingConfiguration>(organizationId, "configuration", accessToken),
  billingSubscription: (organizationId: string, accessToken: string) => billingRequest<BillingSubscription>(organizationId, "subscription", accessToken),
  createCheckout: (organizationId: string, priceId: string, accessToken: string) => billingRequest<BillingRedirect>(organizationId, "checkout", accessToken, { priceId, quantity: 1 }),
  createPortal: (organizationId: string, accessToken: string) => billingRequest<BillingRedirect>(organizationId, "portal", accessToken),
  beginOAuth: async (provider: OAuthProvider): Promise<never> => {
    // Nest reports configured providers and returns a URL. FastAPI has no
    // provider list and owns the redirect at /start. Both keep PKCE and
    // provider secrets on the backend.
    try {
      const providers = await request<Array<{ provider: string; configured: boolean }>>("/auth/oauth/providers", { method: "GET" });
      if (!providers.some((item) => item.provider === provider && item.configured)) {
        throw new ApiError("Este proveedor OAuth no está configurado.", 400, "OAUTH_PROVIDER_UNAVAILABLE");
      }
      const result = await request<Record<string, unknown>>(`/auth/oauth/${provider}`, { method: "GET" });
      if (typeof result.authorizationUrl === "string" && result.authorizationUrl) {
        window.location.assign(result.authorizationUrl);
        return new Promise<never>(() => undefined);
      }
      throw new ApiError("El proveedor OAuth no devolvió una URL de autorización.", 502, "OAUTH_PROVIDER_ERROR");
    } catch (cause) {
      if (!(cause instanceof ApiError) || cause.status !== 404) throw cause;
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- FastAPI must own the provider redirect and callback cookies.
      window.location.assign(`${apiBaseUrl}/auth/oauth/${provider}/start`);
      return new Promise<never>(() => undefined);
    }
  },
};
