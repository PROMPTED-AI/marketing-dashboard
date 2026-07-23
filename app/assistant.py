"""AI-assistent: tool-use chat over de dashboarddata van de actieve klant.

Draait via EuRouter, een EU-gehoste OpenAI-compatibele gateway. Deze module bevat
alleen de LLM-orkestratie (chat-loop + SSE-stream) en de tool-definities. De
data-ophaling gebeurt in `main.py` via een `execute`-callback, zodat de org-scoping
en de 409 "opnieuw koppelen"-afhandeling op één plek blijven.
"""
import json
import logging
import time
from concurrent.futures import ThreadPoolExecutor
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
    "- Bij vragen als 'wat valt op' of 'waar moet ik op letten' roep je "
    "`get_insights` aan en bespreek je die vooraf gedetecteerde signalen.\n"
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
            "name": "get_insights",
            "description": (
                "Haalt de automatisch gedetecteerde signalen op: opvallende "
                "veranderingen per kanaal t.o.v. de vorige periode (sterke stijgers "
                "en dalers) en SEO-kansen, vooraf berekend door het dashboard. Roep "
                "dit aan bij vragen als 'wat valt op', 'zijn er bijzonderheden' of "
                "'waar moet ik op letten', en citeer de signalen in plaats van zelf "
                "te zoeken."
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
    used_tools = False
    content = ""
    for _ in range(MAX_TOOL_ITERATIONS):
        stream = client.chat.completions.create(
            model=model, messages=convo, tools=TOOLS, max_tokens=2500, stream=True,
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
        used_tools = True
        state["rounds"] = state.get("rounds", 0) + 1
        state["tools"] = state.get("tools", 0) + len(calls)
        # Meld eerst alle tools aan de UI, voer ze daarna parallel uit: modellen
        # als Kimi vragen meerdere kanalen tegelijk op, en de fetches zijn
        # I/O-gebonden. Dat scheelt seconden op cross-kanaal-vragen.
        parsed = []
        for c in calls.values():
            yield _sse("tool", name=c["name"])
            try:
                args = json.loads(c["args"]) if c["args"] else {}
                if not isinstance(args, dict):
                    args = {}
            except ValueError:
                args = {}
            parsed.append((c["id"], c["name"], args))
        if len(parsed) > 1:
            with ThreadPoolExecutor(max_workers=min(6, len(parsed))) as pool:
                results = list(pool.map(lambda p: execute(p[1], p[2]), parsed))
        else:
            results = [execute(parsed[0][1], parsed[0][2])]
        for (call_id, _name, _args), result in zip(parsed, results):
            convo.append({"role": "tool", "tool_call_id": call_id, "content": result})

    # Vangnet in twee gevallen: (a) er is helemaal geen antwoordtekst gestreamd
    # (model bleef tools aanroepen tot de limiet of gaf een lege completion), of
    # (b) er zijn tools gebruikt maar de LAATSTE ronde leverde geen tekst op. Dat
    # tweede geval is het productiepatroon "model kondigt aan dat het data gaat
    # ophalen, roept de tool aan en zwijgt daarna": de gebruiker krijgt alleen de
    # aankondiging en denkt dat de chat stuk is. Forceer dan een afronding
    # zonder tools, zodat het echte antwoord alsnog volgt.
    if not state["text"] or (used_tools and not content.strip()):
        state["fallback"] = True
        log.warning(
            "assistant: geen (slot)tekst na tool-gebruik (model=%s, text=%s); afronding geforceerd",
            model, state["text"],
        )
        closing = convo + [{
            "role": "user",
            "content": "Formuleer nu je definitieve antwoord op basis van de al opgehaalde gegevens hierboven. Roep geen tools meer aan.",
        }]
        stream = client.chat.completions.create(
            model=model, messages=closing, max_tokens=2500, stream=True,
        )
        for chunk in stream:
            if not chunk.choices:
                continue
            delta = chunk.choices[0].delta
            if getattr(delta, "content", None):
                state["text"] = True
                yield _sse("text", text=delta.content)


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
        model=model, messages=convo, max_tokens=2500, stream=True,
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
    state = {"text": False, "rounds": 0, "tools": 0, "fallback": False}
    t0 = time.monotonic()
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
    # Telemetrie per beurt: hiermee is in de logs te volgen hoe het model zich
    # gedraagt (aantal tool-rondes, duur, of het afrondingsvangnet nodig was).
    log.info(
        "assistant turn: model=%s rounds=%s tools=%s fallback=%s text=%s dur=%.1fs",
        model, state.get("rounds", 0), state.get("tools", 0),
        state.get("fallback", False), state.get("text", False),
        time.monotonic() - t0,
    )
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


# ------------------------------------------------------------ feedback-analyse

FEEDBACK_PROMPT = (
    "Je bent productmanager van een marketingdashboard (kanalen: Google "
    "Analytics, Search Console, Google Ads, Meta Ads en Organisch, WooCommerce; "
    "samenstelbare dashboards met widgets; een AI-assistent; multi-tenant met "
    "klantorganisaties). Je krijgt één stuk gebruikersfeedback. Werk die uit "
    "voor het ontwikkelteam, in het Nederlands, met deze Markdown-koppen:\n"
    "## Uitgewerkte omschrijving\n"
    "Herschrijf de feedback als een volledig, ondubbelzinnig verzoek of "
    "probleemrapport. Vul redelijke aannames expliciet in.\n"
    "## Advies voor verwerking\n"
    "Concreet advies hoe dit in het dashboard te verwerken: welke schermen of "
    "onderdelen het raakt, een voorgestelde aanpak en eventuele aandachtspunten.\n"
    "## Inschatting\n"
    "Prioriteit (laag, middel, hoog) met één zin motivatie, en een grove "
    "omvang (klein, middel, groot).\n"
    "Houd het geheel beknopt, in totaal ongeveer 200 woorden. Denk kort na en "
    "begin snel met schrijven. Schrijf volledige zinnen die met een hoofdletter "
    "beginnen en gebruik nooit een gedachtestreepje."
)


def stream_feedback_analysis(item: dict, *, api_key: str, base_url: str, model: str, on_done=None):
    """SSE-generator die één feedback-item uitwerkt en live doorstuurt.

    Events: "thinking" (het model denkt, nog geen tekst), "text" (stukje van de
    uitwerking), "done" (klaar en opgeslagen via on_done) en "error". Zo ziet de
    beheerder meteen dat de AI bezig is en verschijnt de uitwerking al tijdens
    het genereren in plaats van na een lange stilte.

    Denkende modellen (zoals kimi-k2.6) kunnen hun tokens in reasoning_content
    stoppen en met een leeg antwoord eindigen. Daarom: reasoning als vangnet en
    één niet-streamende herkansing voordat we leeg teruggeven. Alles is in tijd
    begrensd, anders bleef de knop eindeloos hangen bij een stilgevallen
    gateway of een model dat blijft doorrekenen.
    """
    client = OpenAI(api_key=api_key, base_url=base_url, timeout=90, max_retries=1)
    deadline = time.monotonic() + 150
    parts = [
        f"Categorie: {item.get('category')}",
        f"Toelichting: {item.get('message')}",
    ]
    if item.get("severity"):
        parts.append(f"Impact volgens gebruiker: {item['severity']}")
    if item.get("page"):
        parts.append(f"Pagina waar de feedback gegeven werd: {item['page']}")
    if item.get("org_name"):
        parts.append(f"Organisatie: {item['org_name']}")
    messages = [
        {"role": "system", "content": FEEDBACK_PROMPT},
        {"role": "user", "content": "\n".join(parts)},
    ]

    out, reasoning = [], []
    try:
        yield _sse("thinking")
        stream = client.chat.completions.create(
            model=model, messages=messages, max_tokens=2500, stream=True,
        )
        last_think = 0.0
        for chunk in stream:
            if time.monotonic() > deadline:
                log.warning("feedback-analyse: tijdslimiet bereikt tijdens streamen, stream afgebroken")
                stream.close()
                break
            if not chunk.choices:
                continue
            delta = chunk.choices[0].delta
            if getattr(delta, "content", None):
                out.append(delta.content)
                yield _sse("text", text=delta.content)
            elif getattr(delta, "reasoning_content", None):
                reasoning.append(delta.reasoning_content)
                # Af en toe een levensteken zodat de indicator blijft bewegen
                # en tussenliggende proxies de verbinding niet sluiten.
                now = time.monotonic()
                if now - last_think > 1.5:
                    last_think = now
                    yield _sse("thinking")
        text = "".join(out).strip()

        if not text:
            log.warning(
                "feedback-analyse leeg (model=%s, reasoning=%d tekens), herkansing zonder stream",
                model, len("".join(reasoning)),
            )
            # Herkansing: niet-streamend, met expliciete instructie om direct
            # de uitwerking te geven. Alleen als het tijdsbudget het toelaat.
            if time.monotonic() <= deadline:
                yield _sse("thinking")
                retry = messages + [{
                    "role": "user",
                    "content": (
                        "Geef nu direct de volledige uitwerking als platte Markdown-tekst "
                        "met de drie gevraagde koppen, zonder verdere denkstappen."
                    ),
                }]
                try:
                    resp = client.with_options(timeout=60, max_retries=0).chat.completions.create(
                        model=model, messages=retry, max_tokens=2500, stream=False,
                    )
                    msg = resp.choices[0].message if resp.choices else None
                    text = (getattr(msg, "content", None) or "").strip()
                    if not text and getattr(msg, "reasoning_content", None):
                        reasoning.append(msg.reasoning_content)
                except Exception as e:  # noqa: BLE001
                    log.warning("feedback-analyse herkansing faalde: %s", e)
            # Laatste redmiddel: de denkstappen bevatten vaak al de analyse.
            if not text:
                text = "".join(reasoning).strip()
            if text:
                yield _sse("text", text=text)

        if not text:
            yield _sse("error", message="De AI-uitwerking kwam leeg terug. Probeer het opnieuw.")
            return
        if on_done:
            try:
                on_done(text)
            except Exception:  # noqa: BLE001 - uitwerking is er al, opslaan mag niet de stream breken
                log.exception("feedback-analyse opslaan mislukt")
        yield _sse("done")
    except openai.APITimeoutError:
        log.warning("feedback-analyse timeout (model=%s)", model)
        yield _sse("error", message="De AI-uitwerking duurde te lang. Probeer het opnieuw.")
    except openai.AuthenticationError:
        yield _sse("error", message="De AI-uitwerking kan niet inloggen bij de taalmodel-service. Controleer de EuRouter-sleutel.")
    except Exception:  # noqa: BLE001
        log.exception("feedback-analyse faalde")
        yield _sse("error", message="De AI-uitwerking is niet gelukt. Probeer het later opnieuw.")


# ---------------------------------------------------------- dashboard genereren

DASHBOARD_PROMPT = (
    "Je bent een assistent die een marketingdashboard samenstelt uit widgets. Je "
    "krijgt een CATALOGUS met beschikbare bronnen (widgets) en een verzoek van de "
    "gebruiker. Stel een passend, overzichtelijk dashboard samen.\n\n"
    "Antwoord UITSLUITEND met één JSON-object, zonder tekst eromheen, precies zo:\n"
    '{"widgets": [ {"source": "<bronsleutel uit de catalogus>", "kind": '
    '"kpi|area|donut|bars|table", "size": 3, "title": "<korte titel>"} ], '
    '"notes": "<één korte zin over keuzes, of leeg>", "requests": ["<gevraagde '
    'widget die niet kon, of niets>"]}\n\n'
    "Regels:\n"
    "- Gebruik voor 'source' ALLEEN sleutels die exact in de catalogus staan, en voor "
    "'kind' alleen een waarde die in de 'kinds' van die bron staat.\n"
    "- Groottes (kolommen van 12): KPI 3, cirkeldiagram 4, balkenlijst/tabel 6, "
    "lijngrafiek 12.\n"
    "- Bestaat een gevraagde afgeleide metric niet als bron (bijv. 'kosten per "
    "bestelling', 'omzet per bezoeker')? Maak dan een custom KPI: "
    '{"source":"custom","kind":"kpi","size":3,"title":"...","spec":{"op":'
    '"ratio|sum|diff|product|identity","refs":["<bronsleutel>","<bronsleutel>"],'
    '"fmt":"int|euro|ratio|percent"}}. Gebruik in \'refs\' uitsluitend bronsleutels '
    "met \"scalar\": true uit de catalogus. Voor een verhouding gebruik je 'ratio' "
    "met precies twee refs (teller, noemer).\n"
    "- Kan iets echt niet met deze catalogus? Zet een korte omschrijving in 'requests' "
    "en laat de widget weg.\n"
    "- Geef 6 tot 14 widgets tenzij anders gevraagd, belangrijkste KPI's eerst.\n"
    "- Titels in het Nederlands, met een hoofdletter. Verzin geen cijfers; je kiest "
    "alleen wélke widgets op het dashboard komen."
)


def _extract_json(text: str) -> dict | None:
    """Haal het JSON-object uit een modelantwoord. Bestand tegen redenerende
    modellen (kimi-k2.6 levert zijn tekst vaak via reasoning_content, met losse
    accolades in de denktekst), <think>-blokken, code-fences en trailing komma's.

    Aanpak: scan de tekst en decodeer elk JSON-object dat begint bij een '{';
    prefereer het laatste object met een 'widgets'-sleutel. Zo pikken we de echte
    indeling eruit, ook als er eerder in de redenering losse accolades staan."""
    if not text:
        return None
    import re
    t = re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL)
    t = re.sub(r"<think>.*$", "", t, flags=re.DOTALL).strip()  # afgekapt denkblok
    if "```" in t:
        m = re.search(r"```(?:json)?\s*(.+?)```", t, re.DOTALL)
        if m:
            t = m.group(1).strip()

    found: list[dict] = []
    dec = json.JSONDecoder()
    i = 0
    while True:
        j = t.find("{", i)
        if j < 0:
            break
        try:
            obj, endpos = dec.raw_decode(t, j)
            if isinstance(obj, dict):
                found.append(obj)
            i = endpos
        except ValueError:
            i = j + 1

    # Vangnet voor trailing komma's: eerste { .. laatste } opschonen en parsen.
    if not found:
        a, b = t.find("{"), t.rfind("}")
        if 0 <= a < b:
            try:
                obj = json.loads(re.sub(r",(\s*[}\]])", r"\1", t[a:b + 1]))
                if isinstance(obj, dict):
                    found.append(obj)
            except (ValueError, TypeError):
                pass

    if not found:
        return None
    for f in reversed(found):
        if "widgets" in f:
            return f
    return found[-1]


def generate_dashboard(prompt: str, catalog_json: str, *, api_key: str,
                       base_url: str, model: str, context: str | None = None) -> dict:
    """Vraag het model een dashboard-indeling voor te stellen op basis van de
    catalogus. Geeft het rauwe, geparste object terug ({widgets, notes, requests});
    de aanroeper valideert dat tegen de echte catalogus. Kan een uitzondering
    gooien (gateway-fout) of ValueError als er geen JSON uitkwam.

    Ruime max_tokens en een strikte herkansing, zodat een redenerend model
    (kimi-k2.6) genoeg ruimte heeft om ná het denken de JSON te geven; de
    reasoning_content dient als vangnet als het model met lege content eindigt."""
    client = OpenAI(api_key=api_key, base_url=base_url, timeout=90, max_retries=1)
    user = f"CATALOGUS (beschikbare widgets):\n{catalog_json}\n\n"
    if context:
        user += f"CONTEXT (ter inspiratie, geen cijfers overnemen):\n{context}\n\n"
    user += f"VERZOEK VAN DE GEBRUIKER:\n{prompt}"
    messages = [
        {"role": "system", "content": DASHBOARD_PROMPT},
        {"role": "user", "content": user},
    ]

    def _ask(msgs):
        resp = client.chat.completions.create(model=model, messages=msgs, max_tokens=3500, stream=False)
        m = resp.choices[0].message if resp.choices else None
        txt = (getattr(m, "content", None) or "").strip()
        if not txt and getattr(m, "reasoning_content", None):
            txt = m.reasoning_content
        return txt

    obj = _extract_json(_ask(messages))
    if obj is None:
        # Eén strikte herkansing: uitsluitend JSON, geen uitleg of denkstappen.
        strict = messages + [{
            "role": "user",
            "content": "Geef nu UITSLUITEND het JSON-object terug, zonder enige uitleg, tekst of denkstappen eromheen.",
        }]
        obj = _extract_json(_ask(strict))
    if obj is None:
        raise ValueError("Geen bruikbare JSON in het modelantwoord")
    return obj
