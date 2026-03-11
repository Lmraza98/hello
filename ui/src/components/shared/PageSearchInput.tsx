import { Search } from 'lucide-react';

type PageSearchInputProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  className?: string;
  inputClassName?: string;
  ariaLabel?: string;
};

export function PageSearchInput({
  value,
  onChange,
  placeholder,
  className = '',
  inputClassName = '',
  ariaLabel,
}: PageSearchInputProps) {
  return (
    <div className={`relative h-8 min-w-[220px] flex-1 ${className}`.trim()}>
      <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-dim" />
      <input
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={ariaLabel || placeholder}
        className={`h-full w-full rounded-none border-none bg-surface pl-7 pr-2.5 text-[13px] text-text placeholder:text-[12px] placeholder:text-text-dim focus:border-accent focus:outline-none ${inputClassName}`.trim()}
      />
    </div>
  );
}
