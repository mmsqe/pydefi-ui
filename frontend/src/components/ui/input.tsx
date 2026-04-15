import { cn } from "@/lib/utils";
import { InputHTMLAttributes, forwardRef } from "react";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  suffix?: React.ReactNode;
  adornmentStart?: React.ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, suffix, adornmentStart, className, ...props }, ref) => {
    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label className="text-xs font-medium uppercase tracking-wider text-muted">
            {label}
          </label>
        )}
        <div className="relative flex items-center">
          {adornmentStart && (
            <div className="absolute left-3 text-muted flex items-center pointer-events-none">
              {adornmentStart}
            </div>
          )}
          <input
            ref={ref}
            className={cn(
              "w-full bg-surface border border-border-dim rounded-xl px-4 py-2.5 text-sm text-[#e8eaf0] placeholder-muted",
              "focus:outline-none focus:border-cyan/40 focus:ring-1 focus:ring-cyan/20 focus:bg-surface",
              "transition-all duration-150",
              adornmentStart && "pl-9",
              suffix && "pr-9",
              error && "border-red-500/50 focus:border-red-500/70",
              className
            )}
            {...props}
          />
          {suffix && (
            <div className="absolute right-3 text-muted flex items-center pointer-events-none">
              {suffix}
            </div>
          )}
        </div>
        {error && <p className="text-xs text-red-400">{error}</p>}
      </div>
    );
  }
);

Input.displayName = "Input";

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
}

export function Select({ label, className, children, ...props }: SelectProps) {
  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label className="text-xs font-medium uppercase tracking-wider text-muted">
          {label}
        </label>
      )}
      <select
        className={cn(
          "w-full bg-surface border border-border-dim rounded-xl px-4 py-2.5 text-sm text-[#e8eaf0]",
          "focus:outline-none focus:border-cyan/40 focus:ring-1 focus:ring-cyan/20",
          "transition-all duration-150 cursor-pointer appearance-none",
          className
        )}
        {...props}
      >
        {children}
      </select>
    </div>
  );
}
