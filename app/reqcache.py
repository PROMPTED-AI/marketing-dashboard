"""Per-request memo voor kleine, veel herhaalde reads.

Eén dashboardverzoek vraagt dezelfde dingen meerdere keren op: de organisatie
(voor demo-check, trial-check en de bureau-toewijzing), de functiestand en de
kanaalstand, en de status van een koppeling. Op een netwerk-database (Neon)
kost elke losse query milliseconden die optellen.

Twee eigenschappen maken dit veilig:

* De memo leeft in een ContextVar die per verzoek wordt gezet en daarna weer
  losgelaten, dus er lekt niets tussen verzoeken of gebruikers.
* Elke schrijfactie in `models` leegt de memo (`clear()`), zodat een read ná een
  write binnen hetzelfde verzoek nooit een verouderde waarde geeft.

Draait code buiten een verzoek (achtergrondthreads van het raamwerk, de seed bij
het opstarten), dan is er geen memo en gaat elke read gewoon naar de database.
"""
from contextvars import ContextVar

_current: ContextVar[dict | None] = ContextVar("reqcache", default=None)


class RequestCacheMiddleware:
    """Zet per HTTP-verzoek een lege memo op (pure ASGI, ook veilig bij SSE)."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        token = _current.set({})
        try:
            await self.app(scope, receive, send)
        finally:
            _current.reset(token)


def memo(key, producer):
    """Geef de gecachete waarde voor `key`, of bepaal hem met `producer`."""
    store = _current.get()
    if store is None:
        return producer()
    if key not in store:
        store[key] = producer()
    return store[key]


def clear() -> None:
    """Leeg de memo van dit verzoek (na elke schrijfactie)."""
    store = _current.get()
    if store is not None:
        store.clear()
