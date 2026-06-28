/**
 * faster-features — public roadmap (React)
 *
 *   <Roadmap ingestUrl="https://faster-features-ingest.you.workers.dev" />
 *
 * Reads the ingest Worker's public GET endpoint. Shows only dev-curated items
 * (labeled `roadmap`) with safe fields (title + status). Reuses the `ffr-*`
 * styles from roadmap.js, or restyle to taste.
 */
import { useEffect, useState } from "react";

type Status = "planned" | "in_progress" | "shipped";
interface Item {
  id: number;
  title: string;
  status: Status;
  updatedAt: string;
}

const COLUMNS: { key: Status; title: string }[] = [
  { key: "planned", title: "Planned" },
  { key: "in_progress", title: "In progress" },
  { key: "shipped", title: "Shipped" },
];

export interface RoadmapProps {
  ingestUrl: string;
  /** Optional target repo when one Worker serves multiple repos. */
  repo?: string;
}

export function Roadmap({ ingestUrl, repo }: RoadmapProps) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    const url = ingestUrl + (repo ? `?repo=${encodeURIComponent(repo)}` : "");
    fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d) => setItems(d.items || []))
      .catch(() => setError(true));
  }, [ingestUrl, repo]);

  if (error) return <div className="ffr-loading">Roadmap unavailable right now.</div>;
  if (!items) return <div className="ffr-loading">Loading roadmap…</div>;

  return (
    <div className="ffr-board">
      {COLUMNS.map((col) => {
        const inCol = items.filter((i) => i.status === col.key);
        return (
          <div className="ffr-col" key={col.key}>
            <div className="ffr-col-head">
              {col.title}
              <span className="ffr-count">{inCol.length}</span>
            </div>
            {inCol.length ? (
              inCol.map((i) => (
                <div className="ffr-card" key={i.id}>
                  {i.title}
                </div>
              ))
            ) : (
              <div className="ffr-empty">Nothing here yet.</div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default Roadmap;
