// Turns a failed API response into text a user can read (SPEC.md D6).
export async function errorMessage(res: Response): Promise<string> {
  const fallback = `Server error (HTTP ${res.status})`;
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return fallback;
  }

  const detail = (body as { detail?: unknown } | null)?.detail;
  if (typeof detail === "string") return detail;

  // Our own validation errors: {"detail": {"validation_errors": [...]}}
  const validationErrors = (detail as { validation_errors?: unknown } | null)?.validation_errors;
  if (Array.isArray(validationErrors) && validationErrors.length > 0) {
    return validationErrors.join("\n");
  }

  // FastAPI/Pydantic request validation: {"detail": [{"loc": [...], "msg": "..."}]}
  if (Array.isArray(detail) && detail.length > 0) {
    return detail
      .map((d: { loc?: unknown[]; msg?: string }) => {
        const field = d.loc?.[d.loc.length - 1];
        return field !== undefined ? `${field}: ${d.msg}` : String(d.msg);
      })
      .join("\n");
  }

  return fallback;
}
