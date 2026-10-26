import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { claim, jsonResponse, mockFetch, textResponse } from "../test/helpers";
import { ClaimList } from "./ClaimList";
import { SubmitClaim } from "./SubmitClaim";

function renderSubmit() {
  return render(
    <MemoryRouter initialEntries={["/submit"]}>
      <Routes>
        <Route path="/" element={<ClaimList />} />
        <Route path="/submit" element={<SubmitClaim />} />
      </Routes>
    </MemoryRouter>
  );
}

function fillAndSubmit() {
  fireEvent.change(screen.getByLabelText("Patient Name"), { target: { value: "Jane Roe" } });
  fireEvent.change(screen.getByLabelText("Payer ID"), { target: { value: "1" } });
  fireEvent.change(screen.getByPlaceholderText("Code (e.g. D0120)"), { target: { value: "D0120" } });
  fireEvent.change(screen.getByPlaceholderText("Amount"), { target: { value: "50" } });
  fireEvent.click(screen.getByRole("button", { name: "Submit Claim" }));
}

afterEach(() => vi.unstubAllGlobals());

describe("SubmitClaim", () => {
  it("R11/F6: shows every validation error and keeps the form values", async () => {
    mockFetch(async () => jsonResponse(422, { detail: { validation_errors: ["A", "B"] } }));
    renderSubmit();
    fillAndSubmit();
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("A");
    expect(alert.textContent).toContain("B");
    expect((screen.getByLabelText("Patient Name") as HTMLInputElement).value).toBe("Jane Roe");
  });

  it("R11/F7: shows a Pydantic field error as '<field>: <msg>'", async () => {
    mockFetch(async () =>
      jsonResponse(422, { detail: [{ loc: ["body", "payer_id"], msg: "Input should be a valid integer" }] })
    );
    renderSubmit();
    fillAndSubmit();
    expect((await screen.findByRole("alert")).textContent).toContain("payer_id: Input should be a valid integer");
  });

  it("R11/F8: a plain-text 500 shows 'Server error (HTTP 500)'", async () => {
    mockFetch(async () => textResponse(500, "Internal Server Error"));
    renderSubmit();
    fillAndSubmit();
    expect((await screen.findByRole("alert")).textContent).toContain("Server error (HTTP 500)");
  });

  it("R12/F9: on success navigates to the list and shows the success message", async () => {
    mockFetch(async (url, init) =>
      init?.method === "POST"
        ? jsonResponse(200, { claim: claim({ patient_name: "Jane Roe" }), message: "Claim submitted successfully" })
        : jsonResponse(200, { claims: [claim({ patient_name: "Jane Roe" })], total: 1 })
    );
    renderSubmit();
    fillAndSubmit();
    expect(await screen.findByText("Claim submitted successfully")).toBeTruthy();
    expect(await screen.findByText("Jane Roe")).toBeTruthy();
    expect(screen.queryByLabelText("Patient Name")).toBeNull();
  });
});
