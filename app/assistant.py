"""AI-assistent: tool-use chat over de dashboarddata van de actieve klant.

Deze module bevat alleen de LLM-orkestratie (Anthropic-loop + SSE-stream) en de
tool-definities. De data-ophaling zelf gebeurt in `main.py` via een `execute`
callback, zodat de org-scoping en de 409 "opnieuw koppelen"-afhandeling op één
plek blijven.
"""
import json

import anthropic

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
    "- Hou antwoorden bondig en to-the-point."
)

TOOLS = [
    {
        "name": "list_connections",
        "description": (
            "Toont welke databronnen (kanalen) gekoppeld zijn voor deze klant. "
            "Roep dit aan als je niet zeker weet of een kanaal beschikbaar is, of "
            "als de gebruiker vraagt wat er gekoppeld is."
        ),
        "input_schema": {"type": "object", "properties": {}, "additionalProperties": False},
    },
    {
        "name": "get_analytics_overview",
        "description": (
            "Haalt het Google Analytics-overzicht van de klant op voor de huidige "
            "periode: kerncijfers (bezoekers, sessies, conversies, bouncepercentage "
            "e.d.) met vergelijking t.o.v. de vorige periode, verkeersbronnen, "
            "apparaten, toppagina's en de trend over tijd. Roep dit aan bij vragen "
            "over websiteverkeer, bezoekers, conversies of gedrag."
        ),
        "input_schema": {"type": "object", "properties": {}, "additionalProperties": False},
    },
    {
        "name": "get_search_console",
        "description": (
            "Haalt de Google Search Console-data (SEO / organisch zoekverkeer) van "
            "de klant op voor de huidige periode: klikken, vertoningen, CTR, "
            "gemiddelde positie, top-zoekopdrachten en -pagina's, kansen (queries "
            "net buiten pagina 1) en uitsplitsing per apparaat/land. Roep dit aan "
            "bij vragen over SEO, zoekopdrachten, posities of quick wins."
        ),
        "input_schema": {"type": "object", "properties": {}, "additionalProperties": False},
    },
]


def _sse(event: str, **data) -> str:
    return "data: " + json.dumps({"type": event, **data}, ensure_ascii=False) + "\n\n"


def stream_chat(messages: list, execute, *, api_key: str, model: str):
    """Yield Server-Sent-Events strings for one chat turn.

    `messages` is the conversation history (user/assistant). `execute(name, input)`
    runs a tool and returns a JSON string (already org-scoped, never raises).
    """
    client = anthropic.Anthropic(api_key=api_key)
    convo = list(messages)
    try:
        for _ in range(MAX_TOOL_ITERATIONS):
            with client.messages.stream(
                model=model,
                max_tokens=6000,
                system=[{"type": "text", "text": SYSTEM_PROMPT, "cache_control": {"type": "ephemeral"}}],
                tools=TOOLS,
                thinking={"type": "adaptive"},
                output_config={"effort": "medium"},
                messages=convo,
            ) as stream:
                for text in stream.text_stream:
                    yield _sse("text", text=text)
                final = stream.get_final_message()

            convo.append({"role": "assistant", "content": final.content})
            if final.stop_reason != "tool_use":
                break

            results = []
            for block in final.content:
                if block.type == "tool_use":
                    yield _sse("tool", name=block.name)
                    results.append({
                        "type": "tool_result",
                        "tool_use_id": block.id,
                        "content": execute(block.name, block.input),
                    })
            convo.append({"role": "user", "content": results})
    except Exception as e:  # never leak a raw stack trace to the client
        yield _sse("error", message=f"Er ging iets mis met de assistent: {e}")
    yield _sse("done")
