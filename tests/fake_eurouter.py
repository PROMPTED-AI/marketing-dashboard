"""Minimal OpenAI-compatible SSE server to exercise the assistant end-to-end
without a real LLM. Turn 1: emit a tool_call to get_marketing_overview.
Turn 2 (after the tool result is appended): stream a Markdown answer that embeds
the exact tool JSON, so the whole chain (endpoint -> tool loop -> execute -> SSE)
and the computed cross-channel numbers can be inspected."""
import json
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


def _chunk(delta, finish=None):
    return "data: " + json.dumps({
        "id": "x", "object": "chat.completion.chunk", "model": "fake",
        "choices": [{"index": 0, "delta": delta, "finish_reason": finish}],
    }) + "\n\n"


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_GET(self):
        if self.path.rstrip("/").endswith("/models"):
            body = json.dumps({"data": [{"id": "fake", "supported_parameters": ["tools"]}]}).encode()
            self.send_response(200); self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body))); self.end_headers(); self.wfile.write(body)
        else:
            self.send_response(404); self.end_headers()

    def do_POST(self):
        n = int(self.headers.get("Content-Length", 0))
        req = json.loads(self.rfile.read(n) or "{}")
        msgs = req.get("messages", [])
        has_tool_result = any(m.get("role") == "tool" for m in msgs)
        # Scenario-detectie over het HELE gesprek, zodat ook de geforceerde
        # afrondingsronde (extra user-instructie achteraan) het scenario raakt.
        last_user = " ".join(str(m.get("content", "")) for m in msgs if m.get("role") == "user")

        # Niet-streamende aanroep (de herkansing van de feedback-analyse):
        # JSON-completion teruggeven. Bij "leegstil" blijft óók de herkansing
        # leeg (alleen reasoning), zodat het reasoning-vangnet getest wordt.
        if not req.get("stream"):
            # Dashboard-generatie: geef een JSON-indeling terug met een geldige
            # bron, een custom-KPI (afgeleide metric) en één ongeldige bron, zodat
            # de server-side validatie (droppen + custom-spec) getest wordt.
            if "catalogus" in str(last_user).lower():
                layout = {
                    "widgets": [
                        {"source": "users", "kind": "kpi", "size": 3, "title": "Bezoekers"},
                        {"source": "channels", "kind": "donut", "size": 4, "title": "Verkeersbronnen"},
                        {"source": "custom", "kind": "kpi", "size": 3, "title": "Sessies per bezoeker",
                         "spec": {"op": "ratio", "refs": ["sessions", "users"], "fmt": "ratio"}},
                        {"source": "bestaat_niet_xyz", "kind": "kpi", "size": 3, "title": "Ongeldig"},
                    ],
                    "notes": "Testconcept met een afgeleide KPI.",
                    "requests": ["een heatmap van klikken op de pagina"],
                }
                msg = {"role": "assistant", "content": "```json\n" + json.dumps(layout) + "\n```"}
                body = json.dumps({"id": "x", "object": "chat.completion", "model": "fake",
                                   "choices": [{"index": 0, "message": msg, "finish_reason": "stop"}]}).encode()
                self.send_response(200); self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body))); self.end_headers(); self.wfile.write(body)
                return
            if "leegstil" in str(last_user).lower():
                msg = {"role": "assistant", "content": "",
                       "reasoning_content": "## Uitgewerkte omschrijving\nDit komt uit de denkstappen."}
            else:
                msg = {"role": "assistant", "content": (
                    "## Uitgewerkte omschrijving\nHerkansing gelukt, dit is de volledige uitwerking.\n"
                    "## Advies voor verwerking\nVerwerk dit in het betreffende scherm.\n"
                    "## Inschatting\nPrioriteit middel, omvang klein.")}
            body = json.dumps({"id": "x", "object": "chat.completion", "model": "fake",
                               "choices": [{"index": 0, "message": msg, "finish_reason": "stop"}]}).encode()
            self.send_response(200); self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body))); self.end_headers(); self.wfile.write(body)
            return

        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.end_headers()

        def w(s):
            self.wfile.write(s.encode()); self.wfile.flush()

        # "leegdenk"/"leegstil": denkend model dat alleen reasoning_content
        # stroomt en met lege content eindigt (het kimi-k2.6-faalpad van de
        # feedback-analyse).
        if "leegdenk" in str(last_user).lower() or "leegstil" in str(last_user).lower():
            w(_chunk({"reasoning_content": "Eerst even nadenken over deze feedback. "}))
            time.sleep(1.2)
            w(_chunk({"reasoning_content": "De kern is duidelijk."}))
            time.sleep(1.2)
            w(_chunk({}, finish="stop"))
            w("data: [DONE]\n\n")
            return

        # Simulatie van het productie-faalpad: bevat de vraag "hardnekkig", dan
        # blijft het model tool-calls teruggeven zolang er tools in het verzoek
        # zitten (loop-uitputting). Pas als de backend de afronding zonder tools
        # forceert, komt er tekst.
        # Tool-loze aanroep zonder eerdere toolresultaten (bijv. de
        # feedback-analyse): gewoon tekst terugstromen.
        if not req.get("tools") and not has_tool_result:
            answer = ("## Uitgewerkte omschrijving\nDe gebruiker beschrijft het punt hierboven; "
                      "dit is de uitgewerkte versie.\n## Advies voor verwerking\nPak dit op in het "
                      "dashboard bij het betreffende scherm.\n## Inschatting\nPrioriteit middel, omvang klein.")
            for piece in answer.split(" "):
                w(_chunk({"content": piece + " "}))
            w("data: [DONE]\n\n")
            return

        # "aankondiging": het productie-faalpad. Turn 1: intro-tekst + tool-call.
        # Turn 2 (met toolresultaat, tools in verzoek): LEGE completion, het
        # model "zwijgt". Alleen de geforceerde afronding (zonder tools) levert
        # daarna het echte antwoord.
        if "aankondiging" in str(last_user).lower():
            if not has_tool_result:
                w(_chunk({"content": "Ik ga de gegevens van de huidige periode voor je ophalen. "}))
                w(_chunk({"tool_calls": [{"index": 0, "id": "call_1", "type": "function",
                                          "function": {"name": "get_analytics_overview", "arguments": "{}"}}]}))
                w(_chunk({}, finish="tool_calls"))
            elif req.get("tools"):
                w(_chunk({}, finish="stop"))  # lege completion na het toolresultaat
            else:
                for piece in "Je conversies daalden 12 procent, vooral door minder betaald verkeer. Overweeg je Google Ads-budget te herstellen.".split(" "):
                    w(_chunk({"content": piece + " "}))
            w("data: [DONE]\n\n")
            return

        # "tussentijds": eerst een stuk tekst, dán een tool-call (zoals modellen
        # die hun plan aankondigen), en een traag vervolg. Test van de
        # "denkt verder"-indicator onder een deelantwoord.
        if "tussentijds" in str(last_user).lower():
            if not has_tool_result:
                w(_chunk({"content": "Ik pak eerst de huidige data erbij. "}))
                time.sleep(0.4)
                w(_chunk({"tool_calls": [{"index": 0, "id": "call_1", "type": "function",
                                          "function": {"name": "get_analytics_overview", "arguments": "{}"}}]}))
                w(_chunk({}, finish="tool_calls"))
            else:
                time.sleep(2.5)  # het "stille" denkvenster dat de gebruiker zag
                for piece in "Klaar. De conversies staan er goed bij deze periode.".split(" "):
                    w(_chunk({"content": piece + " "}))
                    time.sleep(0.05)
            w("data: [DONE]\n\n")
            return

        stubborn = "hardnekkig" in str(last_user).lower() and bool(req.get("tools"))
        # "parallel": twee tool-calls in één beurt (test van de parallelle uitvoering)
        if "parallel" in str(last_user).lower() and not has_tool_result:
            w(_chunk({"tool_calls": [{"index": 0, "id": "call_a", "type": "function",
                                      "function": {"name": "get_marketing_overview", "arguments": "{}"}},
                                     {"index": 1, "id": "call_b", "type": "function",
                                      "function": {"name": "get_analytics_overview", "arguments": "{}"}}]}))
            w(_chunk({}, finish="tool_calls"))
            w("data: [DONE]\n\n")
            return
        if stubborn or not has_tool_result:
            # Turn 1: call the cross-channel tool.
            w(_chunk({"tool_calls": [{"index": 0, "id": "call_1", "type": "function",
                                      "function": {"name": "get_marketing_overview", "arguments": ""}}]}))
            w(_chunk({"tool_calls": [{"index": 0, "function": {"arguments": "{}"}}]}))
            w(_chunk({}, finish="tool_calls"))
        else:
            # Turn 2: stream a Markdown answer embedding the tool result verbatim.
            tool_json = next((m.get("content", "") for m in reversed(msgs) if m.get("role") == "tool"), "{}")
            answer = (
                "## Marketingoverzicht\n\n"
                "Hier het **cross-kanaal** beeld:\n\n"
                "| Metric | Waarde |\n| --- | --- |\n"
                "| Blended ROAS | zie hieronder |\n\n"
                "```json\n" + tool_json + "\n```\n\n"
                "- Actie: stuur bij op de best renderende kanalen.\n"
            )
            for piece in answer.splitlines(keepends=True):
                w(_chunk({"content": piece}))
        w("data: [DONE]\n\n")


if __name__ == "__main__":
    ThreadingHTTPServer(("127.0.0.1", 9099), H).serve_forever()
