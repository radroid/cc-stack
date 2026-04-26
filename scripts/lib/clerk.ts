// Clerk Backend API client — only the endpoints we need for onboarding.
// Docs: https://clerk.com/docs/reference/backend-api
import { HttpError, request } from "./http";

const CLERK_API = "https://api.clerk.com/v1";

type Instance = {
  object: "instance";
  id: string;
  environment_type: "development" | "production";
  // The hostname Clerk serves the Frontend API from. The JWT issuer is just
  // `https://${frontend_api}` (no path).
  frontend_api?: string;
  home_url?: string;
};

type JwtTemplate = {
  id: string;
  name: string;
  claims?: Record<string, unknown>;
  lifetime?: number;
  allowed_clock_skew?: number;
};

export class ClerkClient {
  constructor(private secretKey: string) {}

  private headers(): Record<string, string> {
    return { Authorization: `Bearer ${this.secretKey}` };
  }

  async getInstance(): Promise<Instance> {
    return request<Instance>(`${CLERK_API}/instance`, { headers: this.headers() });
  }

  /** Returns `https://<frontend_api>` — what Convex's `auth.config.ts` expects. */
  async getJwtIssuerDomain(): Promise<string> {
    const inst = await this.getInstance();
    if (!inst.frontend_api) {
      throw new Error(
        "Clerk instance has no frontend_api — is this a fresh dev instance? " +
          "Try refreshing the dashboard and re-running.",
      );
    }
    return `https://${inst.frontend_api}`;
  }

  async listJwtTemplates(): Promise<JwtTemplate[]> {
    return request<JwtTemplate[]>(`${CLERK_API}/jwt_templates`, { headers: this.headers() });
  }

  /** Idempotent: PATCHes if a template named `convex` exists, otherwise POSTs. */
  async ensureConvexJwtTemplate(): Promise<JwtTemplate> {
    const body = {
      name: "convex",
      claims: { aud: "convex" },
      lifetime: 3600,
      allowed_clock_skew: 5,
    };

    const existing = await this.listJwtTemplates();
    const found = existing.find((t) => t.name === "convex");
    if (found) {
      return request<JwtTemplate>(`${CLERK_API}/jwt_templates/${found.id}`, {
        method: "PATCH",
        headers: this.headers(),
        body,
      });
    }
    return request<JwtTemplate>(`${CLERK_API}/jwt_templates`, {
      method: "POST",
      headers: this.headers(),
      body,
    });
  }

  /** Whitelist a redirect URL on the instance. Idempotent on the Clerk side. */
  async addRedirectUrl(url: string): Promise<void> {
    try {
      await request(`${CLERK_API}/redirect_urls`, {
        method: "POST",
        headers: this.headers(),
        body: { url },
      });
    } catch (err) {
      if (err instanceof HttpError && err.status === 422) {
        // already exists — fine
        return;
      }
      throw err;
    }
  }

  /** PATCH /v1/instance — used to set allowed_origins. */
  async updateInstance(body: { allowed_origins?: string[] }): Promise<Instance> {
    return request<Instance>(`${CLERK_API}/instance`, {
      method: "PATCH",
      headers: this.headers(),
      body,
    });
  }
}
