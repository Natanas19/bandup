"use client";

import { useState, type ComponentProps } from "react";

type PasswordInputProps = Omit<ComponentProps<"input">, "type" | "id"> & {
  id: string;
  visibilityLabel?: string;
};

export default function PasswordInput({ id, className = "", visibilityLabel = "senha", ...props }: PasswordInputProps) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="relative">
      <input {...props} id={id} type={visible ? "text" : "password"} className={`${className} pr-14`} />
      <button
        type="button"
        aria-label={`${visible ? "Ocultar" : "Mostrar"} ${visibilityLabel}`}
        aria-controls={id}
        aria-pressed={visible}
        onClick={() => setVisible(value => !value)}
        disabled={props.disabled}
        className="absolute inset-y-0 right-0 flex w-12 items-center justify-center rounded-xl text-content-muted hover:text-accent focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus disabled:cursor-not-allowed disabled:opacity-50"
      >
        <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
          <circle cx="12" cy="12" r="3" />
          {visible && <path d="m3 3 18 18" />}
        </svg>
      </button>
    </div>
  );
}
