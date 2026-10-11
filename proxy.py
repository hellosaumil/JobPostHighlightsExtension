"""
Local proxy server for forwarding Ollama requests to a remote or local endpoint.
Bypasses browser CORS restrictions, ngrok browser warning interstitials, and streaming limits.
Supports both standard JSON endpoints (/api/tags) and streaming NDJSON endpoints (/api/chat, /api/generate).

Usage:
    python proxy.py                                          # forwards to http://localhost:11434 (or OLLAMA_REMOTE env var)
    python proxy.py --remote https://xyz.ngrok-free.app      # forwards to remote ngrok URL
    python proxy.py --port 11435                             # run proxy on a specific port
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

CHUNK_SIZE = 8192  # bytes per stream chunk read


class OllamaProxyHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    remote_url = "http://localhost:11434"

    def _set_cors_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
        self.send_header(
            "Access-Control-Allow-Headers",
            "Content-Type, Authorization, ngrok-skip-browser-warning, Accept, Origin, X-Requested-With, x-ollama-remote",
        )
        self.send_header("Access-Control-Max-Age", "86400")

    def do_OPTIONS(self):
        self.send_response(204)
        self._set_cors_headers()
        self.send_header("Content-Length", "0")
        self.end_headers()

    def _get_target_url(self) -> str:
        """Resolve target URL using optional client header override or configured remote_url."""
        override = self.headers.get("x-ollama-remote")
        base = (override or self.remote_url).rstrip("/")
        return base + self.path

    def _proxy(self, method: str, body: bytes | None = None):
        """Forward a request upstream, handling both non-streaming and streaming responses."""
        target = self._get_target_url()

        # Build upstream headers
        upstream_headers = {
            "ngrok-skip-browser-warning": "true",
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
            "Accept": "application/json, */*",
        }
        if body is not None:
            content_type = self.headers.get("Content-Type", "application/json")
            upstream_headers["Content-Type"] = content_type

        try:
            req = urllib.request.Request(target, data=body, headers=upstream_headers, method=method)
            with urllib.request.urlopen(req, timeout=120) as resp:
                resp_status = resp.status
                resp_headers = resp.headers
                content_type = resp_headers.get("Content-Type", "application/json")
                content_length = resp_headers.get("Content-Length")

                # Detect if the endpoint is non-streaming (e.g. /api/tags, /api/version, or Content-Length present)
                is_tag_or_info = any(self.path.startswith(prefix) for prefix in ("/api/tags", "/api/version", "/api/show"))
                is_non_streaming = content_length is not None or is_tag_or_info or method == "GET"

                if is_non_streaming:
                    payload = resp.read()
                    self.send_response(resp_status)
                    self._set_cors_headers()
                    self.send_header("Content-Type", content_type)
                    self.send_header("Content-Length", str(len(payload)))
                    self.send_header("Connection", "keep-alive")
                    self.end_headers()
                    self.wfile.write(payload)
                    self.wfile.flush()
                    print(f"[proxy] ✅ {method} {self.path} -> {target} [{resp_status}] ({len(payload)} bytes)")
                    return

                # For streaming responses (e.g. /api/chat, /api/generate with NDJSON tokens)
                self.send_response(resp_status)
                self._set_cors_headers()
                self.send_header("Content-Type", content_type)
                self.send_header("Transfer-Encoding", "chunked")
                self.send_header("Connection", "keep-alive")
                self.end_headers()

                bytes_streamed = 0
                while True:
                    chunk = resp.read(CHUNK_SIZE)
                    if not chunk:
                        break
                    bytes_streamed += len(chunk)
                    self.wfile.write(f"{len(chunk):X}\r\n".encode())
                    self.wfile.write(chunk)
                    self.wfile.write(b"\r\n")
                    self.wfile.flush()

                # Terminate chunked transfer encoding
                self.wfile.write(b"0\r\n\r\n")
                self.wfile.flush()
                print(f"[proxy] ⚡ Streamed {method} {self.path} -> {target} [{resp_status}] ({bytes_streamed} bytes)")

        except urllib.error.HTTPError as e:
            err_body = e.read()
            print(f"[proxy] ⚠️ Upstream HTTP error {e.code} for {method} {self.path} -> {target}: {err_body[:200]}")
            self.send_response(e.code)
            self._set_cors_headers()
            content_type = e.headers.get("Content-Type", "application/json") if e.headers else "application/json"
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(err_body)))
            self.end_headers()
            self.wfile.write(err_body)
            self.wfile.flush()

        except urllib.error.URLError as e:
            err_msg = str(e.reason)
            print(f"[proxy] ❌ Cannot connect to upstream {target}: {err_msg}")
            print(f"        👉 Make sure Ollama is running or specify the correct --remote URL.")
            err_json = json.dumps({
                "error": f"Proxy cannot reach Ollama at {target}: {err_msg}",
                "target": target,
                "hint": "Check that Ollama is running and your --remote URL is correct.",
            }).encode()
            self.send_response(502)
            self._set_cors_headers()
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(err_json)))
            self.end_headers()
            self.wfile.write(err_json)
            self.wfile.flush()

        except Exception as e:
            print(f"[proxy] ❌ Unexpected error for {method} {self.path} -> {target}: {e}")
            err_json = json.dumps({"error": str(e), "target": target}).encode()
            self.send_response(500)
            self._set_cors_headers()
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(err_json)))
            self.end_headers()
            self.wfile.write(err_json)
            self.wfile.flush()

    def do_GET(self):
        # Health check endpoint
        if self.path == "/health" or self.path == "/proxy/status":
            status_data = json.dumps({
                "status": "ok",
                "proxy": "running",
                "remote_url": self.remote_url,
            }).encode()
            self.send_response(200)
            self._set_cors_headers()
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(status_data)))
            self.end_headers()
            self.wfile.write(status_data)
            return

        self._proxy("GET")

    def do_POST(self):
        content_length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(content_length) if content_length > 0 else None
        self._proxy("POST", body)

    def log_message(self, format, *args):
        # Suppress default noisy stderr output; custom logging is handled in _proxy
        pass


def main():
    parser = argparse.ArgumentParser(description="Local streaming proxy for remote or local Ollama")
    default_remote = os.environ.get("OLLAMA_REMOTE") or os.environ.get("OLLAMA_URL") or "http://localhost:11434"
    parser.add_argument(
        "--remote",
        default=default_remote,
        help=f"Remote Ollama URL (e.g. https://xyz.ngrok-free.app, default: {default_remote})",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=11435,
        help="Local port for the proxy (default: 11435)",
    )
    args = parser.parse_args()

    OllamaProxyHandler.remote_url = args.remote
    server = ThreadingHTTPServer(("127.0.0.1", args.port), OllamaProxyHandler)

    print("=" * 60)
    print(f"🔀 Ollama Proxy Server running on http://127.0.0.1:{args.port}")
    print(f"   Target Upstream: {args.remote}")
    print(f"   Extension URL:   http://localhost:{args.port}")
    print("=" * 60)
    print("Ready to receive requests... (Press Ctrl+C to stop)")
    print()

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping proxy server...")
        server.server_close()
        print("Proxy stopped.")


if __name__ == "__main__":
    main()
