import * as React from 'react';
import Link from 'next/link';
import { cn } from '@/lib/utils/cn';

export type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'outline'
  | 'ghost'
  | 'danger'
  | 'subtle'
  | 'link';
export type ButtonSize = 'sm' | 'md' | 'lg';

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-brand text-white shadow-sm hover:bg-brand/90 active:bg-brand/95',
  secondary:
    'bg-[rgb(var(--brand-secondary))] text-white shadow-sm hover:bg-[rgb(var(--brand-secondary))]/90',
  outline: 'border border-hairline bg-surface text-content hover:bg-muted/5',
  ghost: 'text-content hover:bg-muted/10',
  subtle: 'bg-muted/10 text-content hover:bg-muted/20',
  danger: 'bg-red-600 text-white shadow-sm hover:bg-red-700',
  link: 'text-brand underline underline-offset-4 hover:no-underline p-0 h-auto',
};

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-[0.8125rem] gap-1.5',
  md: 'h-10 px-4 text-sm gap-2',
  lg: 'h-12 px-6 text-base gap-2',
};

export function buttonClasses(
  variant: ButtonVariant = 'primary',
  size: ButtonSize = 'md',
  className?: string,
): string {
  return cn(
    // `ui-btn` / `ui-btn-*` are hooks for the admin's design system
    // (src/app/admin/admin-ui.css). They only match inside `.admin-ui`, so the
    // public site keeps exactly these utilities.
    `ui-btn ui-btn-${variant}`,
    'inline-flex items-center justify-center whitespace-nowrap rounded-lg font-medium transition-colors',
    'disabled:pointer-events-none disabled:opacity-50',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2',
    VARIANTS[variant],
    variant !== 'link' && SIZES[size],
    className,
  );
}

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = 'primary', size = 'md', type = 'button', ...props },
  ref,
) {
  return <button ref={ref} type={type} className={buttonClasses(variant, size, className)} {...props} />;
});

export interface ButtonLinkProps extends React.ComponentPropsWithoutRef<typeof Link> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export function ButtonLink({ className, variant = 'primary', size = 'md', ...props }: ButtonLinkProps) {
  return <Link className={buttonClasses(variant, size, className)} {...props} />;
}
