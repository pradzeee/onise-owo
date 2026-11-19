"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Camera,
  CheckCircle2,
  ExternalLink,
  Landmark,
  ScanFace,
  ShieldCheck,
  Upload,
  UserCheck,
} from "lucide-react";
import { TRADES, type ArtisanTrade } from "@/lib/constants";
import { NIGERIAN_BANKS } from "@/lib/banks";

interface ArtisanOnboardingFormProps {
  initialFullName?: string;
  initialTrade?: ArtisanTrade;
  initialBio?: string;
  initialWorkArea?: string;
}

function createIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `art-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function ArtisanOnboardingForm({
  initialFullName = "",
  initialTrade = "plumber",
  initialBio = "",
  initialWorkArea = "",
}: ArtisanOnboardingFormProps) {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2 | 3>(1);

  // Step 1: Profile, Guarantor, Payout Bank
  const [fullName, setFullName] = useState(initialFullName);
  const [trade, setTrade] = useState<ArtisanTrade>(initialTrade);
  const [bio, setBio] = useState(initialBio);
  const [workArea, setWorkArea] = useState(initialWorkArea);
  const [profilePhoto, setProfilePhoto] = useState<File | null>(null);
  const [guarantorName, setGuarantorName] = useState("");
  const [guarantorPhone, setGuarantorPhone] = useState("");
  const [bankCode, setBankCode] = useState(NIGERIAN_BANKS[6]?.code ?? "058");
  const [accountNumber, setAccountNumber] = useState("");

  // Step 2: Explicit face-matching consent
  const [faceConsentAccepted, setFaceConsentAccepted] = useState(false);

  // Step 3: NIN + Live Selfie
  const [nin, setNin] = useState("");
  const [selfie, setSelfie] = useState<File | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successData, setSuccessData] = useState<{
    providerStatus: string;
    livenessPassed: boolean;
    faceMatchPassed: boolean;
    devGuarantorLink?: string;
  } | null>(null);

  const idempotencyKeyRef = useRef<string>(createIdempotencyKey());

  function validateStep1(): string | null {
    if (fullName.trim().length < 2) return "Enter your full legal name.";
    if (!profilePhoto) return "Upload a clear profile photo.";
    if (bio.trim().length < 10) return "Write a short bio (at least 10 characters).";
    if (workArea.trim().length < 2) return "Enter your main work area (e.g. Ikeja, Lagos).";
    if (guarantorName.trim().length < 2) return "Enter your guarantor's full name.";
    if (guarantorPhone.replace(/\D/g, "").length < 10) {
      return "Enter your guarantor's valid Nigerian mobile number.";
    }
    if (!/^\d{10}$/.test(accountNumber.replace(/\s+/g, ""))) {
      return "Enter a valid 10-digit Nigerian bank account number (NUBAN).";
    }
    return null;
  }

  function handleNextFromStep1() {
    const err = validateStep1();
    if (err) {
      setError(err);
      return;
    }
    setError(null);
    setStep(2);
  }

  function handleNextFromStep2() {
    if (!faceConsentAccepted) {
      setError(
        "Please read and confirm your explicit consent for NIN face matching and liveness verification.",
      );
      return;
    }
    setError(null);
    setStep(3);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setError(null);

    const cleanNin = nin.replace(/[\s-]/g, "").trim();
    if (!/^\d{11}$/.test(cleanNin)) {
      setError("Enter a valid 11-digit NIN.");
      return;
    }
    if (!selfie) {
      setError("Take or upload a clear live selfie for face matching.");
      return;
    }
    if (!profilePhoto) {
      setError("Profile photo is required.");
      setStep(1);
      return;
    }

    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.set("fullName", fullName.trim());
      fd.set("trade", trade);
      fd.set("bio", bio.trim());
      fd.set("workArea", workArea.trim());
      fd.set("nin", cleanNin);
      fd.set("guarantorName", guarantorName.trim());
      fd.set("guarantorPhone", guarantorPhone.trim());
      fd.set("bankCode", bankCode);
      fd.set("accountNumber", accountNumber.replace(/\s+/g, "").trim());
      fd.set("faceMatchingConsentAccepted", "true");
      fd.set("idempotencyKey", idempotencyKeyRef.current);
      fd.set("profilePhoto", profilePhoto);
      fd.set("selfie", selfie);

      const res = await fetch("/api/artisan/onboarding", {
        method: "POST",
        headers: {
          "X-Idempotency-Key": idempotencyKeyRef.current,
        },
        body: fd,
      });

      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        verification?: {
          providerStatus: string;
          livenessPassed: boolean;
          faceMatchPassed: boolean;
        };
        devGuarantorLink?: string;
      };

      if (!res.ok) {
        setError(data.error ?? "Verification submission failed. Please review your details.");
        // Rotate idempotency key on hard validation/conflict errors so corrected retry succeeds
        idempotencyKeyRef.current = createIdempotencyKey();
        return;
      }

      // Immediately clear sensitive fields from memory
      setNin("");
      setAccountNumber("");
      setSuccessData({
        providerStatus: data.verification?.providerStatus ?? "pending",
        livenessPassed: Boolean(data.verification?.livenessPassed),
        faceMatchPassed: Boolean(data.verification?.faceMatchPassed),
        devGuarantorLink: data.devGuarantorLink,
      });
      router.refresh();
    } catch {
      setError("Network error while submitting. Your request is safe to retry.");
    } finally {
      setSubmitting(false);
    }
  }

  if (successData) {
    return (
      <div className="space-y-4 rounded-2xl border border-emerald-200 bg-white p-6 shadow-sm">
        <div className="flex items-start gap-3">
          <CheckCircle2 className="mt-0.5 h-6 w-6 shrink-0 text-[#0B6E4F]" />
          <div>
            <h2 className="text-lg font-bold text-gray-900">
              Verification application submitted
            </h2>
            <p className="mt-1 text-sm text-gray-600">
              Your profile is now <strong>pending admin review</strong>. Your NIN and bank
              details were not stored on our servers.
            </p>
          </div>
        </div>

        <div className="grid gap-3 rounded-xl bg-gray-50 p-4 text-xs sm:grid-cols-2">
          <div>
            <p className="text-gray-500">NIN + Face Match &amp; Liveness</p>
            <p className="mt-1 font-bold capitalize text-gray-900">
              {successData.providerStatus}{" "}
              {successData.providerStatus === "passed" ? "✓" : "✗"}
            </p>
          </div>
          <div>
            <p className="text-gray-500">Guarantor Confirmation SMS</p>
            <p className="mt-1 font-bold text-amber-700">Sent — awaiting guarantor OTP</p>
          </div>
        </div>

        {successData.devGuarantorLink ? (
          <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-xs text-amber-950">
            <p className="font-bold">Local dev mode — Guarantor confirmation link:</p>
            <p className="mt-1">
              Because <code className="font-mono">APP_SMS_PROVIDER=dev_mock</code>, open
              this link directly to test the guarantor privacy notice + OTP confirmation
              flow:
            </p>
            <a
              href={successData.devGuarantorLink}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-flex items-center gap-1.5 font-semibold text-[#0B6E4F] underline break-all"
            >
              {successData.devGuarantorLink}
              <ExternalLink className="h-3.5 w-3.5 shrink-0" />
            </a>
          </div>
        ) : null}

        <div className="flex flex-wrap gap-3 pt-2">
          <Link
            href="/dashboard"
            className="inline-flex min-h-11 items-center justify-center rounded-xl bg-[#0B6E4F] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#08523B]"
          >
            Back to dashboard
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6">
      {/* Stepper */}
      <ol className="mb-6 grid grid-cols-3 gap-2 text-xs">
        {[
          { num: 1, label: "1. Profile & Payout" },
          { num: 2, label: "2. Face Consent" },
          { num: 3, label: "3. NIN & Selfie" },
        ].map((item) => (
          <li
            key={item.num}
            className={`rounded-lg px-2.5 py-2 text-center font-semibold ${
              step === item.num
                ? "bg-[#0B6E4F] text-white"
                : step > item.num
                  ? "bg-[#EBF7F2] text-[#08523B]"
                  : "bg-gray-100 text-gray-500"
            }`}
          >
            {item.label}
          </li>
        ))}
      </ol>

      {error ? (
        <div
          role="alert"
          className="mb-4 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700"
        >
          {error}
        </div>
      ) : null}

      {/* STEP 1: Profile, Guarantor, Bank Payout */}
      {step === 1 ? (
        <div className="space-y-5">
          <div className="space-y-4">
            <h2 className="text-base font-bold text-gray-900">Your Artisan Profile</h2>

            <div>
              <label htmlFor="fullName" className="mb-1 block text-sm font-semibold text-gray-800">
                Full name (matches your NIN)
              </label>
              <input
                id="fullName"
                type="text"
                required
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="e.g. Adebayo Okafor"
                className="min-h-12 w-full rounded-xl border border-gray-300 px-3.5 text-base focus:border-[#0B6E4F] focus:outline-none focus:ring-2 focus:ring-[#0B6E4F]/20"
              />
            </div>

            <div>
              <label htmlFor="profilePhoto" className="mb-1 block text-sm font-semibold text-gray-800">
                Profile photo (shown to customers)
              </label>
              <label className="flex min-h-12 cursor-pointer items-center justify-between gap-3 rounded-xl border border-dashed border-gray-300 bg-gray-50 px-3.5 py-3 text-sm text-gray-700 hover:bg-gray-100">
                <span className="flex items-center gap-2 truncate">
                  <Upload className="h-4 w-4 shrink-0 text-[#0B6E4F]" />
                  <span className="truncate">
                    {profilePhoto ? profilePhoto.name : "Choose JPEG, PNG, or WebP (max 2 MB)"}
                  </span>
                </span>
                <input
                  id="profilePhoto"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={(e) => setProfilePhoto(e.target.files?.[0] ?? null)}
                  className="sr-only"
                />
                <span className="shrink-0 rounded-lg bg-white px-2.5 py-1 text-xs font-semibold text-[#0B6E4F] shadow-xs">
                  Select
                </span>
              </label>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="trade" className="mb-1 block text-sm font-semibold text-gray-800">
                  Trade
                </label>
                <select
                  id="trade"
                  value={trade}
                  onChange={(e) => setTrade(e.target.value as ArtisanTrade)}
                  className="min-h-12 w-full rounded-xl border border-gray-300 bg-white px-3.5 text-base focus:border-[#0B6E4F] focus:outline-none focus:ring-2 focus:ring-[#0B6E4F]/20"
                >
                  {TRADES.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="workArea" className="mb-1 block text-sm font-semibold text-gray-800">
                  Primary work area
                </label>
                <input
                  id="workArea"
                  type="text"
                  required
                  value={workArea}
                  onChange={(e) => setWorkArea(e.target.value)}
                  placeholder="e.g. Ikeja, Lagos or Wuse, Abuja"
                  className="min-h-12 w-full rounded-xl border border-gray-300 px-3.5 text-base focus:border-[#0B6E4F] focus:outline-none focus:ring-2 focus:ring-[#0B6E4F]/20"
                />
              </div>
            </div>

            <div>
              <label htmlFor="bio" className="mb-1 block text-sm font-semibold text-gray-800">
                Short bio (experience &amp; specialties)
              </label>
              <textarea
                id="bio"
                rows={3}
                maxLength={500}
                required
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                placeholder="e.g. 8 years fixing home plumbing, boreholes, water heaters, and bathroom fittings across Ikeja and Surulere."
                className="w-full rounded-xl border border-gray-300 p-3.5 text-sm focus:border-[#0B6E4F] focus:outline-none focus:ring-2 focus:ring-[#0B6E4F]/20"
              />
            </div>
          </div>

          <hr className="border-gray-100" />

          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <UserCheck className="h-4 w-4 text-[#0B6E4F]" />
              <h2 className="text-base font-bold text-gray-900">Guarantor Details</h2>
            </div>
            <p className="text-xs text-gray-600">
              We&apos;ll send your guarantor an SMS link with a short privacy notice so they
              can confirm your identity with a one-time code.
            </p>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="guarantorName" className="mb-1 block text-sm font-semibold text-gray-800">
                  Guarantor full name
                </label>
                <input
                  id="guarantorName"
                  type="text"
                  required
                  value={guarantorName}
                  onChange={(e) => setGuarantorName(e.target.value)}
                  placeholder="e.g. Chinedu Eze"
                  className="min-h-12 w-full rounded-xl border border-gray-300 px-3.5 text-base focus:border-[#0B6E4F] focus:outline-none focus:ring-2 focus:ring-[#0B6E4F]/20"
                />
              </div>
              <div>
                <label htmlFor="guarantorPhone" className="mb-1 block text-sm font-semibold text-gray-800">
                  Guarantor Nigerian mobile
                </label>
                <input
                  id="guarantorPhone"
                  type="tel"
                  inputMode="tel"
                  required
                  value={guarantorPhone}
                  onChange={(e) => setGuarantorPhone(e.target.value)}
                  placeholder="0803 987 6543"
                  className="min-h-12 w-full rounded-xl border border-gray-300 px-3.5 text-base focus:border-[#0B6E4F] focus:outline-none focus:ring-2 focus:ring-[#0B6E4F]/20"
                />
              </div>
            </div>
          </div>

          <hr className="border-gray-100" />

          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Landmark className="h-4 w-4 text-[#0B6E4F]" />
              <h2 className="text-base font-bold text-gray-900">Bank Account for Payouts</h2>
            </div>
            <p className="text-xs text-gray-600">
              Sent securely to Paystack to register your payout recipient code.{" "}
              <strong>We never store your bank account details.</strong>
            </p>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="bankCode" className="mb-1 block text-sm font-semibold text-gray-800">
                  Bank
                </label>
                <select
                  id="bankCode"
                  value={bankCode}
                  onChange={(e) => setBankCode(e.target.value)}
                  className="min-h-12 w-full rounded-xl border border-gray-300 bg-white px-3.5 text-base focus:border-[#0B6E4F] focus:outline-none focus:ring-2 focus:ring-[#0B6E4F]/20"
                >
                  {NIGERIAN_BANKS.map((bank) => (
                    <option key={bank.code} value={bank.code}>
                      {bank.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="accountNumber" className="mb-1 block text-sm font-semibold text-gray-800">
                  10-digit account number (NUBAN)
                </label>
                <input
                  id="accountNumber"
                  type="text"
                  inputMode="numeric"
                  maxLength={10}
                  required
                  value={accountNumber}
                  onChange={(e) =>
                    setAccountNumber(e.target.value.replace(/\D/g, "").slice(0, 10))
                  }
                  placeholder="0123456789"
                  className="min-h-12 w-full rounded-xl border border-gray-300 px-3.5 text-base tracking-wider focus:border-[#0B6E4F] focus:outline-none focus:ring-2 focus:ring-[#0B6E4F]/20"
                />
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={handleNextFromStep1}
            className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#0B6E4F] px-4 py-3 text-base font-semibold text-white transition hover:bg-[#08523B]"
          >
            Continue to Identity Verification Consent
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      ) : null}

      {/* STEP 2: Explicit Biometric Face Matching Consent Screen (BEFORE NIN check) */}
      {step === 2 ? (
        <div className="space-y-5">
          <div className="flex items-start gap-3 rounded-2xl border border-emerald-200 bg-[#EBF7F2] p-4">
            <ScanFace className="mt-0.5 h-6 w-6 shrink-0 text-[#0B6E4F]" />
            <div>
              <h2 className="text-base font-bold text-gray-900">
                Explicit Consent for NIN Check &amp; Face Matching
              </h2>
              <p className="mt-1 text-xs leading-relaxed text-[#08523B]">
                Before we ask for your NIN or selfie, please review how your biometric
                identity verification works under the Nigeria Data Protection Act (NDPA).
              </p>
            </div>
          </div>

          <ul className="space-y-3 rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700">
            <li className="flex items-start gap-2.5">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#0B6E4F]" />
              <span>
                <strong>Face match with liveness check:</strong> Your live selfie will be
                compared with your official NIN ID photo by our licensed Nigerian
                verification provider to confirm you are a real person and the rightful
                owner of the ID.
              </span>
            </li>
            <li className="flex items-start gap-2.5">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#0B6E4F]" />
              <span>
                <strong>Your NIN is never stored:</strong> We send your NIN only to our
                verification provider. We store only the provider reference, the pass/fail
                result, and a keyed one-way cryptographic hash so the same NIN cannot be
                used on two accounts.
              </span>
            </li>
            <li className="flex items-start gap-2.5">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#0B6E4F]" />
              <span>
                <strong>Private storage &amp; audit logging:</strong> Your selfie is kept
                in a private bucket. Reviewers can open it only through temporary 60-second
                signed links, and every access is recorded in our audit log.
              </span>
            </li>
            <li className="flex items-start gap-2.5">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#0B6E4F]" />
              <span>
                <strong>Withdrawable consent:</strong> This consent is recorded separately
                in your consent ledger and can be withdrawn at any time in your dashboard.
              </span>
            </li>
          </ul>

          <label className="flex cursor-pointer items-start gap-3 rounded-xl border-2 border-[#0B6E4F]/30 bg-white p-4">
            <input
              type="checkbox"
              checked={faceConsentAccepted}
              onChange={(e) => setFaceConsentAccepted(e.target.checked)}
              className="mt-0.5 h-5 w-5 shrink-0 rounded border-gray-400 text-[#0B6E4F] focus:ring-[#0B6E4F]"
            />
            <span className="text-sm leading-relaxed text-gray-900">
              I understand and explicitly consent to my NIN and live selfie being sent to{" "}
              <strong>Oníṣẹ́ ọwọ́&apos;s licensed verification provider</strong> for
              biometric face matching and liveness verification.
            </span>
          </label>

          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => {
                setError(null);
                setStep(1);
              }}
              className="inline-flex min-h-12 items-center justify-center gap-1.5 rounded-xl border border-gray-300 px-4 py-3 text-sm font-semibold text-gray-700 hover:bg-gray-50"
            >
              <ArrowLeft className="h-4 w-4" />
              Back
            </button>
            <button
              type="button"
              disabled={!faceConsentAccepted}
              onClick={handleNextFromStep2}
              className="flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-[#0B6E4F] px-4 py-3 text-base font-semibold text-white transition hover:bg-[#08523B] disabled:cursor-not-allowed disabled:opacity-60"
            >
              I Consent — Continue to NIN &amp; Selfie
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      ) : null}

      {/* STEP 3: NIN + Live Selfie */}
      {step === 3 ? (
        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <h2 className="text-base font-bold text-gray-900">
              NIN &amp; Live Selfie Verification
            </h2>
            <p className="mt-1 text-xs text-gray-600">
              Your NIN is sent directly to our verification provider and is never saved to
              our database.
            </p>
          </div>

          <div>
            <label htmlFor="nin" className="mb-1 block text-sm font-semibold text-gray-800">
              11-digit National Identification Number (NIN)
            </label>
            <input
              id="nin"
              type="text"
              inputMode="numeric"
              autoComplete="off"
              maxLength={11}
              required
              value={nin}
              onChange={(e) => setNin(e.target.value.replace(/\D/g, "").slice(0, 11))}
              placeholder="12345678901"
              className="min-h-12 w-full rounded-xl border border-gray-300 px-3.5 text-lg font-semibold tracking-widest focus:border-[#0B6E4F] focus:outline-none focus:ring-2 focus:ring-[#0B6E4F]/20"
            />
            {process.env.NODE_ENV !== "production" ? (
              <p className="mt-1.5 text-[11px] text-amber-800">
                Dev mock tip: Any 11-digit NIN passes; enter{" "}
                <code className="font-mono">00000000000</code> to simulate a failed face
                match/liveness check.
              </p>
            ) : null}
          </div>

          <div>
            <label htmlFor="selfie" className="mb-1 block text-sm font-semibold text-gray-800">
              Live selfie (good lighting, face clearly visible)
            </label>
            <label className="flex min-h-16 cursor-pointer items-center justify-between gap-3 rounded-xl border-2 border-dashed border-[#0B6E4F]/40 bg-[#EBF7F2]/40 px-4 py-4 text-sm text-gray-800 hover:bg-[#EBF7F2]/70">
              <span className="flex items-center gap-2.5 truncate">
                <Camera className="h-5 w-5 shrink-0 text-[#0B6E4F]" />
                <span className="truncate font-medium">
                  {selfie ? selfie.name : "Take live selfie or upload photo (max 4 MB)"}
                </span>
              </span>
              <input
                id="selfie"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                capture="user"
                onChange={(e) => setSelfie(e.target.files?.[0] ?? null)}
                className="sr-only"
              />
              <span className="shrink-0 rounded-lg bg-[#0B6E4F] px-3 py-1.5 text-xs font-semibold text-white">
                Capture
              </span>
            </label>
          </div>

          <div className="flex gap-3">
            <button
              type="button"
              disabled={submitting}
              onClick={() => {
                setError(null);
                setStep(2);
              }}
              className="inline-flex min-h-12 items-center justify-center gap-1.5 rounded-xl border border-gray-300 px-4 py-3 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-60"
            >
              <ArrowLeft className="h-4 w-4" />
              Back
            </button>
            <button
              type="submit"
              disabled={submitting || nin.length !== 11 || !selfie}
              className="flex min-h-12 flex-1 items-center justify-center rounded-xl bg-[#0B6E4F] px-4 py-3 text-base font-semibold text-white transition hover:bg-[#08523B] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting
                ? "Verifying identity & notifying guarantor..."
                : "Submit for Verification"}
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
