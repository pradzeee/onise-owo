"use client";

import { useEffect, useState } from "react";
import { Shield, Trash2 } from "lucide-react";

export function TrustedContactCard() {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [savedMasked, setSavedMasked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/trusted-contact")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.contact) {
          setName(data.contact.contactName);
          setPhone(data.contact.contactPhone);
          setSavedMasked(data.contact.maskedPhone);
        }
      })
      .catch(() => {});
  }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/trusted-contact", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contactName: name, contactPhone: phone }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        contact?: { maskedPhone: string };
      };
      if (!res.ok) {
        setError(data.error ?? "Could not save trusted contact.");
        return;
      }
      setSavedMasked(data.contact?.maskedPhone ?? null);
      setMessage("Trusted contact saved for Share Job & SOS safety alerts.");
    } catch {
      setError("Network error saving contact.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (busy) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await fetch("/api/trusted-contact", { method: "DELETE" });
      setName("");
      setPhone("");
      setSavedMasked(null);
      setMessage("Trusted contact removed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Shield className="h-4 w-4 text-[#0B6E4F]" />
          <h2 className="text-base font-bold text-gray-900">
            Safety Trusted Contact (Share Job &amp; SOS)
          </h2>
        </div>
        {savedMasked ? (
          <button
            type="button"
            disabled={busy}
            onClick={handleDelete}
            className="inline-flex items-center gap-1 text-xs font-medium text-red-600 hover:underline"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Remove
          </button>
        ) : null}
      </div>
      <p className="mt-1 text-xs text-gray-600">
        When you tap <strong>Share job</strong> or <strong>SOS</strong> on an active job,
        we notify this trusted person by SMS and let you call them in one tap.
      </p>

      <form onSubmit={handleSave} className="mt-3 grid gap-3 sm:grid-cols-3">
        <input
          type="text"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Contact name (e.g. Tunde)"
          className="min-h-11 rounded-xl border border-gray-300 px-3 text-sm"
        />
        <input
          type="tel"
          required
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="0803 123 4567"
          className="min-h-11 rounded-xl border border-gray-300 px-3 text-sm"
        />
        <button
          type="submit"
          disabled={busy}
          className="min-h-11 rounded-xl bg-[#0B6E4F] px-4 text-xs font-bold text-white hover:bg-[#08523B] disabled:opacity-50"
        >
          {busy ? "Saving..." : savedMasked ? "Update contact" : "Save contact"}
        </button>
      </form>

      {error ? <p className="mt-2 text-xs text-red-600">{error}</p> : null}
      {message ? <p className="mt-2 text-xs text-[#08523B]">{message}</p> : null}
    </section>
  );
}
