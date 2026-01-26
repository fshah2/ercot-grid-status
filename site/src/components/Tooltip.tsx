import React, { useState } from "react";

export function Tooltip(props: { label: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);

  return (
    <span className="tooltipWrap">
      <button
        type="button"
        className="infoBtn"
        aria-label={props.label}
        onClick={() => setOpen((v) => !v)}
        onBlur={() => setOpen(false)}
      >
        i
      </button>

      {open && (
        <div className="tooltip" role="dialog" aria-label={props.label}>
          <div className="tooltipTitle">{props.label}</div>
          <div className="tooltipBody">{props.children}</div>
        </div>
      )}
    </span>
  );
}
