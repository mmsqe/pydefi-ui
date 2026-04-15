import { cn } from "@/lib/utils";
import { HTMLAttributes } from "react";

type BadgeVariant = "default" | "cyan" | "purple" | "green" | "muted" | "v2" | "v3";

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
}

const variantClasses: Record<BadgeVariant, string> = {
  default: "bg-cyan/10 text-cyan border border-cyan/20",
  cyan: "bg-cyan/10 text-cyan border border-cyan/20",
  purple: "bg-purple/10 text-purple border border-purple/20",
  green: "bg-green/10 text-green border border-green/20",
  muted: "bg-muted/10 text-muted border border-muted/20",
  v2: "bg-purple/10 text-purple border border-purple/20",
  v3: "bg-cyan/10 text-cyan border border-cyan/20",
};

export function Badge({ variant = "default", className, children, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center px-2 py-0.5 rounded-md text-xs font-semibold font-mono",
        variantClasses[variant],
        className
      )}
      {...props}
    >
      {children}
    </span>
  );
}
