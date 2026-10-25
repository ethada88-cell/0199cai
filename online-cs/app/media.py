"""Upload helpers, signed media URLs, and path resolution."""
from __future__ import annotations

import hashlib
import hmac
import os
import re
import time
import uuid
from pathlib import Path
from typing import BinaryIO
from urllib.parse import parse_qs, urlencode, urlparse

UPLOAD_ROOT = Path(os.getenv("UPLOAD_ROOT", "/data/uploads"))
ALLOWED_IMAGE = {".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"}
_HEIC_BRANDS = {b"heic", b"heif", b"heix", b"heim", b"heis", b"mif1", b"msf1"}
ALLOWED_FILE = ALLOWED_IMAGE | {
    ".pdf",
    ".doc",
    ".docx",
    ".xls",
    ".xlsx",
    ".ppt",
    ".pptx",
    ".txt",
    ".zip",
    ".rar",
    ".7z",
    ".mp3",
    ".mp4",
    ".csv",
}
MAX_BYTES = int(os.getenv("UPLOAD_MAX_BYTES", str(20 * 1024 * 1024)))
MIN_BYTES = int(os.getenv("UPLOAD_MIN_BYTES", "32"))  # reject empty / corrupt uploads
MEDIA_TTL_SEC = int(os.getenv("MEDIA_URL_TTL_SEC", str(7 * 24 * 3600)))
# Chat history keeps signed URLs past TTL; allow HMAC-valid links after expiry
# (still require a correct sig so uploads are not world-readable).
_MEDIA_ALLOW_EXPIRED = os.getenv("MEDIA_ALLOW_EXPIRED", "1").strip().lower() not in {
    "0",
    "false",
    "no",
    "off",
}
# Extra skew when expiry is still enforced (seconds).
_MEDIA_EXP_SKEW_SEC = int(os.getenv("MEDIA_EXP_SKEW_SEC", "300"))
_PATH_RE = re.compile(r"^/media/([a-zA-Z0-9_-]+)/([a-f0-9]{16,64}\.[a-z0-9]+)$")
_SHA_RE = re.compile(r"^[a-f0-9]{32,64}$")


def _signing_secret() -> bytes:
    raw = (
        os.getenv("MEDIA_SIGNING_SECRET")
        or os.getenv("TOKEN_SECRET")
        or os.getenv("POSTGRES_PASSWORD")
        or "ocs-media-dev-secret"
    ).encode("utf-8")
    return hashlib.sha256(raw).digest()


def ensure_root() -> None:
    UPLOAD_ROOT.mkdir(parents=True, exist_ok=True)


def sniff_image_ext(data: bytes) -> str | None:
    """Return a store ext from magic bytes, or '.heic' for iPhone live photos."""
    if not data or len(data) < 12:
        return None
    if data.startswith(b"\xff\xd8\xff"):
        return ".jpg"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return ".png"
    if data.startswith(b"GIF87a") or data.startswith(b"GIF89a"):
        return ".gif"
    if data.startswith(b"BM"):
        return ".bmp"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return ".webp"
    if data[4:8] == b"ftyp" and data[8:12] in _HEIC_BRANDS:
        return ".heic"
    return None


def _reject_heic(ext: str) -> None:
    if ext in {".heic", ".heif"}:
        raise ValueError("不支持 iPhone 实况/HEIC，请另存为 jpg 或 png 后再上传")


def safe_ext(filename: str) -> str:
    ext = Path(filename or "").suffix.lower()
    _reject_heic(ext)
    if not ext or ext not in ALLOWED_FILE:
        raise ValueError("不支持的文件类型，请上传 jpg/png/webp/gif")
    return ext


def resolve_image_ext(filename: str, data: bytes | None = None, *, kind: str = "file") -> str:
    """Prefer filename, then magic bytes. kind=image requires a real image."""
    raw = Path(filename or "").suffix.lower()
    _reject_heic(raw)
    sniffed = sniff_image_ext(data or b"")
    _reject_heic(sniffed or "")
    if raw in ALLOWED_IMAGE:
        return ".jpg" if raw == ".jpeg" else raw
    if sniffed and sniffed in ALLOWED_IMAGE:
        return sniffed
    if kind == "image":
        raise ValueError("请上传 jpg/png/webp/gif 图片")
    if raw in ALLOWED_FILE:
        return raw
    raise ValueError("不支持的文件类型，请上传 jpg/png/webp/gif")


def media_path(company_id: str, filename: str) -> str:
    return f"/media/{company_id}/{filename}"


def strip_media_url(url: str) -> str:
    """Return canonical /media/{company}/{file} without query string."""
    raw = (url or "").strip()
    if not raw:
        return ""
    parsed = urlparse(raw)
    path = parsed.path or raw.split("?", 1)[0]
    if not path.startswith("/media/"):
        return ""
    return path


def company_id_from_media_url(url: str) -> str | None:
    path = strip_media_url(url)
    m = _PATH_RE.match(path)
    return m.group(1) if m else None


def assert_media_belongs_to_company(url: str, company_id: str) -> str:
    path = strip_media_url(url)
    if not path:
        raise ValueError("无效的文件地址")
    cid = company_id_from_media_url(path)
    if not cid or cid != company_id:
        raise ValueError("文件不属于当前公司")
    if not resolve_media(path[len("/media/") :]):
        raise ValueError("文件不存在")
    return path


def sign_media_url(url_or_path: str, ttl_sec: int | None = None) -> str:
    path = strip_media_url(url_or_path)
    if not path:
        return (url_or_path or "").strip()
    ttl = MEDIA_TTL_SEC if ttl_sec is None else int(ttl_sec)
    exp = int(time.time()) + max(60, ttl)
    msg = f"{path}:{exp}".encode("utf-8")
    sig = hmac.new(_signing_secret(), msg, hashlib.sha256).hexdigest()
    return f"{path}?{urlencode({'exp': exp, 'sig': sig})}"


def verify_media_signature(path: str, exp: str | int | None, sig: str | None) -> bool:
    path = strip_media_url(path) or (path or "").split("?", 1)[0]
    if not _PATH_RE.match(path):
        return False
    try:
        exp_i = int(exp or 0)
    except (TypeError, ValueError):
        return False
    if exp_i <= 0:
        return False
    if not sig or len(str(sig)) < 32:
        return False
    msg = f"{path}:{exp_i}".encode("utf-8")
    expect = hmac.new(_signing_secret(), msg, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expect, str(sig)):
        return False
    # HMAC ok — reject only when expiry is enforced and past skew window.
    if _MEDIA_ALLOW_EXPIRED:
        return True
    return exp_i >= int(time.time()) - max(0, _MEDIA_EXP_SKEW_SEC)


def verify_request_url(url: str) -> bool:
    parsed = urlparse(url)
    path = parsed.path
    qs = parse_qs(parsed.query)
    exp = (qs.get("exp") or [None])[0]
    sig = (qs.get("sig") or [None])[0]
    return verify_media_signature(path, exp, sig)



def _reject_empty(data_or_size) -> None:
    """Block zero-byte uploads that become SHA256(e3b0c442...) and break image display."""
    n = data_or_size if isinstance(data_or_size, int) else len(data_or_size or b"")
    if n < MIN_BYTES:
        raise ValueError("图片内容为空，请重新选择图片后发送")


def _purge_empty_file(path: Path) -> None:
    try:
        if path.is_file() and path.stat().st_size < MIN_BYTES:
            path.unlink(missing_ok=True)
    except OSError:
        pass

def _meta_for_rel(rel: str, filename: str, size: int, msg_type: str) -> dict:
    url = sign_media_url(f"/media/{rel}")
    return {
        "msg_type": msg_type,
        "file_url": url,
        "file_name": Path(filename).name[:120] or Path(rel).name,
        "size": size,
        "sha256": Path(rel).stem if _SHA_RE.match(Path(rel).stem) else "",
    }


def find_by_sha256(company_id: str, sha256: str) -> dict | None:
    """Return existing media meta if this company already stored the content hash."""
    digest = (sha256 or "").strip().lower()
    if not _SHA_RE.match(digest):
        return None
    stem = digest[:32]
    for ext in (".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp"):
        rel = f"{company_id}/{stem}{ext}"
        fp = resolve_media(rel)
        if not fp:
            continue
        size = fp.stat().st_size
        if size < MIN_BYTES:
            _purge_empty_file(fp)
            continue
        msg_type = "image" if ext in ALLOWED_IMAGE else "file"
        return _meta_for_rel(rel, fp.name, size, msg_type)
    return None


def save_upload(company_id: str, filename: str, data: bytes, kind: str = "file") -> dict:
    ensure_root()
    if len(data) > MAX_BYTES:
        raise ValueError("文件过大（最大 20MB）")
    _reject_empty(data)
    return _write(company_id, filename, data, kind)


def save_upload_stream(company_id: str, filename: str, stream: BinaryIO, kind: str = "file") -> dict:
    """Read upload in chunks and abort early if over MAX_BYTES."""
    ensure_root()
    chunks: list[bytes] = []
    total = 0
    while True:
        chunk = stream.read(64 * 1024)
        if not chunk:
            break
        total += len(chunk)
        if total > MAX_BYTES:
            raise ValueError("文件过大（最大 20MB）")
        chunks.append(chunk)
    data = b"".join(chunks)
    _reject_empty(data)
    return _write(company_id, filename, data, kind)


async def save_upload_async_file(company_id: str, filename: str, upload_file, kind: str = "file") -> dict:
    """Save upload; images are content-addressed so repeat tutorial pics are free."""
    ensure_root()
    raw_name = filename or "image.bin"
    raw_ext = Path(raw_name).suffix.lower()
    # Images (and unknown names from phone pickers) are hashed in memory.
    read_all = kind == "image" or raw_ext in ALLOWED_IMAGE or raw_ext in {".heic", ".heif", ".jpeg", ""}
    if read_all and raw_ext != ".gif":
        chunks: list[bytes] = []
        total = 0
        while True:
            chunk = await upload_file.read(64 * 1024)
            if not chunk:
                break
            total += len(chunk)
            if total > MAX_BYTES:
                raise ValueError("文件过大（最大 20MB）")
            chunks.append(chunk)
        data = b"".join(chunks)
        _reject_empty(data)
        ext = resolve_image_ext(raw_name, data, kind=kind)
        if ext not in ALLOWED_IMAGE:
            raise ValueError("请上传图片文件")
        digest = hashlib.sha256(data).hexdigest()
        # Prefer .jpg for compressed chat images even if original name differed.
        store_ext = ".jpg" if ext in {".jpg", ".jpeg", ".png", ".bmp", ".webp"} else ext
        rel = f"{company_id}/{digest[:32]}{store_ext}"
        path = UPLOAD_ROOT / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        _purge_empty_file(path)
        if not path.is_file():
            tmp = path.with_suffix(path.suffix + ".part")
            try:
                tmp.write_bytes(data)
                tmp.replace(path)
            except Exception:
                try:
                    tmp.unlink(missing_ok=True)
                except OSError:
                    pass
                raise
        return _meta_for_rel(rel, raw_name if Path(raw_name).suffix else f"image{store_ext}", len(data), "image")

    ext = safe_ext(raw_name)
    msg_type = "image" if ext in ALLOWED_IMAGE else "file"
    if kind == "image" and msg_type != "image":
        raise ValueError("请上传图片文件")

    # Non-image / GIF: stream to unique name
    fid = uuid.uuid4().hex
    rel = f"{company_id}/{fid}{ext}"
    path = UPLOAD_ROOT / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    total = 0
    try:
        with path.open("wb") as out:
            while True:
                chunk = await upload_file.read(64 * 1024)
                if not chunk:
                    break
                total += len(chunk)
                if total > MAX_BYTES:
                    raise ValueError("文件过大（最大 20MB）")
                out.write(chunk)
    except Exception:
        try:
            if path.exists():
                path.unlink()
        except OSError:
            pass
        raise
    _reject_empty(total)
    return _meta_for_rel(rel, raw_name, total, msg_type)


def _write(company_id: str, filename: str, data: bytes, kind: str) -> dict:
    ext = safe_ext(filename)
    msg_type = "image" if ext in ALLOWED_IMAGE else "file"
    if kind == "image" and msg_type != "image":
        raise ValueError("请上传图片文件")
    _reject_empty(data)
    if msg_type == "image" and ext != ".gif":
        digest = hashlib.sha256(data).hexdigest()
        store_ext = ".jpg" if ext in {".jpg", ".jpeg", ".png", ".bmp", ".webp"} else ext
        rel = f"{company_id}/{digest[:32]}{store_ext}"
        path = UPLOAD_ROOT / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        _purge_empty_file(path)
        if not path.is_file():
            path.write_bytes(data)
        return _meta_for_rel(rel, filename, len(data), "image")
    fid = uuid.uuid4().hex
    rel = f"{company_id}/{fid}{ext}"
    path = UPLOAD_ROOT / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    return _meta_for_rel(rel, filename, len(data), msg_type)


def resolve_media(rel: str) -> Path | None:
    rel = rel.replace("\\", "/").lstrip("/")
    if ".." in rel or rel.startswith("/"):
        return None
    if not re.match(r"^[a-zA-Z0-9_-]+/[a-f0-9]{16,64}\.[a-z0-9]+$", rel):
        return None
    path = (UPLOAD_ROOT / rel).resolve()
    root = UPLOAD_ROOT.resolve()
    if not str(path).startswith(str(root)):
        return None
    if not path.is_file():
        return None
    return path


def try_delete_media_file(url_or_path: str) -> bool:
    """Best-effort delete of an uploaded media file referenced by /media/... URL."""
    path = strip_media_url(url_or_path)
    if not path.startswith("/media/"):
        return False
    rel = path[len("/media/") :]
    fp = resolve_media(rel)
    if not fp:
        return False
    try:
        fp.unlink(missing_ok=True)
        return True
    except Exception:
        return False
