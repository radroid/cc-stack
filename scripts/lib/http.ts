// Thin fetch wrapper with sane defaults and structured errors so callers can
// match on status without unwrapping.

export class HttpError extends Error {
  constructor(
    public status: number,
    public statusText: string,
    public body: unknown,
    public url: string,
  ) {
    super(`HTTP ${status} ${statusText} on ${url}`);
    this.name = "HttpError";
  }
}

export type RequestInit = {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  headers?: Record<string, string>;
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
};

export async function request<T = unknown>(url: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    ...(init.headers ?? {}),
  };

  let body: BodyInit | undefined;
  if (init.body !== undefined) {
    headers["Content-Type"] ??= "application/json";
    body = JSON.stringify(init.body);
  }

  let finalUrl = url;
  if (init.query) {
    const u = new URL(url);
    for (const [k, v] of Object.entries(init.query)) {
      if (v !== undefined) u.searchParams.set(k, String(v));
    }
    finalUrl = u.toString();
  }

  const res = await fetch(finalUrl, { method: init.method ?? "GET", headers, body });
  const text = await res.text();
  let parsed: unknown = text;
  if (text && (res.headers.get("content-type") ?? "").includes("json")) {
    try {
      parsed = JSON.parse(text);
    } catch {
      // leave as text
    }
  }

  if (!res.ok) {
    throw new HttpError(res.status, res.statusText, parsed, finalUrl);
  }
  return parsed as T;
}
