"""AI-assistent: tool-use chat over de dashboarddata van de actieve klant.

Draait via EuRouter, een EU-gehoste OpenAI-compatibele gateway. Deze module bevat
alleen de LLM-orkestratie (chat-loop + SSE-stream) en de tool-definities. De
data-ophaling gebeurt in `main.py` via een `execute`-callback, zodat de org-scoping
en de 409 "opnieuw koppelen"-afhandeling op één plek blijven.
"""
import json
import logging
from datetime import date

import openai
import requests
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
    "- Bij vragen die kanalen combineren of naar samenhang/rendement over kanalen "
    "vragen (bijv. 'wat leveren mijn advertenties op', 'ROAS', 'betaald vs "
    "organisch', 'waar komt mijn omzet vandaan'), roep je `get_marketing_overview` "
    "aan. Die levert vooraf berekende, kloppende cross-kanaal-cijfers (o.a. totale "
    "advertentie-uitgaven, blended ROAS, betaald vs organisch verkeer, kosten per "
    "conversie). Bereken zulke verbanden NIET zelf uit losse cijfers; gebruik de "
    "waarden uit dat overzicht.\n"
    "- Noem concrete cijfers en de periode waarover je het hebt. De data bevat waar "
    "mogelijk een vergelijking met de vorige periode (deltas); gebruik die voor "
    "trends in plaats van ze te schatten.\n"
    "- Leg waar zinvol een verband tussen kanalen dat relevant is voor marketing "
    "(bijv. advertentie-uitgaven versus omzet, verkeersbron versus conversie, SEO "
    "versus betaald verkeer).\n"
    "- Sluit af met 1 tot 3 concrete, uitvoerbare acties.\n"
    "- Je ziet uitsluitend de gegevens van de huidige klant.\n"
    "- Als een kanaal niet gekoppeld is, leg dat rustig uit in plaats van te "
    "gokken; noem geen technische foutdetails.\n"
    "- Periodes: standaard geldt de dashboardperiode. Noemt de gebruiker zelf een "
    "periode (bijv. 'vorige maand', 'maart', 'afgelopen 7 dagen'), reken die dan om "
    "naar ISO-datums en geef die als start/end mee aan de tool. Noem in je antwoord "
    "altijd welke periode je hebt gebruikt.\n"
    "- Opmaak: gebruik korte Markdown waar dat de leesbaarheid helpt: koppen, "
    "**vet** voor kerncijfers, opsommingen, en een Markdown-tabel bij een "
    "vergelijking van meerdere kanalen of campagnes. Hou het bondig en to-the-point.\n"
    "- Schrijfstijl: schrijf volledige zinnen die met een hoofdletter beginnen. "
    "Gebruik NOOIT een gedachtestreepje (em dash of los streepje als leesteken); "
    "gebruik in plaats daarvan een komma, dubbele punt of een nieuwe zin."
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
            "name": "get_marketing_overview",
            "description": (
                "Cross-kanaal marketingoverzicht van de klant voor de huidige periode: "
                "haalt alle gekoppelde kanalen op en berekent de VERBANDEN ertussen die "
                "je zelf niet mag uitrekenen: totale advertentie-uitgaven (Google Ads + "
                "Meta), totale omzet, blended ROAS (omzet / advertentie-uitgaven), kosten "
                "per conversie, en de verdeling betaald vs. organisch vs. direct verkeer. "
                "Geeft ook per kanaal de kerncijfers. Gebruik dit ALTIJD bij vragen over "
                "rendement/ROAS over kanalen heen, 'wat leveren advertenties op', betaald "
                "vs. organisch, of waar de omzet vandaan komt. Voor detailvragen over één "
                "kanaal gebruik je de kanaal-specifieke tool."
            ),
            "parameters": _PERIOD_PARAMS,
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
    {
        "type": "function",
        "function": {
            "name": "get_woocommerce",
            "description": (
                "Haalt de webshopdata (WooCommerce) van de klant op voor de huidige "
                "periode: omzet, aantal bestellingen, gemiddelde orderwaarde, verkochte "
                "artikelen, klanten, terugbetalingen, omzet per dag, orderstatussen, "
                "betaalmethoden en bestverkochte producten. Roep dit aan bij vragen "
                "over de webshop, omzet, bestellingen of producten."
            ),
            "parameters": _PERIOD_PARAMS,
        },
    },
]


def _sse(event: str, **data) -> str:
    return "data: " + json.dumps({"type": event, **data}, ensure_ascii=False) + "\n\n"


def _err_detail(exc) -> str:
    """Korte, veilige weergave van de foutreden die de gateway teruggaf.

    Haalt de leesbare boodschap uit de OpenAI-compatibele fout (body.error.message
    of .message). Bevat geen sleutel; alleen de reden van afwijzing. Ingekort.
    """
    msg = ""
    body = getattr(exc, "body", None)
    if isinstance(body, dict):
        err = body.get("error")
        if isinstance(err, dict):
            msg = err.get("message") or ""
        msg = msg or body.get("message") or ""
    if not msg:
        msg = getattr(exc, "message", "") or ""
    msg = str(msg).strip()
    return f": {msg[:200]}" if msg else ""


def _tool_unsupported(exc) -> bool:
    """Herken de 400 'model does not support tool calling' van de gateway."""
    txt = (_err_detail(exc) or "").lower()
    return "tool" in txt and ("support" in txt or "function" in txt)


def _run_tool_loop(client, model, convo, execute, state):
    """Tool-use-modus: het model roept tools aan die de data ophalen.

    `state["text"]` wordt True zodra er antwoordtekst is gestreamd, zodat de
    aanroeper weet of een fallback nog veilig is.
    """
    for _ in range(MAX_TOOL_ITERATIONS):
        stream = client.chat.completions.create(
            model=model, messages=convo, tools=TOOLS, max_tokens=1500, stream=True,
        )
        content = ""
        calls = {}  # index -> {id, name, args}
        for chunk in stream:
            if not chunk.choices:
                continue
            delta = chunk.choices[0].delta
            if getattr(delta, "content", None):
                content += delta.content
                state["text"] = True
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


def _run_context_mode(client, model, system, messages, gather_context):
    """Tool-loze modus voor modellen zonder function-calling.

    De backend haalt zelf de data van de gekoppelde kanalen op en geeft die als
    context mee; het model formuleert het antwoord. Werkt met elk chatmodel.
    """
    yield _sse("tool", name="alle gekoppelde kanalen")
    context = gather_context() if gather_context else ""
    sys2 = system + (
        "\n\nJe kunt geen tools aanroepen. Gebruik uitsluitend de onderstaande "
        "actuele cijfers van deze klant om de vraag te beantwoorden. Noem alleen "
        "cijfers die hieronder staan.\n\n=== ACTUELE CIJFERS ===\n" + context
    )
    convo = [{"role": "system", "content": sys2}] + list(messages)
    stream = client.chat.completions.create(
        model=model, messages=convo, max_tokens=1500, stream=True,
    )
    for chunk in stream:
        if not chunk.choices:
            continue
        delta = chunk.choices[0].delta
        if getattr(delta, "content", None):
            yield _sse("text", text=delta.content)


def stream_chat(messages: list, execute, gather_context=None, *, api_key: str,
                base_url: str, model: str, period: tuple[str, str] | None = None):
    """Yield Server-Sent-Events strings for one chat turn.

    `messages` is the conversation history (user/assistant). `execute(name, input)`
    runs a tool and returns a JSON string (already org-scoped, never raises).
    `gather_context()` returns a text blob of the connected channels' data, used
    as a fallback for models zonder tool-calling. `period` is the dashboard's
    (start, end); the model may override it per tool when the user asks about a
    different date range.
    """
    client = OpenAI(api_key=api_key, base_url=base_url)
    system = SYSTEM_PROMPT + f"\n\nVandaag is {date.today().isoformat()}."
    if period:
        system += f" De dashboardperiode is {period[0]} t/m {period[1]}."
    convo = [{"role": "system", "content": system}] + list(messages)
    state = {"text": False}
    try:
        yield from _run_tool_loop(client, model, convo, execute, state)
    except openai.BadRequestError as e:
        # Ondersteunt het model geen tools? Val (voordat er tekst is) terug op de
        # tool-loze contextmodus, zodat de assistent met elk model blijft werken.
        if not state["text"] and _tool_unsupported(e):
            log.info("assistant: %s ondersteunt geen tools; contextmodus", model)
            try:
                yield from _run_context_mode(client, model, system, messages, gather_context)
            except Exception:
                log.exception("assistant contextmodus faalde (model=%s)", model)
                yield _sse("error", message="Er ging iets mis met de assistent. Probeer het later opnieuw.")
        else:
            log.exception("assistant: EuRouter 400 (model=%s)", model)
            yield _sse("error", message=(
                f"De taalmodel-service weigerde het verzoek (400){_err_detail(e)}. "
                f"Controleer EUROUTER_MODEL ('{model}')."
            ))
        yield _sse("done")
        return
    except openai.AuthenticationError:
        log.exception("assistant: EuRouter auth geweigerd (model=%s)", model)
        yield _sse("error", message="De assistent kan niet inloggen bij de taalmodel-service. Controleer de EuRouter-sleutel (EUROUTER_API_KEY).")
    except openai.NotFoundError:
        log.exception("assistant: model niet gevonden (model=%s)", model)
        yield _sse("error", message=f"Het ingestelde taalmodel is niet beschikbaar (model '{model}'). Controleer EUROUTER_MODEL.")
    except openai.PermissionDeniedError:
        log.exception("assistant: EuRouter toegang geweigerd (model=%s)", model)
        yield _sse("error", message=f"Geen toegang tot dit taalmodel ('{model}') op EuRouter. Controleer je abonnement of EUROUTER_MODEL.")
    except openai.RateLimitError:
        log.exception("assistant: EuRouter rate limit / tegoed (model=%s)", model)
        yield _sse("error", message="De taalmodel-service is tijdelijk overbelast of het tegoed is op. Probeer het later opnieuw.")
    except openai.APIConnectionError:
        log.exception("assistant: EuRouter onbereikbaar (model=%s, base=%s)", model, base_url)
        yield _sse("error", message="Kan de taalmodel-service (EuRouter) niet bereiken. Controleer EUROUTER_BASE_URL of probeer het later opnieuw.")
    except openai.APIStatusError as e:
        code = getattr(e, "status_code", "?")
        log.exception("assistant: EuRouter fout %s (model=%s)", code, model)
        yield _sse("error", message=f"De taalmodel-service gaf een fout (status {code}){_err_detail(e)}. Probeer het later opnieuw.")
    except Exception:  # onbekende fout; log server-side, generieke melding
        log.exception("assistant stream failed (model=%s)", model)
        yield _sse("error", message="Er ging iets mis met de assistent. Probeer het later opnieuw.")
    yield _sse("done")


# ----------------------------------------------------------- model-diagnostiek
#
# Welke EuRouter-modellen ondersteunen tool-calling? Dat verschilt per gateway en
# is niet betrouwbaar te raden, dus vragen we het EuRouter zelf: lijst de modellen
# en probe tool-support met een mini-verzoek. Het resultaat wordt in-process
# gecachet (per instance) zodat routing/diagnostiek het kan hergebruiken.

_TOOL_SUPPORT: dict[str, bool] = {}  # model-slug -> ondersteunt tools


def list_models(api_key: str, base_url: str) -> list[dict]:
    """EuRouter-modellen met hun opgegeven tool-support (uit de catalogus).

    De /models-catalogus geeft per model `supported_parameters` en `tags`; een
    model dat tool-calling ondersteunt heeft "tools" in de parameters (of de tag
    "function-calling"). Dat lezen we gratis uit de metadata — geen probe nodig.
    """
    resp = requests.get(
        f"{base_url.rstrip('/')}/models",
        headers={"Authorization": f"Bearer {api_key}"},
        timeout=20,
    )
    resp.raise_for_status()
    out = []
    for m in resp.json().get("data", []):
        params = m.get("supported_parameters") or []
        tags = m.get("tags") or []
        declares = ("tools" in params) or ("function-calling" in tags)
        out.append({
            "id": m.get("id"),
            "declares_tools": bool(declares),
            "context": m.get("context_length"),
        })
    return sorted(out, key=lambda x: (not x["declares_tools"], x["id"] or ""))


def cached_tool_support(model: str):
    """True/False als eerder geprobed, anders None (nog onbekend)."""
    return _TOOL_SUPPORT.get(model)


def probe_tool_support(api_key: str, base_url: str, model: str) -> dict:
    """Stuur een minimaal verzoek mét tool en kijk of de gateway het accepteert.

    Cachet en retourneert {model, supports_tools: True/False/None, detail}. None =
    onbekend (een andere fout dan 'geen tool-support', bv. auth/onbereikbaar).
    """
    client = OpenAI(api_key=api_key, base_url=base_url)
    try:
        client.chat.completions.create(
            model=model,
            messages=[{"role": "user", "content": "ping"}],
            tools=TOOLS[:1],
            max_tokens=1,
            stream=False,
        )
        _TOOL_SUPPORT[model] = True
        return {"model": model, "supports_tools": True, "detail": ""}
    except openai.BadRequestError as e:
        if _tool_unsupported(e):
            _TOOL_SUPPORT[model] = False
            return {"model": model, "supports_tools": False, "detail": _err_detail(e).lstrip(": ").strip()}
        return {"model": model, "supports_tools": None, "detail": ("400" + _err_detail(e)).strip()}
    except openai.APIStatusError as e:
        return {"model": model, "supports_tools": None, "detail": f"status {getattr(e, 'status_code', '?')}"}
    except Exception as e:  # noqa: BLE001
        log.warning("probe tool-support faalde (model=%s): %s", model, e)
        return {"model": model, "supports_tools": None, "detail": type(e).__name__}
