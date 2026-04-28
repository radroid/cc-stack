// PostHog API — minimal subset needed to bootstrap projects + environments.
// Docs: https://posthog.com/docs/api
import { HttpError, request } from "./http";

export type PostHogRegion = "us" | "eu";

const HOSTS: Record<PostHogRegion, string> = {
  us: "https://us.posthog.com",
  eu: "https://eu.posthog.com",
};

export const ANALYTICS_HOSTS: Record<PostHogRegion, string> = {
  us: "https://us.i.posthog.com",
  eu: "https://eu.i.posthog.com",
};

type Organization = {
  id: string;
  name: string;
};

type Project = {
  id: number;
  name: string;
  api_token: string;
};

type Environment = {
  id: number;
  name: string;
  api_token: string;
  project_id: number;
};

export class PostHogClient {
  private base: string;

  constructor(
    private personalApiKey: string,
    public region: PostHogRegion = "us",
  ) {
    this.base = HOSTS[region];
  }

  private headers(): Record<string, string> {
    return { Authorization: `Bearer ${this.personalApiKey}` };
  }

  /**
   * Returns the user's primary org id.
   *
   * Uses `/api/organizations/@current/` (covered by the `organization:read`
   * scope on scoped `phx_` personal API keys). We avoid `/api/users/@me/`
   * because that endpoint requires a separate `user:read` scope, which our
   * setup instructions didn't ask for.
   */
  async getOrgId(): Promise<string> {
    try {
      const org = await request<Organization>(`${this.base}/api/organizations/@current/`, {
        headers: this.headers(),
      });
      return org.id;
    } catch (err) {
      if (err instanceof HttpError && err.status === 403) {
        throw new Error(
          "PostHog rejected the personal API key (403). Make sure it has scope " +
            "`organization:read` (and `project:write` to create projects/environments).",
        );
      }
      throw err;
    }
  }

  async listProjects(orgId: string): Promise<Project[]> {
    const res = await request<{ results: Project[] }>(
      `${this.base}/api/organizations/${orgId}/projects/`,
      { headers: this.headers() },
    );
    return res.results;
  }

  async createProject(orgId: string, name: string): Promise<Project> {
    return request<Project>(`${this.base}/api/organizations/${orgId}/projects/`, {
      method: "POST",
      headers: this.headers(),
      body: { name },
    });
  }

  async listEnvironments(projectId: number): Promise<Environment[]> {
    try {
      const res = await request<{ results: Environment[] }>(
        `${this.base}/api/projects/${projectId}/environments/`,
        { headers: this.headers() },
      );
      return res.results;
    } catch (err) {
      // Older accounts may not have Environments enabled — surface a typed null.
      if (err instanceof HttpError && (err.status === 404 || err.status === 403)) {
        return [];
      }
      throw err;
    }
  }

  /** Idempotent: returns the existing env if one matches by name (case-insensitive). */
  async ensureEnvironment(projectId: number, name: string): Promise<Environment | null> {
    const existing = await this.listEnvironments(projectId);
    if (existing.length === 0) return null;
    const match = existing.find((e) => e.name.toLowerCase() === name.toLowerCase());
    if (match) return match;
    return request<Environment>(`${this.base}/api/projects/${projectId}/environments/`, {
      method: "POST",
      headers: this.headers(),
      body: { name },
    });
  }
}
