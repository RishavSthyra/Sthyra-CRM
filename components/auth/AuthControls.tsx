"use client";

import Image from "next/image";
import type { InputHTMLAttributes, ReactNode } from "react";
import { useState } from "react";

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
        className="h-12 w-full rounded-[10px] border border-[#342e2e] bg-[#222]/20 px-3 text-sm text-white outline-none transition placeholder:text-white/40 focus:border-[#2aa284] focus:ring-2 focus:ring-[#2aa284]/20"
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
  ...props
}: FieldProps) {
  const [visible, setVisible] = useState(false);
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
          className="h-12 w-full rounded-[10px] border border-[#342e2e] bg-[#222]/20 px-3 pr-11 text-sm text-white outline-none transition placeholder:text-white/40 focus:border-[#2aa284] focus:ring-2 focus:ring-[#2aa284]/20"
          id={id}
          type={visible ? "text" : "password"}
          {...props}
        />
        <button
          aria-label={visible ? "Hide password" : "Show password"}
          className="absolute top-1/2 right-2.5 flex size-8 -translate-y-1/2 items-center justify-center rounded-md hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-[#2aa284]"
          onClick={() => setVisible((current) => !current)}
          type="button"
        >
          <Image src="/auth/eye.svg" alt="" width={20} height={14} />
        </button>
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
      <select
        className="auth-select h-12 w-full appearance-none rounded-[10px] border border-[#342e2e] bg-[#070707] px-3 pr-11 text-sm text-white outline-none transition focus:border-[#2aa284] focus:ring-2 focus:ring-[#2aa284]/20"
        id={id}
        name={name}
        onChange={onChange}
        required={required}
        value={value}
      >
        {children}
      </select>
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
      className="auth-submit flex h-[52px] w-full items-center gap-2 rounded-[10px] px-4 text-left text-[15px] font-medium shadow-[0_4px_35px_rgba(0,0,0,0.22)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
      disabled={pending}
      type="submit"
    >
      <span className="flex-1">{pending ? "Please wait…" : children}</span>
      {!pending && (
        <Image src="/auth/arrow-right.svg" alt="" width={20} height={20} />
      )}
    </button>
  );
}

export function SocialButtons() {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {[
        ["google", "Continue with Google"],
        ["apple", "Continue with Apple"],
      ].map(([provider, label]) => (
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
