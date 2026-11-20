"""Thin LLM client. Returns None when no API key is set or the call fails,
so every agent can fall back to its built-in heuristic."""
import json
import logging
import re
import httpx
from ..config import ANTHROPIC_API_KEY, LLM_MODEL

logger = logging.getLogger(__name__)


def llm_enabled() -> bool:
    return bool(ANTHROPIC_API_KEY)


def call_json(system: str, user: str, max_tokens: int = 1000) -> dict | None:
    if not llm_enabled():
        return None
    try:
        r = httpx.post(
            "https://api.anthropic.com/v1/messages",
            headers={"x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01",
                     "content-type": "application/json"},
            json={"model": LLM_MODEL, "max_tokens": max_tokens, "system": system,
                  "messages": [{"role": "user", "content": user}]},
            timeout=30)
        r.raise_for_status()
        response = r.json()
        text = response["content"][0]["text"]
        text = re.sub(r"^```(?:json)?|```$", "", text.strip(), flags=re.M).strip()
        parsed = json.loads(text)
        if not isinstance(parsed, dict):
            logger.warning("Anthropic response was valid JSON but not a JSON object; using heuristic fallback.")
            return None
        return parsed
    except (httpx.HTTPError, KeyError, IndexError, TypeError, json.JSONDecodeError) as exc:
        logger.warning("Anthropic request/response failed (%s); using heuristic fallback.", type(exc).__name__)
        return None
