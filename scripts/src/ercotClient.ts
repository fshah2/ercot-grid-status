import { CONFIG } from "./config.js";
import { ApiResponse } from "./types.js";

export class ErcotClient {
  // Global throttling across ALL requests for this process
  private static lastRequestAt = 0;

  constructor(
    private readonly idToken: string,
    private readonly subscriptionKey: string
  ) {}

  async fetchAllPages(path: string, query: Record<string, string>): Promise<ApiResponse[]> {
    const pages: ApiResponse[] = [];
    let page = 1;

    while (page <= CONFIG.maxPagesPerEndpoint) {
      const url = new URL(CONFIG.apiBase + path);

      for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);

      // Common paging parameters supported by many ERCOT endpoints
      url.searchParams.set("size", String(CONFIG.pageSize));
      url.searchParams.set("page", String(page));

      const res = await this.requestWithRetry(url.toString(), path);

      const text = await res.text();
      if (!res.ok) {
        throw new Error(`GET ${path} failed (${res.status}). Body: ${text.slice(0, 600)}`);
      }

      const json = JSON.parse(text) as ApiResponse;
      pages.push(json);

      const nextHref = json._links?.next?.href;
      if (!nextHref) break;

      page += 1;

      // Additional small delay between pages (keeps it gentle even if next exists)
      await sleep(CONFIG.interPageDelayMs);
    }

    return pages;
  }

  /**
   * Throttled request + 429 retry/backoff.
   *
   * Why: ERCOT rate limiting can be bursty (per-second). Even if you're under 30/min,
   * multiple calls back-to-back can trigger 429.
   */
  private async requestWithRetry(url: string, endpointPath: string): Promise<Response> {
    const maxAttempts = 6;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      await this.throttle();

      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${this.idToken}`,
          "Ocp-Apim-Subscription-Key": this.subscriptionKey
        }
      });

      if (res.status !== 429) return res;

      // 429: rate limited. Respect Retry-After if provided, else parse body, else backoff.
      const retryAfter = parseRetryAfterSeconds(res);
      const bodyText = await safeReadText(res);

      const secondsFromBody = parseTryAgainSeconds(bodyText);
      const waitSeconds =
        retryAfter ??
        secondsFromBody ??
        Math.min(30, 2 ** (attempt - 1)); // 1,2,4,8,16,30

      console.warn(
        `[RATE LIMIT] 429 from ${endpointPath}. Waiting ${waitSeconds}s (attempt ${attempt}/${maxAttempts}).`
      );

      await sleep(waitSeconds * 1000);
      // then retry
    }

    // If we somehow exhausted attempts, do one last request to capture the final status/body
    await this.throttle();
    return fetch(url, {
      headers: {
        Authorization: `Bearer ${this.idToken}`,
        "Ocp-Apim-Subscription-Key": this.subscriptionKey
      }
    });
  }

  /**
   * Ensure minimum spacing between ANY two requests.
   *
   * Set this to ~1200ms to stay well under per-second burst limits.
   * (30/min is 2000ms; 1200ms is still conservative and faster.)
   */
  private async throttle() {
    const minGapMs = 1200; // conservative per-second throttle
    const now = Date.now();
    const elapsed = now - ErcotClient.lastRequestAt;

    if (elapsed < minGapMs) {
      await sleep(minGapMs - elapsed);
    }

    ErcotClient.lastRequestAt = Date.now();
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function parseRetryAfterSeconds(res: Response): number | null {
  const ra = res.headers.get("retry-after");
  if (!ra) return null;

  const n = Number(ra);
  if (Number.isFinite(n) && n >= 0) return n;

  // Sometimes Retry-After can be an HTTP date; ignore here.
  return null;
}

async function safeReadText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "";
  }
}

function parseTryAgainSeconds(body: string): number | null {
  // Example: { "statusCode": 429, "message": "Rate limit is exceeded. Try again in 1 seconds." }
  const m = body.match(/Try again in\s+(\d+)\s+seconds?/i);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}
