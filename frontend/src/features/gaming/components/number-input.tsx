import { useState } from 'react';

/**
 * A whole-number input that lets the user clear the field and type a new
 * value. The value is committed as soon as it is inside the range; anything
 * else stays a draft and is dropped when the field loses focus. A value that
 * may be left unset is `null` and shows an empty field; with `onClear`,
 * emptying the field unsets it.
 */
export function NumberInput({
  id,
  value,
  min,
  max,
  step,
  title,
  placeholder,
  className,
  onCommit,
  onClear,
}: {
  id: string;
  value: number | null;
  min: number;
  max: number;
  step?: number;
  title?: string;
  placeholder?: string;
  className?: string;
  onCommit: (value: number) => void;
  onClear?: () => void;
}) {
  const text = value === null ? '' : String(value);
  const [draft, setDraft] = useState(text);

  // Follow changes made elsewhere: undo, a proposal, another field of the form.
  const [shown, setShown] = useState(value);
  if (shown !== value) {
    setShown(value);
    setDraft(text);
  }

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
      placeholder={placeholder}
      value={draft}
      onChange={event => {
        setDraft(event.target.value);
        if (event.target.value === '') {
          if (onClear && value !== null) onClear();
          return;
        }
        const next = Number(event.target.value);
        if (Number.isInteger(next) && next >= min && next <= max && next !== value) {
          onCommit(next);
        }
      }}
      onBlur={() => setDraft(text)}
    />
  );
}
