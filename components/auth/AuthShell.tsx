import Image from "next/image";
import type { ReactNode } from "react";

type AuthShellProps = {
  activeStep: number;
  children: ReactNode;
  description: string;
  stepLabels: string[];
  title: string;
};

export function AuthShell({
  activeStep,
  children,
  description,
  stepLabels,
  title,
}: AuthShellProps) {
  const stepColumns = stepLabels.length === 2 ? "grid-cols-2" : "grid-cols-3";

  return (
    <main className="min-h-dvh overflow-x-hidden bg-black text-white">
      <div className="auth-layout grid min-h-dvh w-full">
        <aside className="auth-panel relative flex min-h-[230px] overflow-hidden rounded-b-2xl px-5 py-6 sm:min-h-[260px] sm:px-8 sm:py-8 lg:sticky lg:top-0 lg:h-dvh lg:min-h-[640px] lg:rounded-none lg:px-[clamp(28px,3vw,56px)] lg:py-[clamp(28px,5vh,64px)]">
          <div
            className={`auth-panel-content mt-auto w-full ${
              stepLabels.length === 2 ? "auth-panel-content--two-step" : ""
            }`}
          >
            <h2 className="mb-5 max-w-[280px] font-heading text-[30px] leading-[0.95] font-medium tracking-[-0.01em] sm:text-4xl lg:text-[40px]">
              Get started
              <br />
              with us
            </h2>
            <ol className={`grid ${stepColumns} gap-2.5 lg:gap-3`}>
              {stepLabels.map((label, index) => {
                const step = index + 1;
                const completed = step < activeStep;
                const active = step === activeStep;
                return (
                  <li
                    className={`flex min-h-[118px] min-w-0 flex-col rounded-xl border p-3 sm:min-h-[130px] lg:min-h-[158px] lg:p-4 ${
                      active
                        ? "border-[#e4dddd] bg-[#e4dddd] text-[#0f0e0e]"
                        : "border-white/15 bg-white/10 text-white"
                    }`}
                    key={label}
                  >
                    <span
                      className={`flex size-8 items-center justify-center rounded-full text-sm ${
                        active ? "bg-black text-white" : "bg-white text-black"
                      }`}
                    >
                      {completed ? (
                        <Image
                          src="/auth/check.svg"
                          alt="Completed"
                          width={20}
                          height={20}
                        />
                      ) : (
                        step
                      )}
                    </span>
                    <span className="mt-auto text-xs leading-4 font-semibold sm:text-sm sm:leading-5 lg:text-[15px]">
                      {label}
                    </span>
                    {active && stepLabels.length === 3 && (
                      <span className="mt-2 h-[7px] overflow-hidden rounded-full bg-[#3f3a3a]">
                        <span
                          className="block h-full rounded-full bg-[#2aa284]"
                          style={{ width: `${Math.round((step / 3) * 100)}%` }}
                        />
                      </span>
                    )}
                  </li>
                );
              })}
            </ol>
          </div>
        </aside>

        <section className="auth-content flex min-w-0 items-center justify-center px-5 py-8 sm:px-8 sm:py-10 lg:justify-start lg:px-[clamp(40px,5vw,80px)] lg:py-12">
          <div className="flex w-full max-w-[620px] flex-col">
            <header>
              <h1 className="font-heading text-[32px] leading-tight font-medium tracking-[-0.01em] sm:text-4xl lg:text-[40px]">
                {title}
              </h1>
              <p className="mt-1.5 text-sm leading-6 font-medium text-white/75 sm:text-base">
                {description}
              </p>
            </header>
            <div className="mt-7 sm:mt-9">{children}</div>
          </div>
        </section>
      </div>
    </main>
  );
}
