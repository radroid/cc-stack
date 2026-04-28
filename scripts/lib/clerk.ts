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
  constructor(
    private secretKey: string,
    private publishableKey?: string,
  ) {}

  private headers(): Record<string, string> {
    return { Authorization: `Bearer ${this.secretKey}` };
  }

  async getInstance(): Promise<Instance> {
    return request<Instance>(`${CLERK_API}/instance`, { headers: this.headers() });
  }

  /**
   * Returns `https://<frontend_api>` — what Convex's `auth.config.ts` expects.
   *
   * Prefers decoding from the publishable key (always populated, no API call
   * needed). Falls back to `/v1/instance` if no publishable key was passed to
   * the constructor.
   */
  async getJwtIssuerDomain(): Promise<string> {
    if (this.publishableKey) {
      return jwtIssuerFromPublishableKey(this.publishableKey);
    }
    const inst = await this.getInstance();
    if (!inst.frontend_api) {
      throw new Error(
        "Clerk instance has no frontend_api — pass the publishable key to ClerkClient " +
          "or refresh the dashboard and re-run.",
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

/**
 * Decode the Frontend API hostname from a Clerk publishable key.
 *
 * Publishable keys are `pk_(test|live)_<base64(<host>$)>`. The trailing `$`
 * is a sentinel Clerk uses to validate the encoding. We strip it to get the
 * raw hostname, e.g. `thankful-dane-92.clerk.accounts.dev`.
 *
 * This is more reliable than calling `/v1/instance` for `frontend_api`, which
 * can return undefined on fresh dev instances.
 */
export function frontendApiFromPublishableKey(pk: string): string {
  const m = /^pk_(test|live)_(.+)$/.exec(pk.trim());
  if (!m) throw new Error(`Not a Clerk publishable key: ${pk.slice(0, 12)}…`);
  const encoded = m[2];
  let decoded: string;
  try {
    decoded = Buffer.from(encoded, "base64").toString("utf8");
  } catch {
    throw new Error("Could not base64-decode the publishable key payload.");
  }
  const host = decoded.replace(/\$+$/, "");
  if (!host || !host.includes(".")) {
    throw new Error(`Decoded publishable key payload doesn't look like a hostname: ${decoded}`);
  }
  return host;
}

/** Convenience: returns the JWT issuer URL (`https://<host>`) for a publishable key. */
export function jwtIssuerFromPublishableKey(pk: string): string {
  return `https://${frontendApiFromPublishableKey(pk)}`;
}
