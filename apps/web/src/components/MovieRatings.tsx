import { useData } from "../lib/state";
type Scores = {
  status: string;
  provider: "OMDB";
  imdb: {
    score: number | null;
    scale: 10;
    votes: number | null;
    url: string | null;
  };
  metacritic: { score: number | null; scale: 100 };
  fetchedAt: string | null;
};
export function MovieRatings({ titleId }: { titleId: string }) {
  const data = useData<Scores>("/titles/" + titleId + "/ratings"),
    scores = data.data;
  const imdb = scores?.imdb?.score,
    meta = scores?.metacritic?.score;
  const validImdb =
    typeof imdb === "number" &&
    Number.isFinite(imdb) &&
    imdb >= 0 &&
    imdb <= 10;
  const validMeta =
    typeof meta === "number" &&
    Number.isInteger(meta) &&
    meta >= 0 &&
    meta <= 100;
  const imdbUrl =
    typeof scores?.imdb?.url === "string" &&
    /^https:\/\/www\.imdb\.com\/title\/tt[0-9]{7,10}\/$/.test(scores.imdb.url)
      ? scores.imdb.url
      : undefined;
  return (
    <section
      className="movie-ratings"
      aria-label="Điểm IMDb và Metacritic"
      aria-busy={data.loading}
    >
      <h2 className="ratings-heading">Điểm đánh giá</h2>
      <div className="movie-ratings-grid">
        <article
          className="movie-score movie-score-imdb"
          aria-label="Điểm IMDb"
        >
          <div className="movie-score-heading">
            <span className="score-source score-source-imdb">IMDb</span>
            <span>Khán giả</span>
          </div>
          <div className="movie-score-value">
            {data.loading ? (
              <span className="score-placeholder">Đang tải…</span>
            ) : validImdb ? (
              <>
                <strong>{imdb.toFixed(1)}</strong>
                <span>/10</span>
              </>
            ) : (
              <span className="score-placeholder">Chưa có điểm</span>
            )}
          </div>
          {validImdb && scores?.imdb?.votes != null && (
            <small>
              {scores.imdb.votes.toLocaleString("vi-VN")} lượt đánh giá
            </small>
          )}
          {imdbUrl && (
            <a href={imdbUrl} target="_blank" rel="noopener noreferrer">
              Xem trên IMDb ↗
            </a>
          )}
        </article>
        <article
          className="movie-score movie-score-meta"
          aria-label="Điểm Metacritic"
        >
          <div className="movie-score-heading">
            <span className="score-source score-source-meta">Metacritic</span>
            <span>Metascore · Giới phê bình</span>
          </div>
          <div className="movie-score-value">
            {data.loading ? (
              <span className="score-placeholder">Đang tải…</span>
            ) : validMeta ? (
              <>
                <strong
                  className={
                    meta >= 61
                      ? "score-positive"
                      : meta >= 40
                        ? "score-mixed"
                        : "score-negative"
                  }
                >
                  {meta}
                </strong>
                <span>/100</span>
              </>
            ) : (
              <span className="score-placeholder">Chưa có điểm</span>
            )}
          </div>
          <small>Điểm tổng hợp của giới phê bình</small>
        </article>
      </div>
      <div className="movie-ratings-note">
        <span>
          Nguồn dữ liệu:{" "}
          <a
            href="https://www.omdbapi.com/"
            target="_blank"
            rel="noopener noreferrer"
          >
            OMDb
          </a>
          {scores?.fetchedAt
            ? " · Cập nhật " +
              new Date(scores.fetchedAt).toLocaleDateString("vi-VN")
            : ""}
        </span>
        {!data.loading && (data.error || scores?.status === "UNAVAILABLE") && (
          <span role="status">
            Chưa tải được điểm đánh giá.{" "}
            <button className="text-link" onClick={data.reload}>
              Thử lại
            </button>
          </span>
        )}
        {!data.loading &&
          !data.error &&
          scores?.status !== "UNAVAILABLE" &&
          !validImdb &&
          !validMeta && (
            <span>Chưa có dữ liệu điểm IMDb và Metacritic cho phim này.</span>
          )}
      </div>
    </section>
  );
}
