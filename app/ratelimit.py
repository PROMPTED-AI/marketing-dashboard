"""Best-effort in-process rate limiting (fixed window).

Per Cloud Run *instance* — niet gedeeld tussen instances. Dat is bewust: het
dempt misbruik en runaway-loops zonder afhankelijkheid van Redis/Neon. Voor
harde, gedeelde limieten is een externe store nodig; dit is de goedkope
eerste verdedigingslinie (o.a. voor de assistent en de WooCommerce-koppeling,
die uitgaande requests doen).
"""
import threading
import time

_lock = threading.Lock()
_windows: dict[str, list] = {}  # key -> [window_end_epoch, count]
_MAX_KEYS = 4096


def allow(key: str, limit: int, window_s: float) -> bool:
    """True als deze hit binnen de limiet valt; False als het venster vol is."""
    now = time.time()
    with _lock:
        bucket = _windows.get(key)
        if bucket is None or bucket[0] <= now:
            if len(_windows) > _MAX_KEYS:
                _prune(now)
            _windows[key] = [now + window_s, 1]
            return True
        if bucket[1] >= limit:
            return False
        bucket[1] += 1
        return True


def _prune(now: float) -> None:
    """Verwijder verlopen vensters (aangeroepen onder de lock)."""
    for k in [k for k, b in _windows.items() if b[0] <= now]:
        _windows.pop(k, None)
