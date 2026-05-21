import type { ButtonHTMLAttributes, ReactNode } from 'react'

type PrimaryButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'tertiary'
  children: ReactNode
  className?: string
}

function PrimaryButton({
  variant = 'primary',
  children,
  className = '',
  ...props
}: PrimaryButtonProps) {
  const variantClass = `${variant}-button`
  const classes = ['ui-button', variantClass, className].filter(Boolean).join(' ')

  return (
    <button type="button" className={classes} {...props}>
      {children}
    </button>
  )
}

export default PrimaryButton