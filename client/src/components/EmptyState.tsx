/**
 * Feature 012 (US4) — a small, accessible empty-state block. Renders an informative title and an
 * optional next-action hint as plain text (never a blank or cryptic placeholder), used for the
 * no-events list and the no-contacts state across the dead-man UI (FR-009). Presentation-only.
 */
export interface EmptyStateProps {
  title: string;
  hint?: string;
  /** Optional id so a control/region can reference this block via aria-describedby. */
  id?: string;
}

export function EmptyState({ title, hint, id }: EmptyStateProps) {
  return (
    <div className="empty-state" id={id}>
      <p className="empty-state__title">{title}</p>
      {hint ? <p className="empty-state__hint">{hint}</p> : null}
    </div>
  );
}
