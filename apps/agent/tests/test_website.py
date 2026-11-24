import unittest,httpx
from uuid import uuid4
from langchain_core.messages import AIMessage
from pjflim_agent.website_agent import WebsiteAgent,Gateway,WebsiteError
RUN_ID="12345678-1234-4234-9234-123456789012"
TITLE_ID="12345678-1234-4234-9234-123456789013"
def fact(kind="TITLE",id=TITLE_ID,tag="a"):
    return {"id":"ev-"+tag*32,"kind":kind,"entityId":id,"version":"f"*64,"fields":{"name":"Phim thử"}}
class FakeGateway:
    def __init__(self,results):self.results=list(results);self.calls=[]
    def tool(self,name,args):
        self.calls.append((name,args))
        return self.results.pop(0)
class ScriptedModel:
    def __init__(self,responses):self.responses=list(responses);self.bound=None
    def bind_tools(self,tools):self.bound=tools;return self
    def invoke(self,messages):return self.responses.pop(0)
def run(**kw):return {"id":RUN_ID,"message":"Tìm phim hành động",**kw}
class WebsiteTests(unittest.TestCase):
    def test_catalog_search(self):
        gateway=FakeGateway([{"evidence":[fact()]}])
        answer=WebsiteAgent(gateway).run(run())
        self.assertEqual(answer["engine"],"CATALOG");self.assertEqual(answer["selection"]["titleIds"],[TITLE_ID])
    def test_empty(self):
        self.assertEqual(WebsiteAgent(FakeGateway([{"evidence":[]}])).run(run())["selection"]["kind"],"EMPTY")
    def test_help(self):
        gateway=FakeGateway([{"evidence":[fact("HELP","quality")]}])
        answer=WebsiteAgent(gateway).run(run(message="Đổi chất lượng video thế nào?"))
        self.assertEqual(answer["selection"]["kind"],"HELP");self.assertEqual(gateway.calls[0][0],"search_help")
    def test_context_episodes(self):
        gateway=FakeGateway([{"evidence":[fact(),fact("EPISODE",RUN_ID,"b")]}])
        answer=WebsiteAgent(gateway).run(run(message="Phim này có bao nhiêu tập?",contextTitleId=TITLE_ID))
        self.assertEqual(gateway.calls[0],("get_published_episodes",{"titleId":TITLE_ID}));self.assertEqual(answer["selection"]["episodeIds"],[RUN_ID])
    def test_context_details(self):
        g=FakeGateway([{"evidence":[fact()]}]);WebsiteAgent(g).run(run(message="Phim này năm nào?",contextTitleId=TITLE_ID))
        self.assertEqual(g.calls[0][0],"get_title_details")
    def test_browse(self):
        g=FakeGateway([{"evidence":[]}]);WebsiteAgent(g).run(run(message="Có phim nào đang xem được?"))
        self.assertEqual(g.calls[0][1]["query"],"")
    def test_explicit_filters(self):
        g=FakeGateway([{"evidence":[]}]);WebsiteAgent(g).run(run(message="Phim bộ năm 2024",filters={"country":"VN"}))
        args=g.calls[0][1];self.assertEqual(args["kind"],"SERIES");self.assertEqual(args["year"],2024);self.assertEqual(args["country"],"VN")
    def test_injected_run_fields(self):
        with self.assertRaises(Exception):WebsiteAgent(FakeGateway([])).run(run(userId="another"))
    def test_invalid_tool(self):
        a=WebsiteAgent(FakeGateway([]));a.started=__import__("time").monotonic()
        with self.assertRaises(WebsiteError):a.call("raw_sql",{"sql":"SELECT *"})
    def test_no_model(self):
        with self.assertRaisesRegex(WebsiteError,"AGENT_MODEL_UNAVAILABLE"):WebsiteAgent(FakeGateway([]),"OLLAMA").run(run())
    def test_model_call_and_finish(self):
        responses=[AIMessage(content="",tool_calls=[{"name":"search_catalog","id":"call1","args":{"query":"phim"}}]),
          AIMessage(content="",tool_calls=[{"name":"finish_answer","id":"call2","args":{"kind":"FOUND","titleIds":[TITLE_ID],"helpIds":[],"episodeIds":[],"evidenceIds":["ev-"+"a"*32]}}])]
        a=WebsiteAgent(FakeGateway([{"evidence":[fact()]}]),"OLLAMA",ScriptedModel(responses))
        self.assertEqual(a.run(run())["selection"]["titleIds"],[TITLE_ID])
    def test_model_free_text_denied(self):
        with self.assertRaisesRegex(WebsiteError,"AGENT_ANSWER_INVALID"):WebsiteAgent(FakeGateway([]),"OLLAMA",ScriptedModel([AIMessage(content="fake film")])).run(run())
    def test_model_forged_id_denied(self):
        r=AIMessage(content="",tool_calls=[{"name":"finish_answer","id":"x","args":{"kind":"FOUND","titleIds":[TITLE_ID],"evidenceIds":["ev-"+"a"*32]}}])
        with self.assertRaisesRegex(WebsiteError,"AGENT_ANSWER_INVALID"):WebsiteAgent(FakeGateway([]),"OLLAMA",ScriptedModel([r,r])).run(run())
    def test_gateway_fixed_route_and_key_scope(self):
        requests=[]
        def handle(r):
            requests.append(r)
            return httpx.Response(200,json={"evidence":[fact()]})
        g=Gateway("http://127.0.0.1:3000",RUN_ID,"capability",httpx.MockTransport(handle))
        try:
            g.tool("search_catalog",{"query":""})
            self.assertEqual(requests[0].url.path,"/api/v1/internal/assistant/runs/"+RUN_ID+"/tools")
            self.assertEqual(requests[0].headers["Authorization"],"Bearer capability")
            self.assertNotIn("worker",str(requests[0].headers))
        finally:g.close()
    def test_gateway_no_credential_origin(self):
        with self.assertRaises(WebsiteError):Gateway("https://user:password@example.test",RUN_ID,"cap")
    def test_gateway_redirect_denied(self):
        g=Gateway("http://127.0.0.1:3000",RUN_ID,"cap",httpx.MockTransport(lambda r:httpx.Response(302,headers={"Location":"http://bad.test"})))
        try:
            with self.assertRaises(WebsiteError):g.tool("search_catalog",{})
        finally:g.close()
    def test_gateway_redacts_provider_error(self):
        g=Gateway("http://127.0.0.1:3000",RUN_ID,"cap",httpx.MockTransport(lambda r:httpx.Response(500,json={"code":"PASSWORD_SECRET","detail":"hidden"})))
        try:
            with self.assertRaisesRegex(WebsiteError,"AGENT_WORKER_UNAVAILABLE"):g.tool("search_catalog",{})
        finally:g.close()

class WebsiteFeedbackTests(unittest.TestCase):
    def test_feedback_context(self):
        g=FakeGateway([{"evidence":[fact(),fact("FEEDBACK",TITLE_ID,"b")]}])
        result=WebsiteAgent(g).run(run(message="Điểm IMDb và review phim này?",contextTitleId=TITLE_ID))
        self.assertEqual(g.calls,[("get_title_feedback",{"titleId":TITLE_ID})])
        self.assertEqual(result["selection"]["evidenceIds"],["ev-"+"a"*32,"ev-"+"b"*32])
    def test_feedback_named_title(self):
        g=FakeGateway([{"evidence":[fact()]},{"evidence":[fact(),fact("FEEDBACK",TITLE_ID,"b")]}])
        WebsiteAgent(g).run(run(message="Điểm IMDb và review của phim Alpha?"))
        self.assertEqual(g.calls[0][0],"search_catalog")
        self.assertEqual(g.calls[0][1]["query"],"alpha")
        self.assertEqual(g.calls[1],("get_title_feedback",{"titleId":TITLE_ID}))
    def test_feedback_no_title_asks(self):
        g=FakeGateway([])
        # A valid answer still needs one evidence-producing step, including empty searches.
        g.results=[{"evidence":[]}]
        answer=WebsiteAgent(g).run(run(message="Điểm IMDb phim này?"))
        self.assertEqual(answer["selection"]["kind"],"NEEDS_INPUT")
        self.assertFalse(answer["selection"]["titleIds"])
    def test_feedback_ambiguity_does_not_guess(self):
        g=FakeGateway([{"evidence":[fact(),fact("TITLE",RUN_ID,"c")]}])
        result=WebsiteAgent(g).run(run(message="Review phim Alpha"))
        self.assertEqual(result["selection"]["kind"],"NEEDS_INPUT")
        self.assertEqual(len(g.calls),1)
    def test_feedback_unmatched_title(self):
        g=FakeGateway([{"evidence":[]}])
        self.assertEqual(WebsiteAgent(g).run(run(message="Review phim KhongTonTai"))["selection"]["kind"],"EMPTY")
    def test_feedback_cross_entity_denied(self):
        g=FakeGateway([{"evidence":[fact(),fact("FEEDBACK",RUN_ID,"b")]}])
        a=WebsiteAgent(g);a.started=__import__("time").monotonic()
        a.call("get_title_feedback",{"titleId":TITLE_ID})
        with self.assertRaisesRegex(WebsiteError,"AGENT_ANSWER_INVALID"):
            a.finish({"kind":"FOUND","titleIds":[TITLE_ID],"evidenceIds":["ev-"+"a"*32,"ev-"+"b"*32]},__import__("pjflim_agent.website_agent",fromlist=["Run"]).Run.model_validate(run()))
    def test_ollama_feedback_schema_and_finish(self):
        responses=[AIMessage(content="",tool_calls=[{"name":"get_title_feedback","id":"one","args":{"titleId":TITLE_ID}}]),
          AIMessage(content="",tool_calls=[{"name":"finish_answer","id":"two","args":{"kind":"FOUND","titleIds":[TITLE_ID],"evidenceIds":["ev-"+"a"*32,"ev-"+"b"*32]}}])]
        model=ScriptedModel(responses)
        answer=WebsiteAgent(FakeGateway([{"evidence":[fact(),fact("FEEDBACK",TITLE_ID,"b")]}]),"OLLAMA",model).run(run(contextTitleId=TITLE_ID))
        self.assertEqual(answer["engine"],"OLLAMA")
        self.assertIn("get_title_feedback",[t.name for t in model.bound])

if __name__=="__main__":unittest.main()
