from bs4 import BeautifulSoup
import requests


def _failed_to_fetch_message(url: str) -> str:
    return f"Failed to fetch url: {url}"


def load_web_page(url: str) -> str:
    """Fetches and extracts readable text content from a URL."""
    try:
        response = requests.get(url, allow_redirects=False, timeout=30)
    except requests.RequestException:
        return _failed_to_fetch_message(url)

    if response.status_code != 200:
        return _failed_to_fetch_message(url)

    soup = BeautifulSoup(response.content, "lxml")
    text = soup.get_text(separator="\n", strip=True)
    return "\n".join(line for line in text.splitlines() if len(line.split()) > 3)
