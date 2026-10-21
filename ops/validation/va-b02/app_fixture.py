"""Fictitious loopback health service; never loads real configuration or cells."""
import http.server,signal,threading
class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200);self.end_headers();self.wfile.write(b'{"status":"ok"}')
    def log_message(self,*args):pass
server=http.server.HTTPServer(('127.0.0.1',3001),Handler)
def stop(*args):threading.Thread(target=server.shutdown,daemon=True).start()
signal.signal(signal.SIGTERM,stop)
server.serve_forever();server.server_close()
