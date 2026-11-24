"""Private Docker/host service. Do not run as a public or Colab server."""
from __future__ import annotations
import os,json,hmac,threading,sys
import httpx
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from .website_agent import Gateway,WebsiteAgent,WebsiteError
from pydantic import ValidationError
SECRET=os.environ.get("ASSISTANT_SERVICE_SECRET","")
ENGINE=os.environ.get("ASSISTANT_ENGINE","CATALOG")
ORIGIN=os.environ.get("ASSISTANT_GATEWAY_ORIGIN","http://host.docker.internal:3000")
MODEL=os.environ.get("ASSISTANT_MODEL","qwen2.5:7b")
OLLAMA=os.environ.get("ASSISTANT_OLLAMA_ORIGIN","http://host.docker.internal:11434")
semaphore=threading.BoundedSemaphore(1)
def model():
    if ENGINE!="OLLAMA":return None
    from langchain_ollama import ChatOllama
    return ChatOllama(model=MODEL,base_url=OLLAMA,temperature=0,num_ctx=4096,num_predict=600,client_kwargs={"timeout":90,"trust_env":False})
class Handler(BaseHTTPRequestHandler):
    protocol_version="HTTP/1.1"
    def log_message(self,*args):pass
    def reply(self,status,data):
        raw=json.dumps(data,ensure_ascii=False).encode()
        self.send_response(status);self.send_header("Content-Type","application/json")
        self.send_header("Cache-Control","no-store");self.send_header("Content-Length",str(len(raw)));self.end_headers()
        try:self.wfile.write(raw)
        except (BrokenPipeError,ConnectionResetError):pass
    def do_GET(self):
        if self.path!="/health":return self.reply(404,{"code":"NOT_FOUND"})
        ready=ENGINE=="CATALOG"
        if ENGINE=="OLLAMA":
            try:
                with httpx.Client(timeout=3,follow_redirects=False,trust_env=False) as client:
                    r=client.get(OLLAMA.rstrip("/")+"/api/tags")
                    ready=r.status_code==200 and any(m.get("name")==MODEL for m in r.json().get("models",[]))
            except Exception:ready=False
        self.reply(200 if ready else 503,{"status":"READY" if ready else "MODEL_UNAVAILABLE","engine":ENGINE,"modelReady":ready and ENGINE=="OLLAMA"})
    def do_POST(self):
        if self.path!="/process":return self.reply(404,{"code":"NOT_FOUND"})
        if not hmac.compare_digest(self.headers.get("X-Assistant-Service-Key",""),SECRET):return self.reply(403,{"code":"AUTH_FORBIDDEN"})
        if self.headers.get("Transfer-Encoding") or self.headers.get("Content-Type","").split(";")[0]!="application/json":return self.reply(415,{"code":"REQUEST_INVALID"})
        try:size=int(self.headers.get("Content-Length","0"))
        except ValueError:return self.reply(400,{"code":"REQUEST_INVALID"})
        if size<1 or size>16384:return self.reply(413,{"code":"REQUEST_TOO_LARGE"})
        if not semaphore.acquire(blocking=False):return self.reply(503,{"code":"AGENT_WORKER_UNAVAILABLE"})
        gateway=None
        try:
            self.connection.settimeout(10)
            data=json.loads(self.rfile.read(size))
            if not isinstance(data,dict) or set(data)!={"run","capability"} or not isinstance(data["capability"],str) or len(data["capability"])>1024:raise WebsiteError("AGENT_ANSWER_INVALID")
            gateway=Gateway(ORIGIN,data["run"]["id"],data["capability"])
            result=WebsiteAgent(gateway,ENGINE,model()).run(data["run"])
            self.reply(200,result)
        except (ValidationError,KeyError,ValueError):self.reply(422,{"code":"AGENT_ANSWER_INVALID"})
        except WebsiteError as exc:self.reply(503 if exc.code in ("AGENT_MODEL_UNAVAILABLE","AGENT_WORKER_UNAVAILABLE") else 409,{"code":exc.code})
        except Exception:self.reply(500,{"code":"AGENT_WORKER_UNAVAILABLE"})
        finally:
            if gateway:gateway.close()
            semaphore.release()
def main():
    if "google.colab" in sys.modules or os.path.isdir("/content"):raise RuntimeError("COLAB_SERVER_NOT_SUPPORTED")
    if len(SECRET)<64 or ENGINE not in ("CATALOG","OLLAMA"):raise RuntimeError("ASSISTANT_CONFIGURATION_INVALID")
    server=ThreadingHTTPServer(("0.0.0.0",8010),Handler)
    print(json.dumps({"event":"assistant.service.started","engine":ENGINE}),flush=True)
    server.serve_forever()
if __name__=="__main__":main()
