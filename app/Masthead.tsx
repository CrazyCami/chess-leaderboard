import type { ReactNode } from "react";

interface MastheadProps {
  eyebrow: string;
  title: string;
  children: ReactNode;
}

/** Shared page header: eyebrow, title, intro, and a small board mark. */
export function Masthead({ eyebrow, title, children }: MastheadProps) {
  return (
    <header className="page-header">
      <div className="masthead-text">
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p className="intro">{children}</p>
      </div>
      <BoardMark />
    </header>
  );
}

function BoardMark() {
  const squares: ReactNode[] = [];
  for (let rank = 0; rank < 4; rank += 1) {
    for (let file = 0; file < 4; file += 1) {
      squares.push(
        <rect
          key={`${file}${rank}`}
          x={file * 16}
          y={rank * 16}
          width="16"
          height="16"
          className={(file + rank) % 2 === 0 ? "board-light" : "board-dark"}
        />,
      );
    }
  }
  return (
    <svg className="board-mark" viewBox="0 0 64 64" width="64" height="64" aria-hidden="true">
      {squares}
      <text x="2" y="62" className="board-coord">a</text>
      <text x="60" y="13" textAnchor="end" className="board-coord">4</text>
    </svg>
  );
}
