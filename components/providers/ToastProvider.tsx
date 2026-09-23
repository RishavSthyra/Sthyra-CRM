"use client";

import { Toaster } from "react-hot-toast";

export function ToastProvider() {
  return (
    <Toaster
      position="top-right"
      toastOptions={{
        duration: 3500,
        className:
          "!rounded-xl !border !border-[#343434] !bg-[#161616] !text-sm !text-white !shadow-2xl",
        success: {
          iconTheme: { primary: "#2aa284", secondary: "#ffffff" },
        },
      }}
    />
  );
}
