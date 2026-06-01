import os
from urllib.parse import urlencode, urlparse
from urllib.request import Request, urlopen
from json import loads
from urllib.error import HTTPError, URLError
from google.adk.agents.callback_context import CallbackContext

def _normalize_domain(domain: str) -> str:
    cleaned_domain = domain.strip().lower()
    if "://" not in cleaned_domain:
        return cleaned_domain.replace("www.", "")
    parsed_domain = urlparse(cleaned_domain).netloc or cleaned_domain
    return parsed_domain.replace("www.", "")


def similarweb_traffic_and_engagement(
    domain: str,
    country: str = "us",
    granularity: str = "monthly",
    web_source: str = "total",
) -> dict:
    """Fetch Similarweb traffic and engagement metrics for a domain."""
    api_key = os.getenv("SIMILARWEB_API_KEY")
    if not api_key:
        return {"error": "SIMILARWEB_API_KEY is not configured."}
    query_params = urlencode(
        {
            "domain": _normalize_domain(domain),
            "country": country,
            "granularity": granularity,
            "web_source": web_source,
            "format": "json",
        }
    )
    request = Request(
        url=f"https://api.similarweb.com/v5/website-analysis/websites/traffic-and-engagement?{query_params}",
        headers={"api-key": api_key},
        method="GET",
    )
    try:
        with urlopen(request, timeout=30) as response:
            return loads(response.read().decode("utf-8"))
    except HTTPError as error:
        return {"error": f"Similarweb API error: {error.code}", "details": error.reason}
    except URLError as error:
        return {"error": "Similarweb request failed.", "details": str(error.reason)}


async def generate_memories_callback(callback_context: CallbackContext) -> None:
  """Persist the current session context to long-term memory."""
  await callback_context.add_session_to_memory()
  return None