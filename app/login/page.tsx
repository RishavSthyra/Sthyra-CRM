"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import toast from "react-hot-toast";
import {
  AuthField,
  FormMessage,
  OrDivider,
  PasswordField,
  SocialButtons,
  SubmitButton,
} from "@/components/auth/AuthControls";
import { AuthShell } from "@/components/auth/AuthShell";
import { fetchWithSession, getApiError } from "@/lib/clientAuth";
import { validateFormFields } from "@/utils/validateFormFields";

export default function LoginPage() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void fetchWithSession("/api/auth/me", { cache: "no-store" }).then(
      (response) => {
        if (active && response.ok) {
          router.replace("/dashboard");
        }
      },
    );
    return () => {
      active = false;
    };
  }, [router]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!validateFormFields(event.currentTarget)) return;

    setPending(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          identifier: form.get("identifier"),
          password: form.get("password"),
        }),
      });
      if (!response.ok) {
        const message = await getApiError(response);
        setError(message);
        toast.error(message);
        return;
      }
      toast.success("Welcome back.");
      router.replace("/dashboard");
      router.refresh();
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
      activeStep={1}
      title="Login account"
      description="Enter your account details to continue to your CRM"
      stepLabels={["Sign in with your account", "Start managing your CRM"]}
    >
      <SocialButtons mode="login" />
      <OrDivider />
      <form
        className="flex flex-col gap-3.5"
        noValidate
        onSubmit={handleSubmit}
      >
        <AuthField
          autoComplete="username"
          id="identifier"
          label="Email or username"
          name="identifier"
          placeholder="name@company.com"
          required
        />
        <PasswordField
          autoComplete="current-password"
          id="password"
          label="Password"
          maxLength={128}
          name="password"
          placeholder="Enter your password"
          required
        />
        <div className="-mt-1 flex justify-end">
          <Link
            className="text-sm text-[#2aa284] transition hover:text-[#63d4b6]"
            href="/forgot-password"
          >
            Forgot password?
          </Link>
        </div>
        {error && <FormMessage>{error}</FormMessage>}
        <SubmitButton pending={pending}>Login</SubmitButton>
      </form>
      <p className="mt-3 text-center text-sm text-white/80">
        Don&apos;t have an account?{" "}
        <Link className="text-[#06aa81] hover:text-[#63d4b6]" href="/signup">
          Sign up
        </Link>
      </p>
    </AuthShell>
  );
}
