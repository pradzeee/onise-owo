"use client";

import { useEffect, useRef, useState } from "react";
import { ShieldAlert, ShieldCheck } from "lucide-react";

declare global {
  interface Window {
    turnstile?: {
      render: (
        container: HTMLElement,
        options: {
          sitekey: string;
          callback: (token: string) => void;
          "expired-callback": () => void;
          "error-callback": () => void;
          theme?: "light" | "dark" | "auto";
        },
      ) => string;
      reset: (widgetId?: string) => void;
      remove: (widgetId: string) => void;
    };
  }
}

interface TurnstileWidgetProps {
  onTokenChange: (token: string) => void;
  resetSignal?: number;
}

export function TurnstileWidget({ onTokenChange, resetSignal = 0 }: TurnstileWidgetProps) {
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "";
  const devFallbackAllowed =
    process.env.NODE_ENV !== "production" &&
    process.env.NEXT_PUBLIC_ENABLE_DEV_CAPTCHA === "true";

  const containerRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<string | null>(null);
  const [devChecked, setDevChecked] = useState(false);

  // Reset widget when parent bumps resetSignal (e.g. after failed submit or resend)
  useEffect(() => {
    if (resetSignal === 0) return;
    if (siteKey && window.turnstile && widgetIdRef.current) {
      window.turnstile.reset(widgetIdRef.current);
      onTokenChange("");
    } else if (!siteKey && devFallbackAllowed) {
      setDevChecked(false);
      onTokenChange("");
    }
  }, [resetSignal, siteKey, devFallbackAllowed, onTokenChange]);

  useEffect(() => {
    if (!siteKey) return;

    let cancelled = false;

    const mountWidget = () => {
      if (cancelled || !containerRef.current || !window.turnstile) return;
      if (widgetIdRef.current) return;

      widgetIdRef.current = window.turnstile.render(containerRef.current, {
        sitekey: siteKey,
        theme: "light",
        callback: (token: string) => onTokenChange(token),
        "expired-callback": () => onTokenChange(""),
        "error-callback": () => onTokenChange(""),
      });
    };

    const existingScript = document.querySelector<HTMLScriptElement>(
      'script[data-turnstile="true"]',
    );

    if (existingScript) {
      if (window.turnstile) {
        mountWidget();
      } else {
        existingScript.addEventListener("load", mountWidget, { once: true });
      }
    } else {
      const script = document.createElement("script");
      script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      script.async = true;
      script.defer = true;
      script.dataset.turnstile = "true";
      script.addEventListener("load", mountWidget, { once: true });
      document.head.appendChild(script);
    }

    return () => {
      cancelled = true;
      if (widgetIdRef.current && window.turnstile) {
        window.turnstile.remove(widgetIdRef.current);
        widgetIdRef.current = null;
      }
    };
  }, [siteKey, onTokenChange]);

  if (siteKey) {
    return (
      <div className="rounded-xl border border-gray-200 bg-gray-50 p-3">
        <div ref={containerRef} className="min-h-[65px]" />
      </div>
    );
  }

  if (devFallbackAllowed) {
    return (
      <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-amber-300 bg-amber-50/70 p-3.5 text-sm text-gray-800">
        <input
          type="checkbox"
          checked={devChecked}
          onChange={(e) => {
            const next = e.target.checked;
            setDevChecked(next);
            onTokenChange(next ? "dev-captcha-passed" : "");
          }}
          className="h-5 w-5 rounded border-gray-400 text-[#0B6E4F] focus:ring-[#0B6E4F]"
        />
        <span className="flex flex-1 items-center justify-between gap-2">
          <span className="font-medium">I am human (Dev CAPTCHA)</span>
          <span className="inline-flex items-center gap-1 text-xs text-amber-800">
            <ShieldCheck className="h-4 w-4" aria-hidden="true" />
            Local dev only
          </span>
        </span>
      </label>
    );
  }

  return (
    <div className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-800">
      <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <p>
        CAPTCHA is not configured. Set{" "}
        <code className="font-mono">NEXT_PUBLIC_TURNSTILE_SITE_KEY</code> and{" "}
        <code className="font-mono">TURNSTILE_SECRET_KEY</code> in your environment.
      </p>
    </div>
  );
}
