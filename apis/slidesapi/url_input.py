import re
from urllib.parse import urlparse


def parse_urls_from_multiline(raw: str) -> list[str]:
    lines = re.split(r"\r?\n", raw)
    return [line.strip() for line in lines if line.strip()]


def is_allowed_audit_url(url_string: str) -> bool:
    try:
        parsed = urlparse(url_string)
    except ValueError:
        return False
    return parsed.scheme in ("http", "https") and bool(parsed.netloc)
