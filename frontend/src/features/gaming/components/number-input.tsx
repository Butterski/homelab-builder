import { useEffect, useState } from 'react';

/**
 * A whole-number input that lets the user clear the field and type a new
 * value. The value is committed as soon as it is inside the range; anything
 * else stays a draft and is dropped when the field loses focus.
 */
export function NumberInput({
  id,
  value,
  min,
  max,
  step,
  title,
  className,
  onCommit,
}: {
  id: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  title?: string;
  className?: string;
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));

  // Follow changes made elsewhere: undo, a proposal, another field of the form.
  useEffect(() => setDraft(String(value)), [value]);

  return (
    <input
      id={id}
      className={className}
      type="number"
      inputMode="numeric"
      min={min}
      max={max}
      step={step}
      title={title}
      value={draft}
      onChange={event => {
        setDraft(event.target.value);
        const next = Number(event.target.value);
        if (
          event.target.value !== '' &&
          Number.isInteger(next) &&
          next >= min &&
          next <= max &&
          next !== value
        ) {
          onCommit(next);
        }
      }}
      onBlur={() => setDraft(String(value))}
    />
  );
}
