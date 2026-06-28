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
  votes?: number;
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
  const [voting, setVoting] = useState(false);
  const [voted, setVoted] = useState<Record<number, boolean>>({});
  const [error, setError] = useState(false);

  const voteUrl = ingestUrl.replace(/\/$/, "") + "/vote";
  const votedKey = (id: number) => `ffv:${repo || "default"}:${id}`;

  useEffect(() => {
    const url = ingestUrl + (repo ? `?repo=${encodeURIComponent(repo)}` : "");
    fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d) => {
        setItems(d.items || []);
        setVoting(!!d.voting);
      })
      .catch(() => setError(true));
  }, [ingestUrl, repo]);

  const upvote = (id: number) => {
    if (voted[id]) return;
    setVoted((v) => ({ ...v, [id]: true }));
    setItems((cur) =>
      cur ? cur.map((i) => (i.id === id ? { ...i, votes: (i.votes || 0) + 1 } : i)) : cur,
    );
    try { localStorage.setItem(votedKey(id), "1"); } catch {}
    fetch(voteUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, repo }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d && typeof d.votes === "number")
          setItems((cur) =>
            cur ? cur.map((i) => (i.id === id ? { ...i, votes: d.votes } : i)) : cur,
          );
      })
      .catch(() => {});
  };

  if (error) return <div className="ffr-loading">Roadmap unavailable right now.</div>;
  if (!items) return <div className="ffr-loading">Loading roadmap…</div>;

  const hasVoted = (id: number) => {
    if (voted[id]) return true;
    try { return !!localStorage.getItem(votedKey(id)); } catch { return false; }
  };

  return (
    <div className="ffr-board">
      {COLUMNS.map((col) => {
        const inCol = items.filter((i) => i.status === col.key);
        if (voting) inCol.sort((a, b) => (b.votes || 0) - (a.votes || 0));
        return (
          <div className="ffr-col" key={col.key}>
            <div className="ffr-col-head">
              {col.title}
              <span className="ffr-count">{inCol.length}</span>
            </div>
            {inCol.length ? (
              inCol.map((i) => (
                <div className="ffr-card" key={i.id}>
                  <div className="ffr-card-title">{i.title}</div>
                  {voting && (
                    <button
                      type="button"
                      className={"ffr-vote" + (hasVoted(i.id) ? " ffr-vote--on" : "")}
                      disabled={hasVoted(i.id)}
                      onClick={() => upvote(i.id)}
                      title="Upvote"
                    >
                      ▲<span className="ffr-vote-count">{i.votes || 0}</span>
                    </button>
                  )}
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
