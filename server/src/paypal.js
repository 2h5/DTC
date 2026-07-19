"use strict";

const MAX_RESPONSE_BYTES = 512 * 1024;

class PayPalTransportError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "PayPalTransportError";
    this.ambiguous = Boolean(options.ambiguous);
    this.code = options.code || "PAYPAL_UNAVAILABLE";
  }
}

function safeDebugId(data) {
  return data && typeof data.debug_id === "string" && /^[A-Za-z0-9-]{1,64}$/.test(data.debug_id)
    ? data.debug_id
    : undefined;
}

function firstIssue(data) {
  const issue = data && Array.isArray(data.details) && data.details[0] && data.details[0].issue;
  return typeof issue === "string" && /^[A-Z0-9_]{1,80}$/.test(issue) ? issue : undefined;
}

class PayPalClient {
  constructor(options) {
    this.baseUrl = options.baseUrl;
    this.clientId = options.clientId;
    this.clientSecret = options.clientSecret;
    this.fetchImpl = options.fetchImpl || globalThis.fetch;
    this.timeoutMs = options.timeoutMs;
    this.maxRetries = options.maxRetries;
    this.clock = options.clock || (() => Date.now());
    this.sleep = options.sleep || ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.token = null;
  }

  async createOrder(body, requestId) {
    return this.request("/v2/checkout/orders", {
      method: "POST",
      headers: { "PayPal-Request-Id": requestId, Prefer: "return=representation" },
      body: JSON.stringify(body),
    });
  }

  async getOrder(orderID) {
    return this.request(`/v2/checkout/orders/${encodeURIComponent(orderID)}`, { method: "GET" });
  }

  async captureOrder(orderID, requestId) {
    return this.request(`/v2/checkout/orders/${encodeURIComponent(orderID)}/capture`, {
      method: "POST",
      headers: { "PayPal-Request-Id": requestId, Prefer: "return=representation" },
      body: "{}",
    });
  }

  async verifyWebhook(payload) {
    return this.request("/v1/notifications/verify-webhook-signature", {
      method: "POST",
      retryable: true,
      body: JSON.stringify(payload),
    });
  }

  async request(apiPath, options) {
    let refreshed = false;
    while (true) {
      const token = await this.#getAccessToken();
      const result = await this.#requestWithRetries(`${this.baseUrl}${apiPath}`, {
        method: options.method,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          "Content-Type": "application/json",
          ...(options.headers || {}),
        },
        body: options.body,
        retryable:
          options.retryable || options.method === "GET" || Boolean(options.headers && options.headers["PayPal-Request-Id"]),
      });
      if (result.status !== 401 || refreshed) return result;
      this.token = null;
      refreshed = true;
    }
  }

  async #getAccessToken() {
    if (this.token && this.clock() < this.token.expiresAt - 60_000) return this.token.value;
    const credentials = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString("base64");
    const result = await this.#requestWithRetries(`${this.baseUrl}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
      retryable: true,
    });
    if (!result.ok || typeof result.data.access_token !== "string" || !Number.isFinite(result.data.expires_in)) {
      throw new PayPalTransportError("PayPal authentication failed.", { ambiguous: false, code: "PAYPAL_AUTH_FAILED" });
    }
    this.token = {
      value: result.data.access_token,
      expiresAt: this.clock() + Math.max(60, result.data.expires_in) * 1000,
    };
    return this.token.value;
  }

  async #requestWithRetries(url, options) {
    let lastNetworkError;
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      try {
        const result = await this.#singleRequest(url, options);
        const transient = result.status === 429 || result.status >= 500;
        if (transient && options.retryable && attempt < this.maxRetries) {
          await this.sleep(100 * 2 ** attempt);
          continue;
        }
        return { ...result, ambiguous: transient && options.retryable };
      } catch (error) {
        lastNetworkError = error;
        if (!options.retryable || attempt >= this.maxRetries) break;
        await this.sleep(100 * 2 ** attempt);
      }
    }
    throw new PayPalTransportError("PayPal request timed out or failed in transit.", {
      ambiguous: Boolean(options.retryable),
      code: lastNetworkError && lastNetworkError.name === "AbortError" ? "PAYPAL_TIMEOUT" : "PAYPAL_NETWORK_ERROR",
    });
  }

  async #singleRequest(url, options) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    timeout.unref?.();
    let response;
    try {
      response = await this.fetchImpl(url, {
        method: options.method,
        headers: options.headers,
        body: options.body,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
    const contentLength = Number(response.headers.get("content-length") || 0);
    if (contentLength > MAX_RESPONSE_BYTES) throw new PayPalTransportError("PayPal response was unexpectedly large.");
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > MAX_RESPONSE_BYTES) {
      throw new PayPalTransportError("PayPal response was unexpectedly large.");
    }
    let data = {};
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = {};
      }
    }
    return {
      ok: response.ok,
      status: response.status,
      data,
      debugId: safeDebugId(data),
      issue: firstIssue(data),
    };
  }
}

module.exports = { PayPalClient, PayPalTransportError, firstIssue, safeDebugId };
