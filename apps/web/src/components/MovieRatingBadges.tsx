import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
type CardScores = {
  imdb?: { score: number | null };
  metacritic?: { score: number | null };
};
// Load only visible cards, one at a time, to avoid a provider request burst.
const jobs: Array<() => Promise<void>> = [];
let running = false;
function drain() {
  if (running || !jobs.length) return;
  running = true;
  void jobs.shift()!()
    .catch(() => {})
    .finally(() => {
      running = false;
      drain();
    });
}
export function MovieRatingBadges({ titleId }: { titleId: string }) {
  const element = useRef<HTMLSpanElement>(null),
    [visible, setVisible] = useState(false),
    [scores, setScores] = useState<CardScores | null>(null);
  useEffect(() => {
    const node = element.current;
    if (!node) return;
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "80px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    let current = true;
    setScores(null);
    if (visible) {
      jobs.push(async () => {
        if (!current) return;
        try {
          const result = await api<CardScores>(
            "/titles/" + titleId + "/ratings",
            { auth: false },
          );
          if (current) setScores(result.data);
        } catch {
          if (current) setScores(null);
        }
      });
      drain();
    }
    return () => {
      current = false;
    };
  }, [titleId, visible]);
  const imdb = scores?.imdb?.score,
    meta = scores?.metacritic?.score;
  const imdbText =
    typeof imdb === "number" && Number.isFinite(imdb) && imdb >= 0 && imdb <= 10
      ? imdb.toFixed(1)
      : "—";
  const metaText =
    typeof meta === "number" &&
    Number.isInteger(meta) &&
    meta >= 0 &&
    meta <= 100
      ? String(meta)
      : "—";
  return (
    <span
      className="card-ratings"
      ref={element}
      aria-label="Điểm IMDb và Metacritic"
    >
      <span
        className="card-rating"
        title={
          imdbText === "—" ? "IMDb: Chưa có điểm" : "IMDb: " + imdbText + "/10"
        }
      >
        <span className="card-rating-imdb">IMDb</span>
        <strong>{imdbText}</strong>
        <span className="card-rating-scale">/10</span>
      </span>
      <span
        className="card-rating"
        title={
          metaText === "—"
            ? "Metacritic: Chưa có điểm"
            : "Metacritic Metascore: " + metaText + "/100"
        }
      >
        <span className="card-rating-meta">Metacritic</span>
        <strong>{metaText}</strong>
        <span className="card-rating-scale">/100</span>
      </span>
    </span>
  );
}
