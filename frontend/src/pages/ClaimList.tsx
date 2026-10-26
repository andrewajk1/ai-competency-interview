import { useCallback, useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import type { Claim, ClaimsListResponse } from "../types/api";

const PRACTICE_ID = "practice-1";

type ListState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "loaded"; claims: Claim[] };

export function ClaimList() {
  const [state, setState] = useState<ListState>({ kind: "loading" });
  // Message passed via router state, e.g. after a successful submit.
  const flash = (useLocation().state as { flash?: string } | null)?.flash;

  const loadClaims = useCallback(async () => {
    setState({ kind: "loading" });
    let res: Response;
    try {
      res = await fetch(`/api/claims?practice_id=${PRACTICE_ID}`);
    } catch {
      setState({ kind: "error", message: "Couldn't load claims (network error)." });
      return;
    }
    if (!res.ok) {
      setState({ kind: "error", message: `Couldn't load claims (HTTP ${res.status}).` });
      return;
    }
    const data: ClaimsListResponse = await res.json();
    setState({ kind: "loaded", claims: data.claims });
  }, []);

  useEffect(() => {
    loadClaims();
  }, [loadClaims]);

  return (
    <div className="page">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
        <h1 style={{ margin: 0 }}>Claims</h1>
        <Link to="/submit">
          <button type="button">Submit New Claim</button>
        </Link>
      </div>
      {flash && (
        <div className="success-banner" role="status">
          {flash}
        </div>
      )}
      {state.kind === "error" && (
        <div className="error-banner" role="alert">
          {state.message}{" "}
          <button type="button" onClick={loadClaims}>
            Retry
          </button>
        </div>
      )}
      {state.kind === "loading" && <p>Loading claims…</p>}
      {state.kind === "loaded" && (
        <table>
          <thead>
            <tr>
              <th>Patient</th>
              <th>Status</th>
              <th>Amount</th>
              <th>Submitted</th>
            </tr>
          </thead>
          <tbody>
            {state.claims.map((claim) => (
              <tr key={claim.id}>
                <td>
                  <Link to={`/claims/${claim.id}`}>{claim.patient_name}</Link>
                </td>
                <td>
                  <span className={`status-badge status-${claim.status}`}>
                    {claim.status}
                  </span>
                </td>
                <td>${claim.total_amount.toFixed(2)}</td>
                <td>{new Date(claim.created_at).toLocaleDateString()}</td>
              </tr>
            ))}
            {state.claims.length === 0 && (
              <tr>
                <td colSpan={4} style={{ textAlign: "center", color: "#888", padding: "2rem" }}>
                  No claims yet. <Link to="/submit">Submit a claim</Link>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}
