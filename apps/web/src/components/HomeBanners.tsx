import { Link } from "react-router-dom";
import { useSite } from "../lib/site";
import { poster, type Row } from "../lib/api";
export function HomeBanners() {
  const data = useSite();
  if (!data.banners?.length) return null;
  return (
    <section className="homepage-banners container" aria-label="Phim nổi bật">
      {data.banners.map((b: Row) => (
        <Link
          className="homepage-banner"
          key={b.id}
          to={"/titles/" + b.titleId}
        >
          {poster(b.imageAssetRef, 960) && (
            <img src={poster(b.imageAssetRef, 960)} alt="" loading="lazy" />
          )}
          <span>{b.headline || b.localizedTitle}</span>
        </Link>
      ))}
    </section>
  );
}
