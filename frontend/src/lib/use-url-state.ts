import { useEffect, type DependencyList } from "react";

/**
 * On mount, reads each key from the URL search params and calls the
 * corresponding setter if the param is present.
 *
 * For simple key→value params (e.g. swap page: from/to/amount/slippage).
 */
export function useUrlRestore(handlers: Record<string, (value: string) => void>) {
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    for (const [key, handler] of Object.entries(handlers)) {
      const val = p.get(key);
      if (val !== null) handler(val);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

/**
 * On mount, calls `restore` with the current URLSearchParams.
 *
 * For pages that need custom parsing (e.g. routing-lab, program-builder).
 */
export function useUrlRestoreOnce(restore: (p: URLSearchParams) => void) {
  useEffect(() => {
    restore(new URLSearchParams(window.location.search));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

/**
 * Whenever `deps` change, calls `build` to get a URLSearchParams and
 * pushes it to the URL via replaceState (no history entry).
 * An empty URLSearchParams reverts to the bare pathname.
 */
export function useUrlWrite(build: () => URLSearchParams, deps: DependencyList) {
  useEffect(() => {
    const qs = build().toString();
    history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
