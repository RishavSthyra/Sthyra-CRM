"use client";

import toast from "react-hot-toast";

type FormControl = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

function getFieldLabel(control: FormControl): string {
  const label = control.closest("label")?.querySelector("span")?.textContent;
  return (
    label?.trim() ||
    control.getAttribute("aria-label") ||
    control.name ||
    "This field"
  );
}

export function validateFormFields(form: HTMLFormElement): boolean {
  const controls = Array.from(form.elements).filter(
    (element): element is FormControl =>
      element instanceof HTMLInputElement ||
      element instanceof HTMLSelectElement ||
      element instanceof HTMLTextAreaElement,
  );
  const invalidControl = controls.find((control) => !control.checkValidity());

  if (!invalidControl) return true;

  const label = getFieldLabel(invalidControl);
  const message = invalidControl.validity.valueMissing
    ? `${label} is required.`
    : invalidControl.validationMessage;

  toast.error(message);
  invalidControl.focus();
  return false;
}
