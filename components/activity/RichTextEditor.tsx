"use client";

import { useEffect, useRef, useState } from "react";
import { Bold, Italic, List, ListOrdered, Underline } from "lucide-react";

type Command = "bold" | "italic" | "underline" | "insertUnorderedList" | "insertOrderedList";

const tools: Array<{
  command: Command;
  label: string;
  icon: typeof Bold;
}> = [
  { command: "bold", label: "Bold", icon: Bold },
  { command: "italic", label: "Italic", icon: Italic },
  { command: "underline", label: "Underline", icon: Underline },
  { command: "insertUnorderedList", label: "Bulleted list", icon: List },
  { command: "insertOrderedList", label: "Numbered list", icon: ListOrdered },
];

function hasText(html: string) {
  return html
    .replace(/<br\s*\/?>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .trim().length > 0;
}

function editorValue(html: string) {
  if (hasText(html) || /<(?:ul|ol|li)\b/i.test(html)) return html;
  return "";
}

export function RichTextEditor({
  ariaLabel,
  minHeight = "min-h-32",
  onChange,
  placeholder,
  value,
}: {
  ariaLabel: string;
  minHeight?: string;
  onChange: (value: string) => void;
  placeholder: string;
  value: string;
}) {
  const editorRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<Set<Command>>(new Set());

  useEffect(() => {
    const editor = editorRef.current;
    if (editor && editor.innerHTML !== value) editor.innerHTML = value;
  }, [value]);

  function refreshActive() {
    const next = new Set<Command>();
    for (const tool of tools) {
      if (document.queryCommandState(tool.command)) next.add(tool.command);
    }
    setActive(next);
  }

  function run(command: Command) {
    editorRef.current?.focus();
    document.execCommand(command, false);
    const html = editorRef.current?.innerHTML ?? "";
    onChange(editorValue(html));
    refreshActive();
  }

  return (
    <div className="overflow-hidden rounded-lg border border-[#303231] bg-[#111312] transition focus-within:border-[#3d7f69] focus-within:ring-2 focus-within:ring-[#2a8f71]/10">
      <div className="flex h-10 items-center gap-1.5 border-b border-[#2c2e2d] bg-[#181a19] px-2.5">
        {tools.map(({ command, icon: Icon, label }) => (
          <span className="contents" key={command}>
            <button
              aria-label={label}
              aria-pressed={active.has(command)}
              className={`flex size-7 shrink-0 items-center justify-center rounded-md p-0 transition ${
                active.has(command)
                  ? "bg-[#28483d] text-[#8ce0c1]"
                  : "text-[#aeb2af] hover:bg-white/[0.07] hover:text-white"
              }`}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => run(command)}
              type="button"
            >
              <Icon aria-hidden className="size-3.5 shrink-0" strokeWidth={2} />
            </button>
          </span>
        ))}
      </div>
      <div className="relative">
        {!value && (
          <span className="pointer-events-none absolute top-3 left-3 text-xs text-[#646866]">
            {placeholder}
          </span>
        )}
        <div
          aria-label={ariaLabel}
          className={`${minHeight} max-h-72 overflow-y-auto px-3 py-3 text-xs leading-6 text-[#e4e6e5] outline-none [&_ol]:ml-5 [&_ol]:list-decimal [&_ul]:ml-5 [&_ul]:list-disc`}
          contentEditable
          onBlur={refreshActive}
          onInput={(event) => {
            const html = event.currentTarget.innerHTML;
            onChange(editorValue(html));
          }}
          onKeyUp={refreshActive}
          onPaste={(event) => {
            event.preventDefault();
            document.execCommand(
              "insertText",
              false,
              event.clipboardData.getData("text/plain"),
            );
          }}
          ref={editorRef}
          role="textbox"
          suppressContentEditableWarning
        />
      </div>
    </div>
  );
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function safeRichHtml(value: string) {
  const hasMarkup = /<\/?(?:b|strong|i|em|u|p|div|ul|ol|li|br)\b/i.test(value);
  let escaped = escapeHtml(value);
  escaped = escaped
    .replace(/&lt;(\/?)(b|strong|i|em|u|p|div|ul|ol|li)&gt;/gi, "<$1$2>")
    .replace(/&lt;br\s*\/?&gt;/gi, "<br>");
  return hasMarkup ? escaped : escaped.replace(/\r?\n/g, "<br>");
}

export function RichTextContent({
  className,
  value,
}: {
  className?: string;
  value: string;
}) {
  return (
    <div
      className={`${className ?? ""} [&_ol]:ml-5 [&_ol]:list-decimal [&_ul]:ml-5 [&_ul]:list-disc`}
      dangerouslySetInnerHTML={{ __html: safeRichHtml(value) }}
    />
  );
}
