"use client";

import { useEffect } from "react";
import { onIdTokenChanged } from "firebase/auth";
import {
  getFirebaseAuth,
  isFirebaseClientConfigured,
} from "@/lib/firebase/client";

/**
 * Keeps the server-side HTTP-only Firebase ID token cookie synchronized
 * whenever the Firebase SDK refreshes the user's 1-hour JWT in the background.
 */
export function FirebaseTokenSync() {
  useEffect(() => {
    if (!isFirebaseClientConfigured()) return;

    const auth = getFirebaseAuth();
    const unsubscribe = onIdTokenChanged(auth, async (user) => {
      if (!user) return;
      try {
        const idToken = await user.getIdToken();
        await fetch("/api/auth/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ idToken, mode: "refresh" }),
        });
      } catch {
        // Ignore silent background sync errors on flaky networks
      }
    });

    return () => unsubscribe();
  }, []);

  return null;
}
