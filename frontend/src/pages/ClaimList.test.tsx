import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { claim, jsonResponse, mockFetch, textResponse } from "../test/helpers";
import { ClaimList } from "./ClaimList";

function renderList() {
  return render(
    <MemoryRouter>
      <ClaimList />
    </MemoryRouter>
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("ClaimList", () => {
  it("R8: shows a loading indicator, not the empty state, while the request is in flight", () => {
    mockFetch(() => new Promise<Response>(() => {}));
    renderList();
    expect(screen.getByText(/loading/i)).toBeTruthy();
    expect(screen.queryByText(/no claims/i)).toBeNull();
  });

  it("R9/F1: HTTP 500 with an empty body shows an error banner with Retry, not the empty state", async () => {
    mockFetch(async () => textResponse(500, ""));
    renderList();
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Couldn't load claims (HTTP 500).");
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
    expect(screen.queryByText(/no claims/i)).toBeNull();
  });

  it("R9/F2: a network failure shows the network-error banner with Retry", async () => {
    mockFetch(async () => {
      throw new TypeError("Failed to fetch");
    });
    renderList();
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Couldn't load claims (network error).");
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  });

  it("R10/F3: an empty successful response shows the empty state linking to Submit", async () => {
    mockFetch(async () => jsonResponse(200, { claims: [], total: 0 }));
    renderList();
    expect(await screen.findByText("No claims yet.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Submit a claim" }).getAttribute("href")).toBe("/submit");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("R9/F4: Retry refetches and replaces the banner with the claims", async () => {
    let calls = 0;
    mockFetch(async () => {
      calls += 1;
      return calls === 1
        ? textResponse(500, "")
        : jsonResponse(200, { claims: [claim({ patient_name: "Alice" })], total: 1 });
    });
    renderList();
    fireEvent.click(await screen.findByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Alice")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("F5: renders one row per claim and neither the empty state nor the banner", async () => {
    mockFetch(async () =>
      jsonResponse(200, {
        claims: [claim({ id: 1, patient_name: "Alice" }), claim({ id: 2, patient_name: "Bob" })],
        total: 2,
      })
    );
    renderList();
    expect(await screen.findByText("Alice")).toBeTruthy();
    expect(screen.getByText("Bob")).toBeTruthy();
    expect(screen.queryByText(/no claims/i)).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
