import { Suspense } from "react";
import { SettingsWorkspace } from "@/components/settings/SettingsWorkspace";

export default function SettingsPage() {
  return (
    <Suspense fallback={<main className="min-h-dvh bg-black" />}>
      <SettingsWorkspace />
    </Suspense>
  );
}
