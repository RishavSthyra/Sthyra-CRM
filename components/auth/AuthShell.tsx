import type { ReactNode } from "react";
import { Check } from "lucide-react";

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
      <div className="grid min-h-dvh w-full lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <aside className="relative flex min-h-[230px] overflow-hidden rounded-b-2xl bg-[radial-gradient(circle_at_16%_10%,rgba(55,151,127,0.42),transparent_34%),linear-gradient(140deg,#1b6151_2%,#09231a_31%,#175243_65%,#124235_82%,#1b6151_100%)] px-5 py-6 sm:min-h-[260px] sm:px-8 sm:py-8 lg:sticky lg:top-0 lg:h-dvh lg:min-h-[640px] lg:rounded-none lg:px-[clamp(28px,3vw,56px)] lg:py-[clamp(28px,5vh,64px)]">
          <div
            className={`mt-auto w-full ${
              stepLabels.length === 2
                ? "lg:max-w-[min(100%,420px)]"
                : "lg:max-w-[669px]"
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
                        <Check
                          aria-label="Completed"
                          className="size-5"
                          strokeWidth={2}
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
                          className={`block h-full rounded-full bg-[#2aa284] ${step === 1 ? "w-1/3" : step === 2 ? "w-2/3" : "w-full"}`}
                        />
                      </span>
                    )}
                  </li>
                );
              })}
            </ol>
          </div>
        </aside>

        <section className="flex min-w-0 items-center justify-center px-5 py-8 sm:px-8 sm:py-10 lg:justify-start lg:px-[clamp(40px,5vw,80px)] lg:py-12">
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
