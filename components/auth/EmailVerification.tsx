"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import toast from "react-hot-toast";
import CodeSlots, { type CodeSlotsStatus } from "@/components/auth/CodeSlots";
import { FormMessage } from "@/components/auth/AuthControls";
import { AuthShell } from "@/components/auth/AuthShell";
import { getApiError } from "@/lib/clientAuth";

export function EmailVerification({
  email,
  initialOtpLength,
}: {
  email: string;
  initialOtpLength: number;
}) {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [otpLength, setOtpLength] = useState(initialOtpLength);
  const [pending, setPending] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<CodeSlotsStatus>("idle");
  const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

  if (!validEmail) {
    return (
      <AuthShell
        activeStep={2}
        title="Verification link incomplete"
        description="Return to signup so we know which email address to verify."
        stepLabels={["Create your account", "Verify your email"]}
      >
        <FormMessage>
          The email address is missing from this verification page.
        </FormMessage>
        <Link
          className="mt-4 flex h-12 items-center justify-center rounded-[10px] bg-[#236f5a] px-4 text-sm font-medium transition hover:bg-[#2a8068]"
          href="/signup"
        >
          Return to signup
        </Link>
      </AuthShell>
    );
  }

  async function verify(code: string): Promise<boolean> {
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/verify-email", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, token: code }),
      });
      if (!response.ok) throw new Error(await getApiError(response));
      toast.success("Email verified. Welcome to Sthyra CRM.");
      window.setTimeout(() => {
        router.replace("/dashboard");
        router.refresh();
      }, 700);
      return true;
    } catch (cause) {
      const message =
        cause instanceof Error ? cause.message : "Unable to verify the code";
      setError(message);
      toast.error(message);
      return false;
    } finally {
      setPending(false);
    }
  }

  async function resend() {
    setResending(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/resend-verification", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (!response.ok) throw new Error(await getApiError(response));
      const result = (await response.json()) as { otp_length?: number };
      if (
        Number.isInteger(result.otp_length) &&
        Number(result.otp_length) >= 6 &&
        Number(result.otp_length) <= 10
      ) {
        setOtpLength(Number(result.otp_length));
      }
      setToken("");
      setStatus("idle");
      toast.success("A new verification code has been sent.");
    } catch (cause) {
      const message =
        cause instanceof Error ? cause.message : "Unable to resend the code";
      setError(message);
      toast.error(message);
    } finally {
      setResending(false);
    }
  }

  return (
    <AuthShell
      activeStep={2}
      title="Verify your email"
      description={`Enter the ${otpLength}-digit code sent to ${email}`}
      stepLabels={["Create your account", "Verify your email"]}
    >
      <div className="flex flex-col gap-3.5">
        <span className="text-[13px] leading-5 font-medium sm:text-sm">
          Verification code
        </span>
        <div className="flex min-h-[52px] max-w-full items-center overflow-x-auto pb-0.5">
          <CodeSlots
            length={otpLength}
            value={token}
            status={status}
            onChange={(code) => {
              setToken(code);
              setStatus("idle");
              setError(null);
            }}
            onComplete={async (code) => {
              const ok = await verify(code);
              setStatus(ok ? "success" : "error");
            }}
            accentColor="#f5f5f5"
            inkColor="#f5f5f5"
            slotColor="#27272a"
            digitColor="#18181b"
            dangerColor="#ff3b30"
            slotSize={44}
            gap={8}
            radius={12}
            bounce={0.2}
            settle={0.3}
            rise={8}
            cascade={20}
            mask={false}
            caret
            autoFocus
            disabled={pending}
          />
        </div>
        {error && <FormMessage>{error}</FormMessage>}
      </div>
      <div className="mt-4 flex items-center justify-start gap-5 whitespace-nowrap text-xs text-white/60">
        <span className="flex items-center gap-2">
          <span>Didn&apos;t receive the code?</span>
          <button
            className="text-[#2aa284] transition hover:text-[#63d4b6] disabled:cursor-not-allowed disabled:opacity-50"
            disabled={resending}
            onClick={() => void resend()}
            type="button"
          >
            {resending ? "Sending…" : "Send again"}
          </button>
        </span>
        <span className="flex items-center gap-1 text-white/50">
          <span>Wrong email?</span>
          <Link
            className="text-[#2aa284] transition hover:text-[#63d4b6]"
            href="/signup"
          >
            Start again
          </Link>
        </span>
      </div>
    </AuthShell>
  );
}
