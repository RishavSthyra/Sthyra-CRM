"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import toast from "react-hot-toast";
import {
  AuthField,
  FormMessage,
  SubmitButton,
} from "@/components/auth/AuthControls";
import { AuthShell } from "@/components/auth/AuthShell";
import { getApiError } from "@/lib/clientAuth";
import { validateFormFields } from "@/utils/validateFormFields";

export default function ForgotPasswordPage() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [developmentToken, setDevelopmentToken] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!validateFormFields(event.currentTarget)) return;

    setPending(true);
    setError(null);
    setMessage(null);
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: form.get("email") }),
      });
      if (!response.ok) {
        const responseMessage = await getApiError(response);
        setError(responseMessage);
        toast.error(responseMessage);
        return;
      }
      const body = (await response.json()) as {
        message: string;
        development_reset_token?: string;
      };
      setMessage(body.message);
      setDevelopmentToken(body.development_reset_token ?? null);
      toast.success(body.message);
    } catch {
      const responseMessage = "Unable to reach the server. Please try again.";
      setError(responseMessage);
      toast.error(responseMessage);
    } finally {
      setPending(false);
    }
  }

  return (
    <AuthShell
      activeStep={1}
      title="Reset your password"
      description="Enter your account email to receive reset instructions"
      stepLabels={["Request reset", "Choose new password"]}
    >
      <form
        className="flex flex-col gap-3.5"
        noValidate
        onSubmit={handleSubmit}
      >
        <AuthField
          autoComplete="email"
          id="reset-email"
          label="Email"
          name="email"
          placeholder="name@company.com"
          required
          type="email"
        />
        {error && <FormMessage>{error}</FormMessage>}
        {message && <FormMessage tone="success">{message}</FormMessage>}
        {developmentToken && (
          <Link
            className="text-center text-sm text-[#2aa284] underline"
            href={`/reset-password?token=${encodeURIComponent(developmentToken)}`}
          >
            Continue with the development reset token
          </Link>
        )}
        <SubmitButton pending={pending}>Send reset instructions</SubmitButton>
      </form>
      <p className="mt-4 text-center text-sm text-white/80">
        <Link className="text-[#2aa284]" href="/login">
          Back to login
        </Link>
      </p>
    </AuthShell>
  );
}
