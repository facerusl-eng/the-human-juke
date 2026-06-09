import type { HTMLAttributes, ReactNode } from 'react'

type CardProps = HTMLAttributes<HTMLDivElement> & {
  children: ReactNode
  icon?: ReactNode
  iconLabel?: string
}

function Card({ children, icon, iconLabel = 'Card icon', className = '', ...props }: CardProps) {
  const classes = ['ui-card', className].filter(Boolean).join(' ')
  return (
    <div className={classes} {...props}>
      {icon ? (
        <div className="ui-card-icon" aria-label={iconLabel}>
          {icon}
        </div>
      ) : null}
      {children}
    </div>
  )
}

export default Card