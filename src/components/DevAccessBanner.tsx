"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ChevronDown, ChevronUp, Shield, Wrench, User, LogOut, ExternalLink } from "lucide-react";
import type { DevRole } from "@/lib/dev-access";

export function DevAccessBanner() {
  const router = useRouter();
  const pathname = usePathname();
  const [activeRole, setActiveRole] = useState<DevRole | "guest">("guest");
  const [collapsed, setCollapsed] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // Read cookie directly on client
    const match = document.cookie.match(/(?:^|; )onise_dev_role=([^;]*)/);
    if (match && (match[1] === "admin" || match[1] === "artisan" || match[1] === "customer")) {
      setActiveRole(match[1]);
    } else {
      setActiveRole("guest");
    }
  }, [pathname]);

  async function handleSwitchRole(role: DevRole | "logout", redirectUrl?: string) {
    if (loading) return;
    setLoading(true);
    try {
      const res = await fetch("/api/dev/switch-role", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role, redirectUrl }),
      });
      const data = (await res.json()) as { ok?: boolean; redirectUrl?: string; activeRole?: DevRole | null };
      if (data.ok) {
        setActiveRole(data.activeRole ?? "guest");
        router.push(data.redirectUrl ?? "/");
        router.refresh();
      }
    } catch (err) {
      console.error("Failed to switch dev role:", err);
    } finally {
      setLoading(false);
    }
  }

  return (
    <aside
      aria-label="Developer access bar"
      className="sticky top-0 z-50 border-b border-amber-300 bg-amber-500/95 text-gray-950 shadow-md backdrop-blur-md transition-all"
    >
      <div className="mx-auto flex max-w-7xl items-center justify-between px-3 py-1.5 text-xs">
        {/* Left: Indicator & Current Persona */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1 rounded bg-black/85 px-1.5 py-0.5 font-mono text-[10px] font-black uppercase tracking-wider text-amber-300">
            ⚡ DEV ACCESS
          </span>
          <span className="font-semibold text-gray-950">
            Active:{" "}
            <span className="rounded bg-white/70 px-1.5 py-0.5 font-bold uppercase tracking-tight text-gray-900">
              {activeRole === "admin"
                ? "👑 Admin (Adewale)"
                : activeRole === "artisan"
                  ? "🔧 Artisan (Kazeem)"
                  : activeRole === "customer"
                    ? "👤 Customer (Chioma)"
                    : "🚪 Guest (Not signed in)"}
            </span>
          </span>
        </div>

        {/* Center / Right: Quick Switcher & Toggle */}
        <div className="flex items-center gap-2">
          {!collapsed ? (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="hidden text-[11px] font-medium text-gray-900 sm:inline">Switch to:</span>
              <button
                type="button"
                disabled={loading || activeRole === "admin"}
                onClick={() => handleSwitchRole("admin", "/admin")}
                className={`inline-flex items-center gap-1 rounded-md px-2 py-1 font-bold transition ${
                  activeRole === "admin"
                    ? "bg-gray-950 text-amber-300 ring-2 ring-amber-200"
                    : "bg-white text-gray-900 hover:bg-gray-100"
                } disabled:opacity-70`}
                title="Log in as Admin superuser with full access to /admin"
              >
                <Shield className="h-3 w-3" />
                Admin
              </button>

              <button
                type="button"
                disabled={loading || activeRole === "artisan"}
                onClick={() => handleSwitchRole("artisan", "/dashboard")}
                className={`inline-flex items-center gap-1 rounded-md px-2 py-1 font-bold transition ${
                  activeRole === "artisan"
                    ? "bg-gray-950 text-amber-300 ring-2 ring-amber-200"
                    : "bg-white text-gray-900 hover:bg-gray-100"
                } disabled:opacity-70`}
                title="Log in as verified artisan with Online switch and incoming requests"
              >
                <Wrench className="h-3 w-3" />
                Artisan
              </button>

              <button
                type="button"
                disabled={loading || activeRole === "customer"}
                onClick={() => handleSwitchRole("customer", "/find")}
                className={`inline-flex items-center gap-1 rounded-md px-2 py-1 font-bold transition ${
                  activeRole === "customer"
                    ? "bg-gray-950 text-amber-300 ring-2 ring-amber-200"
                    : "bg-white text-gray-900 hover:bg-gray-100"
                } disabled:opacity-70`}
                title="Log in as customer with map discovery and job posting"
              >
                <User className="h-3 w-3" />
                Customer
              </button>

              {activeRole !== "guest" ? (
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => handleSwitchRole("logout", "/login")}
                  className="inline-flex items-center gap-1 rounded-md border border-gray-900/30 bg-black/10 px-2 py-1 font-semibold text-gray-900 hover:bg-black/20"
                  title="Clear dev session and test public pages"
                >
                  <LogOut className="h-3 w-3" />
                  Logout
                </button>
              ) : null}

              {/* Quick links to high-interest screens */}
              <div className="hidden items-center gap-1 border-l border-amber-600/40 pl-2 lg:flex">
                <a
                  href="/find"
                  className="rounded px-1.5 py-0.5 text-[11px] font-semibold text-gray-950 underline hover:bg-white/40"
                >
                  Map
                </a>
                <a
                  href="/jobs"
                  className="rounded px-1.5 py-0.5 text-[11px] font-semibold text-gray-950 underline hover:bg-white/40"
                >
                  Jobs
                </a>
                <a
                  href="/admin"
                  className="rounded px-1.5 py-0.5 text-[11px] font-semibold text-gray-950 underline hover:bg-white/40"
                >
                  Admin
                </a>
                <a
                  href="/settings"
                  className="rounded px-1.5 py-0.5 text-[11px] font-semibold text-gray-950 underline hover:bg-white/40"
                >
                  Settings
                </a>
              </div>
            </div>
          ) : null}

          <button
            type="button"
            onClick={() => setCollapsed(!collapsed)}
            className="rounded p-1 text-gray-950 hover:bg-white/30"
            title={collapsed ? "Expand dev banner" : "Minimize dev banner"}
            aria-label="Toggle dev banner"
          >
            {collapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
          </button>
        </div>
      </div>
    </aside>
  );
}
