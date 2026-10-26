import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { claim, jsonResponse, mockFetch } from "../test/helpers";
import { ClaimDetail } from "./ClaimDetail";

function renderDetail() {
  return render(
    <MemoryRouter initialEntries={["/claims/1"]}>
      <Routes>
        <Route path="/claims/:id" element={<ClaimDetail />} />
      </Routes>
    </MemoryRouter>
  );
}

function badge(container: HTMLElement) {
  return container.querySelector(".status-badge")?.textContent;
}

afterEach(() => vi.unstubAllGlobals());

describe("ClaimDetail", () => {
  it("R13/F10: a rejected PATCH shows the server detail and keeps the status", async () => {
    mockFetch(async (_url, init) =>
      init?.method === "PATCH"
        ? jsonResponse(400, { detail: "Cannot transition from 'pending' to 'accepted'" })
        : jsonResponse(200, claim({ status: "pending" }))
    );
    const { container } = renderDetail();
    fireEvent.click(await screen.findByRole("button", { name: "Reject Claim" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("Cannot transition from 'pending' to 'accepted'");
    expect(badge(container)).toBe("pending");
  });

  it("R14/F11: a successful PATCH displays the claim returned by the server", async () => {
    // GET keeps answering 'pending', so 'rejected' can only come from the PATCH response.
    mockFetch(async (_url, init) =>
      init?.method === "PATCH"
        ? jsonResponse(200, claim({ status: "rejected" }))
        : jsonResponse(200, claim({ status: "pending" }))
    );
    const { container } = renderDetail();
    fireEvent.click(await screen.findByRole("button", { name: "Reject Claim" }));
    await screen.findByText("rejected");
    expect(badge(container)).toBe("rejected");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("R15/F12: a 404 on load shows 'Claim not found.' instead of crashing", async () => {
    mockFetch(async () => jsonResponse(404, { detail: "Not found" }));
    renderDetail();
    expect(await screen.findByText("Claim not found.")).toBeTruthy();
  });
});
