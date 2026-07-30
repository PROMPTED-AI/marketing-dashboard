"""Security-headers op elke respons.

Opzettelijk een pure ASGI-middleware en geen `BaseHTTPMiddleware`: die laatste
staat tussen de respons en de client in en kan server-sent events (de assistent
en de feedback-analyse streamen) bufferen. Deze variant raakt alleen de
`http.response.start`-boodschap en laat de body ongemoeid.

De Content-Security-Policy is toegesneden op deze app: de SPA laadt zijn eigen
JS/CSS van dezelfde origin en zijn lettertype van Google Fonts. `style-src`
staat inline stijl toe omdat de interface grotendeels met inline `style`-props
werkt; scripts blijven strikt op de eigen origin, wat de belangrijkste
beperking is (een XSS kan dan geen extern script laden of data wegsturen).
"""
from starlette.datastructures import MutableHeaders

_CSP = "; ".join(
    (
        "default-src 'self'",
        "base-uri 'self'",
        "object-src 'none'",
        "frame-ancestors 'none'",
        "script-src 'self'",
        "connect-src 'self'",
        "img-src 'self' data:",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "font-src 'self' data: https://fonts.gstatic.com",
        "form-action 'self'",
    )
)

_BASE_HEADERS = {
    "content-security-policy": _CSP,
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "strict-origin-when-cross-origin",
    "permissions-policy": "geolocation=(), microphone=(), camera=()",
    "cross-origin-opener-policy": "same-origin",
}
# Twee jaar, zoals de HSTS-preloadlijst vraagt. Alleen zinvol (en veilig) op
# https; op een http-omgeving voor lokale ontwikkeling zou het de site
# onbereikbaar maken zodra de browser de header onthoudt.
_HSTS = "max-age=63072000; includeSubDomains"


class SecurityHeadersMiddleware:
    def __init__(self, app, hsts: bool = False):
        self.app = app
        self.headers = dict(_BASE_HEADERS)
        if hsts:
            self.headers["strict-transport-security"] = _HSTS

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        async def send_with_headers(message):
            if message["type"] == "http.response.start":
                headers = MutableHeaders(scope=message)
                for name, value in self.headers.items():
                    # setdefault: een endpoint dat bewust een eigen waarde zet
                    # (bijvoorbeeld Cache-Control) blijft leidend.
                    headers.setdefault(name, value)
            await send(message)

        await self.app(scope, receive, send_with_headers)
