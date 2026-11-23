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
    <header className="sticky top-0 z-20 border-b border-gray-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-3xl items-center justify-between px-4">
        <Link
          href={isAuthenticated ? "/dashboard" : "/"}
          className="flex items-center gap-2 font-bold tracking-tight text-gray-900"
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#0B6E4F] text-white">
            <ShieldCheck className="h-4 w-4" aria-hidden="true" />
          </span>
          <span className="text-base sm:text-lg">{APP_NAME}</span>
        </Link>

        <nav className="flex items-center gap-3 text-sm">
          {isAuthenticated ? (
            <>
              {roleLabel ? (
                <span className="rounded-full bg-[#EBF7F2] px-2.5 py-1 text-xs font-semibold capitalize text-[#08523B]">
                  {roleLabel}
                </span>
              ) : null}
              <LogoutButton />
            </>
          ) : (
            <div className="flex items-center gap-2 sm:gap-3">
              <Link
                href="/login"
                className="px-2.5 py-1.5 text-sm font-semibold text-gray-700 transition hover:text-[#0B6E4F]"
              >
                Log in
              </Link>
              <Link
                href="/signup"
                className="inline-flex min-h-9 items-center rounded-lg bg-[#0B6E4F] px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-[#08523B]"
              >
                Sign up
              </Link>
            </div>
          )}
        </nav>
      </div>
    </header>
  );
}
