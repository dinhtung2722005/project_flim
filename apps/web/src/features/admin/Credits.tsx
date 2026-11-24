import { useEffect, useState, type FormEvent } from "react";
import { api, type Row, type Page } from "../../lib/api";
import { useAuth, usePages } from "../../lib/state";
import { Field, ErrorBox, asError, Spinner } from "../../components/ui";
export function TitleCredits({
  titleId,
  onSaved,
}: {
  titleId: string;
  onSaved: () => void;
}) {
  const auth = useAuth(),
    people = usePages("/admin/people?limit=100");
  const [rows, setRows] = useState<Row[]>([]),
    [tag, setTag] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<Error | null>(null),
    [loaded, setLoaded] = useState(false),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    const c = new AbortController();
    setLoaded(false);
    api<Row>("/admin/titles/" + titleId, { signal: c.signal })
      .then((r) => {
        if (!c.signal.aborted) {
          setRows(
            r.data.credits.map((r: Row) => ({
              personId: r.personId,
              role: r.role,
              characterName: r.characterName,
              sortOrder: r.sortOrder,
            })),
          );
          setTag(r.etag || "");
          setError(null);
          setLoaded(true);
        }
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(asError(e));
      });
    return () => c.abort();
  }, [titleId, revision]);
  function change(i: number, k: string, v: unknown) {
    setRows((old) => old.map((r, n) => (n === i ? { ...r, [k]: v } : r)));
  }
  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<Row>("/admin/titles/" + titleId, {
        method: "PATCH",
        headers: { "If-Match": tag },
        body: { credits: rows },
      });
      setTag(r.etag || "");
      onSaved();
    } catch (e) {
      setError(asError(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel content-section">
      <h2>Diễn viên và đoàn phim</h2>
      <ErrorBox error={error} />
      {!loaded && !error ? (
        <Spinner />
      ) : (
        <form onSubmit={save}>
          <fieldset disabled={busy || !auth.can("catalog.write")}>
            <div className="credits-editor">
              {rows.map((r, i) => (
                <div className="form-grid" key={i}>
                  <Field label={"Người tham gia " + (i + 1)}>
                    <select
                      required
                      value={r.personId}
                      onChange={(e) => change(i, "personId", e.target.value)}
                    >
                      <option value="">Chọn người</option>
                      {!people.rows.some((p) => p.id === r.personId) &&
                        r.personId && (
                          <option value={r.personId}>
                            Người đã gán ({r.personId})
                          </option>
                        )}
                      {people.rows.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label={"Vai trò " + (i + 1)}>
                    <select
                      value={r.role}
                      onChange={(e) => change(i, "role", e.target.value)}
                    >
                      <option value="ACTOR">Diễn viên</option>
                      <option value="DIRECTOR">Đạo diễn</option>
                      <option value="WRITER">Biên kịch</option>
                      <option value="PRODUCER">Nhà sản xuất</option>
                    </select>
                  </Field>
                  <Field label={"Tên nhân vật " + (i + 1)}>
                    <input
                      maxLength={200}
                      value={r.characterName}
                      onChange={(e) =>
                        change(i, "characterName", e.target.value)
                      }
                    />
                  </Field>
                  <button
                    type="button"
                    className="button ghost"
                    onClick={() =>
                      setRows((old) => old.filter((_, n) => n !== i))
                    }
                  >
                    Bỏ người {i + 1}
                  </button>
                </div>
              ))}
            </div>
            {auth.can("catalog.write") && (
              <>
                <button
                  type="button"
                  className="button secondary"
                  disabled={rows.length >= 100}
                  onClick={() =>
                    setRows((old) => [
                      ...old,
                      {
                        personId: "",
                        role: "ACTOR",
                        characterName: "",
                        sortOrder: old.length,
                      },
                    ])
                  }
                >
                  Thêm người tham gia
                </button>{" "}
                <button className="button" disabled={!loaded}>
                  Lưu đoàn phim
                </button>
              </>
            )}
          </fieldset>
        </form>
      )}
      <ErrorBox error={people.error} />
      {people.cursor && (
        <button
          type="button"
          className="button ghost"
          disabled={people.loading}
          onClick={() => void people.more()}
        >
          Tải thêm người
        </button>
      )}
      <p className="muted">
        Nếu có xung đột, bản nháp vẫn được giữ. Chỉ tải lại khi bạn muốn bỏ bản
        nháp.
      </p>
      <button
        type="button"
        className="button ghost"
        disabled={busy}
        onClick={() => setRevision((v) => v + 1)}
      >
        Bỏ bản nháp và tải lại đoàn phim
      </button>
    </section>
  );
}
