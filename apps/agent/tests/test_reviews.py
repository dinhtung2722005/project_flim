import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from langchain_core.messages import AIMessage,ToolMessage
from pjflim_agent.catalog import create_demo,Catalog,AgentError
from pjflim_agent.providers import ReviewDiscovery
from pjflim_agent.agent import MovieAgent
from test_agent import Fixture

class ReviewChecks(Fixture):
    def test_no_results_exception_becomes_empty(self):
        DDGSException=type("DDGSException",(Exception,),{})
        discovery=ReviewDiscovery(True,search=lambda q:(_ for _ in ()).throw(DDGSException("No results found.")))
        catalog=self.real()
        self.assertEqual(discovery.find(catalog,next(iter(catalog.by_id))),[])

    def test_provider_failure_is_not_empty(self):
        catalog=self.real()
        for error in [RuntimeError("No results found."),RuntimeError("timeout"),type("DDGSException",(Exception,),{})("timeout")]:
            discovery=ReviewDiscovery(True,search=lambda q:(_ for _ in ()).throw(error))
            self.code("WEB_SEARCH_UNAVAILABLE",lambda:discovery.find(catalog,next(iter(catalog.by_id))))

    def test_refs_not_lost_when_catalog_only_cited(self):
        catalog=self.real()
        title_id=next(iter(catalog.by_id))
        class Model:
            def bind_tools(self,tools):return self
            def invoke(self,messages):
                observations=[m for m in messages if isinstance(m,ToolMessage)]
                if not observations:return AIMessage(content="",tool_calls=[
                    {"name":"get_title_details","id":"detail","args":{"title_id":title_id}},
                    {"name":"search_web","id":"review","args":{"title_id":title_id}}])
                detail=json.loads(observations[0].content)["data"]
                return AIMessage(content="",tool_calls=[{"name":"finish_answer","id":"finish","args":{
                    "status":"FOUND","picks":[{"title_id":title_id,"evidence_ids":[detail["evidence"][0]["id"]]}]}}])
        discovery=ReviewDiscovery(True,search=lambda q:[{"href":"https://moveek.com/review/sample"}])
        result=MovieAgent(catalog,None,Model(),discovery=discovery).ask("Tìm review",mode="HYBRID")
        self.assertEqual(result["cards"][0]["review_refs"][0]["url"],"https://moveek.com/review/sample")
        self.assertFalse(result["cards"][0]["review_refs"][0]["read_verified"])

    def test_cell8_displays_review_links_as_data(self):
        source=Path(__file__).resolve().parents[1]
        catalog=self.real()
        result={"answer":"Review","cards":[{"name":"Phim","year":2024,"genres":[],"evidence":[],
            "external_ratings":[],"review_refs":[{"url":"https://moveek.com/review/sample","read_verified":False}]}],
            "status":"FOUND","demo":False,"warnings":[],"tool_calls":2}
        class Agent:
            def __init__(self,*args,**kwargs):pass
            def ask(self,*args,**kwargs):return result
        displayed=[]
        state={"NOTEBOOK_SECRETS":{},"OMDB_MAPPINGS":{},"TMDB_MAPPINGS":{},"ENABLE_WEB_DISCOVERY":True,
            "catalog":catalog,"search":None,"llm":None,"QUESTION":"Review","MODE":"HYBRID","display":displayed.append}
        with patch("pjflim_agent.agent.MovieAgent",Agent):
            exec((source/"colab_cells/08_agent.py").read_text(),state)
        self.assertIn("https://moveek.com/review/sample",json.dumps(displayed))
        self.assertIn('"da_doc_bai": false',json.dumps(displayed))
