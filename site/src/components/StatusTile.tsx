import React from "react";
import { Tooltip } from "./Tooltip";

export function StatusTile(props: {
  title: string;
  value: string;
  subvalue?: string;
  tone: "good" | "warn" | "bad" | "neutral";
  tooltipTitle: string;
  tooltipBody: React.ReactNode;
  icon?: string; // decorative
}) {
  return (
    <div className={`tile tile-${props.tone}`}>
      <div className="tileTop">
        <div className="tileTitle">
          {props.icon && (
            <span className="tileIcon" aria-hidden="true">
              {props.icon}
            </span>
          )}
          {props.title}
        </div>
        <Tooltip label={props.tooltipTitle}>{props.tooltipBody}</Tooltip>
      </div>

      <div className="tileValuePill">
        <span className="tileValue">{props.value}</span>
      </div>

      {props.subvalue && <div className="tileSub">{props.subvalue}</div>}
    </div>
  );
}
