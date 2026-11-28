import { httpClient, setAuthToken, clearAuthToken, getAuthToken } from "@/services/http-client";

// =============================================================================
// Backend API Types
// =============================================================================

export interface ApiUser {
  id: string;
  email: string;
  full_name: string;
  role: string; // student | teacher
  is_active: boolean;
  created_at: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface RegisterRequest {
  email: string;
  full_name: string;
  password: string;
  confirm_password: string;
  role?: "student" | "teacher";
}

export interface AuthToken {
  access_token: string;
  token_type: string;
}

// =============================================================================
// Frontend User Types (aligned with design)
// =============================================================================

export interface UserProfile {
  id: string;
  name: string;
  email: string;
  // Optional so existing profile literals (demo data, settings) keep compiling;
  // the backend always returns it on /auth/me.
  role?: "student" | "teacher";
  major?: string;
  goal?: string;
}

// =============================================================================
// Map Backend to Frontend
// =============================================================================

function mapApiUserToProfile(user: ApiUser): UserProfile {
  return {
    id: user.id,
    name: user.full_name,
    email: user.email,
    role: (user.role as "student" | "teacher") || "student",
  };
}

// =============================================================================
// Auth State Management
// =============================================================================

let currentUser: UserProfile | null = null;
const listeners = new Set<() => void>();

function notifyListeners() {
  listeners.forEach((listener) => listener());
}

// =============================================================================
// Auth API Service
// =============================================================================

export const authApi = {
  /**
   * Login with email and password
   */
  async login(email: string, password: string): Promise<UserProfile> {
    // Backend expects form-urlencoded data
    const formData = new URLSearchParams();
    formData.append("username", email);
    formData.append("password", password);

    // Use direct fetch to /api/auth/login (bypass httpClient because login needs form-urlencoded)
    const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000/api";
    const loginUrl = baseUrl.endsWith("/api") ? `${baseUrl}/auth/login` : `${baseUrl}/api/auth/login`;

    const response = await fetch(loginUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: formData.toString(),
    });

    if (!response.ok) {
      let errorMessage = "Đăng nhập thất bại.";
      try {
        const errorData = (await response.json()) as { detail?: string; message?: string };
        errorMessage = errorData.detail || errorData.message || errorMessage;
      } catch {
        // Use default
      }
      throw new Error(errorMessage);
    }

    const token: AuthToken = await response.json();
    setAuthToken(token.access_token);

    // Fetch user profile after login
    const user = await this.getCurrentUser();
    currentUser = user;
    notifyListeners();

    return user;
  },

  /**
   * Register a new user account. Does not sign in: the user logs in afterwards.
   */
  async register(input: RegisterRequest): Promise<UserProfile> {
    const user = await httpClient.post<ApiUser>("/auth/register", {
      email: input.email,
      full_name: input.full_name,
      password: input.password,
      confirm_password: input.confirm_password,
      role: input.role ?? "student",
    });

    return mapApiUserToProfile(user);
  },

  /**
   * Get current authenticated user
   */
  async getCurrentUser(): Promise<UserProfile> {
    const user: ApiUser = await httpClient.get("/auth/me");
    return mapApiUserToProfile(user);
  },

  /**
   * Logout current user
   */
  async logout(): Promise<void> {
    try {
      await httpClient.post("/auth/logout", {});
    } catch {
      // Ignore errors on logout
    }
    clearAuthToken();
    currentUser = null;
    notifyListeners();
  },

  /**
   * Check if user is authenticated (hydrate from stored token)
   */
  async current(): Promise<UserProfile | null> {
    const token = getAuthToken();
    if (!token) return null;

    try {
      const user = await this.getCurrentUser();
      currentUser = user;
      return user;
    } catch {
      // Token invalid or expired
      clearAuthToken();
      currentUser = null;
      return null;
    }
  },

  /**
   * Subscribe to auth state changes
   */
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  /**
   * Get current user synchronously (must call current() first)
   */
  getCurrentUserSync(): UserProfile | null {
    return currentUser;
  },

  /**
   * Update user profile
   */
  async updateProfile(data: { full_name?: string }): Promise<UserProfile> {
    const user: ApiUser = await httpClient.put("/auth/me", data);
    currentUser = mapApiUserToProfile(user);
    notifyListeners();
    return currentUser;
  },

  /**
   * Change password
   */
  async changePassword(oldPassword: string, newPassword: string): Promise<void> {
    await httpClient.post("/auth/change-password", {
      old_password: oldPassword,
      new_password: newPassword,
    });
  },
};

// =============================================================================
// Auth Error Helpers
// =============================================================================

export function authErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return "Đã xảy ra lỗi không xác định. Vui lòng thử lại.";
}
