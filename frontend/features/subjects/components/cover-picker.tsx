"use client";

import { useId } from "react";
import { Check } from "lucide-react";
import { COVER_OPTIONS, type SubjectAccent } from "@/features/subjects/types";

type Props = { value: SubjectAccent; onChange: (accent: SubjectAccent) => void; disabled?: boolean };

/** Picks a subject's notebook cover (create and edit dialogs). */
export function CoverPicker({ value, onChange, disabled }: Props) {
  const name = useId();
  return (
    <fieldset className="swatches" disabled={disabled}>
      <legend>Màu bìa vở</legend>
      {COVER_OPTIONS.map((option) => (
        <label key={option.accent} className={`swatch cover-${option.accent}`}>
          <input
            type="radio"
            name={name}
            checked={value === option.accent}
            onChange={() => onChange(option.accent)}
          />
          <span className="chip" aria-hidden="true">
            {value === option.accent ? <Check className="size-5" /> : null}
          </span>
          {option.label}
        </label>
      ))}
    </fieldset>
  );
}
