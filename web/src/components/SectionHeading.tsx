import type { ReactNode } from "react";

/**
 * The one heading every homepage section uses: a small label line, then the
 * section title, left-aligned at the same size, font and spacing everywhere.
 * `actions` (e.g. "Explore all", carousel arrows) sit on the right from
 * tablet width up; on phones each section keeps its own row under the rail.
 */
export function SectionHeading({ eyebrow, title, actions }: { eyebrow: string; title: string; actions?: ReactNode }) {
  return (
    <div className="sectionHeading">
      <div className="sectionHeading__text">
        <p className="sectionHeading__eyebrow">{eyebrow}</p>
        <h2 className="sectionHeading__title">{title}</h2>
      </div>
      {actions ? <div className="sectionHeading__actions">{actions}</div> : null}
    </div>
  );
}
