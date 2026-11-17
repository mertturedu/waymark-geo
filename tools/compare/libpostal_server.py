import json
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import parse_qs, urlparse

from postal.parser import parse_address


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        text = parse_qs(urlparse(self.path).query).get('q', [''])[0]
        body = json.dumps(parse_address(text, country='tr'), ensure_ascii=False).encode()
        self.send_response(200)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


HTTPServer(('127.0.0.1', int(sys.argv[1]) if len(sys.argv) > 1 else 8087), Handler).serve_forever()
