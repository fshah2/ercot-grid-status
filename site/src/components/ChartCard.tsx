import React from "react";
import { Tooltip } from "./Tooltip";

export function ChartCard(props: {
  title: string;
  tooltipTitle: string;
  tooltipBody: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="card">
      <div className="cardHeader">
        <h2 className="h2">{props.title}</h2>
        <Tooltip label={props.tooltipTitle}>{props.tooltipBody}</Tooltip>
      </div>
      <div className="cardBody">{props.children}</div>
    </section>
  );
}

