#!/usr/bin/env python3
"""Local static server + same-origin proxy for Intelekta chat API."""
from __future__ import annotations

import http.client
import http.server
import socketserver
import ssl
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent
HOST = "127.0.0.1"
PORT = 3000
CHAT_PREFIX = "/api/v1/public/chat"
UPSTREAM = "https://os.4chairs.bg" + CHAT_PREFIX

# Upstream may need TLS context on some Windows setups
_SSL = ssl.create_default_context()


class Handler(http.server.SimpleHTTPRequestHandler):
	def __init__(self, *args, **kwargs):
		super().__init__(*args, directory=str(ROOT), **kwargs)

	def do_OPTIONS(self):
		if self.path.startswith(CHAT_PREFIX):
			self.send_response(204)
			self._cors()
			self.end_headers()
			return
		self.send_error(404)

	def do_GET(self):
		if self.path.startswith(CHAT_PREFIX):
			self._proxy()
			return
		super().do_GET()

	def do_POST(self):
		if self.path.startswith(CHAT_PREFIX):
			self._proxy()
			return
		self.send_error(405)

	def do_PUT(self):
		if self.path.startswith(CHAT_PREFIX):
			self._proxy()
			return
		self.send_error(405)

	def _cors(self):
		origin = self.headers.get("Origin")
		if origin:
			self.send_header("Access-Control-Allow-Origin", origin)
			self.send_header("Vary", "Origin")
			self.send_header("Access-Control-Allow-Credentials", "true")
			self.send_header(
				"Access-Control-Allow-Headers",
				self.headers.get("Access-Control-Request-Headers")
				or "Authorization, Content-Type",
			)
			self.send_header(
				"Access-Control-Allow-Methods",
				"GET, POST, PUT, OPTIONS",
			)

	def _proxy(self):
		suffix = self.path[len(CHAT_PREFIX) :] or "/"
		url = UPSTREAM + suffix
		length = int(self.headers.get("Content-Length") or 0)
		body = self.rfile.read(length) if length else None

		req = urllib.request.Request(url, data=body, method=self.command)
		# Forward useful headers; do not forward Host
		auth = self.headers.get("Authorization")
		if auth:
			req.add_header("Authorization", auth)
		ctype = self.headers.get("Content-Type")
		if ctype:
			req.add_header("Content-Type", ctype)
		req.add_header("Accept", self.headers.get("Accept") or "application/json")

		try:
			with urllib.request.urlopen(req, context=_SSL, timeout=30) as resp:
				data = resp.read()
				self.send_response(resp.status)
				# Pass through content-type; skip hop-by-hop / framing headers
				ct = resp.headers.get("Content-Type")
				if ct:
					self.send_header("Content-Type", ct)
				self.send_header("Content-Length", str(len(data)))
				self._cors()
				self.end_headers()
				if self.command != "HEAD":
					self.wfile.write(data)
		except urllib.error.HTTPError as e:
			data = e.read()
			self.send_response(e.code)
			ct = e.headers.get("Content-Type") if e.headers else None
			if ct:
				self.send_header("Content-Type", ct)
			self.send_header("Content-Length", str(len(data)))
			self._cors()
			self.end_headers()
			self.wfile.write(data)
		except Exception as e:
			msg = str(e).encode("utf-8", "replace")
			self.send_response(502)
			self.send_header("Content-Type", "text/plain; charset=utf-8")
			self.send_header("Content-Length", str(len(msg)))
			self._cors()
			self.end_headers()
			self.wfile.write(msg)

	def log_message(self, fmt, *args):
		sys_stderr = __import__("sys").stderr
		sys_stderr.write("%s - %s\n" % (self.address_string(), fmt % args))


class ReusableTCPServer(socketserver.TCPServer):
	allow_reuse_address = True


def main():
	with ReusableTCPServer((HOST, PORT), Handler) as httpd:
		print("Serving %s at http://%s:%s" % (ROOT, HOST, PORT), flush=True)
		print("Chat proxy: %s -> %s" % (CHAT_PREFIX, UPSTREAM), flush=True)
		httpd.serve_forever()


if __name__ == "__main__":
	main()
