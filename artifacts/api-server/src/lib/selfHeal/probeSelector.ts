export interface ProbeSelectorResult<T> {
  element: T | null;
  matchedSelector: string | null;
  usedFallback: boolean;
}

export async function probeSelector<T>(
  resolver: (selector: string) => Promise<T | null>,
  selectors: string[],
): Promise<ProbeSelectorResult<T>> {
  for (let i = 0; i < selectors.length; i++) {
    const selector = selectors[i];
    const element = await resolver(selector);
    if (element) {
      return {
        element,
        matchedSelector: selector,
        usedFallback: i > 0,
      };
    }
  }
  return { element: null, matchedSelector: null, usedFallback: false };
}

