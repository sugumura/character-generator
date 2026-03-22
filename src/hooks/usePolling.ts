import { useState, useEffect, useRef, useCallback } from "react";
import { fetchAuthSession } from "aws-amplify/auth";
import type { Character } from "../types";

const POLLING_INTERVAL_MS = 5000;

function allDone(characters: Character[]): boolean {
  return (
    characters.length > 0 &&
    characters.every(
      (c) => c.generationStatus === "completed" || c.generationStatus === "failed"
    )
  );
}

export function usePolling(
  projectId: string,
  apiBaseUrl: string
): { characters: Character[]; isPolling: boolean } {
  const [characters, setCharacters] = useState<Character[]>([]);
  const [isPolling, setIsPolling] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setIsPolling(false);
  }, []);

  const fetchCharacters = useCallback(async () => {
    if (!projectId || !apiBaseUrl) return;

    try {
      const session = await fetchAuthSession();
      const idToken = session.tokens?.idToken?.toString();

      const response = await fetch(
        `${apiBaseUrl}/projects/${projectId}/characters`,
        {
          headers: {
            Authorization: `Bearer ${idToken}`,
          },
        }
      );

      if (!response.ok) return;

      const data = await response.json();
      const fetched: Character[] = data.data ?? data;

      setCharacters(fetched);

      if (allDone(fetched)) {
        stopPolling();
      }
    } catch {
      // silently ignore fetch errors; polling will retry
    }
  }, [projectId, apiBaseUrl, stopPolling]);

  useEffect(() => {
    if (!projectId || !apiBaseUrl) return;

    // Initial fetch
    fetchCharacters();

    // Start polling
    setIsPolling(true);
    intervalRef.current = setInterval(fetchCharacters, POLLING_INTERVAL_MS);

    return () => {
      stopPolling();
    };
  }, [projectId, apiBaseUrl, fetchCharacters, stopPolling]);

  return { characters, isPolling };
}
