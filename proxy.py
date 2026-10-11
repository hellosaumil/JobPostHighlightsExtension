"""
Local proxy server for forwarding Ollama requests to a remote endpoint.
Bypasses ngrok's browser POST restriction by using Python's requests library.
Supports streaming responses (NDJSON) so the extension's stream reader works correctly.

Usage:
    python proxy.py                                          # default: forwards to http://localhost:11434
    python proxy.py --remote https://xyz.ngrok-free.app      # forwards to remote ngrok URL
    python proxy.py --port 11435                             # run proxy on a different port
"""

import argparse
import json
import urllib.request
import urllib.error
from http.server import HTTPServer, BaseHTTPRequestHandler

CHUNK_SIZE = 8192  # bytes per stream read


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

    def _proxy(self, method: str, body: bytes | None = None):
        """Forward a request upstream, streaming the response back chunk-by-chunk."""
        target = self.remote_url.rstrip("/") + self.path
        headers = {"ngrok-skip-browser-warning": "true"}
        if body is not None:
            headers["Content-Type"] = "application/json"

        try:
            req = urllib.request.Request(target, data=body, headers=headers, method=method)
            with urllib.request.urlopen(req) as resp:
                self.send_response(resp.status)
                self._set_cors_headers()
                content_type = resp.headers.get("Content-Type", "application/json")
                self.send_header("Content-Type", content_type)
                # Do NOT set Content-Length — we stream, so we don't know it upfront.
                # Use chunked transfer encoding so the browser can read each NDJSON line live.
                self.send_header("Transfer-Encoding", "chunked")
                self.end_headers()

                # Stream response to client in chunks
                while True:
                    chunk = resp.read(CHUNK_SIZE)
                    if not chunk:
                        break
                    # Chunked transfer encoding: size (hex) + CRLF + data + CRLF
                    self.wfile.write(f"{len(chunk):X}\r\n".encode())
                    self.wfile.write(chunk)
                    self.wfile.write(b"\r\n")
                    self.wfile.flush()

                # Terminate chunked encoding
                self.wfile.write(b"0\r\n\r\n")
                self.wfile.flush()

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

    def do_GET(self):
        self._proxy("GET")

    def do_POST(self):
        content_length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(content_length)
        self._proxy("POST", body)

    def log_message(self, format, *args):
        print(f"[proxy] {args[0]}")


def main():
    parser = argparse.ArgumentParser(description="Local streaming proxy for remote Ollama")
    parser.add_argument(
        "--remote", default="http://localhost:11434",
        help="Remote Ollama URL (e.g. https://xyz.ngrok-free.app)"
    )
    parser.add_argument(
        "--port", type=int, default=11435,
        help="Local port for the proxy (default: 11435)"
    )
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
