"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import toast from "react-hot-toast";
import { Building2, LoaderCircle, ShieldCheck, UsersRound } from "lucide-react";
import {
  AuthField,
  FormMessage,
  PasswordField,
  SubmitButton,
} from "@/components/auth/AuthControls";
import { AuthShell } from "@/components/auth/AuthShell";
import { getApiError } from "@/lib/clientAuth";
import { validateFormFields } from "@/utils/validateFormFields";

type Invitation = {
  email: string;
  company_name: string;
  company_code: string;
  role_name: string;
  team_name: string;
  expires_at: string;
};

const initialForm = {
  first_name: "",
  last_name: "",
  username: "",
  phone: "",
  password: "",
  confirm_password: "",
};

export function InvitationOnboarding({ token }: { token: string }) {
  const router = useRouter();
  const [invitation, setInvitation] = useState<Invitation | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(initialForm);

  useEffect(() => {
    let active = true;
    void fetch(`/api/invitations/validate?token=${encodeURIComponent(token)}`, {
      cache: "no-store",
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(await getApiError(response));
        return response.json() as Promise<{ invitation: Invitation }>;
      })
      .then((data) => {
        if (!active) return;
        setInvitation(data.invitation);
        const suggested = data.invitation.email
          .split("@")[0]
          .replace(/[^a-zA-Z0-9._-]/g, "")
          .slice(0, 30);
        setForm((current) => ({ ...current, username: suggested }));
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : "Unable to validate invitation");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [token]);

  const update = (field: keyof typeof form, value: string) =>
    setForm((current) => ({ ...current, [field]: value }));

  async function accept(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (!validateFormFields(event.currentTarget)) return;
    if (form.password.length < 12) {
      const message = "Password must contain at least 12 characters.";
      setError(message);
      toast.error(message);
      return;
    }
    if (form.password !== form.confirm_password) {
      const message = "Password and confirmation do not match.";
      setError(message);
      toast.error(message);
      return;
    }
    setPending(true);
    try {
      const response = await fetch("/api/invitations/accept", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          first_name: form.first_name,
          last_name: form.last_name || null,
          username: form.username,
          phone: form.phone || null,
          password: form.password,
        }),
      });
      if (!response.ok) throw new Error(await getApiError(response));
      toast.success("Welcome to your workspace.");
      router.replace("/dashboard");
      router.refresh();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Unable to accept invitation";
      setError(message);
      toast.error(message);
    } finally {
      setPending(false);
    }
  }

  return (
    <AuthShell
      activeStep={1}
      title={invitation ? `Join ${invitation.company_name}` : "Workspace invitation"}
      description="Create your profile to securely activate your workspace access."
      stepLabels={["Review your invitation", "Enter your workspace"]}
    >
      {loading && (
        <div className="flex min-h-52 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.025]">
          <LoaderCircle className="size-6 animate-spin text-[#58bc99]" aria-label="Validating invitation" />
        </div>
      )}
      {!loading && !invitation && (
        <div className="rounded-2xl border border-red-400/20 bg-red-400/[0.06] p-6">
          <h2 className="text-lg font-medium">This link cannot be used</h2>
          <p className="mt-2 text-sm leading-6 text-white/60">{error}</p>
          <Link className="mt-5 inline-flex rounded-lg bg-[#236f5a] px-4 py-2.5 text-sm font-medium hover:bg-[#2a8068]" href="/login">
            Go to login
          </Link>
        </div>
      )}
      {invitation && (
        <>
          <div className="mb-6 grid grid-cols-3 overflow-hidden rounded-xl border border-white/10 bg-white/[0.025] max-[520px]:grid-cols-1">
            {[
              [Building2, "Company", invitation.company_name],
              [ShieldCheck, "Role", invitation.role_name],
              [UsersRound, "Team", invitation.team_name],
            ].map(([Icon, label, value], index) => {
              const ItemIcon = Icon as typeof Building2;
              return (
                <div className={`p-4 ${index ? "border-l border-white/10 max-[520px]:border-t max-[520px]:border-l-0" : ""}`} key={String(label)}>
                  <ItemIcon className="mb-3 size-4 text-[#58bc99]" strokeWidth={1.8} />
                  <span className="block text-[11px] text-white/40">{String(label)}</span>
                  <strong className="mt-1 block truncate text-sm font-medium text-white/85">{String(value)}</strong>
                </div>
              );
            })}
          </div>
          <form className="grid grid-cols-2 gap-3.5 max-[520px]:grid-cols-1" noValidate onSubmit={accept}>
            <AuthField id="first_name" label="First name" required maxLength={200} value={form.first_name} onChange={(e) => update("first_name", e.target.value)} />
            <AuthField id="last_name" label="Last name" maxLength={200} value={form.last_name} onChange={(e) => update("last_name", e.target.value)} />
            <AuthField className="col-span-2 max-[520px]:col-span-1" id="email" label="Email" readOnly value={invitation.email} />
            <AuthField id="username" label="Username" required minLength={3} maxLength={200} pattern="[A-Za-z0-9._-]+" value={form.username} onChange={(e) => update("username", e.target.value)} />
            <AuthField id="phone" label="Phone (optional)" inputMode="tel" maxLength={20} placeholder="+919876543210" value={form.phone} onChange={(e) => update("phone", e.target.value)} />
            <PasswordField id="password" label="Password" required minLength={12} maxLength={128} autoComplete="new-password" value={form.password} onChange={(e) => update("password", e.target.value)} />
            <PasswordField id="confirm_password" label="Confirm password" required minLength={12} maxLength={128} autoComplete="new-password" value={form.confirm_password} onChange={(e) => update("confirm_password", e.target.value)} />
            {error && <div className="col-span-2 max-[520px]:col-span-1"><FormMessage>{error}</FormMessage></div>}
            <div className="col-span-2 mt-1 max-[520px]:col-span-1">
              <SubmitButton pending={pending}>Accept invitation</SubmitButton>
            </div>
          </form>
          <p className="mt-4 text-center text-xs text-white/40">
            This link expires {new Date(invitation.expires_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}.
          </p>
        </>
      )}
    </AuthShell>
  );
}
