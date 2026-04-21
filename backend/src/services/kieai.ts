export interface KeyValidationSuccess {
  valid: true;
  balance: number;
}

export interface KeyValidationFailure {
  valid: false;
  errorCode:
    | "invalid_api_key"
    | "key_expired"
    | "rate_limit_exceeded"
    | "provider_error"
    | "network_error";
  message: string;
}

export type KeyValidationResult = KeyValidationSuccess | KeyValidationFailure;

const TIMEOUT_MS = 10_000;

function getBaseUrl(): string {
  return process.env.KIEAI_API_BASE_URL || "https://api.kie.ai";
}

export async function validateKieaiKey(
  apiKey: string
): Promise<KeyValidationResult> {
  const url = `${getBaseUrl()}/api/v1/chat/credit`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    const message =
      err instanceof DOMException && err.name === "TimeoutError"
        ? "Request to Kie.ai timed out"
        : "Failed to reach Kie.ai API";
    return { valid: false, errorCode: "network_error", message };
  }

  if (response.ok) {
    try {
      const body = (await response.json()) as Record<string, unknown>;
      // Response format: { code: 200, msg: "success", data: 6991 }
      const balance = typeof body.data === "number" ? body.data : 0;
      return { valid: true, balance };
    } catch {
      return {
        valid: false,
        errorCode: "provider_error",
        message: "Invalid response from Kie.ai",
      };
    }
  }

  switch (response.status) {
    case 401:
      return {
        valid: false,
        errorCode: "invalid_api_key",
        message: "API key is invalid",
      };
    case 403:
      return {
        valid: false,
        errorCode: "key_expired",
        message: "API key has expired",
      };
    case 429:
      return {
        valid: false,
        errorCode: "rate_limit_exceeded",
        message: "Rate limit exceeded, try again later",
      };
    default:
      return {
        valid: false,
        errorCode: "provider_error",
        message: `Kie.ai returned status ${response.status}`,
      };
  }
}
