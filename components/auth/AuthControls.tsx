"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import type { FocusEventHandler, InputHTMLAttributes, ReactNode } from "react";
import { useState } from "react";
import {
  ArrowRight,
  Check,
  ChevronDown,
  Eye,
  EyeOff,
} from "lucide-react";
import { getPasswordRequirements } from "@/utils/validatePassword";

type FieldProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
};

export function AuthField({ label, id, className = "", ...props }: FieldProps) {
  return (
    <label
      className={`flex min-w-0 flex-col gap-1.5 ${className}`}
      htmlFor={id}
    >
      <span className="text-[13px] leading-5 font-medium sm:text-sm">
        {label}
      </span>
      <input
        className="h-12 w-full rounded-[10px] border border-[#342e2e] bg-[#222]/20 px-3 text-sm text-white outline-none transition [color-scheme:dark] placeholder:text-white/40 focus:border-[#2aa284] focus:ring-2 focus:ring-[#2aa284]/20"
        id={id}
        {...props}
      />
    </label>
  );
}

export function PasswordField({
  label,
  id,
  className = "",
  showRequirements = false,
  onFocus,
  onBlur,
  ...props
}: FieldProps & { showRequirements?: boolean }) {
  const [visible, setVisible] = useState(false);
  const [focused, setFocused] = useState(false);
  const value = typeof props.value === "string" ? props.value : "";
  const requirements = getPasswordRequirements(value);
  const requirementsId = `${id}-requirements`;
  const handleFocus: FocusEventHandler<HTMLInputElement> = (event) => {
    setFocused(true);
    onFocus?.(event);
  };
  const handleBlur: FocusEventHandler<HTMLInputElement> = (event) => {
    setFocused(false);
    onBlur?.(event);
  };
  return (
    <label
      className={`flex min-w-0 flex-col gap-1.5 ${className}`}
      htmlFor={id}
    >
      <span className="text-[13px] leading-5 font-medium sm:text-sm">
        {label}
      </span>
      <span className="relative block">
        <input
          aria-describedby={showRequirements ? requirementsId : undefined}
          className="h-12 w-full rounded-[10px] border border-[#342e2e] bg-[#222]/20 px-3 pr-11 text-sm text-white outline-none transition placeholder:text-white/40 focus:border-[#2aa284] focus:ring-2 focus:ring-[#2aa284]/20"
          id={id}
          onBlur={handleBlur}
          onFocus={handleFocus}
          type={visible ? "text" : "password"}
          {...props}
        />
        <button
          aria-label={visible ? "Hide password" : "Show password"}
          className="absolute top-1/2 right-2.5 flex size-8 -translate-y-1/2 items-center justify-center rounded-md hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-[#2aa284]"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => setVisible((current) => !current)}
          type="button"
        >
          {visible ? (
            <EyeOff aria-hidden className="size-5" strokeWidth={1.8} />
          ) : (
            <Eye aria-hidden className="size-5" strokeWidth={1.8} />
          )}
        </button>
        {showRequirements && (
          <span
            aria-hidden={!focused}
            className={`absolute top-[calc(100%+8px)] right-0 left-0 z-40 overflow-hidden rounded-xl border bg-[#101311]/[0.98] shadow-[0_18px_55px_rgba(0,0,0,0.58)] backdrop-blur-xl transition-all duration-200 ease-out ${
              focused
                ? "visible translate-y-0 border-white/[0.13] opacity-100"
                : "invisible -translate-y-1 border-transparent opacity-0"
            }`}
            id={requirementsId}
          >
            <span className="grid gap-2.5 px-4 py-3.5 sm:grid-cols-2">
              {requirements.map((requirement) => (
                <span
                  className={`flex min-w-0 items-center gap-2 text-[11px] leading-4 transition-colors duration-200 ${
                    requirement.met ? "text-[#83dec4]" : "text-[#929a96]"
                  }`}
                  key={requirement.key}
                >
                  <span
                    className={`grid size-4 shrink-0 place-items-center rounded-full border transition-all duration-200 ${
                      requirement.met
                        ? "border-[#4cc7a4] bg-[#4cc7a4] text-[#07110e]"
                        : "border-white/35 bg-transparent text-transparent"
                    }`}
                  >
                    {requirement.met && (
                      <Check className="size-2.5" strokeWidth={3} />
                    )}
                  </span>
                  <span>{requirement.label}</span>
                </span>
              ))}
            </span>
          </span>
        )}
      </span>
    </label>
  );
}

export function AuthSelect({
  children,
  id,
  label,
  name,
  required,
  value,
  onChange,
}: {
  children: ReactNode;
  id: string;
  label: string;
  name: string;
  required?: boolean;
  value: string;
  onChange: React.ChangeEventHandler<HTMLSelectElement>;
}) {
  return (
    <label className="flex flex-col gap-1.5" htmlFor={id}>
      <span className="text-[13px] leading-5 font-medium sm:text-sm">
        {label}
      </span>
      <span className="relative block">
        <select
          className="h-12 w-full appearance-none rounded-[10px] border border-[#342e2e] bg-[#070707] px-3 pr-11 text-sm text-white outline-none transition focus:border-[#2aa284] focus:ring-2 focus:ring-[#2aa284]/20"
          id={id}
          name={name}
          onChange={onChange}
          required={required}
          value={value}
        >
          {children}
        </select>
        <ChevronDown
          aria-hidden
          className="pointer-events-none absolute top-1/2 right-3.5 size-4 -translate-y-1/2 text-white/60"
          strokeWidth={1.8}
        />
      </span>
    </label>
  );
}

export function SubmitButton({
  children,
  pending = false,
}: {
  children: ReactNode;
  pending?: boolean;
}) {
  return (
    <button
      className="flex h-[52px] w-full items-center gap-2 rounded-[10px] bg-[#236f5a] px-4 text-left text-[15px] font-medium shadow-[0_10px_30px_rgba(20,88,69,0.28)] transition hover:bg-[#2a8068] disabled:cursor-not-allowed disabled:opacity-60"
      disabled={pending}
      type="submit"
    >
      <span className="flex-1">{pending ? "Please wait…" : children}</span>
      {!pending && (
        <ArrowRight aria-hidden className="size-5" strokeWidth={1.8} />
      )}
    </button>
  );
}

export function SocialButtons({ mode = "login" }: { mode?: "login" | "signup" }) {
  const router = useRouter();
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <button
        className="flex h-12 items-center justify-center gap-2.5 rounded-[10px] border border-[#342e2e] bg-[#222]/20 px-3 text-sm text-white transition hover:border-[#4b4444] hover:bg-white/[0.07]"
        onClick={() => router.push(`/api/auth/google/start?mode=${mode}`)}
        type="button"
      >
        <span className="relative size-6 overflow-hidden">
          <Image
            className="object-contain"
            src="/auth/google.png"
            alt=""
            fill
            sizes="24px"
          />
        </span>
        Continue with Google
      </button>
      {[["apple", "Continue with Apple"]].map(([provider, label]) => (
        <button
          className="flex h-12 cursor-not-allowed items-center justify-center gap-2.5 rounded-[10px] border border-[#342e2e] bg-[#222]/20 px-3 text-sm text-white/65"
          disabled
          key={provider}
          title={`${label} is not configured yet`}
          type="button"
        >
          <span className="relative size-6 overflow-hidden">
            <Image
              className="object-contain"
              src={`/auth/${provider}.png`}
              alt=""
              fill
              sizes="24px"
            />
          </span>
          {label}
        </button>
      ))}
    </div>
  );
}

export function OrDivider() {
  return (
    <div className="my-3.5 flex items-center gap-4 text-sm text-white/65">
      <span className="h-px flex-1 bg-[#342e2e]" />
      <span>or</span>
      <span className="h-px flex-1 bg-[#342e2e]" />
    </div>
  );
}

export function FormMessage({
  children,
  tone = "error",
}: {
  children: ReactNode;
  tone?: "error" | "success";
}) {
  return (
    <div
      aria-live="polite"
      className={`rounded-xl border px-4 py-3 text-sm ${
        tone === "success"
          ? "border-emerald-700/60 bg-emerald-950/40 text-emerald-200"
          : "border-red-800/60 bg-red-950/40 text-red-200"
      }`}
    >
      {children}
    </div>
  );
}
