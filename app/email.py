"""E-mailverzending via SMTP (optioneel).

Zonder SMTP-configuratie (zie config.SMTP_*) doet dit niets: `is_configured()`
geeft False en de aanroeper toont de link in de interface om handmatig te
delen. Zodra de SMTP-variabelen als omgevingsvariabelen gezet zijn, worden de
uitnodigings- en wachtwoord-reset-mails automatisch verstuurd.
"""
import logging
import smtplib
import ssl
from email.message import EmailMessage

from . import config

log = logging.getLogger("dashboard")


def is_configured() -> bool:
    """True als er genoeg SMTP-gegevens zijn om te kunnen versturen."""
    return bool(config.SMTP_HOST and config.SMTP_FROM)


def send(to: str, subject: str, text: str) -> bool:
    """Verstuur een platte-tekstmail. Geeft True bij succes, False bij (config-)fout."""
    if not is_configured():
        return False
    msg = EmailMessage()
    msg["From"] = config.SMTP_FROM
    msg["To"] = to
    msg["Subject"] = subject
    msg.set_content(text)
    try:
        with smtplib.SMTP(config.SMTP_HOST, config.SMTP_PORT, timeout=15) as server:
            if config.SMTP_STARTTLS:
                server.starttls(context=ssl.create_default_context())
            if config.SMTP_USER:
                server.login(config.SMTP_USER, config.SMTP_PASSWORD)
            server.send_message(msg)
        return True
    except Exception:  # noqa: BLE001 - e-mail mag de flow nooit laten crashen
        log.exception("e-mail versturen mislukt naar %s", to)
        return False


def send_invite(to: str, link: str, org_name: str) -> bool:
    return send(
        to,
        "Je bent uitgenodigd voor het dashboard",
        "Hallo,\n\n"
        f"Je bent uitgenodigd om toegang te krijgen tot het marketingdashboard van {org_name}.\n"
        "Stel via onderstaande link je wachtwoord in en log direct in:\n\n"
        f"{link}\n\n"
        "Deze link is 7 dagen geldig en werkt eenmalig.\n\n"
        "Met vriendelijke groet,\nHet team",
    )


def send_reset(to: str, link: str) -> bool:
    return send(
        to,
        "Wachtwoord opnieuw instellen",
        "Hallo,\n\n"
        "Je hebt gevraagd om je wachtwoord opnieuw in te stellen. Gebruik onderstaande link:\n\n"
        f"{link}\n\n"
        "Deze link is 1 uur geldig en werkt eenmalig. Heb je dit niet aangevraagd, "
        "dan kun je deze e-mail negeren.\n\n"
        "Met vriendelijke groet,\nHet team",
    )
