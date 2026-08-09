import type { ReactNode } from "react";

export function AdminSwitchRow({
  name,
  title,
  description,
  status,
  defaultChecked = false,
  disabled = false,
}: {
  name: string;
  title: string;
  description?: string;
  status?: ReactNode;
  defaultChecked?: boolean;
  disabled?: boolean;
}) {
  return (
    <label className={`adminSwitchRow${disabled ? " isDisabled" : ""}`}>
      <span className="adminSwitchRowCopy">
        <span>
          <strong>{title}</strong>
          {status ? <small className="adminSwitchStatus">{status}</small> : null}
        </span>
        {description ? <small>{description}</small> : null}
      </span>
      <input name={name} type="checkbox" defaultChecked={defaultChecked && !disabled} disabled={disabled} />
      <span className="adminSwitchRowTrack" aria-hidden="true" />
    </label>
  );
}
