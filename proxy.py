"""
Local proxy server for forwarding Ollama requests to a remote endpoint.
Bypasses ngrok's browser POST restriction by using Python's requests library.

Usage:
    python proxy.py                                          # default: forwards to http://localhost:11434
    python proxy.py --remote https://xyz.ngrok-free.app      # forwards to remote ngrok URL
    python proxy.py --port 11435                             # run proxy on a different port
"""

import argparse
import json
from http.server import HTTPServer, BaseHTTPRequestHandler
import urllib.request
import urllib.error


class OllamaProxyHandler(BaseHTTPRequestHandler):
    remote_url = "http://localhost:11434"

    def _set_cors_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def do_OPTIONS(self):
        self.send_response(204)
        self._set_cors_headers()
        self.end_headers()

    def do_GET(self):
        target = self.remote_url.rstrip("/") + self.path
        try:
            req = urllib.request.Request(target, headers={"ngrok-skip-browser-warning": "true"})
            with urllib.request.urlopen(req) as resp:
                body = resp.read()
                self.send_response(resp.status)
                self._set_cors_headers()
                self.send_header("Content-Type", resp.headers.get("Content-Type", "application/json"))
                self.end_headers()
                self.wfile.write(body)

        except urllib.error.HTTPError as e:
            self.send_response(e.code)
            self._set_cors_headers()
            self.end_headers()
            self.wfile.write(e.read())

        except Exception as e:
            self.send_response(502)
            self._set_cors_headers()
            self.end_headers()
            self.wfile.write(json.dumps({"error": str(e)}).encode())

    def do_POST(self):
        content_length = int(self.headers.get("Content-Length", 0))
        post_data = self.rfile.read(content_length)
        target = self.remote_url.rstrip("/") + self.path

        try:
            req = urllib.request.Request(
                target,
                data=post_data,
                headers={
                    "Content-Type": "application/json",
                    "ngrok-skip-browser-warning": "true",
                },
                method="POST",
            )

            with urllib.request.urlopen(req) as resp:
                body = resp.read()
                self.send_response(resp.status)
                self._set_cors_headers()
                self.send_header("Content-Type", resp.headers.get("Content-Type", "application/json"))
                self.end_headers()
                self.wfile.write(body)

        except urllib.error.HTTPError as e:
            self.send_response(e.code)
            self._set_cors_headers()
            self.end_headers()
            self.wfile.write(e.read())

        except Exception as e:
            self.send_response(502)
            self._set_cors_headers()
            self.end_headers()
            self.wfile.write(json.dumps({"error": str(e)}).encode())

    def log_message(self, format, *args):
        print(f"[proxy] {args[0]}")


def main():
    parser = argparse.ArgumentParser(description="Local proxy for remote Ollama")
    parser.add_argument("--remote", default="http://localhost:11434", help="Remote Ollama URL (e.g. https://xyz.ngrok-free.app)")
    parser.add_argument("--port", type=int, default=11435, help="Local port for the proxy (default: 11435)")
    args = parser.parse_args()

    OllamaProxyHandler.remote_url = args.remote
    server = HTTPServer(("127.0.0.1", args.port), OllamaProxyHandler)

    print(f"🔀 Ollama proxy running on http://localhost:{args.port}")
    print(f"   Forwarding to: {args.remote}")
    print(f"   Set your extension's Ollama URL to: http://localhost:{args.port}")
    print()

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nProxy stopped.")
        server.server_close()


if __name__ == "__main__":
    main()
