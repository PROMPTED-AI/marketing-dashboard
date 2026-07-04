"""AI-assistent: tool-use chat over de dashboarddata van de actieve klant.

Draait via EuRouter, een EU-gehoste OpenAI-compatibele gateway. Deze module bevat
alleen de LLM-orkestratie (chat-loop + SSE-stream) en de tool-definities. De
data-ophaling gebeurt in `main.py` via een `execute`-callback, zodat de org-scoping
en de 409 "opnieuw koppelen"-afhandeling op één plek blijven.
"""
import json
import logging
from datetime import date

from openai import OpenAI

log = logging.getLogger("dashboard")

MAX_TOOL_ITERATIONS = 6

SYSTEM_PROMPT = (
    "Je bent de marketinganalist binnen dit dashboard. Je helpt de gebruiker de "
    "resultaten van hun marketing te begrijpen en geeft concreet advies.\n\n"
    "Regels:\n"
    "- Antwoord altijd in het Nederlands, in gewone taal. Vermijd jargon en "
    "technische termen.\n"
    "- Gebruik ALTIJD eerst de tools om de echte cijfers op te halen voordat je "
    "iets beweert. Verzin nooit getallen of trends.\n"
    "- Noem concrete cijfers en de periode waarover je het hebt.\n"
    "- Sluit af met 1 tot 3 concrete, uitvoerbare acties.\n"
    "- Je ziet uitsluitend de gegevens van de huidige klant.\n"
    "- Als een kanaal niet gekoppeld is, leg dat rustig uit in plaats van te "
    "gokken; noem geen technische foutdetails.\n"
    "- Periodes: standaard geldt de dashboardperiode. Noemt de gebruiker zelf een "
    "periode (bijv. 'vorige maand', 'maart', 'afgelopen 7 dagen'), reken die dan om "
    "naar ISO-datums en geef die als start/end mee aan de tool. Noem in je antwoord "
    "altijd welke periode je hebt gebruikt.\n"
    "- Hou antwoorden bondig en to-the-point."
)

# Optionele periode-override per tool: alleen invullen als de gebruiker expliciet
# een andere periode noemt; anders weglaten (dan geldt de dashboardperiode).
_PERIOD_PARAMS = {
    "type": "object",
    "properties": {
        "start": {
            "type": "string",
            "description": "Begindatum (JJJJ-MM-DD). Alleen meegeven als de gebruiker een andere periode noemt dan de dashboardperiode.",
        },
        "end": {
            "type": "string",
            "description": "Einddatum (JJJJ-MM-DD). Alleen samen met start meegeven.",
        },
    },
    "additionalProperties": False,
}

# OpenAI-compatibele function/tool-definities (EuRouter gebruikt dit schema).
TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "list_connections",
            "description": (
                "Toont welke databronnen (kanalen) gekoppeld zijn voor deze klant. "
                "Roep dit aan als je niet zeker weet of een kanaal beschikbaar is, of "
                "als de gebruiker vraagt wat er gekoppeld is."
            ),
            "parameters": {"type": "object", "properties": {}, "additionalProperties": False},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_analytics_overview",
            "description": (
                "Haalt het Google Analytics-overzicht van de klant op voor de huidige "
                "periode: kerncijfers (bezoekers, sessies, conversies, bouncepercentage "
                "e.d.) met vergelijking t.o.v. de vorige periode, verkeersbronnen, "
                "apparaten, toppagina's en de trend over tijd. Roep dit aan bij vragen "
                "over websiteverkeer, bezoekers, conversies of gedrag."
            ),
            "parameters": _PERIOD_PARAMS,
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_search_console",
            "description": (
                "Haalt de Google Search Console-data (SEO / organisch zoekverkeer) van "
                "de klant op voor de huidige periode: klikken, vertoningen, CTR, "
                "gemiddelde positie, top-zoekopdrachten en -pagina's, kansen (queries "
                "net buiten pagina 1) en uitsplitsing per apparaat/land. Roep dit aan "
                "bij vragen over SEO, zoekopdrachten, posities of quick wins."
            ),
            "parameters": _PERIOD_PARAMS,
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_google_ads",
            "description": (
                "Haalt de Google Ads-data van de klant op voor de huidige periode: "
                "uitgaven, vertoningen, klikken, CTR, CPC, conversies, kosten per "
                "conversie en de campagnes. Roep dit aan bij vragen over betaald "
                "zoeken, advertentiebudget, campagnes of rendement (ROAS/CPA)."
            ),
            "parameters": _PERIOD_PARAMS,
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_meta_ads",
            "description": (
                "Haalt de betaalde Meta-advertentiedata (Facebook/Instagram Ads) van "
                "de klant op voor de huidige periode: uitgaven, bereik, vertoningen, "
                "klikken, CTR, CPC/CPM, resultaten per conversiedoel en de campagnes. "
                "Roep dit aan bij vragen over social advertising of Meta-campagnes."
            ),
            "parameters": _PERIOD_PARAMS,
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_meta_organic",
            "description": (
                "Haalt de organische Meta-data (Facebook-pagina + Instagram) van de "
                "klant op: volgers en groei, bereik, vertoningen, betrokkenheid en "
                "top-posts. Roep dit aan bij vragen over organische social, bereik of "
                "betrokkenheid op Facebook/Instagram."
            ),
            "parameters": _PERIOD_PARAMS,
        },
    },
]


def _sse(event: str, **data) -> str:
    return "data: " + json.dumps({"type": event, **data}, ensure_ascii=False) + "\n\n"


def stream_chat(messages: list, execute, *, api_key: str, base_url: str, model: str,
                period: tuple[str, str] | None = None):
    """Yield Server-Sent-Events strings for one chat turn.

    `messages` is the conversation history (user/assistant). `execute(name, input)`
    runs a tool and returns a JSON string (already org-scoped, never raises).
    `period` is the dashboard's (start, end); the model may override it per tool
    when the user asks about a different date range.
    """
    client = OpenAI(api_key=api_key, base_url=base_url)
    system = SYSTEM_PROMPT + f"\n\nVandaag is {date.today().isoformat()}."
    if period:
        system += f" De dashboardperiode is {period[0]} t/m {period[1]}."
    convo = [{"role": "system", "content": system}] + list(messages)
    try:
        for _ in range(MAX_TOOL_ITERATIONS):
            stream = client.chat.completions.create(
                model=model,
                messages=convo,
                tools=TOOLS,
                max_tokens=1500,
                stream=True,
            )
            content = ""
            calls = {}  # index -> {id, name, args}
            for chunk in stream:
                if not chunk.choices:
                    continue
                delta = chunk.choices[0].delta
                if getattr(delta, "content", None):
                    content += delta.content
                    yield _sse("text", text=delta.content)
                for tc in (getattr(delta, "tool_calls", None) or []):
                    slot = calls.setdefault(tc.index, {"id": "", "name": "", "args": ""})
                    if tc.id:
                        slot["id"] = tc.id
                    if tc.function and tc.function.name:
                        slot["name"] = tc.function.name
                    if tc.function and tc.function.arguments:
                        slot["args"] += tc.function.arguments

            if not calls:
                break

            convo.append({
                "role": "assistant",
                "content": content or None,
                "tool_calls": [
                    {"id": c["id"], "type": "function",
                     "function": {"name": c["name"], "arguments": c["args"] or "{}"}}
                    for c in calls.values()
                ],
            })
            for c in calls.values():
                yield _sse("tool", name=c["name"])
                try:
                    args = json.loads(c["args"]) if c["args"] else {}
                    if not isinstance(args, dict):
                        args = {}
                except ValueError:
                    args = {}
                convo.append({
                    "role": "tool",
                    "tool_call_id": c["id"],
                    "content": execute(c["name"], args),
                })
    except Exception:  # log server-side; keep client message generic
        log.exception("assistant stream failed (model=%s)", model)
        yield _sse("error", message="Er ging iets mis met de assistent. Probeer het later opnieuw.")
    yield _sse("done")
