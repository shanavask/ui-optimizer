# %%
from google.cloud import firestore
from pydantic import BaseModel, Field

from google.genai import Client
from google.genai.types import GenerateContentConfig
from google.genai.types import Part, Content
import base64
# %%
task_id = 'CV8BUj1ed6R4SiSWWPLQ'
client = firestore.Client(database="ui-optimizer", project="jfgp-martech-agents")
# %%
runs = client.collection("runs").document(task_id).get().to_dict()
runs
# %%
competitors = runs['audit']['competitors']
competitors
# %%

# %%
comp_0 = client.collection("audits").document(f"{task_id}_page_0_comp_0").get().to_dict()
comp_1 = client.collection("audits").document(f"{task_id}_page_0_comp_1").get().to_dict()
# %%
report = client.collection("reports").document(f"{task_id}_page_0").get().to_dict()
report
# %%
GOOGLE_CLOUD_PROJECT = "jfgp-martech-agents"
GOOGLE_CLOUD_LOCATION = "us-central1"
LLM_MODEL = "gemini-2.5-flash"
# %%
comp_0
# %%
class Findings(BaseModel):
    category: str = Field(default=None, description="The category being analyzed")
    problem_discovered: str = Field(description="The snappy problem statement identified related to the criterion in 3-5 words")
    status: str = Field(default=None, description="The status of the category (good, missing, opportunity)")

class CompetitorOut(BaseModel):        
    final_score: int = Field(default=None, description="The overall score of the website based on the audit normalized to 100")
    url: str = Field(default=None, description="The url being analyzed")
    findings: list[Findings] = Field(default=None, description="A list of findings for each category analyzed")

findings = '\n'.join([f"{u['category']}: {u['reasoning']}" for u in report['findings']])
screenshot = comp_0['screenshot']
prompt = f"""
An AI agent discovered the following findings about a website based on a UI audit. You are tasked to analyze the screenshot of a competitor's website and provide feedback on how well they are doing based on the same criteria. Do your best to assign a status based on what you can see in the screenshot, but feel free to make assumptions if you think they are reasonable. 

Competitor's Name: {competitors[0]['competitor_name']}
Competitor's URL: {competitors[0]['competitor_url']}
The findings are as follows:
{findings}
"""
# %%
image = Part.from_bytes(data=base64.b64decode(screenshot), mime_type="image/jpeg")
# %%
llm_client = Client(vertexai=True, project=GOOGLE_CLOUD_PROJECT, location=GOOGLE_CLOUD_LOCATION)
response = llm_client.models.generate_content(
    model=LLM_MODEL, contents=[prompt, image],
    config=GenerateContentConfig(
        response_mime_type="application/json",
        response_schema=CompetitorOut
    )
)

json_output = response.to_json_dict()['parsed']
# %%
json_output
# %%
