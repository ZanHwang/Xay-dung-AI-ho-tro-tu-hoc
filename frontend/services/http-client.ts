const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "/api";
const AUTH_TOKEN_KEY = "jarvis.auth.token";

type RequestOptions = Omit<RequestInit, "body"> & {
  body?: unknown;
};

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

// Token management functions
export function setAuthToken(token: string): void {
  if (typeof window !== "undefined") {
    sessionStorage.setItem(AUTH_TOKEN_KEY, token);
  }
}

export function getAuthToken(): string | null {
  if (typeof window === "undefined") return null;
  return sessionStorage.getItem(AUTH_TOKEN_KEY);
}

export function clearAuthToken(): void {
  if (typeof window !== "undefined") {
    sessionStorage.removeItem(AUTH_TOKEN_KEY);
  }
}

export function isAuthenticated(): boolean {
  return getAuthToken() !== null;
}

// --- Sliding session -------------------------------------------------------
// Access tokens are short-lived; while the user is actually using the app we
// swap the token for a fresh one (POST /auth/refresh) before it expires, so
// they are only logged out after a long stretch of inactivity - not in the
// middle of a quiz or a chat.
const REFRESH_WHEN_REMAINING_MS = 10 * 60 * 1000;
const ACTIVE_WITHIN_MS = 30 * 60 * 1000;
let refreshing: Promise<void> | null = null;
let lastActivity = Date.now();

function tokenExpiresAt(token: string): number | null {
  try {
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return typeof payload.exp === "number" ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

function refreshTokenIfNeeded(): void {
  const token = getAuthToken();
  if (!token || refreshing) return;
  const expiresAt = tokenExpiresAt(token);
  if (expiresAt === null) return;
  const remaining = expiresAt - Date.now();
  if (remaining <= 0 || remaining > REFRESH_WHEN_REMAINING_MS) return;
  refreshing = fetch(`${API_BASE_URL}/auth/refresh`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  })
    .then(async (response) => {
      if (!response.ok) return;
      const data = (await response.json()) as { access_token?: string };
      // Only replace the token we refreshed - not one set by a new login meanwhile.
      if (data.access_token && getAuthToken() === token) setAuthToken(data.access_token);
    })
    .catch(() => { /* next activity/request tries again */ })
    .finally(() => { refreshing = null; });
}

if (typeof window !== "undefined") {
  const markActive = () => { lastActivity = Date.now(); };
  window.addEventListener("pointerdown", markActive, { passive: true });
  window.addEventListener("keydown", markActive, { passive: true });
  window.setInterval(() => {
    if (Date.now() - lastActivity < ACTIVE_WITHIN_MS) refreshTokenIfNeeded();
  }, 60 * 1000);
}

async function send(path: string, options: RequestOptions = {}): Promise<Response> {
  const token = getAuthToken();
  const multipart = options.body instanceof FormData;
  const headers = new Headers(options.headers);

  if (!multipart && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");

  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers,
    body: multipart ? (options.body as FormData) : JSON.stringify(options.body),
  });

  // Handle 401 - token expired or invalid
  if (response.status === 401) {
    clearAuthToken();
    // Redirect to login if in browser
    if (typeof window !== "undefined" && !path.includes("/auth/")) {
      window.location.href = "/login";
    }
  }

  if (!response.ok) {
    let errorMessage = "Không thể xử lý yêu cầu.";
    try {
      const errorData = (await response.json()) as {
        detail?: string | { msg?: string }[];
        message?: string;
      };
      const detail = typeof errorData.detail === "string" ? errorData.detail : errorData.detail?.[0]?.msg;
      errorMessage = detail?.replace(/^Value error, /, "") || errorData.message || errorMessage;
    } catch {
      // Use default message
    }
    throw new ApiError(errorMessage, response.status);
  }
  if (!path.includes("/auth/")) refreshTokenIfNeeded();
  return response;
}

async function request<T>(path: string, options?: RequestOptions): Promise<T> {
  const response = await send(path, options);
  // Handle 204 No Content
  if (response.status === 204) {
    return {} as T;
  }

  return response.json() as Promise<T>;
}

export const httpClient = {
  get: <T>(path: string) => request<T>(path),
  getBlob: async (path: string) => (await send(path)).blob(),
  post: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "POST", body }),
  put: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "PUT", body }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "PATCH", body }),
};
