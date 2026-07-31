// Themed textarea matching beUI Input (accent focus ring)

import {
  forwardRef,
  useId,
  useState,
  type TextareaHTMLAttributes,
} from 'react';
import { cn } from '~/lib/utils';

export interface TextareaProps extends Omit<
  TextareaHTMLAttributes<HTMLTextAreaElement>,
  'onChange'
> {
  label?: string;
  value?: string;
  onChange?: (value: string) => void;
  className?: string;
  fieldClassName?: string;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  function Textarea(
    {
      label,
      value,
      onChange,
      onFocus,
      onBlur,
      className,
      fieldClassName,
      disabled,
      id: idProp,
      rows = 4,
      ...rest
    },
    ref
  ) {
    const autoId = useId();
    const id = idProp ?? autoId;
    const [focused, setFocused] = useState(false);

    return (
      <div className={cn('flex flex-col gap-1.5', className)}>
        {label ? (
          <label
            htmlFor={id}
            className="px-1 text-xs font-semibold text-muted-foreground"
          >
            {label}
          </label>
        ) : null}
        <textarea
          ref={ref}
          id={id}
          rows={rows}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange?.(e.target.value)}
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          className={cn(
            'w-full rounded-xl border border-border bg-card px-3 py-2 text-sm text-foreground caret-accent outline-none transition-colors',
            'placeholder:text-muted-foreground/60',
            focused && 'border-accent ring-2 ring-ring/30',
            disabled && 'cursor-not-allowed opacity-60',
            fieldClassName
          )}
          {...rest}
        />
      </div>
    );
  }
);
