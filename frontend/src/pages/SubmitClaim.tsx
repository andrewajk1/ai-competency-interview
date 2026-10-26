import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { errorMessage } from "../api/errors";

interface ProcedureInput {
  code: string;
  amount: string;
}

export function SubmitClaim() {
  const navigate = useNavigate();
  const [patientName, setPatientName] = useState("");
  const [payerId, setPayerId] = useState("");
  const [procedures, setProcedures] = useState<ProcedureInput[]>([
    { code: "", amount: "" },
  ]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/claims", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          practice_id: "practice-1",
          patient_name: patientName,
          payer_id: parseInt(payerId, 10),
          procedures: procedures.map((p) => ({
            code: p.code,
            amount: parseFloat(p.amount),
          })),
          total_amount: procedures.reduce(
            (sum, p) => sum + parseFloat(p.amount || "0"),
            0
          ),
        }),
      });

      if (!response.ok) {
        setError(await errorMessage(response));
        setIsSubmitting(false);
        return;
      }

      navigate("/", { state: { flash: "Claim submitted successfully" } });
    } catch {
      setError("Couldn't submit claim (network error).");
      setIsSubmitting(false);
    }
  };

  const updateProcedure = (index: number, field: keyof ProcedureInput, value: string) => {
    setProcedures((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      return updated;
    });
  };

  const removeProcedure = (index: number) => {
    setProcedures((prev) => prev.filter((_, i) => i !== index));
  };

  return (
    <div className="page">
      <h1>Submit Claim</h1>
      {error && (
        <div className="error-banner" role="alert" style={{ whiteSpace: "pre-line" }}>
          {error}
        </div>
      )}
      <form onSubmit={handleSubmit}>
        <div className="field">
          <label htmlFor="patient-name">Patient Name</label>
          <input
            id="patient-name"
            value={patientName}
            onChange={(e) => setPatientName(e.target.value)}
            required
          />
        </div>
        <div className="field">
          <label htmlFor="payer-id">Payer ID</label>
          <input
            id="payer-id"
            value={payerId}
            onChange={(e) => setPayerId(e.target.value)}
            required
          />
        </div>
        <div className="procedures">
          <h2>Procedures</h2>
          {procedures.map((proc, i) => (
            <div key={i} className="procedure-row">
              <input
                placeholder="Code (e.g. D0120)"
                value={proc.code}
                onChange={(e) => updateProcedure(i, "code", e.target.value)}
              />
              <input
                placeholder="Amount"
                type="number"
                step="0.01"
                value={proc.amount}
                onChange={(e) => updateProcedure(i, "amount", e.target.value)}
              />
              {procedures.length > 1 && (
                <button type="button" onClick={() => removeProcedure(i)}>
                  Remove
                </button>
              )}
            </div>
          ))}
          <button
            type="button"
            onClick={() => setProcedures((prev) => [...prev, { code: "", amount: "" }])}
          >
            + Add Procedure
          </button>
        </div>
        <button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Submitting..." : "Submit Claim"}
        </button>
      </form>
    </div>
  );
}
