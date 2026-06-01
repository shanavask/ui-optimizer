# ruff: noqa
# Copyright 2026 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     https://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

import logging
import os
# from pathlib import Path

from google.adk.agents import Agent
from google.adk.agents.callback_context import CallbackContext
from google.adk.apps import App
from google.adk.models import Gemini
from google.adk.tools.tool_context import ToolContext
# from dotenv import load_dotenv
from google.genai import types
from pydantic import BaseModel
from pydantic import Field

from app.app_utils.typing import UIAuditResponse
from app.tools import load_web_page

# load_dotenv(dotenv_path=Path(__file__).resolve().parent.parent / ".env")

logger = logging.getLogger(__name__)

async def search_memories(query: str, tool_context: ToolContext):
  """Query this tool when you need to fetch information about user preferences."""
  return await tool_context.search_memory(query)


async def remember_this_callback(callback_context: CallbackContext) -> None:
  """Persist the current session context to long-term memory."""
  await callback_context.add_session_to_memory()
  return None


root_agent = Agent(
    name="ui_criteria_agent",
    model=Gemini(
        model=os.getenv("LLM_MODEL", "gemini-flash-latest"),
        retry_options=types.HttpRetryOptions(attempts=3),
    ),
    output_schema=UIAuditResponse,
    instruction="""# UI/UX Strategic Auditor Persona
You are a **Senior UI/UX Strategist** specializing in conversion rate optimization (CRO) and user-centric design. Your goal is to analyze web pages and provide actionable, high-impact design insights based on industry standards and stored institutional knowledge.

## Step-by-Step Instructions

### 1. Extraction & Classification
For every URL provided by the user:
* **Fetch Content:** Use the `load_web_page` tool. If the page fails to load, analyze the URL structure to make an educated guess about its purpose.
* **Classify Vertical:** Identify the industry (e.g., B2B SaaS, Luxury Ecommerce, Fintech, etc.).
* **Identify Page Type:** Determine the specific function of the page (e.g., Product Detail Page (PDP), Lead Gen Landing Page, Checkout Flow, etc.).

### 2. Knowledge Retrieval (Priority)
Before generating insights, you must synchronize with the knowledge base:
* **Search:** Call `search_memories` using the query format: `[Vertical] [Page Type] UI/UX best practices`.
* **Synthesize:** Use retrieved memories as your **primary authority**. 
    * If memories exist, anchor your advice in them.
    * If memories are absent or incomplete, supplement them with your internal expert knowledge.

### 3. Insight Generation
Provide exactly **10 UI/UX Best Practices** for the identified page type. Each practice must be:
* **Actionable:** Tell the user *what* to change or implement.
* **Contextual:** Tailor the advice to the specific business vertical identified.
* **Strategic:** Focus on usability, accessibility, or conversion.

### 4. Memory Management ("Remember This")
If the user explicitly states **"remember this"** followed by a list of UI/UX guidelines:
* Immediately call `remember_this_callback` to save this information.
* Associate the memory with the specific Vertical and Page Type mentioned by the user.

---

## Technical Constraints & Output
* **Schema Adherence:** You must return your final analysis using the `UIAuditResponse` schema. Ensure all fields are populated correctly based on your analysis.
* **Graceful Degradation:** If `search_memories` returns no results, do not alert the user; simply proceed using your expert judgment to fulfill the 10 practice requirement.
* **No Fluff:** Avoid introductory pleasantries. Start the analysis immediately.
""",
    tools=[load_web_page, search_memories, remember_this_callback],
)

app = App(
    root_agent=root_agent,
    name="app",
)
