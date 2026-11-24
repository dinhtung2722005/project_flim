// Normalize a bounded public-metadata batch. This module never handles video URLs.
export const PROVIDER = "KKPHIM";
export const IMAGE_HOST = "phimimg.com";
export function normalizeName(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
export function plainText(value, limit = 2000) {
  let text = String(value ?? "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "");
  for (let i = 0; i < 2; i++)
    text = text
      .replace(/<[^>]*>/g, " ")
      .replace(
        /&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi,
        (_, entity) => {
          const named = {
            amp: "&",
            lt: "<",
            gt: ">",
            quot: '"',
            apos: "'",
            nbsp: " ",
          };
          if (entity[0] !== "#") return named[entity.toLowerCase()];
          const number =
            entity[1].toLowerCase() === "x"
              ? parseInt(entity.slice(2), 16)
              : Number(entity.slice(1));
          return number > 0 &&
            number <= 0x10ffff &&
            !(number >= 0xd800 && number <= 0xdfff)
            ? String.fromCodePoint(number)
            : "";
        },
      );
  return text
    .replace(/<[^>]*>/g, " ")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .normalize("NFC")
    .slice(0, limit);
}
export function episodeCount(value, kind) {
  const text = String(value ?? "").trim();
  const match = text.match(/^(\d+)(?:\s*(?:tập|tap|episodes?))?$/i);
  if (!match) throw new Error("EPISODE_COUNT_UNVERIFIED");
  const number = Number(match[1]);
  if (!Number.isSafeInteger(number) || number < 1 || number > 100)
    throw new Error("EPISODE_COUNT_OUT_OF_RANGE");
  if (kind === "MOVIE" && number !== 1)
    throw new Error("MOVIE_EPISODE_COUNT_INVALID");
  return number;
}
export function safeImageUrl(value) {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.hostname !== IMAGE_HOST ||
    url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !["/uploads/movies/", "/upload/vod/"].some((prefix) =>
      url.pathname.startsWith(prefix),
    )
  )
    throw new Error("IMAGE_SOURCE_NOT_ALLOWED");
  if (!/\.(?:jpe?g|png|webp)$/i.test(url.pathname))
    throw new Error("IMAGE_FORMAT_NOT_ALLOWED");
  return url.href;
}
export function normalizeItem(raw, synopsis) {
  const kind =
    raw.type === "single" ? "MOVIE" : raw.type === "series" ? "SERIES" : null;
  if (
    !/^[a-f0-9]{16,64}$/.test(String(raw.providerId)) ||
    !kind ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(raw.slug || "") ||
    raw.slug.length > 180
  )
    throw new Error("METADATA_ID_INVALID");
  const name = plainText(raw.name, 300),
    originalName = plainText(raw.originalName, 300);
  const year = Number(raw.year);
  const description = plainText(synopsis, 2000);
  if (
    !name ||
    !description ||
    !Number.isInteger(year) ||
    year < 1888 ||
    year > 2200
  )
    throw new Error("METADATA_FIELDS_INVALID");
  const genres = (raw.category || []).map((g) => ({
    slug: String(g.slug),
    name: plainText(g.name, 100),
  }));
  if (genres.some((g) => !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(g.slug) || !g.name))
    throw new Error("METADATA_GENRE_INVALID");
  const countryMap = {
    "viet-nam": "VN",
    "han-quoc": "KR",
    "trung-quoc": "CN",
    "nhat-ban": "JP",
    "au-my": "US",
    anh: "GB",
    phap: "FR",
    "thai-lan": "TH",
    "dai-loan": "TW",
    "hong-kong": "HK",
    "an-do": "IN",
    duc: "DE",
    canada: "CA",
    uc: "AU",
    brazil: "BR",
    "tay-ban-nha": "ES",
    mexico: "MX",
    y: "IT",
    indonesia: "ID",
    malaysia: "MY",
    philippines: "PH",
  };
  // "Âu Mỹ" groups several countries; do not pretend it is a verified US country.
  delete countryMap["au-my"];
  const countryCodes = [
    ...new Set(
      (raw.country || []).map((c) => countryMap[c.slug]).filter(Boolean),
    ),
  ];
  return {
    provider: PROVIDER,
    providerId: String(raw.providerId),
    sourceSlug: raw.slug,
    sourceApiUrl: "https://phimapi.com/phim/" + raw.slug,
    sourcePageUrl: "https://www.kkphim2.com/phim/" + raw.slug,
    slug: raw.slug,
    name,
    originalName,
    kind,
    year,
    synopsis: description,
    synopsisAdapted: true,
    posterUrl: safeImageUrl(raw.posterUrl),
    expectedEpisodes: episodeCount(raw.episodeTotal, kind),
    sourceEpisodeCurrent: plainText(raw.episodeCurrent, 100),
    countryCodes,
    genres: [...new Map(genres.map((g) => [g.slug, g])).values()],
  };
}
export function titleMatches(existing, candidate) {
  if (
    existing.kind !== candidate.kind ||
    Number(existing.releaseYear) !== candidate.year
  )
    return false;
  const names = [existing.localizedTitle, existing.originalTitle]
    .map(normalizeName)
    .filter(Boolean);
  return [candidate.name, candidate.originalName]
    .map(normalizeName)
    .filter(Boolean)
    .some((n) => names.includes(n));
}
export function validImageBytes(bytes) {
  return (
    Buffer.isBuffer(bytes) &&
    bytes.length >= 12 &&
    (bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])) ||
      bytes
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
      (bytes.toString("ascii", 0, 4) === "RIFF" &&
        bytes.toString("ascii", 8, 12) === "WEBP"))
  );
}
