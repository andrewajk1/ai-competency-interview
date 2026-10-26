import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { claim, jsonResponse, mockFetch, textResponse } from "../test/helpers";
import { ClaimDetail } from "./ClaimDetail";
import { ClaimList } from "./ClaimList";
import { SubmitClaim } from "./SubmitClaim";

afterEach(() => vi.unstubAllGlobals());

function renderAt(path: string | { pathname: string; state: unknown }, extra?: React.ReactNode) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/" element={<ClaimList />} />
        <Route path="/submit" element={<SubmitClaim />} />
        <Route path="/claims/:id" element={<ClaimDetail />} />
      </Routes>
      {extra}
    </MemoryRouter>
  );
}

describe("Amendment 1", () => {
  it("R16/F13: a 200 non-JSON list body shows the invalid-response banner with Retry", async () => {
    mockFetch(async () => textResponse(200, "<html></html>"));
    renderAt("/");
    expect((await screen.findByRole("alert")).textContent).toContain("Couldn't load claims (invalid response).");
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
    expect(screen.queryByText(/loading/i)).toBeNull();
  });

  it("R16/F14: a 200 body without a claims array shows the same banner", async () => {
    mockFetch(async () => jsonResponse(200, { items: [] }));
    renderAt("/");
    expect((await screen.findByRole("alert")).textContent).toContain("Couldn't load claims (invalid response).");
  });

  it("R17/F15: double-clicking a status action sends one PATCH", async () => {
    let resolvePatch: (r: Response) => void = () => {};
    const fetchMock = mockFetch((_url, init) =>
      init?.method === "PATCH"
        ? new Promise<Response>((r) => (resolvePatch = r))
        : Promise.resolve(jsonResponse(200, claim({ status: "pending" })))
    );
    renderAt("/claims/1");
    const button = await screen.findByRole("button", { name: "Reject Claim" });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH")).toHaveLength(1);
    expect((button as HTMLButtonElement).disabled).toBe(true);
    resolvePatch(jsonResponse(200, claim({ status: "rejected" })));
    await screen.findByText("rejected");
  });

  it("R18/F16: the flash shows once and is cleared from history state", async () => {
    mockFetch(async () => jsonResponse(200, { claims: [], total: 0 }));
    let seenState: unknown = "unset";
    function StateProbe() {
      seenState = useLocation().state;
      return null;
    }
    renderAt({ pathname: "/", state: { flash: "X" } }, <StateProbe />);
    expect(await screen.findByText("X")).toBeTruthy();
    await waitFor(() => expect(seenState).toBeNull());
  });

  it("R19/F17: a submit network failure shows the network-error banner", async () => {
    mockFetch(async () => {
      throw new TypeError("Failed to fetch");
    });
    renderAt("/submit");
    fireEvent.change(screen.getByLabelText("Patient Name"), { target: { value: "Jane" } });
    fireEvent.change(screen.getByLabelText("Payer ID"), { target: { value: "1" } });
    fireEvent.change(screen.getByPlaceholderText("Code (e.g. D0120)"), { target: { value: "D0120" } });
    fireEvent.change(screen.getByPlaceholderText("Amount"), { target: { value: "50" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit Claim" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Couldn't submit claim (network error).");
  });

  it("R19/F18: a status-update network failure shows the banner and keeps the status", async () => {
    mockFetch(async (_url, init) => {
      if (init?.method === "PATCH") throw new TypeError("Failed to fetch");
      return jsonResponse(200, claim({ status: "pending" }));
    });
    const { container } = renderAt("/claims/1");
    fireEvent.click(await screen.findByRole("button", { name: "Reject Claim" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Couldn't update status (network error).");
    expect(container.querySelector(".status-badge")?.textContent).toBe("pending");
  });
});
