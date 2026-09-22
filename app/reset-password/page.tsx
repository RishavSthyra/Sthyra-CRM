"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import toast from "react-hot-toast";
import {
  FormMessage,
  PasswordField,
  SubmitButton,
} from "@/components/auth/AuthControls";
import { AuthShell } from "@/components/auth/AuthShell";
import { getApiError } from "@/lib/clientAuth";
import { validateFormFields } from "@/utils/validateFormFields";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!validateFormFields(event.currentTarget)) return;

    const form = new FormData(event.currentTarget);
    const token =
      new URLSearchParams(window.location.search).get("token") ?? "";
    const password = String(form.get("password") ?? "");
    const confirmation = String(form.get("confirmation") ?? "");
    if (!token) {
      const message = "The password reset link is missing its token.";
      setError(message);
      toast.error(message);
      return;
    }
    if (password !== confirmation) {
      const message = "Password and confirmation do not match.";
      setError(message);
      toast.error(message);
      return;
    }
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, new_password: password }),
      });
      if (!response.ok) {
        const message = await getApiError(response);
        setError(message);
        toast.error(message);
        return;
      }
      toast.success("Password reset successfully. You can now log in.");
      router.replace("/login");
    } catch {
      const message = "Unable to reach the server. Please try again.";
      setError(message);
      toast.error(message);
    } finally {
      setPending(false);
    }
  }

  return (
    <AuthShell
      activeStep={2}
      title="Choose a new password"
      description="Use at least 12 characters for your new password"
      stepLabels={["Request reset", "Choose new password"]}
    >
      <form
        className="flex flex-col gap-3.5"
        noValidate
        onSubmit={handleSubmit}
      >
        <PasswordField
          autoComplete="new-password"
          id="new-password"
          label="New Password"
          minLength={12}
          name="password"
          placeholder="At least 12 characters"
          required
        />
        <PasswordField
          autoComplete="new-password"
          id="new-password-confirmation"
          label="Confirm Password"
          minLength={12}
          name="confirmation"
          placeholder="Repeat your password"
          required
        />
        {error && <FormMessage>{error}</FormMessage>}
        <SubmitButton pending={pending}>Reset password</SubmitButton>
      </form>
      <p className="mt-4 text-center text-sm text-white/80">
        <Link className="text-[#2aa284]" href="/login">
          Back to login
        </Link>
      </p>
    </AuthShell>
  );
}
