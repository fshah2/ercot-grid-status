import React from "react";

export function Layout(props: { children: React.ReactNode }) {
  return (
    <div className="page">
      <header className="header">
        <div className="container">
          <div className="titleRow">
            <h1 className="h1">ERCOT Grid Status</h1>
            <div className="subtitle">A simple, plain-English dashboard for Texans</div>
          </div>
        </div>
      </header>

      <main className="container main">{props.children}</main>

      <footer className="footer">
        <div className="container footerInner">
          <div>
            Data source: ERCOT Public Data API. Updates about every 15 minutes.
          </div>
          <div className="muted">
            Tip: tooltips explain what each chart means in everyday language.
          </div>
        </div>
      </footer>
    </div>
  );
}
