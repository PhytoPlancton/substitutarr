"use client";
import type { ReactNode } from "react";

export function SettingsHeader({ title, description }: { title: string; description?: string }) {
  return (
    <header>
      <h1 className="text-2xl font-semibold">{title}</h1>
      {description && <p className="text-muted text-sm mt-1">{description}</p>}
    </header>
  );
}

export function Section({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="bg-surface border border-border rounded-lg p-5">
      {title && <h2 className="text-sm uppercase tracking-wider text-muted mb-4">{title}</h2>}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">{children}</div>
    </section>
  );
}

export function Field({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
}: {
  label: string;
  value?: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <label className="text-sm">
      <span className="block text-xs text-muted mb-1">{label}</span>
      <input
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        type={type}
        placeholder={placeholder}
        className="w-full bg-bg border border-border rounded-md px-3 py-2 outline-none focus:border-accent"
      />
    </label>
  );
}

export function SaveButton({
  pending,
  onClick,
  disabled,
  label = "Save",
}: {
  pending: boolean;
  onClick: () => void;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={pending || disabled}
      className="px-4 py-2.5 bg-accent rounded-md font-medium text-white hover:bg-accent/90 disabled:opacity-50"
    >
      {pending ? "Saving..." : label}
    </button>
  );
}
