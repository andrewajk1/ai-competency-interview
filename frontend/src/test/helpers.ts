import { vi } from "vitest";

export function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function textResponse(status: number, body: string): Response {
  return new Response(body, { status, headers: { "Content-Type": "text/plain" } });
}

type Handler = (url: string, init?: RequestInit) => Promise<Response>;

/** Replaces global fetch with `handler`; returns the mock so tests can inspect calls. */
export function mockFetch(handler: Handler) {
  const fn = vi.fn((input: RequestInfo | URL, init?: RequestInit) => handler(String(input), init));
  vi.stubGlobal("fetch", fn);
  return fn;
}

export function claim(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    practice_id: "practice-1",
    patient_name: "Alice",
    payer_id: 1,
    status: "pending",
    total_amount: 65,
    created_at: "2026-10-26T12:00:00",
    updated_at: "2026-10-26T12:00:00",
    procedures: [{ id: 1, claim_id: 1, code: "D0120", description: "", amount: 65 }],
    ...overrides,
  };
}
