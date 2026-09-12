export type User = {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  isActive: boolean;
  avatarUrl?: string | null;
};

type ApiErrorBody = { error?: { code?: string; message?: string }; message?: string | string[] };

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
  ) {
    super(message);
    this.name = "ApiError";
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
    throw new ApiError("No se ha podido contactar con la API. Comprueba NEXT_PUBLIC_API_BASE_URL.", 0, "NETWORK_ERROR");
  }

  if (response.status === 204) return undefined as T;
  const responseBody = (await response.json().catch(() => ({}))) as T & ApiErrorBody;
  if (!response.ok) {
    const message = Array.isArray(responseBody.message)
      ? responseBody.message.join(", ")
      : responseBody.error?.message ?? responseBody.message ?? "La operación no se ha podido completar.";
    throw new ApiError(message, response.status, responseBody.error?.code);
  }
  return responseBody;
}

export type Authentication = { accessToken: string; user: User };
export type OAuthProvider = "google" | "github";

function authentication(input: Record<string, unknown>): Authentication {
  return { accessToken: String(input.accessToken ?? input.access_token), user: normaliseUser(input.user as Record<string, unknown>) };
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
