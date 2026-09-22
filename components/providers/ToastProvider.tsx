"use client";

import { Toaster } from "react-hot-toast";

export function ToastProvider() {
  return (
    <Toaster
      position="top-right"
      toastOptions={{
        duration: 3500,
        style: {
          background: "#161616",
          border: "1px solid #343434",
          color: "#ffffff",
          fontSize: "14px",
        },
        success: {
          iconTheme: { primary: "#2aa284", secondary: "#ffffff" },
        },
      }}
    />
  );
}
