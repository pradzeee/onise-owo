import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { APP_NAME } from "@/lib/constants";
import { LogoutButton } from "./LogoutButton";

interface HeaderProps {
  isAuthenticated?: boolean;
  roleLabel?: string | null;
}

export function Header({ isAuthenticated = false, roleLabel }: HeaderProps) {
  return (
    <header className="sticky top-0 z-30 border-b border-gray-100/80 bg-white/90 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-4xl items-center justify-between px-4 sm:px-6">
        <Link
          href={isAuthenticated ? "/dashboard" : "/"}
          className="flex items-center gap-2.5 font-extrabold tracking-tight text-gray-900 transition hover:opacity-90"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-[#0B6E4F] to-[#08523B] text-white shadow-xs">
            <ShieldCheck className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="flex flex-col">
            <span className="text-base font-extrabold leading-tight tracking-tight sm:text-lg">
              {APP_NAME}
            </span>
            <span className="text-[10px] font-semibold uppercase tracking-wider text-[#0B6E4F]">
              Nigeria
            </span>
          </div>
        </Link>

        <nav className="flex items-center gap-3 text-sm">
          {isAuthenticated ? (
            <div className="flex items-center gap-3">
              {roleLabel ? (
                <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-[#EBF7F2] px-3 py-1 text-xs font-bold capitalize text-[#08523B]">
                  <span className="h-1.5 w-1.5 rounded-full bg-[#0B6E4F]" />
                  {roleLabel}
                </span>
              ) : null}
              <LogoutButton />
            </div>
          ) : (
            <div className="flex items-center gap-2 sm:gap-3">
              <Link
                href="/login"
                className="rounded-xl px-3.5 py-2 text-sm font-bold text-gray-700 transition hover:bg-gray-100 hover:text-gray-900"
              >
                Log In
              </Link>
              <Link
                href="/signup"
                className="inline-flex min-h-10 items-center justify-center rounded-xl bg-[#0B6E4F] px-4 py-2 text-sm font-bold text-white shadow-xs transition hover:bg-[#08523B] active:scale-98"
              >
                Sign Up
              </Link>
            </div>
          )}
        </nav>
      </div>
    </header>
  );
}
