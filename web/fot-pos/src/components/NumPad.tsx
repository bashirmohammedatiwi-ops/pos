export function NumPad({
  onDigit,
  onBack,
  onClear,
}: {
  onDigit: (digit: string) => void;
  onBack: () => void;
  onClear?: () => void;
}) {
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '⌫'] as const;
  return (
    <div className="grid grid-cols-3 gap-1.5">
      {keys.map(key => (
        <button
          key={key}
          type="button"
          className={`pos-key ${key === 'C' || key === '⌫' ? 'pos-key-action' : ''}`}
          onClick={() => {
            if (key === 'C') onClear?.();
            else if (key === '⌫') onBack();
            else onDigit(key);
          }}
        >
          {key}
        </button>
      ))}
    </div>
  );
}
