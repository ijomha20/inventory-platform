export interface ProbeFieldResult<T> {
  value: T | null;
  matchedCandidate: string | null;
  usedFallback: boolean;
}

export function probeField<T = unknown>(
  document: Record<string, unknown> | null | undefined,
  candidates: string[],
): ProbeFieldResult<T> {
  const doc = document ?? {};
  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];
    const raw = doc[candidate];
    if (raw !== undefined && raw !== null && String(raw).trim() !== "") {
      return {
        value: raw as T,
        matchedCandidate: candidate,
        usedFallback: i > 0,
      };
    }
  }
  return { value: null, matchedCandidate: null, usedFallback: false };
}

