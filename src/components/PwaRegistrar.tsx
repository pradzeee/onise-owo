"use client";

import { useEffect } from "react";

export function PwaRegistrar() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;

    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Service worker registration fails silently on unsupported contexts
    });
  }, []);

  return null;
}
