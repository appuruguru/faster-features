/**
 * faster-features — React feedback widget
 *
 *   <FeedbackWidget
 *     ingestUrl="https://faster-features-ingest.you.workers.dev"
 *     appVersion="1.4.2"
 *     user={currentUser?.email}
 *   />
 *
 * Posts feedback to the ingest Worker. No GitHub token, no account for the user.
 * Bring your own styles, or reuse the classes from widget.js's injected CSS.
 */
import { useCallback, useState } from "react";

type FeedbackType = "idea" | "bug";

export interface FeedbackWidgetProps {
  ingestUrl: string;
  appVersion?: string;
  user?: string;
  /** Optional shared secret sent as the x-ff-key header. */
  sharedKey?: string;
  label?: string;
  /** Optional target repo ("owner/name") when one Worker serves multiple repos. */
  repo?: string;
}

type Status = "idle" | "sending" | "sent" | "error";

export function FeedbackWidget({
  ingestUrl,
  appVersion = "",
  user = "",
  sharedKey,
  label = "Feedback",
  repo = "",
}: FeedbackWidgetProps) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<FeedbackType>("idea");
  const [message, setMessage] = useState("");
  const [hp, setHp] = useState(""); // honeypot
  const [status, setStatus] = useState<Status>("idle");

  const reset = useCallback(() => {
    setOpen(false);
    setType("idea");
    setMessage("");
    setHp("");
    setStatus("idle");
  }, []);

  const send = useCallback(async () => {
    if (status === "sending") return;
    if (!message.trim()) {
      setStatus("error");
      return;
    }
    setStatus("sending");
    try {
      const res = await fetch(ingestUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(sharedKey ? { "x-ff-key": sharedKey } : {}),
        },
        body: JSON.stringify({
          message: message.trim(),
          type,
          hp,
          repo,
          context: {
            // Path only — never the query string, which can carry tokens/PII.
            page: typeof location !== "undefined" ? location.pathname : "",
            appVersion,
            userAgent:
              typeof navigator !== "undefined" ? navigator.userAgent : "",
            user, // only set if the host app explicitly passes one
          },
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setStatus("sent");
      setTimeout(reset, 1600);
    } catch {
      setStatus("error");
    }
  }, [ingestUrl, message, type, hp, appVersion, user, sharedKey, repo, status, reset]);

  if (!open) {
    return (
      <button className="ff-btn" type="button" onClick={() => setOpen(true)}>
        {label}
      </button>
    );
  }

  return (
    <div
      className="ff-overlay"
      onClick={(e) => e.target === e.currentTarget && reset()}
    >
      <div className="ff-panel" role="dialog" aria-modal="true">
        {status === "sent" ? (
          <div className="ff-thanks">
            <div className="ff-thanks-mark">✓</div>
            <div className="ff-thanks-text">Thanks! Your feedback was sent.</div>
          </div>
        ) : (
          <>
            <div className="ff-header">
              <span className="ff-title">Send feedback</span>
              <button className="ff-x" type="button" aria-label="Close" onClick={reset}>
                ×
              </button>
            </div>
            <div className="ff-types">
              {(["idea", "bug"] as FeedbackType[]).map((t) => (
                <button
                  key={t}
                  type="button"
                  className={"ff-type" + (type === t ? " ff-type--on" : "")}
                  onClick={() => setType(t)}
                >
                  {t === "idea" ? "Idea" : "Bug"}
                </button>
              ))}
            </div>
            <textarea
              className="ff-textarea"
              rows={5}
              placeholder="What would make this better?"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
            <input
              className="ff-hp"
              type="text"
              tabIndex={-1}
              autoComplete="off"
              aria-hidden="true"
              value={hp}
              onChange={(e) => setHp(e.target.value)}
            />
            <div className="ff-error">
              {status === "error"
                ? message.trim()
                  ? "Couldn't send right now. Please try again."
                  : "Please enter some feedback."
                : ""}
            </div>
            <button
              className="ff-submit"
              type="button"
              disabled={status === "sending"}
              onClick={send}
            >
              {status === "sending" ? "Sending…" : "Send"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export default FeedbackWidget;
