from __future__ import annotations

import hashlib
import json
import re
import unicodedata
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

MAX_SNAPSHOT_BYTES = 5_000_000


class AgentError(Exception):
    """Only this safe code is shown to notebook users."""
    def __init__(self, code: str):
        self.code = code
        super().__init__(code)


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class Title(StrictModel):
    id: str = Field(min_length=1, max_length=80)
    kind: Literal["MOVIE", "SERIES"]
    name: str = Field(min_length=1, max_length=300)
    original_name: str | None = Field(default=None, max_length=300)
    synopsis: str = Field(default="", max_length=3000)
    genres: list[str] = Field(default_factory=list, max_length=30)
    credits: list[str] = Field(default_factory=list, max_length=30)
    year: int | None = Field(default=None, ge=1880, le=2200)
    countries: list[str] = Field(default_factory=list, max_length=20)
    language: str | None = Field(default=None, max_length=35)
    metadata_truncated: bool = False

    @field_validator("id")
    @classmethod
    def title_id(cls, value: str) -> str:
        if not re.fullmatch(r"demo-[a-z0-9-]{1,60}", value):
            try:
                UUID(value)
            except ValueError:
                raise ValueError("title ID must be a UUID or demo ID") from None
        return value

    @field_validator("genres", "credits", "countries")
    @classmethod
    def bounded_strings(cls, values: list[str]) -> list[str]:
        if any(not v.strip() or len(v) > 200 for v in values):
            raise ValueError("invalid metadata list")
        return values


class Rights(StrictModel):
    cloud_processing: Literal[True]
    embedding: Literal[True]

    @field_validator("cloud_processing", "embedding", mode="before")
    @classmethod
    def true_boolean(cls, value):
        if value is not True:
            raise ValueError("explicit true boolean required")
        return value


class Snapshot(StrictModel):
    schema_version: Literal[1]
    source: Literal["pj-flim-public-catalog", "pj-flim-synthetic-demo"]
    generated_at: str
    expires_at: str
    demo: bool
    truncated: bool
    rights: Rights
    titles: list[Title] = Field(max_length=1000)
    titles_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")

    @model_validator(mode="after")
    def consistent(self):
        if len({t.id for t in self.titles}) != len(self.titles):
            raise ValueError("duplicate title IDs")
        if self.demo != (self.source == "pj-flim-synthetic-demo"):
            raise ValueError("demo source mismatch")
        if any(t.id.startswith("demo-") != self.demo for t in self.titles):
            raise ValueError("demo title mismatch")
        return self


def canonical(value) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False).encode("utf-8")


def digest(value) -> str:
    return hashlib.sha256(canonical(value)).hexdigest()


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def parse_time(value: str) -> datetime:
    try:
        result = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if result.tzinfo is None:
            raise ValueError()
        return result.astimezone(timezone.utc)
    except (TypeError, ValueError):
        raise AgentError("SNAPSHOT_TIME_INVALID") from None


class Catalog:
    def __init__(self, snapshot: Snapshot, clock=utcnow):
        self.snapshot = snapshot
        self.clock = clock
        self.by_id = {t.id: t for t in snapshot.titles}
        self.ensure_fresh()

    @classmethod
    def load(cls, path: str | Path, clock=utcnow):
        path = Path(path)
        if not path.is_file() or path.stat().st_size > MAX_SNAPSHOT_BYTES:
            raise AgentError("SNAPSHOT_SIZE_INVALID")
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
            # Validate the original serialized fields before Pydantic fills defaults.
            if digest(raw["titles"]) != raw["titles_sha256"]:
                raise AgentError("SNAPSHOT_HASH_INVALID")
            snapshot = Snapshot.model_validate(raw)
        except AgentError:
            raise
        except (ValueError, KeyError, TypeError, UnicodeError):
            raise AgentError("SNAPSHOT_SCHEMA_INVALID") from None
        return cls(snapshot, clock)

    def ensure_fresh(self):
        created = parse_time(self.snapshot.generated_at)
        expires = parse_time(self.snapshot.expires_at)
        now = self.clock()
        if created > now + timedelta(minutes=5) or not created < expires <= created + timedelta(hours=24):
            raise AgentError("SNAPSHOT_TIME_INVALID")
        if now >= expires:
            raise AgentError("SNAPSHOT_EXPIRED")

    def title(self, title_id: str) -> Title:
        self.ensure_fresh()
        if title_id not in self.by_id:
            raise AgentError("TITLE_NOT_IN_SNAPSHOT")
        return self.by_id[title_id]

    def document(self, title: Title) -> str:
        return "\n".join([title.name, title.original_name or "", title.synopsis,
                          "Thể loại: " + ", ".join(title.genres),
                          "Người tham gia: " + ", ".join(title.credits)])


def normalize(text: str) -> str:
    text = unicodedata.normalize("NFD", text.lower().replace("đ", "d"))
    return " ".join(re.findall(r"[a-z0-9]+", "".join(c for c in text if not unicodedata.combining(c))))


def create_demo(path: str | Path, now: datetime | None = None):
    clock = utcnow if now is None else lambda: now
    now = now or utcnow()
    rows = [
        Title(id="demo-sao-hoa", kind="MOVIE", name="Chuyến tàu đến Sao Hỏa",
              synopsis="Một kỹ sư và người bạn robot khám phá vũ trụ, tìm đường trở về gia đình.",
              genres=["Khoa học viễn tưởng", "Phiêu lưu"], year=2024, countries=["VN"]).model_dump(),
        Title(id="demo-bep-nho", kind="MOVIE", name="Căn bếp cuối ngõ",
              synopsis="Gia đình mở quán ăn, cùng vượt qua hiểu lầm bằng những bữa cơm ấm áp.",
              genres=["Gia đình", "Hài"], year=2023, countries=["VN"]).model_dump(),
        Title(id="demo-hai-dang", kind="SERIES", name="Bí mật ngọn hải đăng",
              synopsis="Nhóm thám tử giải mã những lá thư và một vụ mất tích trên đảo.",
              genres=["Trinh thám", "Bí ẩn"], year=2025, countries=["VN"]).model_dump(),
        Title(id="demo-hanh-tinh", kind="MOVIE", name="Hành tinh của những khu vườn",
              synopsis="Cô bé và người máy vun trồng khu vườn ngoài không gian, kể câu chuyện nhẹ nhàng về tình bạn.",
              genres=["Khoa học viễn tưởng", "Gia đình"], year=2025, countries=["VN"]).model_dump(),
    ]
    payload = {"schema_version": 1, "source": "pj-flim-synthetic-demo",
               "generated_at": now.isoformat(), "expires_at": (now + timedelta(hours=24)).isoformat(),
               "demo": True, "truncated": False, "rights": {"cloud_processing": True, "embedding": True},
               "titles": rows, "titles_sha256": digest(rows)}
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return Catalog.load(path, clock=clock)
