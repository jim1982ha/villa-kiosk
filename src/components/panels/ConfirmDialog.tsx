// src/components/panels/ConfirmDialog.tsx
// Lightweight yes/no gate shown before an instant action when the tapped entity's
// mapping has requiresConfirmation set (Config Editor → Confirm). Reuses the shared
// .modal-backdrop / .modal styling so it matches the rest of the UI.

interface Props {
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({ title, message, confirmLabel, danger, onConfirm, onCancel }: Props) {
  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal" style={{ maxWidth: 380 }} onClick={(e) => e.stopPropagation()}>
        <h2>{title}</h2>
        <p className="sub" style={{ marginTop: 8 }}>{message}</p>
        <div className="modal-actions">
          <button className="btn ghost" onClick={onCancel}>Cancel</button>
          <button className={`btn ${danger ? "danger" : "primary"}`} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
