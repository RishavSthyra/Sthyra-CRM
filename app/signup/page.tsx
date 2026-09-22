"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import toast from "react-hot-toast";
import {
  AuthField,
  AuthSelect,
  FormMessage,
  OrDivider,
  PasswordField,
  SocialButtons,
  SubmitButton,
} from "@/components/auth/AuthControls";
import { AuthShell } from "@/components/auth/AuthShell";
import { getApiError } from "@/lib/clientAuth";
import { validateFormFields } from "@/utils/validateFormFields";

type SignupData = {
  first_name: string;
  last_name: string;
  email: string;
  password: string;
  confirm_password: string;
  company_name: string;
  company_legal_name: string;
  company_code: string;
  company_phone_number: string;
  company_contact_email: string;
  established_on: string;
  job_role: string;
};

const initialData: SignupData = {
  first_name: "",
  last_name: "",
  email: "",
  password: "",
  confirm_password: "",
  company_name: "",
  company_legal_name: "",
  company_code: "",
  company_phone_number: "",
  company_contact_email: "",
  established_on: "",
  job_role: "",
};

export default function SignupPage() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [data, setData] = useState(initialData);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function update(field: keyof SignupData, value: string) {
    setData((current) => ({ ...current, [field]: value }));
  }

  function continueFromAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (!validateFormFields(event.currentTarget)) return;

    if (data.password.length < 12) {
      const message = "Password must contain at least 12 characters.";
      setError(message);
      toast.error(message);
      return;
    }
    if (data.password !== data.confirm_password) {
      const message = "Password and confirmation do not match.";
      setError(message);
      toast.error(message);
      return;
    }
    setData((current) => ({
      ...current,
      company_contact_email: current.company_contact_email || current.email,
    }));
    setStep(2);
  }

  function continueFromCompany(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (!validateFormFields(event.currentTarget)) return;

    if (!/^\+?[0-9]{10,19}$/.test(data.company_phone_number)) {
      const message = "Company contact must contain 10 to 19 digits.";
      setError(message);
      toast.error(message);
      return;
    }
    setStep(3);
  }

  async function submitSignup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!validateFormFields(event.currentTarget)) return;

    setPending(true);
    setError(null);
    const payload = {
      first_name: data.first_name,
      last_name: data.last_name,
      email: data.email,
      password: data.password,
      company_name: data.company_name,
      company_legal_name: data.company_legal_name,
      company_code: data.company_code,
      company_phone_number: data.company_phone_number,
      company_contact_email: data.company_contact_email,
      established_on: data.established_on,
      job_role: data.job_role,
    };
    try {
      const response = await fetch("/api/auth/signup", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const message = await getApiError(response);
        setError(message);
        toast.error(message);
        return;
      }
      toast.success("Your workspace is ready.");
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

  const titles = [
    ["Sign up account", "Enter your personal data and create your account"],
    [
      `Welcome${data.first_name ? ` ${data.first_name}` : ""}!`,
      "Enter your company details to complete your onboarding",
    ],
    ["Onboarding details!", "Tell us your role to finish your workspace"],
  ];

  return (
    <AuthShell
      activeStep={step}
      title={titles[step - 1][0]}
      description={titles[step - 1][1]}
      stepLabels={[
        "Sign up with your account",
        "Add your company details",
        "Let us know more about you",
      ]}
    >
      {step === 1 && (
        <>
          <SocialButtons />
          <OrDivider />
          <form
            className="flex flex-col gap-3.5"
            noValidate
            onSubmit={continueFromAccount}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <AuthField
                autoComplete="given-name"
                id="first-name"
                label="First Name"
                onChange={(event) => update("first_name", event.target.value)}
                placeholder="First name"
                required
                value={data.first_name}
              />
              <AuthField
                autoComplete="family-name"
                id="last-name"
                label="Second Name"
                onChange={(event) => update("last_name", event.target.value)}
                placeholder="Second name"
                value={data.last_name}
              />
            </div>
            <AuthField
              autoComplete="email"
              id="signup-email"
              label="Email"
              onChange={(event) => update("email", event.target.value)}
              placeholder="name@company.com"
              required
              type="email"
              value={data.email}
            />
            <PasswordField
              autoComplete="new-password"
              id="signup-password"
              label="Password"
              minLength={12}
              onChange={(event) => update("password", event.target.value)}
              placeholder="At least 12 characters"
              required
              value={data.password}
            />
            <PasswordField
              autoComplete="new-password"
              id="confirm-password"
              label="Confirm Password"
              minLength={12}
              onChange={(event) =>
                update("confirm_password", event.target.value)
              }
              placeholder="Repeat your password"
              required
              value={data.confirm_password}
            />
            {error && <FormMessage>{error}</FormMessage>}
            <SubmitButton>Next</SubmitButton>
          </form>
          <p className="mt-3 text-center text-sm text-white/80">
            Have an account?{" "}
            <Link className="text-[#06aa81] hover:text-[#63d4b6]" href="/login">
              Login
            </Link>
          </p>
        </>
      )}

      {step === 2 && (
        <form
          className="flex flex-col gap-3.5"
          noValidate
          onSubmit={continueFromCompany}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <AuthField
              id="company-name"
              label="Company Name"
              onChange={(event) => update("company_name", event.target.value)}
              placeholder="Company name"
              required
              value={data.company_name}
            />
            <AuthField
              id="company-legal-name"
              label="Legal Name"
              onChange={(event) =>
                update("company_legal_name", event.target.value)
              }
              placeholder="Registered legal name"
              value={data.company_legal_name}
            />
            <AuthField
              id="company-code"
              label="Company ID"
              maxLength={50}
              minLength={2}
              onChange={(event) =>
                update("company_code", event.target.value.toUpperCase())
              }
              pattern="[A-Za-z0-9][A-Za-z0-9_-]{1,49}"
              placeholder="STHYRA"
              required
              value={data.company_code}
            />
            <AuthField
              id="established-on"
              label="Established on"
              max={new Date().toISOString().slice(0, 10)}
              onChange={(event) => update("established_on", event.target.value)}
              required
              type="date"
              value={data.established_on}
            />
            <AuthField
              autoComplete="tel"
              id="company-contact"
              label="Company Contact"
              onChange={(event) =>
                update("company_phone_number", event.target.value)
              }
              pattern="\+?[0-9]{10,19}"
              placeholder="+919876543210"
              required
              type="tel"
              value={data.company_phone_number}
            />
            <AuthField
              autoComplete="email"
              id="company-email"
              label="Company Email ID"
              onChange={(event) =>
                update("company_contact_email", event.target.value)
              }
              placeholder="hello@company.com"
              required
              type="email"
              value={data.company_contact_email}
            />
          </div>
          {error && <FormMessage>{error}</FormMessage>}
          <div className="flex items-center gap-3">
            <button
              className="h-[52px] rounded-[10px] border border-white/20 px-5 text-sm text-white/80 hover:bg-white/10"
              onClick={() => setStep(1)}
              type="button"
            >
              Back
            </button>
            <SubmitButton>Next</SubmitButton>
          </div>
        </form>
      )}

      {step === 3 && (
        <form
          className="flex flex-col gap-5"
          noValidate
          onSubmit={submitSignup}
        >
          <AuthSelect
            id="job-role"
            label="What is your role?"
            name="job_role"
            onChange={(event) => update("job_role", event.target.value)}
            required
            value={data.job_role}
          >
            <option value="" disabled>
              Select your role
            </option>
            <option value="founder">Founder / Owner</option>
            <option value="sales_manager">Sales Manager</option>
            <option value="sales_executive">Sales Executive</option>
            <option value="operations">Operations</option>
          </AuthSelect>
          {error && <FormMessage>{error}</FormMessage>}
          <div className="flex items-center gap-3">
            <button
              className="h-[52px] rounded-[10px] border border-white/20 px-5 text-sm text-white/80 hover:bg-white/10"
              onClick={() => setStep(2)}
              type="button"
            >
              Back
            </button>
            <SubmitButton pending={pending}>Create workspace</SubmitButton>
          </div>
        </form>
      )}
    </AuthShell>
  );
}
