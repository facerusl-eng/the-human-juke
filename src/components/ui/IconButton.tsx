import type { ButtonHTMLAttributes } from 'react'

type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  icon: string
  label: string
  className?: string
}

function IconButton({ icon, label, className = '', ...props }: IconButtonProps) {
  const classes = ['ui-icon-button', className].filter(Boolean).join(' ')

  return (
    <button type="button" className={classes} aria-label={label} title={label} {...props}>
      <span aria-hidden="true">{icon}</span>
    </button>
  )
}

export default IconButton