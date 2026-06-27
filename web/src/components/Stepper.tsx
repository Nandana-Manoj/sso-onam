/** A small −/+ number counter. Keeps the value within [min, max] and stays
 *  typeable for quick large entries. Used for ticket/person counts. */
export default function Stepper({
  value, onChange, min = 0, max = 99, disabled = false,
}: {
  value: number;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
  disabled?: boolean;
}) {
  const set = (n: number) => onChange(Math.max(min, Math.min(max, Number.isFinite(n) ? n : min)));
  return (
    <div className="stepper">
      <button type="button" className="step-btn" aria-label="Decrease"
        disabled={disabled || value <= min} onClick={() => set(value - 1)}>−</button>
      <input
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        value={value}
        disabled={disabled}
        onChange={(e) => set(Math.floor(Number(e.target.value)))}
      />
      <button type="button" className="step-btn" aria-label="Increase"
        disabled={disabled || value >= max} onClick={() => set(value + 1)}>+</button>
    </div>
  );
}
