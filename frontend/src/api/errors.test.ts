import { describe, expect, it } from "vitest";
import { jsonResponse, textResponse } from "../test/helpers";
import { errorMessage } from "./errors";

// SPEC.md D6
describe("errorMessage", () => {
  it("D6: lists validation_errors one per line", async () => {
    const res = jsonResponse(422, { detail: { validation_errors: ["A", "B"] } });
    expect(await errorMessage(res)).toBe("A\nB");
  });

  it("D6/F7: formats a Pydantic detail array as '<last loc>: <msg>'", async () => {
    const res = jsonResponse(422, {
      detail: [
        { loc: ["body", "payer_id"], msg: "Input should be a valid integer" },
        { loc: ["body", "procedures", 0, "amount"], msg: "Field required" },
      ],
    });
    expect(await errorMessage(res)).toBe("payer_id: Input should be a valid integer\namount: Field required");
  });

  it("D6: passes a string detail through as-is", async () => {
    const res = jsonResponse(400, { detail: "Cannot transition from 'pending' to 'accepted'" });
    expect(await errorMessage(res)).toBe("Cannot transition from 'pending' to 'accepted'");
  });

  it("D6/F8: non-JSON body falls back to 'Server error (HTTP <code>)'", async () => {
    expect(await errorMessage(textResponse(500, "Internal Server Error"))).toBe("Server error (HTTP 500)");
  });

  it("D6: JSON without a usable detail falls back too", async () => {
    expect(await errorMessage(jsonResponse(502, { oops: true }))).toBe("Server error (HTTP 502)");
  });
});
