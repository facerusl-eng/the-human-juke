import { memo } from 'react'

export type ActionButtonConfig = {
  id: string
  label: string
  onClick: () => void | Promise<void>
  disabled?: boolean
  title?: string
  variant?: 'primary' | 'secondary' | 'ghost'
  className?: string
}

function getActionButtonClassName(
  variant: NonNullable<ActionButtonConfig['variant']> = 'secondary',
  buttonClassName?: string,
  actionClassName?: string,
) {
  return [
    variant === 'primary'
      ? 'primary-button'
      : variant === 'ghost'
      ? 'ghost-button'
      : 'secondary-button',
    buttonClassName,
    actionClassName,
  ]
    .filter(Boolean)
    .join(' ')
}

export const ActionButtonGroup = memo(function ActionButtonGroup({
  actions,
  layoutClassName,
  buttonClassName,
}: {
  actions: ActionButtonConfig[]
  layoutClassName: string
  buttonClassName?: string
}) {
  return (
    <div className={layoutClassName}>
      {actions.map((action) => (
        <button
          key={action.id}
          type="button"
          className={getActionButtonClassName(action.variant, buttonClassName, action.className)}
          disabled={action.disabled}
          title={action.title}
          onClick={() => {
            void action.onClick()
          }}
        >
          {action.label}
        </button>
      ))}
    </div>
  )
})